import { Types } from 'mongoose';
import { RatePlan } from './rate.model';
import { RateServices } from './rate.service';
import { RoomCategory } from '../roomCategory/roomCategory.model';
import { RoomStay } from '../reservation/reservation.model';
import { TypeNight } from '../inventory/hotelInventory.model';
import { HotelInventory } from '../inventory/hotelInventory.service';
import { Location } from '../../location/location.model';
import { addDays, dateRange, diffDays } from '../../../utils/businessDate';
import { percentOf } from '../../../utils/money';
import { found } from '../../../utils/query';

type TSuggestion = {
  date: string;
  roomTypeId: Types.ObjectId;
  roomType: string;
  occupancyPct: number;
  pickupLast7Days: number;
  currentMinor: number;
  suggestedMinor: number;
  changePct: number;
  reason: string;
};

// Rule-based pricing advice from occupancy on the books and booking pace.
// Deliberately conservative and explainable; staff apply or ignore each suggestion.
const suggest = async (locationId: string, options: { ratePlanId: string; days?: number; maxChangePct?: number }) => {
  const location = found(await Location.findById(locationId).lean(), 'Location');
  const plan = found(await RatePlan.findOne({ _id: options.ratePlanId, locationId }).lean(), 'Rate plan');
  const days = Math.min(options.days || 30, 120);
  const maxChange = options.maxChangePct ?? 20;
  const from = location.businessDate;
  const to = addDays(from, days - 1);
  const dates = dateRange(from, to);
  const types = await RoomCategory.find({ locationId, isActive: true, ...(plan.roomTypeIds?.length ? { _id: { $in: plan.roomTypeIds } } : {}) }).lean();
  const sold = await TypeNight.find({ locationId, date: { $gte: from, $lte: to } }).lean();
  const soldBy = new Map(sold.map((s) => [`${s.roomTypeId}:${s.date}`, s.sold + s.held]));

  // Pickup: rooms booked in the last 7 days per type and night
  const recent = await RoomStay.find({
    locationId,
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
    status: { $nin: ['CANCELLED'] },
    departureDate: { $gt: from },
    arrivalDate: { $lte: to },
  }).lean();
  const pickupBy = new Map<string, number>();
  for (const stay of recent) {
    for (const date of dateRange(stay.arrivalDate > from ? stay.arrivalDate : from, addDays(stay.departureDate, -1))) {
      const key = `${stay.roomTypeId}:${date}`;
      pickupBy.set(key, (pickupBy.get(key) || 0) + 1);
    }
  }

  const out: TSuggestion[] = [];
  for (const type of types) {
    const capacity = await HotelInventory.capacityByDate(locationId, type._id, dates);
    const calendar = await RateServices.rateCalendar({ ratePlanId: String(plan._id), roomTypeId: String(type._id), from, to });
    for (const day of calendar) {
      const cap = capacity.get(day.date) || 0;
      if (!cap || day.closed) continue;
      const booked = soldBy.get(`${type._id}:${day.date}`) || 0;
      const occ = booked / cap;
      const pickup = pickupBy.get(`${type._id}:${day.date}`) || 0;
      const leadDays = diffDays(from, day.date);
      let change = 0;
      const reasons: string[] = [];
      if (occ >= 0.9) {
        change += 15;
        reasons.push('90%+ booked');
      } else if (occ >= 0.75) {
        change += 8;
        reasons.push('75%+ booked');
      } else if (occ <= 0.3 && leadDays <= 7) {
        change -= 10;
        reasons.push('under 30% booked within a week');
      } else if (occ <= 0.4 && leadDays <= 14) {
        change -= 5;
        reasons.push('under 40% booked within two weeks');
      }
      if (pickup / cap >= 0.2) {
        change += 5;
        reasons.push(`strong pickup (${pickup} in 7 days)`);
      }
      change = Math.max(-maxChange, Math.min(maxChange, change));
      if (!change) continue;
      const suggested = Math.max(0, day.amountMinor + percentOf(day.amountMinor, change * 100));
      out.push({
        date: day.date,
        roomTypeId: type._id as Types.ObjectId,
        roomType: type.name,
        occupancyPct: Math.round(occ * 1000) / 10,
        pickupLast7Days: pickup,
        currentMinor: day.amountMinor,
        suggestedMinor: Math.round(suggested / 100) * 100,
        changePct: change,
        reason: reasons.join(', '),
      });
    }
  }
  return { ratePlanId: plan._id, from, to, suggestions: out };
};

// Applies selected suggestions as daily rate overrides.
const apply = async (ratePlanId: string, items: { roomTypeId: string; date: string; amountMinor: number }[]) => {
  let updated = 0;
  for (const item of items) {
    const result = await RateServices.setDailyRates({ ratePlanId, roomTypeIds: [item.roomTypeId], from: item.date, to: item.date, amountMinor: item.amountMinor });
    updated += result.updated;
  }
  return { updated };
};

export const RateSuggestionService = { suggest, apply };
