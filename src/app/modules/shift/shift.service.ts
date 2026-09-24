import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import AppError from '../../errors/AppError';
import { CashMovement, Shift } from './shift.model';
import { Payment } from '../payment/payment.model';
import { Order } from '../restaurant/order/order.model';
import { Location } from '../location/location.model';
import { Tenant } from '../tenant/tenant.model';
import { ApprovalService } from '../approval/approval.service';
import { activity } from '../auditLog/auditLog.service';
import { requestContext } from '../../utils/requestContext';
import { allocate } from '../restaurant/order/order.pricing';
import { found } from '../../utils/query';

const openShift = async (req: Request, payload: { outletId?: string; openingFloatMinor: number; drawerName?: string }) => {
  const existing = await Shift.findOne({ userId: req.user.id, status: 'OPEN' }).lean();
  if (existing) throw new AppError(httpStatus.CONFLICT, 'You already have an open shift');
  const location = found(await Location.findById(req.locationId).lean(), 'Location');
  const shift = await Shift.create({
    locationId: req.locationId,
    outletId: payload.outletId,
    userId: req.user.id,
    deviceId: req.user.deviceId,
    drawerName: payload.drawerName,
    businessDate: location.businessDate,
    openingFloatMinor: payload.openingFloatMinor,
  });
  await CashMovement.create({ locationId: req.locationId, shiftId: shift._id, type: 'OPENING_FLOAT', amountMinor: payload.openingFloatMinor, createdBy: req.user.id });
  await activity.record({ action: 'SHIFT_OPENED', entity: 'Shift', entityId: shift._id, message: `Shift opened with float ${payload.openingFloatMinor}` });
  return shift;
};

const currentShift = async (userId: string) => Shift.findOne({ userId, status: 'OPEN' }).lean();

const expectedCash = async (shiftId: Types.ObjectId | string) => {
  const rows = await CashMovement.aggregate([{ $match: { shiftId: new Types.ObjectId(String(shiftId)) } }, { $group: { _id: null, total: { $sum: '$amountMinor' } } }]);
  return rows[0]?.total || 0;
};

// Cash drops to the safe, payouts (supplier paid from the till), paid-ins.
const cashMovement = async (req: Request, shiftId: string, payload: { type: 'DROP' | 'PAYOUT' | 'PAID_IN'; amountMinor: number; reason: string }) => {
  const shift = found(await Shift.findOne({ _id: shiftId, status: 'OPEN' }), 'Open shift');
  if (String(shift.userId) !== req.user.id && !req.user.permissions.includes('cash.manage')) {
    throw new AppError(httpStatus.FORBIDDEN, 'This is not your drawer');
  }
  let approvedBy: string | undefined;
  if (payload.type === 'PAYOUT') {
    const tenant = await requestContext.asSystem(() => Tenant.findById(req.user.tenantId).select('settings.approval').lean());
    approvedBy = await ApprovalService.requireApproval(req, 'CASH_PAYOUT', payload.amountMinor > (tenant?.settings?.approval?.cashPayoutOverMinor ?? 0));
  }
  const signed = payload.type === 'PAID_IN' ? payload.amountMinor : -payload.amountMinor;
  if (signed < 0 && (await expectedCash(shift._id)) + signed < 0) throw new AppError(httpStatus.CONFLICT, 'Not that much cash in the drawer');
  const movement = await CashMovement.create({
    locationId: shift.locationId,
    shiftId: shift._id,
    type: payload.type,
    amountMinor: signed,
    reason: payload.reason,
    createdBy: req.user.id,
    approvedBy,
  });
  await activity.record({ action: `CASH_${payload.type}`, entity: 'Shift', entityId: shift._id, approvedBy, message: `${payload.type.toLowerCase()} ${payload.amountMinor}: ${payload.reason}` });
  return movement;
};

