import express from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { locationFilter, requireLocationId } from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import AppError from '../../../errors/AppError';
import { PERMISSION } from '../../user/user.constant';
import { Table } from './table.model';
import { TABLE_STATUS } from './table.interface';
import { TableBooking, TABLE_BOOKING_STATUS, WaitlistEntry } from './tableBooking.model';
import { Order } from '../order/order.model';
import { ORDER_STATUS } from '../order/order.interface';
import { Outlet } from '../../outlet/outlet.model';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { randomToken } from '../../../utils/crypto';
import { sendSms } from '../../../utils/sms';
import { activity } from '../../auditLog/auditLog.service';
import { found } from '../../../utils/query';
import { body, objectId } from '../../../utils/zod';
import logger from '../../../utils/logger';

const router = express.Router();
const P = PERMISSION;

const tableFields = z.object({
  tableNumber: z.string().min(1),
  capacity: z.number().int().min(1),
  outletId: objectId,
  zone: z.string().optional(),
  shape: z.enum(['SQUARE', 'ROUND', 'RECT', 'BAR']).optional(),
  position: z.object({ x: z.number(), y: z.number(), w: z.number().optional(), h: z.number().optional(), rotation: z.number().optional() }).optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('RESTAURANT'));

// Live floor plan: table status, open order, and bookings in the next hour.
router.get(
  '/floor',
  authorize(P.POS_ORDER, P.TABLE_BOOKINGS),
  locationScope(),
  catchAsync(async (req, res) => {
    const outletId = String(req.query.outletId || '');
    if (!outletId) throw new AppError(httpStatus.BAD_REQUEST, 'outletId is required');
    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 60000);
    const [tables, orders, bookings] = await Promise.all([
      Table.find({ outletId, locationId: requireLocationId(req), isActive: true }).sort({ zone: 1, tableNumber: 1 }).lean(),
      Order.find({ outletId, status: ORDER_STATUS.OPEN, tableId: { $ne: null } }).populate('serverId', 'name').lean(),
      TableBooking.find({ outletId, status: { $in: ['BOOKED', 'CONFIRMED'] }, startAt: { $gte: new Date(now.getTime() - 30 * 60000), $lte: soon } }).lean(),
    ]);
    const orderBy = new Map(orders.map((o) => [String(o.tableId), o]));
    const floor = tables.map((t) => {
      const order = orderBy.get(String(t._id));
      const booking = bookings.find((b) => b.tableIds.map(String).includes(String(t._id)));
      return {
        ...t,
        reservedSoon: booking ? { bookingId: booking._id, name: booking.name, partySize: booking.partySize, startAt: booking.startAt } : null,
        order: order && {
          _id: order._id,
          orderNumber: order.orderNumber,
          covers: order.covers,
          totalMinor: order.totals.totalMinor,
          balanceMinor: order.totals.balanceMinor,
          server: (order.serverId as any)?.name,
          openedMinutes: Math.floor((now.getTime() - new Date((order as any).createdAt).getTime()) / 60000),
          itemsReady: order.items.filter((i) => i.status === 'READY').length,
        },
      };
    });
    ok(res, 'Floor plan', floor);
  }),
);

router.get(
  '/',
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const filter: Record<string, unknown> = { ...locationFilter(req) };
    if (req.query.outletId) filter.outletId = req.query.outletId;
    ok(res, 'Tables retrieved successfully', await Table.find(filter).sort({ tableNumber: 1 }).lean());
  }),
);

router.post(
  '/',
  authorize(P.TABLES_MANAGE),
  validateRequest(z.object({ body: tableFields })),
  catchAsync(async (req, res) => {
    const outlet = found(await Outlet.findById(req.body.outletId).lean(), 'Outlet');
    const table = await Table.create({ ...req.body, locationId: outlet.locationId, qrToken: randomToken(12) });
    ok(res, 'Table created successfully', table, { statusCode: httpStatus.CREATED });
  }),
);

// Save the whole floor layout in one call from the floor-plan editor.
router.put(
  '/layout',
  authorize(P.TABLES_MANAGE),
  validateRequest(body({ tables: z.array(z.object({ id: objectId, zone: z.string().optional(), shape: z.enum(['SQUARE', 'ROUND', 'RECT', 'BAR']).optional(), position: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), rotation: z.number() }) })).min(1) })),
  catchAsync(async (req, res) => {
    for (const t of req.body.tables) {
      await Table.updateOne({ _id: t.id }, { position: t.position, ...(t.zone ? { zone: t.zone } : {}), ...(t.shape ? { shape: t.shape } : {}) });
    }
    ok(res, 'Layout saved', { updated: req.body.tables.length });
  }),
);

