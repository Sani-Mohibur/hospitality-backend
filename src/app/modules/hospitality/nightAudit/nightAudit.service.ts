import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { NightAuditRun } from './nightAudit.model';
import { Location } from '../../location/location.model';
import { Tenant } from '../../tenant/tenant.model';
import { RoomStay } from '../reservation/reservation.model';
import { STAY_STATUS } from '../reservation/reservation.interface';
import { ReservationServices } from '../reservation/reservation.service';
import { FolioLedger } from '../folio/folio.ledger';
import { FolioLine } from '../folio/folio.model';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE } from '../folio/folio.interface';
import { HousekeepingServices } from '../housekeeping/housekeeping.service';
import { Allotment } from '../inventory/hotelInventory.model';
import { HotelInventory } from '../inventory/hotelInventory.service';
import { Room, RoomBlock } from '../room/room.model';
import { Payment } from '../../payment/payment.model';
import { Shift } from '../../shift/shift.model';
import { activity } from '../../auditLog/auditLog.service';
import { runInTransaction } from '../../../utils/transaction';
import { requestContext } from '../../../utils/requestContext';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { addDays, localDate, localMinutes, parseTimeOfDay } from '../../../utils/businessDate';
import { found } from '../../../utils/query';
import logger from '../../../utils/logger';

type TId = Types.ObjectId | string;

const orderModel = async () => (await import('../../restaurant/order/order.model')).Order;

// Checklist shown before running: blocking issues must be fixed first.
const preview = async (locationId: TId) => {
  const location = found(await Location.findById(locationId).lean(), 'Location');
  const date = location.businessDate;
  const Order = await orderModel();
  const [pendingArrivals, dueOuts, inHouse, openOrders, openShifts] = await Promise.all([
    RoomStay.find({ locationId, status: STAY_STATUS.RESERVED, arrivalDate: { $lte: date } }).populate('roomId', 'roomNumber').lean(),
    RoomStay.find({ locationId, status: STAY_STATUS.CHECKED_IN, departureDate: { $lte: date } }).populate('roomId', 'roomNumber').lean(),
    RoomStay.countDocuments({ locationId, status: STAY_STATUS.CHECKED_IN, departureDate: { $gt: date } }),
    Order.countDocuments({ locationId, status: 'OPEN', businessDate: { $lte: date } }),
    Shift.countDocuments({ locationId, status: 'OPEN', businessDate: { $lte: date } }),
  ]);
  const blocking = dueOuts.map((s) => `Room ${(s.roomId as any)?.roomNumber || '?'} was due out on ${s.departureDate}: check out or extend`);
  const warnings = [
    ...(pendingArrivals.length ? [`${pendingArrivals.length} arrival(s) not checked in will become no-shows`] : []),
    ...(openOrders ? [`${openOrders} outlet order(s) are still open`] : []),
    ...(openShifts ? [`${openShifts} cash shift(s) are still open`] : []),
  ];
  return {
    businessDate: date,
    nextBusinessDate: addDays(date, 1),
    canRun: blocking.length === 0,
    blocking,
    warnings,
    roomNightsToPost: inHouse,
    pendingArrivals: pendingArrivals.map((s) => ({ stayId: s._id, reservationId: s.reservationId, roomNumber: (s.roomId as any)?.roomNumber })),
  };
};

// Posts one night of room revenue for a stay, splitting out package components.
const postRoomNight = async (stay: any, date: string) => {
  const night = stay.nightlyRates.find((n: { date: string }) => n.date === date);
  if (!night || !stay.folioId) return 0;
  const persons = stay.adults + stay.children;
  let packagesTotal = 0;
  for (const pkg of stay.packages || []) {
    const amount = pkg.per === 'PERSON' ? pkg.amountMinor * persons : pkg.amountMinor;
    if (!amount) continue;
    packagesTotal += amount;
    await FolioLedger.postLine({
      folioId: stay.folioId,
      type: FOLIO_LINE_TYPE.CHARGE,
      code: pkg.chargeCode,
      description: `${pkg.label} (package)`,
      unitAmountMinor: amount,
      businessDate: date,
      source: { kind: FOLIO_SOURCE.PACKAGE, roomStayId: stay._id, date },
      postingKey: `PKG:${stay._id}:${date}:${pkg.chargeCode}`,
      skipCreditLimit: true,
    });
  }
  await FolioLedger.postLine({
    folioId: stay.folioId,
    type: FOLIO_LINE_TYPE.CHARGE,
    code: 'ROOM',
    description: `Room ${date}`,
    unitAmountMinor: Math.max(0, night.amountMinor - packagesTotal),
    businessDate: date,
    source: { kind: FOLIO_SOURCE.ROOM_NIGHT, roomStayId: stay._id, date },
    postingKey: `RN:${stay._id}:${date}`,
    skipCreditLimit: true,
  });
  return night.amountMinor;
};

