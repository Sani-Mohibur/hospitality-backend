import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { Allotment, RoomNight, TypeNight } from './hotelInventory.model';
import { Room, RoomBlock } from '../room/room.model';
import { RoomCategory } from '../roomCategory/roomCategory.model';
import { dateRange, nightsBetween } from '../../../utils/businessDate';
import { requestContext } from '../../../utils/requestContext';

type TId = Types.ObjectId | string;
const oid = (v: TId) => (v instanceof Types.ObjectId ? v : new Types.ObjectId(v));

// Rooms of a type that can be sold on each date (active rooms minus out-of-order blocks).
export const capacityByDate = async (locationId: TId, roomTypeId: TId, dates: string[]) => {
  const rooms = await Room.find({ locationId, roomCategoryId: roomTypeId, isActive: true }).select('_id').lean();
  const roomIds = rooms.map((r) => r._id);
  const blocks = roomIds.length
    ? await RoomBlock.find({
        roomId: { $in: roomIds },
        type: 'OUT_OF_ORDER',
        releasedAt: null,
        from: { $lte: dates[dates.length - 1] },
        to: { $gt: dates[0] },
      }).lean()
    : [];
  const map = new Map<string, number>();
  for (const date of dates) {
    const blocked = blocks.filter((b) => b.from <= date && b.to > date).length;
    map.set(date, roomIds.length - blocked);
  }
  return map;
};

// TypeNight rows must exist before the conditional increment runs inside a transaction.
const ensureTypeNights = async (locationId: TId, roomTypeId: TId, dates: string[]) => {
  const tenantId = requestContext.get()?.tenantId;
  await TypeNight.bulkWrite(
    dates.map((date) => ({
      updateOne: {
        filter: { tenantId: oid(tenantId!), roomTypeId: oid(roomTypeId), date },
        update: { $setOnInsert: { tenantId: oid(tenantId!), locationId: oid(locationId), sold: 0, held: 0 } },
        upsert: true,
      },
    })) as any,
  );
};

export const prepareTypeInventory = ensureTypeNights;

// Compare-and-increment on the allotment night so two bookings cannot take the last held room.
const pickFromAllotment = async (allotmentId: TId, date: string) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const allotment = await Allotment.findOne({ _id: allotmentId, status: 'ACTIVE' }).lean();
    const night = allotment?.nights.find((n) => n.date === date && !n.released);
    if (!night || night.picked >= night.allotted) return false;
    const res = await Allotment.updateOne(
      { _id: allotmentId, nights: { $elemMatch: { date, released: false, picked: night.picked } } },
      { $inc: { 'nights.$.picked': 1 } },
    );
    if (res.modifiedCount) return true;
  }
  return false;
};

// Takes one unit of a room type for each night. With an allotment, the unit comes
// out of the rooms held for it. Throws 409 when any night is sold out.
export const holdRoomType = async (
  locationId: TId,
  roomTypeId: TId,
  arrival: string,
  departure: string,
  options: { allotmentId?: TId } = {},
) => {
  const nights = nightsBetween(arrival, departure);
  const capacity = await capacityByDate(locationId, roomTypeId, nights);
  for (const date of nights) {
    if (options.allotmentId && (await pickFromAllotment(options.allotmentId, date))) {
      const moved = await TypeNight.updateOne({ roomTypeId, date, held: { $gt: 0 } }, { $inc: { held: -1, sold: 1 } });
      if (moved.modifiedCount) continue;
    }
    const cap = capacity.get(date) || 0;
    const result = await TypeNight.updateOne(
      { roomTypeId, date, $expr: { $lt: [{ $add: ['$sold', '$held'] }, cap] } },
      { $inc: { sold: 1 } },
    );
    if (!result.modifiedCount) {
      throw new AppError(httpStatus.CONFLICT, `No rooms of this type left on ${date}`);
    }
  }
};

export const releaseRoomType = async (roomTypeId: TId, nights: string[]) => {
  if (!nights.length) return;
  await TypeNight.updateMany({ roomTypeId, date: { $in: nights }, sold: { $gt: 0 } }, { $inc: { sold: -1 } });
};