// ----- Table bookings -----
const overlapping = async (tableIds: string[], startAt: Date, durationMinutes: number, excludeId?: string) => {
  const end = new Date(startAt.getTime() + durationMinutes * 60000);
  const candidates = await TableBooking.find({
    tableIds: { $in: tableIds },
    status: { $in: ['BOOKED', 'CONFIRMED', 'SEATED'] },
    startAt: { $lt: end, $gte: new Date(startAt.getTime() - 6 * 3600000) },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();
  return candidates.filter((b) => new Date(b.startAt.getTime() + b.durationMinutes * 60000) > startAt);
};

router.get(
  '/bookings/availability',
  authorize(P.TABLE_BOOKINGS),
  catchAsync(async (req, res) => {
    const outletId = String(req.query.outletId);
    const startAt = new Date(String(req.query.startAt));
    const partySize = Number(req.query.partySize || 2);
    const duration = Number(req.query.durationMinutes || 90);
    if (Number.isNaN(startAt.getTime())) throw new AppError(httpStatus.BAD_REQUEST, 'startAt must be an ISO date-time');
    const tables = await Table.find({ outletId, isActive: true, capacity: { $gte: partySize } }).sort({ capacity: 1 }).lean();
    const free = [];
    for (const t of tables) if (!(await overlapping([String(t._id)], startAt, duration)).length) free.push(t);
    ok(res, 'Free tables', free);
  }),
);

router.get(
  '/bookings',
  authorize(P.TABLE_BOOKINGS),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const filter: Record<string, unknown> = { ...locationFilter(req) };
    if (req.query.outletId) filter.outletId = req.query.outletId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.startAt = { ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}) };
    }
    ok(res, 'Table bookings', await TableBooking.find(filter).populate('tableIds', 'tableNumber').sort({ startAt: 1 }).lean());
  }),
);