// Daily manager report for a closed business date.
const dailyReport = async (locationId: TId, date: string) => {
  const oid = new Types.ObjectId(String(locationId));
  const Order = await orderModel();
  const [roomsTotal, ooo, lines, soldStays, arrivals, departures, noShows, payments, fnb] = await Promise.all([
    Room.countDocuments({ locationId, isActive: true }),
    RoomBlock.countDocuments({ locationId, type: 'OUT_OF_ORDER', releasedAt: null, from: { $lte: date }, to: { $gt: date } }),
    FolioLine.aggregate([
      { $match: { locationId: oid, businessDate: date, type: { $ne: 'PAYMENT' }, code: { $ne: 'XFER' } } },
      { $group: { _id: '$code', net: { $sum: '$netMinor' }, tax: { $sum: '$taxMinor' }, gross: { $sum: '$amountMinor' } } },
    ]),
    RoomStay.countDocuments({ locationId, status: { $in: [STAY_STATUS.CHECKED_IN, STAY_STATUS.CHECKED_OUT] }, arrivalDate: { $lte: date }, departureDate: { $gt: date } }),
    RoomStay.countDocuments({ locationId, arrivalDate: date, status: { $in: [STAY_STATUS.CHECKED_IN, STAY_STATUS.CHECKED_OUT] } }),
    RoomStay.countDocuments({ locationId, departureDate: date, status: STAY_STATUS.CHECKED_OUT }),
    RoomStay.countDocuments({ locationId, arrivalDate: date, status: STAY_STATUS.NO_SHOW }),
    // Payments that settled bills of this business date (outlet orders or folio lines).
    Payment.aggregate([
      { $match: { locationId: oid, status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } },
      { $lookup: { from: 'orders', localField: 'target.id', foreignField: '_id', as: 'order' } },
      { $lookup: { from: 'foliolines', localField: 'folioLineIds', foreignField: '_id', as: 'lines' } },
      { $match: { $or: [{ 'order.businessDate': date }, { 'lines.businessDate': date }] } },
      { $group: { _id: '$method', amount: { $sum: { $subtract: [{ $add: ['$amountMinor', '$tipMinor'] }, '$refundedMinor'] } }, count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { locationId: oid, businessDate: date, status: 'CLOSED' } },
      { $group: { _id: '$outletId', orders: { $sum: 1 }, covers: { $sum: '$covers' }, net: { $sum: { $subtract: ['$totals.totalMinor', '$totals.taxMinor'] } }, gross: { $sum: '$totals.totalMinor' } } },
    ]),
  ]);
  const roomRevenue = lines.filter((l) => l._id === 'ROOM').reduce((s, l) => s + l.net, 0);
  const totalRevenue = lines.reduce((s, l) => s + l.net, 0);
  const available = roomsTotal - ooo;
  return {
    businessDate: date,
    rooms: {
      total: roomsTotal,
      outOfOrder: ooo,
      available,
      sold: soldStays,
      occupancyPct: available ? Math.round((soldStays / available) * 10000) / 100 : 0,
      adrMinor: soldStays ? Math.round(roomRevenue / soldStays) : 0,
      revparMinor: available ? Math.round(roomRevenue / available) : 0,
      trevparMinor: available ? Math.round(totalRevenue / available) : 0,
      arrivals,
      departures,
      noShows,
    },
    revenueByCode: lines,
    roomRevenueMinor: roomRevenue,
    totalRevenueMinor: totalRevenue,
    fnbByOutlet: fnb,
    paymentsByMethod: payments,
  };
};

// Runs the audit for one location. Each stay posts in its own transaction, and all
// postings are keyed, so a failed run can simply be run again.
const run = async (locationId: TId, options: { userId?: string; auto?: boolean } = {}) => {
  const check = await preview(locationId);
  if (!check.canRun) throw new AppError(httpStatus.CONFLICT, `Night audit blocked: ${check.blocking.join('; ')}`);
  const date = check.businessDate;

  let auditRun;
  try {
    auditRun = await NightAuditRun.create({ locationId, businessDate: date, auto: Boolean(options.auto), startedBy: options.userId, warnings: check.warnings });
  } catch (err: any) {
    if (err?.code === 11000) throw new AppError(httpStatus.CONFLICT, `Night audit for ${date} is already running or done`);
    throw err;
  }

  const steps: { name: string; count: number }[] = [];
  try {
    // 1. No-shows
    let noShows = 0;
    for (const s of check.pendingArrivals) {
      await ReservationServices.markNoShow(s.stayId, { approvedBy: options.userId });
      noShows += 1;
    }
    steps.push({ name: 'No-shows', count: noShows });

    // 2. Room and package charges for tonight
    const inHouse = await RoomStay.find({ locationId, status: STAY_STATUS.CHECKED_IN, arrivalDate: { $lte: date }, departureDate: { $gt: date } }).lean();
    let posted = 0;
    for (const stay of inHouse) {
      await runInTransaction(() => postRoomNight(stay, date));
      posted += 1;
    }
    steps.push({ name: 'Room nights posted', count: posted });

    // 3. Allotments inside their release window
    const next = addDays(date, 1);
    const allotments = await Allotment.find({ locationId, status: 'ACTIVE' });
    let released = 0;
    for (const a of allotments) {
      released += await HotelInventory.releaseAllotmentNights(a._id, addDays(next, a.releaseDays));
    }
    steps.push({ name: 'Allotment rooms released', count: released });

    // 4. Close the day
    const report = await dailyReport(locationId, date);
    await Location.updateOne({ _id: locationId, businessDate: date }, { businessDate: next, 'nightAudit.lastRunAt': new Date() });

    // 5. Tomorrow's housekeeping list
    const hk = await HousekeepingServices.generateTasks(locationId, next);
    steps.push({ name: 'Housekeeping tasks created', count: hk.created });

    auditRun.status = 'COMPLETED';
    auditRun.finishedAt = new Date();
    auditRun.steps = steps;
    auditRun.report = report;
    await auditRun.save();
    await activity.record({
      action: 'NIGHT_AUDIT',
      entity: 'Location',
      entityId: locationId,
      locationId,
      actorId: options.userId,
      message: `Night audit closed ${date}${options.auto ? ' (automatic)' : ''}: ${posted} room night(s), ${noShows} no-show(s)`,
    });
    const tenantId = requestContext.get()!.tenantId!;
    void publish({ tenantId, locationId, rooms: [socketRooms.location(locationId)], event: 'business_date_changed', data: { businessDate: next } });
    const { ReportScheduleService } = await import('../../report/reportSchedule.service');
    void ReportScheduleService.sendDailyReport(locationId, report).catch((err: unknown) => logger.warn(err, 'Daily report email failed'));
    return auditRun;
  } catch (err: any) {
    auditRun.status = 'FAILED';
    auditRun.error = String(err?.message || err);
    auditRun.steps = steps;
    auditRun.finishedAt = new Date();
    await auditRun.save();
    throw err;
  }
};

const history = async (locationId: TId, limit = 30) =>
  NightAuditRun.find({ locationId }).sort({ businessDate: -1 }).limit(limit).select('-report').lean();

const getRun = async (locationId: TId, businessDate: string) =>
  found(await NightAuditRun.findOne({ locationId, businessDate, status: 'COMPLETED' }).lean(), 'Night audit');

// Scheduled job: runs the audit for locations with auto-run once their local time passes runAt.
const runScheduled = async () => {
  const locations = await requestContext.asSystem(() => Location.find({ 'nightAudit.autoRun': true, isActive: true }).lean());
  for (const location of locations) {
    const today = localDate(location.timezone);
    if (location.businessDate >= today) continue;
    if (localMinutes(location.timezone) < parseTimeOfDay(location.nightAudit.runAt)) continue;
    const tenant = await requestContext.asSystem(() => Tenant.findById(location.tenantId).select('status isActive').lean());
    if (!tenant?.isActive || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') continue;
    await requestContext.asTenant(String(location.tenantId), async () => {
      try {
        await run(location._id, { auto: true });
      } catch (err: any) {
        const { AlertService } = await import('../../alert/alert.service');
        await AlertService.raise({
          type: 'NIGHT_AUDIT_FAILED',
          severity: 'HIGH',
          locationId: location._id,
          title: `Automatic night audit did not run for ${location.businessDate}`,
          message: String(err?.message || err),
          dedupeKey: `audit:${location._id}:${location.businessDate}`,
        });
      }
    });
  }
};

export const NightAuditServices = { preview, run, history, getRun, dailyReport, runScheduled, postRoomNight };
