import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { HK_TASK_STATUS, HK_TASK_TYPE, HousekeepingTask, LostFoundItem } from './housekeeping.model';
import { Room } from '../room/room.model';
import { HOUSEKEEPING_STATUS } from '../room/room.interface';
import { RoomServices } from '../room/room.service';
import { RoomStay } from '../reservation/reservation.model';
import { STAY_STATUS } from '../reservation/reservation.interface';
import { RoomNight } from '../inventory/hotelInventory.model';
import { Location } from '../../location/location.model';
import { FolioLedger } from '../folio/folio.ledger';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE } from '../folio/folio.interface';
import { activity } from '../../auditLog/auditLog.service';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { runInTransaction } from '../../../utils/transaction';
import { found } from '../../../utils/query';

type TId = Types.ObjectId | string;

const businessDateOf = async (locationId: TId) => found(await Location.findById(locationId).select('businessDate').lean(), 'Location').businessDate;

const notify = (tenantId: TId, locationId: TId, event: string, data: unknown) =>
  publish({ tenantId, locationId, rooms: [socketRooms.housekeeping(locationId), socketRooms.location(locationId)], event, data });

// Creates the day's tasks: departures (check-outs due) and stayovers. Idempotent.
const generateTasks = async (locationId: TId, date?: string) => {
  const day = date || (await businessDateOf(locationId));
  const inHouse = await RoomStay.find({ locationId, status: STAY_STATUS.CHECKED_IN, roomId: { $ne: null } }).lean();
  const arrivals = await RoomNight.find({ locationId, date: day }).lean();
  const arrivingRooms = new Set(arrivals.map((n) => String(n.roomId)));
  let created = 0;
  for (const stay of inHouse) {
    const type = stay.departureDate <= day ? HK_TASK_TYPE.DEPARTURE : HK_TASK_TYPE.STAYOVER;
    const exists = await HousekeepingTask.exists({ roomId: stay.roomId, businessDate: day, type: { $in: [HK_TASK_TYPE.DEPARTURE, HK_TASK_TYPE.STAYOVER] } });
    if (exists) continue;
    await HousekeepingTask.create({
      locationId,
      roomId: stay.roomId,
      businessDate: day,
      type,
      priority: type === HK_TASK_TYPE.DEPARTURE ? 5 : 1,
    });
    created += 1;
  }
  // Rooms with an arrival today go to the top of the list.
  if (arrivingRooms.size) {
    await HousekeepingTask.updateMany(
      { locationId, businessDate: day, roomId: { $in: [...arrivingRooms].map((id) => new Types.ObjectId(id)) }, status: HK_TASK_STATUS.PENDING },
      { $max: { priority: 10 } },
    );
  }
  return { businessDate: day, created };
};

const board = async (locationId: TId, date?: string) => {
  const day = date || (await businessDateOf(locationId));
  const tasks = await HousekeepingTask.find({ locationId, businessDate: day })
    .populate('roomId', 'roomNumber floor housekeepingStatus occupancyStatus')
    .populate('assignedTo', 'name profileImage')
    .sort({ status: 1, priority: -1 })
    .lean();
  const byStatus = Object.values(HK_TASK_STATUS).reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: tasks.filter((t) => t.status === s).length }), {});
  return { businessDate: day, counts: byStatus, tasks };
};

// Housekeeper's phone view: their rooms in cleaning order.
const myTasks = async (userId: string, locationId: TId) => {
  const day = await businessDateOf(locationId);
  return HousekeepingTask.find({ locationId, businessDate: day, assignedTo: userId, status: { $in: [HK_TASK_STATUS.PENDING, HK_TASK_STATUS.IN_PROGRESS, HK_TASK_STATUS.DONE] } })
    .populate('roomId', 'roomNumber floor housekeepingStatus occupancyStatus')
    .sort({ status: -1, priority: -1 })
    .lean();
};

const assign = async (req: Request, taskIds: string[], userId: string | null) => {
  const result = await HousekeepingTask.updateMany({ _id: { $in: taskIds } }, userId ? { assignedTo: userId } : { $unset: { assignedTo: 1 } });
  await activity.record({ action: 'HK_ASSIGNED', entity: 'HousekeepingTask', message: `Assigned ${result.modifiedCount} task(s)` });
  if (userId) {
    void publish({ tenantId: req.user.tenantId, rooms: [socketRooms.user(userId)], event: 'hk_tasks_assigned', data: { taskIds } });
  }
  return { updated: result.modifiedCount };
};