router.post(
  '/bookings',
  authorize(P.TABLE_BOOKINGS),
  validateRequest(
    body({
      outletId: objectId,
      name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      guestId: objectId.optional(),
      partySize: z.number().int().min(1).max(100),
      startAt: z.string().datetime(),
      durationMinutes: z.number().int().min(15).max(600).optional(),
      tableIds: z.array(objectId).optional(),
      source: z.enum(['PHONE', 'WALK_IN', 'ONLINE', 'IN_HOUSE']).optional(),
      notes: z.string().optional(),
    }),
  ),
  catchAsync(async (req, res) => {
    const outlet = found(await Outlet.findById(req.body.outletId).lean(), 'Outlet');
    const startAt = new Date(req.body.startAt);
    const duration = req.body.durationMinutes || 90;
    if (req.body.tableIds?.length) {
      const clash = await overlapping(req.body.tableIds, startAt, duration);
      if (clash.length) throw new AppError(httpStatus.CONFLICT, `Table already booked for ${clash[0]!.name}`);
      const seats = (await Table.find({ _id: { $in: req.body.tableIds } }).lean()).reduce((s, t) => s + t.capacity, 0);
      if (seats < req.body.partySize) throw new AppError(httpStatus.BAD_REQUEST, `Those tables seat ${seats}`);
    }
    const booking = await TableBooking.create({ ...req.body, startAt, durationMinutes: duration, locationId: outlet.locationId, createdBy: req.user.id });
    await activity.record({ action: 'TABLE_BOOKED', entity: 'TableBooking', entityId: booking._id, message: `Table booking for ${booking.name}, ${booking.partySize} guests at ${startAt.toISOString()}` });
    void publish({ tenantId: req.user.tenantId, locationId: outlet.locationId, rooms: [socketRooms.outlet(outlet._id)], event: 'table_booking_created', data: { bookingId: booking._id } });
    ok(res, 'Table booked', booking, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/bookings/:id',
  authorize(P.TABLE_BOOKINGS),
  validateRequest(
    body({
      status: z.enum(Object.values(TABLE_BOOKING_STATUS) as [string, ...string[]]).optional(),
      tableIds: z.array(objectId).optional(),
      startAt: z.string().datetime().optional(),
      partySize: z.number().int().min(1).optional(),
      durationMinutes: z.number().int().min(15).optional(),
      notes: z.string().optional(),
    }),
  ),
  catchAsync(async (req, res) => {
    const booking = found(await TableBooking.findById(req.params.id), 'Table booking');
    const startAt = req.body.startAt ? new Date(req.body.startAt) : booking.startAt;
    const tableIds = req.body.tableIds || booking.tableIds.map(String);
    if ((req.body.startAt || req.body.tableIds || req.body.durationMinutes) && tableIds.length) {
      const clash = await overlapping(tableIds, startAt, req.body.durationMinutes || booking.durationMinutes, String(booking._id));
      if (clash.length) throw new AppError(httpStatus.CONFLICT, `Table already booked for ${clash[0]!.name}`);
    }
    Object.assign(booking, { ...req.body, startAt });
    await booking.save();
    ok(res, 'Table booking updated', booking);
  }),
);

// ----- Waitlist -----
router.get(
  '/waitlist',
  authorize(P.TABLE_BOOKINGS, P.POS_ORDER),
  catchAsync(async (req, res) => {
    ok(res, 'Waitlist', await WaitlistEntry.find({ outletId: String(req.query.outletId), status: { $in: ['WAITING', 'NOTIFIED'] } }).sort({ createdAt: 1 }).lean());
  }),
);

router.post(
  '/waitlist',
  authorize(P.TABLE_BOOKINGS, P.POS_ORDER),
  validateRequest(body({ outletId: objectId, name: z.string().min(1), phone: z.string().optional(), partySize: z.number().int().min(1), quotedMinutes: z.number().int().min(0).optional(), notes: z.string().optional() })),
  catchAsync(async (req, res) => {
    const outlet = found(await Outlet.findById(req.body.outletId).lean(), 'Outlet');
    ok(res, 'Added to waitlist', await WaitlistEntry.create({ ...req.body, locationId: outlet.locationId }), { statusCode: httpStatus.CREATED });
  }),
);

// "Your table is ready" by SMS or WhatsApp.
router.post(
  '/waitlist/:id/notify',
  authorize(P.TABLE_BOOKINGS, P.POS_ORDER),
  validateRequest(body({ channel: z.enum(['SMS', 'WHATSAPP']).optional() })),
  catchAsync(async (req, res) => {
    const entry = found(await WaitlistEntry.findById(req.params.id), 'Waitlist entry');
    if (!entry.phone) throw new AppError(httpStatus.BAD_REQUEST, 'No phone number on this entry');
    const outlet = await Outlet.findById(entry.outletId).lean();
    try {
      await sendSms(entry.phone, `Hi ${entry.name}, your table at ${outlet?.name || 'the restaurant'} is ready.`, req.body.channel || 'SMS');
    } catch (err) {
      logger.warn(err, 'Waitlist notification failed');
      throw new AppError(httpStatus.BAD_GATEWAY, 'Could not send the message');
    }
    entry.status = 'NOTIFIED';
    entry.notifiedAt = new Date();
    await entry.save();
    ok(res, 'Guest notified', entry);
  }),
);

router.post(
  '/waitlist/:id/seat',
  authorize(P.TABLE_BOOKINGS, P.POS_ORDER),
  validateRequest(body({ tableId: objectId.optional(), left: z.boolean().optional() })),
  catchAsync(async (req, res) => {
    const entry = found(await WaitlistEntry.findById(req.params.id), 'Waitlist entry');
    entry.status = req.body.left ? 'LEFT' : 'SEATED';
    entry.seatedAt = req.body.left ? undefined : new Date();
    if (req.body.tableId) entry.tableId = req.body.tableId;
    await entry.save();
    ok(res, req.body.left ? 'Removed from waitlist' : 'Seated', entry);
  }),
);

// ----- One table -----
router.get(
  '/:id',
  catchAsync(async (req, res) => ok(res, 'Table retrieved successfully', found(await Table.findById(req.params.id).lean(), 'Table'))),
);

router.patch(
  '/:id',
  authorize(P.TABLES_MANAGE),
  validateRequest(z.object({ body: tableFields.partial() })),
  catchAsync(async (req, res) =>
    ok(res, 'Table updated successfully', found(await Table.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true }), 'Table')),
  ),
);

// Staff may only mark a table cleaning or ready; occupancy follows its orders.
router.patch(
  '/:id/status',
  authorize(P.POS_ORDER),
  validateRequest(body({ status: z.enum([TABLE_STATUS.OPEN, TABLE_STATUS.CLEANING]) })),
  catchAsync(async (req, res) => {
    const table = found(await Table.findById(req.params.id), 'Table');
    const busy = await Order.exists({ tableId: table._id, status: ORDER_STATUS.OPEN });
    if (busy) throw new AppError(httpStatus.CONFLICT, 'The table has an open order');
    table.status = req.body.status;
    await table.save();
    void publish({ tenantId: req.user.tenantId, locationId: table.locationId, rooms: [socketRooms.outlet(table.outletId)], event: 'table_updated', data: { tableId: table._id, status: table.status } });
    ok(res, 'Table status updated', table);
  }),
);

router.post(
  '/:id/rotate-qr',
  authorize(P.TABLES_MANAGE),
  catchAsync(async (req, res) => {
    const table = found(await Table.findByIdAndUpdate(req.params.id, { qrToken: randomToken(12) }, { returnDocument: 'after' }), 'Table');
    ok(res, 'QR code rotated', { tableId: table._id, qrToken: table.qrToken });
  }),
);

router.delete(
  '/:id',
  authorize(P.TABLES_MANAGE),
  catchAsync(async (req, res) => {
    if (await Order.exists({ tableId: req.params.id, status: ORDER_STATUS.OPEN })) throw new AppError(httpStatus.CONFLICT, 'The table has an open order');
    ok(res, 'Table deleted successfully', found(await Table.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false }, { returnDocument: 'after' }), 'Table'));
  }),
);

export const TableRoutes = router;
