import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { DailyRate, IRatePlan, RatePlan } from './rate.model';
import { RoomCategory } from '../roomCategory/roomCategory.model';
import { dateRange, dayOfWeek, nightsBetween } from '../../../utils/businessDate';
import { percentOf } from '../../../utils/money';
import { activity } from '../../auditLog/auditLog.service';
import { found } from '../../../utils/query';
import { IRoomCategory } from '../roomCategory/roomCategory.interface';

type TId = Types.ObjectId | string;
type TPlan = IRatePlan & { _id: Types.ObjectId };
type TRoomType = IRoomCategory & { _id: Types.ObjectId };

const priceOf = (rows: { roomTypeId: Types.ObjectId; amountMinor: number }[], roomTypeId: TId) =>
  rows.find((r) => String(r.roomTypeId) === String(roomTypeId))?.amountMinor;

// Base price of one night before extra guests.
const nightlyBase = async (
  plan: TPlan,
  roomType: TRoomType,
  date: string,
  overrides: Map<string, { amountMinor?: number }>,
  depth = 0,
): Promise<number> => {
  const override = overrides.get(`${plan._id}:${date}`);
  if (override?.amountMinor !== undefined && override.amountMinor !== null) return override.amountMinor;

  if (plan.pricingMode === 'DERIVED' && plan.parentRatePlanId) {
    if (depth > 3) throw new AppError(httpStatus.BAD_REQUEST, 'Rate plan inheritance is too deep');
    const parent = found(await RatePlan.findById(plan.parentRatePlanId).lean(), 'Parent rate plan') as TPlan;
    const parentPrice = await nightlyBase(parent, roomType, date, overrides, depth + 1);
    return Math.max(0, parentPrice + percentOf(parentPrice, plan.adjustBps || 0) + (plan.adjustMinor || 0));
  }

  if (plan.weekendDays?.includes(dayOfWeek(date))) {
    const weekend = priceOf(plan.weekendRates || [], roomType._id);
    if (weekend !== undefined) return weekend;
  }
  return priceOf(plan.rates || [], roomType._id) ?? roomType.baseRateMinor;
};

export type TQuote = {
  ratePlanId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  nights: { date: string; amountMinor: number }[];
  packages: IRatePlan['packages'];
  totalMinor: number;
  restrictions: string[];
};

// Prices a stay night by night and reports any restriction that blocks it.
export const quoteStay = async (input: {
  ratePlanId: TId;
  roomTypeId: TId;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
}): Promise<TQuote> => {
  if (input.arrivalDate >= input.departureDate) throw new AppError(httpStatus.BAD_REQUEST, 'Departure must be after arrival');
  const plan = found(await RatePlan.findOne({ _id: input.ratePlanId, isActive: true }).lean(), 'Rate plan') as TPlan;
  const roomType = found(await RoomCategory.findOne({ _id: input.roomTypeId, isActive: true }).lean(), 'Room type') as TRoomType;
  if (plan.roomTypeIds?.length && !plan.roomTypeIds.map(String).includes(String(roomType._id))) {
    throw new AppError(httpStatus.BAD_REQUEST, `Rate plan ${plan.code} is not sold for ${roomType.name}`);
  }
  if (input.adults > roomType.maxAdults || input.children > roomType.maxChildren || input.adults + input.children > roomType.capacity) {
    throw new AppError(httpStatus.BAD_REQUEST, `${roomType.name} does not fit ${input.adults} adult(s) and ${input.children} child(ren)`);
  }

  const nights = nightsBetween(input.arrivalDate, input.departureDate);
  const planIds = [plan._id, ...(plan.parentRatePlanId ? [plan.parentRatePlanId] : [])];
  const dailyRows = await DailyRate.find({
    ratePlanId: { $in: planIds },
    roomTypeId: roomType._id,
    date: { $gte: input.arrivalDate, $lte: input.departureDate },
  }).lean();
  const overrides = new Map(dailyRows.map((r) => [`${r.ratePlanId}:${r.date}`, r]));

  const restrictions: string[] = [];
  const own = (date: string) => overrides.get(`${plan._id}:${date}`);
  const minLos = Math.max(plan.minLos || 1, own(input.arrivalDate)?.minLos || 1);
  if (nights.length < minLos) restrictions.push(`Minimum stay is ${minLos} night(s)`);
  if (plan.maxLos && nights.length > plan.maxLos) restrictions.push(`Maximum stay is ${plan.maxLos} night(s)`);
  if (own(input.arrivalDate)?.closedToArrival) restrictions.push(`Closed to arrival on ${input.arrivalDate}`);
  if (own(input.departureDate)?.closedToDeparture) restrictions.push(`Closed to departure on ${input.departureDate}`);
  for (const date of nights) if (own(date)?.closed) restrictions.push(`Rate closed on ${date}`);

  const extraAdults = Math.max(0, input.adults - roomType.baseOccupancy);
  const extraChildren = Math.max(0, input.children - Math.max(0, roomType.baseOccupancy - input.adults));
  const extras = extraAdults * roomType.extraAdultMinor + extraChildren * roomType.extraChildMinor;

  const priced = [];
  for (const date of nights) {
    const base = await nightlyBase(plan, roomType, date, overrides);
    priced.push({ date, amountMinor: base + extras });
  }
  return {
    ratePlanId: plan._id,
    roomTypeId: roomType._id,
    nights: priced,
    packages: plan.packages || [],
    totalMinor: priced.reduce((s, n) => s + n.amountMinor, 0),
    restrictions,
  };
};