const start = async (req: Request, taskId: string) => {
  const task = found(await HousekeepingTask.findById(taskId), 'Task');
  if (task.status !== HK_TASK_STATUS.PENDING) throw new AppError(httpStatus.CONFLICT, `Task is ${task.status}`);
  task.status = HK_TASK_STATUS.IN_PROGRESS;
  task.startedAt = new Date();
  if (!task.assignedTo) task.assignedTo = new Types.ObjectId(req.user.id);
  await task.save();
  if (task.type !== HK_TASK_TYPE.MAINTENANCE && task.type !== HK_TASK_TYPE.REQUEST) {
    await Room.updateOne({ _id: task.roomId }, { housekeepingStatus: HOUSEKEEPING_STATUS.IN_PROGRESS });
  }
  void notify(req.user.tenantId!, task.locationId, 'hk_task_updated', { taskId, status: task.status, roomId: task.roomId });
  return task;
};

const finish = async (req: Request, taskId: string, notes?: string) => {
  const task = found(await HousekeepingTask.findById(taskId), 'Task');
  if (![HK_TASK_STATUS.PENDING, HK_TASK_STATUS.IN_PROGRESS].includes(task.status as any)) throw new AppError(httpStatus.CONFLICT, `Task is ${task.status}`);
  task.status = HK_TASK_STATUS.DONE;
  task.finishedAt = new Date();
  task.startedAt = task.startedAt || task.finishedAt;
  if (notes) task.notes = [task.notes, notes].filter(Boolean).join('\n');
  await task.save();
  if (task.type !== HK_TASK_TYPE.MAINTENANCE && task.type !== HK_TASK_TYPE.REQUEST) {
    await Room.updateOne({ _id: task.roomId }, { housekeepingStatus: HOUSEKEEPING_STATUS.CLEAN });
  }
  await activity.record({ action: 'HK_DONE', entity: 'HousekeepingTask', entityId: task._id, message: `${task.type.toLowerCase()} done` });
  void notify(req.user.tenantId!, task.locationId, 'hk_task_updated', { taskId, status: task.status, roomId: task.roomId });
  return task;
};

// Supervisor check. A failed inspection sends the room back to dirty with a new task.
const inspect = async (req: Request, taskId: string, payload: { passed: boolean; notes?: string }) => {
  const task = found(await HousekeepingTask.findById(taskId), 'Task');
  if (task.status !== HK_TASK_STATUS.DONE) throw new AppError(httpStatus.CONFLICT, 'Only finished tasks can be inspected');
  return runInTransaction(async () => {
    task.status = HK_TASK_STATUS.INSPECTED;
    task.inspectedAt = new Date();
    task.inspectedBy = new Types.ObjectId(req.user.id);
    task.inspectionPassed = payload.passed;
    if (payload.notes) task.notes = [task.notes, `Inspection: ${payload.notes}`].filter(Boolean).join('\n');
    await task.save();
    await Room.updateOne({ _id: task.roomId }, { housekeepingStatus: payload.passed ? HOUSEKEEPING_STATUS.INSPECTED : HOUSEKEEPING_STATUS.DIRTY });
    if (!payload.passed) {
      await HousekeepingTask.create([
        { locationId: task.locationId, roomId: task.roomId, businessDate: task.businessDate, type: task.type, priority: task.priority + 1, assignedTo: task.assignedTo, notes: `Re-clean: ${payload.notes || 'failed inspection'}` },
      ]);
    }
    return task;
  });
};

