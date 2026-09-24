import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { Room, RoomBlock } from './room.model';
import { HOUSEKEEPING_STATUS, IRoom, OCCUPANCY_STATUS, ROOM_BLOCK_TYPE } from './room.interface';
import { RoomCategory } from '../roomCategory/roomCategory.model';
import { RoomNight, TypeNight } from '../inventory/hotelInventory.model';
import { HotelInventory } from '../inventory/hotelInventory.service';
import { RoomStay } from '../reservation/reservation.model';
import { STAY_STATUS } from '../reservation/reservation.interface';
import { HousekeepingTask } from '../housekeeping/housekeeping.model';
import { Location } from '../../location/location.model';
import { SubscriptionServices } from '../../subscription/subscription.service';
import { activity } from '../../auditLog/auditLog.service';
import { runInTransaction } from '../../../utils/transaction';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { nightsBetween } from '../../../utils/businessDate';
import { randomToken } from '../../../utils/crypto';
import { found } from '../../../utils/query';

type TRoomInput = Pick<IRoom, 'roomNumber' | 'floor' | 'features' | 'notes'> & { roomCategoryId: string; isActive?: boolean };

const createRoom = async (tenantId: string, locationId: string, payload: TRoomInput) => {
  found(await RoomCategory.findOne({ _id: payload.roomCategoryId, locationId }), 'Room type');
  const room = await Room.create({ ...payload, locationId, qrToken: randomToken(12) });
  await activity.record({ action: 'ROOM_CREATED', entity: 'Room', entityId: room._id, message: `Added room ${room.roomNumber}` });
  await SubscriptionServices.recalculate(tenantId);
  return room;
};

// Bulk creation for onboarding ("101-120 as Deluxe King").
const createRoomRange = async (tenantId: string, locationId: string, payload: { roomCategoryId: string; from: number; to: number; prefix?: string; floor?: string }) => {
  if (payload.to < payload.from || payload.to - payload.from > 500) throw new AppError(httpStatus.BAD_REQUEST, 'Give a range of at most 500 rooms');
  found(await RoomCategory.findOne({ _id: payload.roomCategoryId, locationId }), 'Room type');
  const docs = [];
  for (let n = payload.from; n <= payload.to; n += 1) {
    docs.push({
      locationId,
      roomCategoryId: payload.roomCategoryId,
      roomNumber: `${payload.prefix || ''}${n}`,
      floor: payload.floor,
      qrToken: randomToken(12),
    });
  }
  const created = await Room.insertMany(docs, { ordered: false }).catch((err) => {
    if (err?.code === 11000) throw new AppError(httpStatus.CONFLICT, 'Some room numbers already exist');
    throw err;
  });
  await SubscriptionServices.recalculate(tenantId);
  return created;
};

const updateRoom = async (id: string, payload: Partial<TRoomInput>) => {
  const room = found(await Room.findById(id), 'Room');
  const before = room.toObject();
  if (payload.roomCategoryId && String(payload.roomCategoryId) !== String(room.roomCategoryId)) {
    const future = await RoomNight.exists({ roomId: room._id });
    if (future) throw new AppError(httpStatus.CONFLICT, 'Room has bookings; move them before changing its type');
    found(await RoomCategory.findOne({ _id: payload.roomCategoryId, locationId: room.locationId }), 'Room type');
  }
  Object.assign(room, payload);
  await room.save();
  await activity.record({ action: 'ROOM_UPDATED', entity: 'Room', entityId: room._id, message: `Updated room ${room.roomNumber}`, before, after: room.toObject() });
  return room;
};

const deleteRoom = async (tenantId: string, id: string) => {
  const room = found(await Room.findById(id), 'Room');
  if (await RoomNight.exists({ roomId: room._id })) throw new AppError(httpStatus.CONFLICT, 'Room has current or future bookings');
  room.isDeleted = true;
  room.isActive = false;
  await room.save();
  await SubscriptionServices.recalculate(tenantId);
  return room;
};

// Staff only change housekeeping status; occupancy follows check-in/check-out.
const setHousekeepingStatus = async (req: Request, id: string, status: keyof typeof HOUSEKEEPING_STATUS) => {
  const room = found(await Room.findById(id), 'Room');
  if (status === HOUSEKEEPING_STATUS.INSPECTED && !req.user.permissions.includes('housekeeping.manage')) {
    throw new AppError(httpStatus.FORBIDDEN, 'Only supervisors can mark rooms inspected');
  }
  const from = room.housekeepingStatus;
  room.housekeepingStatus = status;
  await room.save();
  await activity.record({ action: 'ROOM_HK_STATUS', entity: 'Room', entityId: room._id, message: `Room ${room.roomNumber}: ${from} → ${status}` });
  void publish({
    tenantId: req.user.tenantId,
    locationId: room.locationId,
    rooms: [socketRooms.location(room.locationId), socketRooms.housekeeping(room.locationId)],
    event: 'room_updated',
    data: { roomId: room._id, housekeepingStatus: status },
  });
  return room;
};