export const policiesOf = (plan: IRatePlan) => ({
  ratePlanCode: plan.code,
  cancellation: plan.cancellation,
  noShow: plan.noShow,
  deposit: plan.deposit,
  guaranteeRequired: plan.guaranteeRequired,
  isRefundable: plan.isRefundable,
});

// Penalty amount for cancellation / no-show from a policy snapshot.
export const penaltyAmount = (penalty: { type: string; value: number }, nightly: { amountMinor: number }[], totalMinor: number) => {
  switch (penalty.type) {
    case 'NIGHTS':
      return nightly.slice(0, penalty.value).reduce((s, n) => s + n.amountMinor, 0);
    case 'PERCENT':
      return percentOf(totalMinor, penalty.value * 100);
    case 'FIXED':
      return Math.round(penalty.value);
    default:
      return 0;
  }
};

export const depositAmount = (deposit: IRatePlan['deposit'], nightly: { amountMinor: number }[], totalMinor: number) => {
  switch (deposit.type) {
    case 'PERCENT':
      return percentOf(totalMinor, deposit.value * 100);
    case 'NIGHTS':
      return nightly.slice(0, deposit.value).reduce((s, n) => s + n.amountMinor, 0);
    case 'FIXED':
      return Math.round(deposit.value);
    default:
      return 0;
  }
};

// ---------- Rate plan admin ----------
const assertRoomTypes = async (locationId: TId, ids: TId[]) => {
  if (!ids.length) return;
  const count = await RoomCategory.countDocuments({ _id: { $in: ids }, locationId });
  if (count !== new Set(ids.map(String)).size) throw new AppError(httpStatus.BAD_REQUEST, 'Unknown room type for this location');
};

const createRatePlan = async (locationId: string, payload: Partial<IRatePlan>) => {
  const typeIds = [
    ...(payload.roomTypeIds || []),
    ...(payload.rates || []).map((r) => r.roomTypeId),
    ...(payload.weekendRates || []).map((r) => r.roomTypeId),
  ];
  await assertRoomTypes(locationId, typeIds);
  if (payload.pricingMode === 'DERIVED') {
    if (!payload.parentRatePlanId) throw new AppError(httpStatus.BAD_REQUEST, 'Derived plans need a parent rate plan');
    found(await RatePlan.findOne({ _id: payload.parentRatePlanId, locationId }), 'Parent rate plan');
  }
  const plan = await RatePlan.create({ ...payload, locationId });
  await activity.record({ action: 'RATE_PLAN_CREATED', entity: 'RatePlan', entityId: plan._id, message: `Created rate plan ${plan.code}` });
  return plan;
};