// Maintenance issue from housekeeping; can take the room out of order at once.
const reportIssue = async (
  req: Request,
  payload: { roomId: string; description: string; block?: { type: 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'; to: string } },
) => {
  const room = found(await Room.findById(payload.roomId).lean(), 'Room');
  const day = await businessDateOf(room.locationId);
  const [task] = await HousekeepingTask.create([
    { locationId: room.locationId, roomId: room._id, businessDate: day, type: HK_TASK_TYPE.MAINTENANCE, priority: 8, notes: payload.description, createdBy: req.user.id },
  ]);
  let block;
  if (payload.block) {
    block = await RoomServices.createBlock(req, { roomId: payload.roomId, type: payload.block.type, from: day, to: payload.block.to, reason: payload.description });
  }
  const { AlertService } = await import('../../alert/alert.service');
  await AlertService.raise({
    type: 'MAINTENANCE_ISSUE',
    severity: payload.block?.type === 'OUT_OF_ORDER' ? 'HIGH' : 'MEDIUM',
    locationId: room.locationId,
    title: `Room ${room.roomNumber}: maintenance needed`,
    message: payload.description,
    ref: { kind: 'Room', id: room._id },
    dedupeKey: `maint:${task!._id}`,
  });
  return { task, block };
};

// Guest or staff request (extra towels, cleaning now) — also used by Guest QR.
const createRequest = async (locationId: TId, roomId: TId, notes: string, source: 'STAFF' | 'GUEST_QR', tenantId: TId) => {
  const day = await businessDateOf(locationId);
  const [task] = await HousekeepingTask.create([
    { locationId, roomId, businessDate: day, type: HK_TASK_TYPE.REQUEST, priority: 7, notes, requestSource: source },
  ]);
  void notify(tenantId, locationId, 'hk_request', { taskId: task!._id, roomId, notes });
  return task!;
};

// Minibar consumption posted to the in-house guest's bill.
const postMinibar = async (req: Request, payload: { roomId: string; items: { description: string; quantity: number; unitAmountMinor: number; stockItemId?: string }[] }) => {
  const room = found(await Room.findById(payload.roomId).lean(), 'Room');
  const stay = await RoomStay.findOne({ roomId: room._id, status: STAY_STATUS.CHECKED_IN }).lean();
  if (!stay?.folioId) throw new AppError(httpStatus.CONFLICT, `No guest is checked in to room ${room.roomNumber}`);
  const lines = await runInTransaction(async () => {
    const posted = [];
    for (const item of payload.items) {
      posted.push(
        await FolioLedger.postLine({
          folioId: stay.folioId!,
          type: FOLIO_LINE_TYPE.CHARGE,
          code: 'MINI',
          description: `Minibar: ${item.description}`,
          quantity: item.quantity,
          unitAmountMinor: item.unitAmountMinor,
          source: { kind: FOLIO_SOURCE.MINIBAR, refId: room._id as Types.ObjectId, roomStayId: stay._id as Types.ObjectId },
        }),
      );
      if (item.stockItemId) {
        const { InventoryServices } = await import('../../inventory/inventory.service');
        await InventoryServices.recordMovement({
          stockItemId: item.stockItemId,
          type: 'MINIBAR',
          quantity: -item.quantity,
          reason: `Minibar room ${room.roomNumber}`,
          ref: { kind: 'Room', id: String(room._id) },
        });
      }
    }
    await activity.record({ action: 'MINIBAR_POSTED', entity: 'Room', entityId: room._id, message: `Minibar posted to room ${room.roomNumber} (${payload.items.length} item(s))` });
    return posted;
  });
  return lines;
};

// Rooms cleaned and average minutes per room, per housekeeper.
const productivity = async (locationId: TId, from: string, to: string) =>
  HousekeepingTask.aggregate([
    {
      $match: {
        locationId: new Types.ObjectId(String(locationId)),
        businessDate: { $gte: from, $lte: to },
        status: { $in: [HK_TASK_STATUS.DONE, HK_TASK_STATUS.INSPECTED] },
        assignedTo: { $ne: null },
        type: { $in: [HK_TASK_TYPE.DEPARTURE, HK_TASK_TYPE.STAYOVER] },
      },
    },
    {
      $group: {
        _id: '$assignedTo',
        rooms: { $sum: 1 },
        departures: { $sum: { $cond: [{ $eq: ['$type', 'DEPARTURE'] }, 1, 0] } },
        avgMinutes: { $avg: { $divide: [{ $subtract: ['$finishedAt', '$startedAt'] }, 60000] } },
        failedInspections: { $sum: { $cond: [{ $eq: ['$inspectionPassed', false] }, 1, 0] } },
      },
    },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $project: { rooms: 1, departures: 1, failedInspections: 1, avgMinutes: { $round: ['$avgMinutes', 1] }, name: { $first: '$user.name' } } },
    { $sort: { rooms: -1 } },
  ]);

const lostFound = {
  list: (locationId: TId, status?: string) => LostFoundItem.find({ locationId, ...(status ? { status } : {}) } as any).populate('roomId', 'roomNumber').sort({ foundAt: -1 }).lean(),
  create: (req: Request, payload: { roomId?: string; description: string; storageLocation?: string; guestId?: string }) =>
    LostFoundItem.create({ ...payload, locationId: req.locationId, foundBy: req.user.id }),
  resolve: async (id: string, status: 'RETURNED' | 'DISPOSED', note?: string) =>
    found(await LostFoundItem.findByIdAndUpdate(id, { status, resolvedAt: new Date(), resolvedNote: note }, { returnDocument: 'after' }), 'Item'),
};

export const HousekeepingServices = {
  generateTasks,
  board,
  myTasks,
  assign,
  start,
  finish,
  inspect,
  reportIssue,
  createRequest,
  postMinibar,
  productivity,
  lostFound,
};