// Z report for a shift: tenders, sales, discounts, voids, tips and the cash count.
const shiftReport = async (shiftId: string) => {
  const shift = found(await Shift.findById(shiftId).lean(), 'Shift');
  const until = shift.closedAt || new Date();
  const [payments, movements, orders] = await Promise.all([
    Payment.aggregate([
      { $match: { createdBy: shift.userId, createdAt: { $gte: shift.openedAt, $lte: until }, status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } },
      { $group: { _id: '$method', count: { $sum: 1 }, amountMinor: { $sum: '$amountMinor' }, tipMinor: { $sum: '$tipMinor' }, refundedMinor: { $sum: '$refundedMinor' } } },
    ]),
    CashMovement.aggregate([{ $match: { shiftId: shift._id } }, { $group: { _id: '$type', amountMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } }]),
    Order.find({ serverId: shift.userId, createdAt: { $gte: shift.openedAt, $lte: until } }).lean(),
  ]);
  const closed = orders.filter((o) => o.status === 'CLOSED');
  const items = closed.flatMap((o) => o.items);
  const voided = orders.flatMap((o) => o.items.filter((i) => i.status === 'VOIDED'));
  const byCategory = new Map<string, { quantity: number; netMinor: number }>();
  for (const item of items.filter((i) => i.status !== 'VOIDED')) {
    const key = item.taxCategory;
    const row = byCategory.get(key) || { quantity: 0, netMinor: 0 };
    row.quantity += item.quantity;
    row.netMinor += item.calc?.netMinor || 0;
    byCategory.set(key, row);
  }
  const expected = await expectedCash(shift._id);
  return {
    shift: { _id: shift._id, userId: shift.userId, openedAt: shift.openedAt, closedAt: shift.closedAt, businessDate: shift.businessDate, status: shift.status },
    orders: { count: orders.length, closed: closed.length, covers: closed.reduce((s, o) => s + o.covers, 0) },
    salesByCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
    grossSalesMinor: closed.reduce((s, o) => s + o.totals.totalMinor, 0),
    taxMinor: closed.reduce((s, o) => s + o.totals.taxMinor, 0),
    discountsMinor: closed.reduce((s, o) => s + o.totals.discountMinor, 0),
    serviceChargeMinor: closed.reduce((s, o) => s + o.totals.serviceChargeMinor, 0),
    voids: { count: voided.length, amountMinor: voided.reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0) },
    tenders: payments,
    tipsMinor: payments.reduce((s, p) => s + p.tipMinor, 0),
    cash: {
      movements,
      openingFloatMinor: shift.openingFloatMinor,
      expectedMinor: shift.status === 'CLOSED' ? shift.expectedCashMinor : expected,
      countedMinor: shift.countedCashMinor,
      varianceMinor: shift.varianceMinor,
    },
  };
};

// Blind close: the cashier counts first; the expected amount is shown only afterwards.
const closeShift = async (req: Request, shiftId: string, payload: { countedCashMinor: number; notes?: string }) => {
  const shift = found(await Shift.findOne({ _id: shiftId, status: 'OPEN' }), 'Open shift');
  if (String(shift.userId) !== req.user.id && !req.user.permissions.includes('cash.manage')) {
    throw new AppError(httpStatus.FORBIDDEN, 'This is not your drawer');
  }
  const expected = await expectedCash(shift._id);
  shift.status = 'CLOSED';
  shift.closedAt = new Date();
  shift.closedBy = new Types.ObjectId(req.user.id);
  shift.countedCashMinor = payload.countedCashMinor;
  shift.expectedCashMinor = expected;
  shift.varianceMinor = payload.countedCashMinor - expected;
  shift.notes = payload.notes;
  await shift.save();
  const report = await shiftReport(shiftId);
  shift.report = report as unknown as Record<string, unknown>;
  await shift.save();
  await activity.record({
    action: 'SHIFT_CLOSED',
    entity: 'Shift',
    entityId: shift._id,
    message: `Shift closed. Counted ${payload.countedCashMinor}, expected ${expected}, variance ${shift.varianceMinor}`,
  });
  if (Math.abs(shift.varianceMinor) > 0) {
    const { AlertService } = await import('../alert/alert.service');
    await AlertService.raise({
      type: 'CASH_VARIANCE',
      severity: Math.abs(shift.varianceMinor) > 2000 ? 'HIGH' : 'LOW',
      locationId: shift.locationId,
      title: 'Cash drawer variance',
      message: `Shift closed ${shift.varianceMinor > 0 ? 'over' : 'short'} by ${Math.abs(shift.varianceMinor)}`,
      ref: { kind: 'Shift', id: shift._id },
      dedupeKey: `variance:${shift._id}`,
    });
  }
  return report;
};

const listShifts = async (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const where: Record<string, unknown> = { ...filter };
  if (query.status) where.status = query.status;
  if (query.businessDate) where.businessDate = query.businessDate;
  if (query.userId) where.userId = query.userId;
  return Shift.find(where).select('-report').populate('userId', 'name').sort({ openedAt: -1 }).limit(200).lean();
};

// Tip pool: tips of an outlet for a business date shared by points (e.g. server 10, runner 5).
const tipPool = async (outletId: string, businessDate: string, shares: { userId: string; points: number }[]) => {
  const orders = await Order.find({ outletId, businessDate, status: 'CLOSED' }).select('_id').lean();
  const tips = await Payment.aggregate([
    { $match: { 'target.kind': 'ORDER', 'target.id': { $in: orders.map((o) => o._id) }, status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } } },
    { $group: { _id: null, tipMinor: { $sum: '$tipMinor' } } },
  ]);
  const total = tips[0]?.tipMinor || 0;
  const parts = allocate(total, shares.map((s) => s.points));
  return { outletId, businessDate, totalTipsMinor: total, distribution: shares.map((s, i) => ({ userId: s.userId, points: s.points, amountMinor: parts[i] })) };
};

export const ShiftServices = { openShift, currentShift, cashMovement, closeShift, shiftReport, listShifts, tipPool, expectedCash };