// Ties a physical room to a stay. The unique (roomId, date) index is the final
// guard against two stays in one room.
export const assignRoomNights = async (
  stay: { _id: TId; locationId: TId; roomTypeId: TId; arrivalDate: string; departureDate: string },
  roomId: TId,
  fromDate?: string,
) => {
  const room = await Room.findOne({ _id: roomId, locationId: stay.locationId, isActive: true }).lean();
  if (!room) throw new AppError(httpStatus.NOT_FOUND, 'Room not found');
  if (String(room.roomCategoryId) !== String(stay.roomTypeId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Room belongs to another room type; change the stay room type first');
  }
  const nights = nightsBetween(fromDate && fromDate > stay.arrivalDate ? fromDate : stay.arrivalDate, stay.departureDate);
  if (!nights.length) return room;

  const block = await RoomBlock.findOne({
    roomId,
    type: 'OUT_OF_ORDER',
    releasedAt: null,
    from: { $lte: nights[nights.length - 1] },
    to: { $gt: nights[0] },
  }).lean();
  if (block) throw new AppError(httpStatus.CONFLICT, `Room ${room.roomNumber} is out of order ${block.from} to ${block.to}`);

  const clash = await RoomNight.findOne({ roomId, date: { $in: nights }, roomStayId: { $ne: stay._id } }).lean();
  if (clash) throw new AppError(httpStatus.CONFLICT, `Room ${room.roomNumber} is already booked on ${clash.date}`);

  try {
    await RoomNight.insertMany(
      nights.map((date) => ({ locationId: stay.locationId, roomId, roomStayId: stay._id, date })),
    );
  } catch (err: any) {
    if (err?.code === 11000) throw new AppError(httpStatus.CONFLICT, `Room ${room.roomNumber} was just booked by someone else`);
    throw err;
  }
  return room;
};

export const unassignRoomNights = async (roomStayId: TId, fromDate?: string) => {
  await RoomNight.deleteMany({ roomStayId, ...(fromDate ? { date: { $gte: fromDate } } : {}) });
};

// Availability grid per room type and date.
export const availability = async (locationId: TId, from: string, to: string) => {
  const dates = dateRange(from, to);
  if (dates.length > 120) throw new AppError(httpStatus.BAD_REQUEST, 'Request at most 120 days');
  const roomTypes = await RoomCategory.find({ locationId, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
  const nights = await TypeNight.find({ locationId, date: { $gte: from, $lte: to } }).lean();
  const byKey = new Map(nights.map((n) => [`${n.roomTypeId}:${n.date}`, n]));
  const out = [];
  for (const type of roomTypes) {
    const capacity = await capacityByDate(locationId, type._id, dates);
    out.push({
      roomType: { _id: type._id, name: type.name, code: type.code, baseRateMinor: type.baseRateMinor },
      days: dates.map((date) => {
        const row = byKey.get(`${type._id}:${date}`);
        const cap = capacity.get(date) || 0;
        const sold = row?.sold || 0;
        const held = row?.held || 0;
        return { date, capacity: cap, sold, held, available: Math.max(0, cap - sold - held) };
      }),
    });
  }
  return out;
};

// Free rooms of a type for a date range (for assignment pickers).
export const freeRooms = async (locationId: TId, roomTypeId: TId, arrival: string, departure: string) => {
  const nights = nightsBetween(arrival, departure);
  const rooms = await Room.find({ locationId, roomCategoryId: roomTypeId, isActive: true }).sort({ roomNumber: 1 }).lean();
  const taken = await RoomNight.find({ roomId: { $in: rooms.map((r) => r._id) }, date: { $in: nights } }).distinct('roomId');
  const blocked = await RoomBlock.find({
    roomId: { $in: rooms.map((r) => r._id) },
    type: 'OUT_OF_ORDER',
    releasedAt: null,
    from: { $lt: departure },
    to: { $gt: arrival },
  }).distinct('roomId');
  const unavailable = new Set([...taken, ...blocked].map(String));
  return rooms.filter((r) => !unavailable.has(String(r._id)));
};

// ---------- Allotments ----------
export const createAllotment = async (payload: {
  locationId: string;
  name: string;
  roomTypeId: string;
  companyAccountId?: string;
  ratePlanId?: string;
  from: string;
  to: string;
  roomsPerNight: number;
  releaseDays?: number;
}) => {
  const nights = nightsBetween(payload.from, payload.to);
  await ensureTypeNights(payload.locationId, payload.roomTypeId, nights);
  const capacity = await capacityByDate(payload.locationId, payload.roomTypeId, nights);
  for (const date of nights) {
    const cap = capacity.get(date) || 0;
    const res = await TypeNight.updateOne(
      { roomTypeId: payload.roomTypeId, date, $expr: { $lte: [{ $add: ['$sold', '$held', payload.roomsPerNight] }, cap] } },
      { $inc: { held: payload.roomsPerNight } },
    );
    if (!res.modifiedCount) throw new AppError(httpStatus.CONFLICT, `Not enough rooms to hold on ${date}`);
  }
  const [allotment] = await Allotment.create([
    {
      ...payload,
      nights: nights.map((date) => ({ date, allotted: payload.roomsPerNight, picked: 0, released: false })),
    },
  ]);
  return allotment!;
};

// Returns unpicked rooms to general inventory for nights inside the release window.
export const releaseAllotmentNights = async (allotmentId: TId, beforeOrOn: string, force = false) => {
  const allotment = await Allotment.findById(allotmentId);
  if (!allotment || allotment.status !== 'ACTIVE') return 0;
  let released = 0;
  for (const night of allotment.nights) {
    if (night.released) continue;
    if (!force && night.date > beforeOrOn) continue;
    const unpicked = Math.max(0, night.allotted - night.picked);
    if (unpicked) {
      await TypeNight.updateOne({ roomTypeId: allotment.roomTypeId, date: night.date }, { $inc: { held: -unpicked } });
      released += unpicked;
    }
    night.released = true;
  }
  if (allotment.nights.every((n) => n.released)) allotment.status = force ? 'CANCELLED' : 'RELEASED';
  await allotment.save();
  return released;
};

export const HotelInventory = {
  capacityByDate,
  prepareTypeInventory,
  holdRoomType,
  releaseRoomType,
  assignRoomNights,
  unassignRoomNights,
  availability,
  freeRooms,
  createAllotment,
  releaseAllotmentNights,
};