// Out-of-order takes the room out of inventory; out-of-service keeps it sellable.
const createBlock = async (req: Request, payload: { roomId: string; type: keyof typeof ROOM_BLOCK_TYPE; from: string; to: string; reason: string }) => {
  if (payload.to <= payload.from) throw new AppError(httpStatus.BAD_REQUEST, '`to` must be after `from`');
  const room = found(await Room.findById(payload.roomId), 'Room');
  const nights = nightsBetween(payload.from, payload.to);
  const booked = await RoomNight.findOne({ roomId: room._id, date: { $in: nights } }).lean();
  if (booked && payload.type === ROOM_BLOCK_TYPE.OUT_OF_ORDER) {
    throw new AppError(httpStatus.CONFLICT, `Room ${room.roomNumber} is booked on ${booked.date}; move that stay first`);
  }
  return runInTransaction(async () => {
    if (payload.type === ROOM_BLOCK_TYPE.OUT_OF_ORDER) {
      // Blocking must not oversell the room type.
      const capacity = await HotelInventory.capacityByDate(room.locationId, room.roomCategoryId, nights);
      const rows = await TypeNight.find({ roomTypeId: room.roomCategoryId, date: { $in: nights } }).lean();
      for (const row of rows) {
        if (row.sold + row.held > (capacity.get(row.date) || 0) - 1) {
          throw new AppError(httpStatus.CONFLICT, `Blocking would oversell ${row.date}`);
        }
      }
    }
    const [block] = await RoomBlock.create([{ ...payload, locationId: room.locationId, createdBy: req.user.id }]);
    await activity.record({
      action: 'ROOM_BLOCKED',
      entity: 'Room',
      entityId: room._id,
      message: `Room ${room.roomNumber} ${payload.type.replace(/_/g, ' ').toLowerCase()} ${payload.from} to ${payload.to}: ${payload.reason}`,
    });
    return block!;
  });
};

const releaseBlock = async (req: Request, id: string) => {
  const block = found(await RoomBlock.findById(id), 'Room block');
  if (block.releasedAt) return block;
  block.releasedAt = new Date();
  block.releasedBy = new Types.ObjectId(req.user.id);
  await block.save();
  return block;
};

// Room board: every room with occupancy, housekeeping, blocks, current and arriving guest.
const roomBoard = async (locationId: string) => {
  const location = found(await Location.findById(locationId).lean(), 'Location');
  const date = location.businessDate;
  const [rooms, types, blocks, inHouse, arrivals, tasks] = await Promise.all([
    Room.find({ locationId }).sort({ floor: 1, roomNumber: 1 }).lean(),
    RoomCategory.find({ locationId }).select('name code').lean(),
    RoomBlock.find({ locationId, releasedAt: null, from: { $lte: date }, to: { $gt: date } }).lean(),
    RoomStay.find({ locationId, status: STAY_STATUS.CHECKED_IN }).populate('guestIds', 'firstName lastName tags').lean(),
    RoomStay.find({ locationId, status: STAY_STATUS.RESERVED, arrivalDate: date, roomId: { $ne: null } }).populate('guestIds', 'firstName lastName tags').lean(),
    HousekeepingTask.find({ locationId, businessDate: date, status: { $in: ['PENDING', 'IN_PROGRESS'] } }).populate('assignedTo', 'name').lean(),
  ]);
  const typeName = new Map(types.map((t) => [String(t._id), t]));
  const blockBy = new Map(blocks.map((b) => [String(b.roomId), b]));
  const stayBy = new Map(inHouse.map((s) => [String(s.roomId), s]));
  const arrivalBy = new Map(arrivals.map((s) => [String(s.roomId), s]));
  const taskBy = new Map(tasks.map((t) => [String(t.roomId), t]));
  const guestLabel = (s: any) => s && { stayId: s._id, reservationId: s.reservationId, guest: s.guestIds?.[0] && `${s.guestIds[0].firstName} ${s.guestIds[0].lastName}`, tags: s.guestIds?.[0]?.tags, departureDate: s.departureDate, arrivalDate: s.arrivalDate };

  const board = rooms.map((room) => {
    const block = blockBy.get(String(room._id));
    const current = stayBy.get(String(room._id));
    const arriving = arrivalBy.get(String(room._id));
    const displayStatus = block
      ? block.type
      : room.occupancyStatus === OCCUPANCY_STATUS.OCCUPIED
        ? current?.departureDate === date
          ? 'DUE_OUT'
          : 'OCCUPIED'
        : arriving
          ? 'ARRIVING'
          : 'VACANT';
    return {
      _id: room._id,
      roomNumber: room.roomNumber,
      floor: room.floor,
      roomType: typeName.get(String(room.roomCategoryId)),
      housekeepingStatus: room.housekeepingStatus,
      occupancyStatus: room.occupancyStatus,
      displayStatus,
      // Guest arriving into a room that is not ready yet
      needsAttention: Boolean(arriving) && !['CLEAN', 'INSPECTED'].includes(room.housekeepingStatus),
      block: block && { _id: block._id, type: block.type, reason: block.reason, to: block.to },
      current: guestLabel(current),
      arriving: guestLabel(arriving),
      task: taskBy.get(String(room._id)),
    };
  });
  const summary = {
    total: rooms.length,
    occupied: board.filter((r) => r.occupancyStatus === 'OCCUPIED').length,
    vacantClean: board.filter((r) => r.occupancyStatus === 'VACANT' && ['CLEAN', 'INSPECTED'].includes(r.housekeepingStatus) && !r.block).length,
    vacantDirty: board.filter((r) => r.occupancyStatus === 'VACANT' && r.housekeepingStatus === 'DIRTY').length,
    outOfOrder: board.filter((r) => r.block?.type === 'OUT_OF_ORDER').length,
    arrivingNotReady: board.filter((r) => r.needsAttention).length,
  };
  return { businessDate: date, summary, rooms: board };
};

export const RoomServices = {
  createRoom,
  createRoomRange,
  updateRoom,
  deleteRoom,
  setHousekeepingStatus,
  createBlock,
  releaseBlock,
  roomBoard,
};