const updateRatePlan = async (id: string, payload: Partial<IRatePlan>) => {
  const plan = found(await RatePlan.findById(id), 'Rate plan');
  const before = plan.toObject();
  await assertRoomTypes(plan.locationId, [
    ...(payload.roomTypeIds || []),
    ...(payload.rates || []).map((r) => r.roomTypeId),
    ...(payload.weekendRates || []).map((r) => r.roomTypeId),
  ]);
  if (payload.parentRatePlanId && String(payload.parentRatePlanId) === id) {
    throw new AppError(httpStatus.BAD_REQUEST, 'A rate plan cannot derive from itself');
  }
  Object.assign(plan, payload);
  await plan.save();
  await activity.record({ action: 'RATE_PLAN_UPDATED', entity: 'RatePlan', entityId: plan._id, message: `Updated rate plan ${plan.code}`, before, after: plan.toObject() });
  return plan;
};

// Bulk update of the rate calendar for a date range (optionally only some weekdays).
const setDailyRates = async (payload: {
  ratePlanId: string;
  roomTypeIds: string[];
  from: string;
  to: string;
  weekdays?: number[];
  amountMinor?: number | null;
  closed?: boolean;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  minLos?: number | null;
}) => {
  const plan = found(await RatePlan.findById(payload.ratePlanId).lean(), 'Rate plan');
  await assertRoomTypes(plan.locationId, payload.roomTypeIds);
  const dates = dateRange(payload.from, payload.to).filter((d) => !payload.weekdays?.length || payload.weekdays.includes(dayOfWeek(d)));
  if (dates.length > 400) throw new AppError(httpStatus.BAD_REQUEST, 'Update at most 400 days at once');

  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  for (const key of ['amountMinor', 'closed', 'closedToArrival', 'closedToDeparture', 'minLos'] as const) {
    if (payload[key] === null) unset[key] = 1;
    else if (payload[key] !== undefined) set[key] = payload[key];
  }
  const ops = payload.roomTypeIds.flatMap((roomTypeId) =>
    dates.map((date) => ({
      updateOne: {
        filter: { tenantId: plan.tenantId, ratePlanId: plan._id, roomTypeId: new Types.ObjectId(roomTypeId), date },
        update: {
          $set: { ...set, tenantId: plan.tenantId, locationId: plan.locationId },
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
        upsert: true,
      },
    })),
  );
  if (ops.length) await DailyRate.bulkWrite(ops as any);
  await activity.record({
    action: 'RATES_UPDATED',
    entity: 'RatePlan',
    entityId: plan._id,
    message: `Updated ${plan.code} rates for ${dates.length} day(s) (${payload.from} to ${payload.to})`,
    meta: { set, unset: Object.keys(unset) },
  });
  return { updated: ops.length };
};

// Rate calendar for display: effective price and restrictions per day.
const rateCalendar = async (payload: { ratePlanId: string; roomTypeId: string; from: string; to: string }) => {
  const plan = found(await RatePlan.findById(payload.ratePlanId).lean(), 'Rate plan') as TPlan;
  const roomType = found(await RoomCategory.findById(payload.roomTypeId).lean(), 'Room type') as TRoomType;
  const dates = dateRange(payload.from, payload.to);
  if (dates.length > 400) throw new AppError(httpStatus.BAD_REQUEST, 'Request at most 400 days');
  const planIds = [plan._id, ...(plan.parentRatePlanId ? [plan.parentRatePlanId] : [])];
  const rows = await DailyRate.find({ ratePlanId: { $in: planIds }, roomTypeId: roomType._id, date: { $gte: payload.from, $lte: payload.to } }).lean();
  const overrides = new Map(rows.map((r) => [`${r.ratePlanId}:${r.date}`, r]));
  const out = [];
  for (const date of dates) {
    const own = overrides.get(`${plan._id}:${date}`);
    out.push({
      date,
      amountMinor: await nightlyBase(plan, roomType, date, overrides),
      closed: Boolean(own?.closed),
      closedToArrival: Boolean(own?.closedToArrival),
      closedToDeparture: Boolean(own?.closedToDeparture),
      minLos: own?.minLos || plan.minLos,
    });
  }
  return out;
};

export const RateServices = {
  quoteStay,
  policiesOf,
  penaltyAmount,
  depositAmount,
  createRatePlan,
  updateRatePlan,
  setDailyRates,
  rateCalendar,
};
