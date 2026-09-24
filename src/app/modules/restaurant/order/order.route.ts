import express from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { locationFilter, requireLocationId } from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import idempotency from '../../../middlewares/idempotency';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { PERMISSION } from '../../user/user.constant';
import { OrderServices } from './order.service';
import { ORDER_TYPE } from './order.interface';
import { KdsServices } from './kds.service';
import { body, objectId, positiveMinor } from '../../../utils/zod';

const router = express.Router();
const P = PERMISSION;

export const itemInput = z.object({
  menuItemId: objectId,
  quantity: z.number().int().min(1).max(99),
  modifiers: z.array(z.object({ groupId: objectId, optionId: objectId, quantity: z.number().int().min(1).optional() })).optional(),
  specialInstructions: z.string().max(200).optional(),
  course: z.number().int().min(1).max(9).optional(),
  seat: z.number().int().min(1).max(50).optional(),
  checkNo: z.number().int().min(1).optional(),
});

const fireFlag = z.union([z.boolean(), z.literal('ALL')]).optional();

export const createOrderBody = {
  outletId: objectId,
  type: z.enum(Object.values(ORDER_TYPE) as [string, ...string[]]).optional(),
  tableId: objectId.optional(),
  covers: z.number().int().min(0).max(200).optional(),
  guestId: objectId.optional(),
  roomStayId: objectId.optional(),
  items: z.array(itemInput).min(1).max(200),
  notes: z.string().max(500).optional(),
  clientOrderId: z.string().max(64).optional(),
  orderNumber: z.string().max(20).optional(),
  fire: fireFlag,
  delivery: z.object({ address: z.string().optional(), phone: z.string().optional() }).optional(),
};

router.use(tenantUser(), requireModule('RESTAURANT'));

