import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope, { requireLocationId } from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import { PERMISSION } from '../user/user.constant';
import { OrderServices } from '../restaurant/order/order.service';
import { Order } from '../restaurant/order/order.model';
import { MenuServices } from '../restaurant/menuItem/menu.service';
import { Table } from '../restaurant/table/table.model';
import { PaymentService } from '../payment/payment.service';
import { Device } from '../device/device.model';
import { TaxRule } from '../finance/finance.model';
import { Location } from '../location/location.model';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../user/user.model';
import { eventsSince } from '../../utils/realtime';
import { requestContext } from '../../utils/requestContext';
import { body } from '../../utils/zod';

const router = Router();

router.use(tenantUser(), locationScope());

// Everything a POS/KDS needs to keep working offline.
router.get(
  '/bootstrap',
  authorize(PERMISSION.POS_ORDER, PERMISSION.KDS_VIEW),
  catchAsync(async (req, res) => {
    const locationId = requireLocationId(req);
    const outletId = String(req.query.outletId || '');
    if (!outletId) throw new AppError(httpStatus.BAD_REQUEST, 'outletId is required');
    const [menu, tables, openOrders, taxRules, location, tenant, staff, device] = await Promise.all([
      MenuServices.outletMenu(outletId),
      Table.find({ outletId, isActive: true }).lean(),
      Order.find({ outletId, status: 'OPEN' }).lean(),
      TaxRule.find({ isActive: true }).lean(),
      Location.findById(locationId).select('name businessDate timezone currency').lean(),
      requestContext.asSystem(() => Tenant.findById(req.user.tenantId).select('currency settings.taxInclusive settings.offlineRoomChargeLimitMinor branding').lean()),
      User.find({ isActive: true, $or: [{ allLocations: true }, { locationIds: locationId }] }).select('name profileImage role').lean(),
      req.user.deviceId ? Device.findById(req.user.deviceId).select('orderPrefix name').lean() : null,
    ]);
    ok(res, 'Offline bundle', { serverTime: new Date(), location, tenant, menu, tables, openOrders, taxRules, staff, device });
  }),
);

// Real-time events missed while disconnected, by sequence number.
router.get(
  '/events',
  catchAsync(async (req, res) => {
    const since = Number(req.query.since || 0);
    const events = await eventsSince(requireLocationId(req), since, 500);
    ok(res, 'Missed events', { events, lastSeq: events.length ? events[events.length - 1]!.seq : since, more: events.length === 500 });
  }),
);

// Replays the outbox of a device that was offline. Every operation carries a client id,
// so a retried batch never creates duplicates. Operations run in order; each one reports
// its own result.
router.post(
  '/batch',
  authorize(PERMISSION.POS_ORDER),
  validateRequest(
    body({
      operations: z
        .array(
          z.object({
            type: z.enum(['CREATE_ORDER', 'ADD_ITEMS', 'FIRE', 'PAYMENT']),
            clientRef: z.string().min(1).max(64),
            payload: z.record(z.string(), z.any()),
          }),
        )
        .min(1)
        .max(200),
    }),
  ),
  catchAsync(async (req, res) => {
    const results = [];
    const orderIdByClient = new Map<string, string>();
    for (const op of req.body.operations) {
      try {
        const payload = { ...op.payload };
        // Operations may reference an order created earlier in the same batch.
        if (payload.clientOrderId && !payload.orderId) {
          const known = orderIdByClient.get(payload.clientOrderId) || String((await Order.findOne({ clientOrderId: payload.clientOrderId }).select('_id').lean())?._id || '');
          if (known) payload.orderId = known;
        }
        let result: any;
        switch (op.type) {
          case 'CREATE_ORDER': {
            result = await OrderServices.createOrder(req, { ...payload, clientOrderId: payload.clientOrderId || op.clientRef } as any);
            orderIdByClient.set(payload.clientOrderId || op.clientRef, String(result._id));
            break;
          }
          case 'ADD_ITEMS': {
            const order = await Order.findById(payload.orderId).lean();
            if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found');
            // Skip if these items were already added (retried batch).
            const already = order.statusHistory.some((h) => h.remarks === `sync:${op.clientRef}`);
            if (!already) {
              result = await OrderServices.addItems(req, payload.orderId, payload.items, payload.fire ?? true);
              await Order.updateOne({ _id: payload.orderId }, { $push: { statusHistory: { status: 'SYNC', changedAt: new Date(), changedBy: req.user.id, remarks: `sync:${op.clientRef}` } } });
            }
            break;
          }
          case 'FIRE':
            result = await OrderServices.fire(req, payload.orderId, payload).catch((err) => {
              if (/Nothing waiting/.test(err.message)) return null;
              throw err;
            });
            break;
          case 'PAYMENT':
            result = await PaymentService.takePayment(req, { ...payload, clientRef: op.clientRef, offline: true, target: { kind: 'ORDER', id: payload.orderId, checkNo: payload.checkNo } } as any);
            break;
        }
        results.push({ clientRef: op.clientRef, status: 'OK', id: result?._id || result?.payment?._id });
      } catch (err: any) {
        results.push({ clientRef: op.clientRef, status: 'ERROR', statusCode: err.statusCode || 500, message: err.message });
      }
    }
    if (req.user.deviceId) await Device.updateOne({ _id: req.user.deviceId }, { lastSyncAt: new Date(), lastSeenAt: new Date() });
    ok(res, 'Batch processed', { results, failed: results.filter((r) => r.status === 'ERROR').length });
  }),
);

export const SyncRoutes = router;