router.post(
  '/',
  authorize(P.POS_ORDER),
  locationScope(),
  idempotency({ required: false }),
  validateRequest(body(createOrderBody)),
  catchAsync(async (req, res) => ok(res, 'Order created successfully', await OrderServices.createOrder(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.get(
  '/',
  authorize(P.POS_ORDER, P.REPORTS_VIEW, P.KDS_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const result = await OrderServices.listOrders(locationFilter(req), req.query);
    ok(res, 'Orders retrieved successfully', result.data, { meta: result.meta });
  }),
);

// ----- Kitchen display -----
router.get(
  '/kitchen-queue',
  authorize(P.KDS_VIEW),
  locationScope(),
  catchAsync(async (req, res) =>
    ok(res, 'Kitchen queue retrieved successfully', await KdsServices.queue(requireLocationId(req), { stationId: req.query.stationId as string | undefined, outletId: req.query.outletId as string | undefined })),
  ),
);

router.get(
  '/kitchen-queue/all-day',
  authorize(P.KDS_VIEW),
  locationScope(),
  catchAsync(async (req, res) => ok(res, 'All-day counts', await KdsServices.allDay(requireLocationId(req), req.query.stationId as string | undefined))),
);

router.post(
  '/kitchen-queue/items',
  authorize(P.KDS_UPDATE),
  validateRequest(body({ orderId: objectId, itemIds: z.array(objectId).min(1), status: z.enum(['COOKING', 'READY']) })),
  catchAsync(async (req, res) => ok(res, 'Items updated', await KdsServices.setItemStatus(req, req.body.orderId, req.body.itemIds, req.body.status))),
);

router.post(
  '/kitchen-queue/bump',
  authorize(P.KDS_UPDATE),
  validateRequest(body({ orderId: objectId, stationId: objectId })),
  catchAsync(async (req, res) => ok(res, 'Ticket bumped', await KdsServices.bump(req, req.body.orderId, req.body.stationId))),
);

router.post(
  '/kitchen-queue/recall',
  authorize(P.KDS_UPDATE),
  validateRequest(body({ orderId: objectId, stationId: objectId })),
  catchAsync(async (req, res) => ok(res, 'Ticket recalled', await KdsServices.recall(req, req.body.orderId, req.body.stationId))),
);

router.get(
  '/kitchen-queue/prep-times',
  authorize(P.REPORTS_VIEW, P.KDS_VIEW),
  locationScope(),
  catchAsync(async (req, res) =>
    ok(res, 'Prep-time analytics', await KdsServices.prepTimes(requireLocationId(req), String(req.query.from), String(req.query.to))),
  ),
);

// ----- One order -----
router.get(
  '/:id',
  authorize(P.POS_ORDER, P.KDS_VIEW, P.REPORTS_VIEW),
  catchAsync(async (req, res) => ok(res, 'Order retrieved successfully', await OrderServices.getOrder(req.params.id as string))),
);

router.get(
  '/:id/receipt',
  authorize(P.POS_ORDER, P.POS_PAY),
  catchAsync(async (req, res) =>
    ok(res, 'Receipt', await OrderServices.receipt(req.params.id as string, req.query.checkNo ? Number(req.query.checkNo) : undefined)),
  ),
);

router.post(
  '/:id/items',
  authorize(P.POS_ORDER),
  validateRequest(body({ items: z.array(itemInput).min(1).max(100), fire: fireFlag })),
  catchAsync(async (req, res) => ok(res, 'Items added', await OrderServices.addItems(req, req.params.id as string, req.body.items, req.body.fire ?? true))),
);

router.patch(
  '/:id/items/:itemId',
  authorize(P.POS_ORDER),
  validateRequest(
    body({
      quantity: z.number().int().min(1).optional(),
      specialInstructions: z.string().max(200).optional(),
      seat: z.number().int().min(1).optional(),
      course: z.number().int().min(1).optional(),
      checkNo: z.number().int().min(1).optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Item updated', await OrderServices.updateItem(req.params.id as string, req.params.itemId as string, req.body))),
);

router.post(
  '/:id/items/:itemId/void',
  authorize(P.POS_ORDER, P.POS_VOID),
  validateRequest(body({ reason: z.string().min(2), waste: z.boolean().optional() })),
  catchAsync(async (req, res) => ok(res, 'Item voided', await OrderServices.voidItem(req, req.params.id as string, req.params.itemId as string, req.body))),
);

router.post(
  '/:id/fire',
  authorize(P.POS_ORDER),
  validateRequest(body({ course: z.number().int().min(1).optional(), itemIds: z.array(objectId).optional() })),
  catchAsync(async (req, res) => ok(res, 'Sent to kitchen', await OrderServices.fire(req, req.params.id as string, req.body))),
);

router.post(
  '/:id/accept',
  authorize(P.POS_ORDER),
  catchAsync(async (req, res) => ok(res, 'Guest order accepted', await OrderServices.accept(req, req.params.id as string))),
);

router.post(
  '/:id/served',
  authorize(P.POS_ORDER),
  validateRequest(body({ itemIds: z.array(objectId).min(1) })),
  catchAsync(async (req, res) => ok(res, 'Items served', await OrderServices.markServed(req, req.params.id as string, req.body.itemIds))),
);

router.post(
  '/:id/discounts',
  authorize(P.POS_DISCOUNT, P.POS_ORDER),
  validateRequest(
    body({
      type: z.enum(['PERCENT', 'AMOUNT', 'COMP']),
      value: z.number().int().min(0),
      reason: z.string().min(2),
      itemId: objectId.optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Discount applied', await OrderServices.applyDiscount(req, req.params.id as string, req.body))),
);

router.delete(
  '/:id/discounts',
  authorize(P.POS_DISCOUNT),
  validateRequest(body({ discountId: objectId.optional(), itemId: objectId.optional() })),
  catchAsync(async (req, res) => ok(res, 'Discount removed', await OrderServices.removeDiscount(req.params.id as string, req.body))),
);

router.post(
  '/:id/split',
  authorize(P.POS_ORDER),
  validateRequest(
    body({
      mode: z.enum(['ITEMS', 'SEATS', 'EVEN', 'RESET']),
      assignments: z.array(z.object({ itemId: objectId, checkNo: z.number().int().min(1) })).optional(),
      parts: z.number().int().min(2).max(20).optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Checks updated', await OrderServices.splitChecks(req.params.id as string, req.body))),
);

router.get(
  '/:id/checks',
  authorize(P.POS_ORDER, P.POS_PAY),
  catchAsync(async (req, res) => {
    const order = await OrderServices.getOrder(req.params.id as string);
    ok(res, 'Checks', await OrderServices.checksSummary(order));
  }),
);

router.post(
  '/:id/transfer',
  authorize(P.POS_ORDER),
  validateRequest(body({ tableId: objectId })),
  catchAsync(async (req, res) => ok(res, 'Order moved', await OrderServices.transferTable(req, req.params.id as string, req.body.tableId))),
);

router.post(
  '/:id/merge',
  authorize(P.POS_ORDER),
  validateRequest(body({ sourceOrderIds: z.array(objectId).min(1) })),
  catchAsync(async (req, res) => ok(res, 'Orders merged', await OrderServices.mergeOrders(req, req.params.id as string, req.body.sourceOrderIds))),
);

router.post(
  '/:id/split-order',
  authorize(P.POS_ORDER),
  validateRequest(body({ itemIds: z.array(objectId).min(1), tableId: objectId.optional() })),
  catchAsync(async (req, res) => ok(res, 'Order split', await OrderServices.splitOrder(req, req.params.id as string, req.body))),
);

router.post(
  '/:id/guest',
  authorize(P.POS_ORDER),
  validateRequest(body({ guestId: objectId.nullable().optional(), roomStayId: objectId.nullable().optional() })),
  catchAsync(async (req, res) => ok(res, 'Guest linked', await OrderServices.setGuest(req.params.id as string, req.body))),
);

router.post(
  '/:id/request-bill',
  authorize(P.POS_ORDER),
  catchAsync(async (req, res) => ok(res, 'Bill requested', await OrderServices.requestBill(req.params.id as string))),
);

router.post(
  '/:id/close',
  authorize(P.POS_PAY),
  catchAsync(async (req, res) => ok(res, 'Order closed', await OrderServices.closeOrder(req, req.params.id as string))),
);

router.post(
  '/:id/reopen',
  authorize(P.POS_ORDER),
  validateRequest(body({ reason: z.string().min(2) })),
  catchAsync(async (req, res) => ok(res, 'Order reopened', await OrderServices.reopenOrder(req, req.params.id as string, req.body.reason))),
);

router.post(
  '/:id/void',
  authorize(P.POS_VOID, P.POS_ORDER),
  validateRequest(body({ reason: z.string().min(2) })),
  catchAsync(async (req, res) => ok(res, 'Order voided', await OrderServices.voidOrder(req, req.params.id as string, req.body.reason))),
);

// Payment shortcut for the POS (same as POST /payment with target ORDER)
router.post(
  '/:id/payments',
  authorize(P.POS_PAY),
  locationScope(),
  idempotency(),
  validateRequest(
    body({
      checkNo: z.number().int().min(1).optional(),
      method: z.string(),
      amountMinor: positiveMinor,
      tipMinor: positiveMinor.optional(),
      tenderedMinor: positiveMinor.optional(),
      reference: z.string().optional(),
      clientRef: z.string().max(64).optional(),
      offline: z.boolean().optional(),
      roomCharge: z.object({ roomNumber: z.string().optional(), roomStayId: objectId.optional(), guestLastName: z.string().optional(), signatureUrl: z.string().optional() }).optional(),
      companyAccountId: objectId.optional(),
      guestId: objectId.optional(),
    }),
  ),
  catchAsync(async (req, res) => {
    const { PaymentService } = await import('../../payment/payment.service');
    const { checkNo, ...rest } = req.body;
    const result = await PaymentService.takePayment(req, { ...rest, target: { kind: 'ORDER', id: req.params.id as string, checkNo } });
    ok(res, 'Payment recorded', result, { statusCode: httpStatus.CREATED });
  }),
);

export const OrderRoutes = router;
