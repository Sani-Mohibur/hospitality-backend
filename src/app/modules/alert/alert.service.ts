import { Types } from 'mongoose';
import { Alert, AlertRule, IAlert, TAlertSeverity, TAlertType } from './alert.model';
import { User } from '../user/user.model';
import { NotificationService } from '../notification/notification.service';
import { Location } from '../location/location.model';
import { Tenant } from '../tenant/tenant.model';
import { RoomStay, Reservation } from '../hospitality/reservation/reservation.model';
import { STAY_STATUS } from '../hospitality/reservation/reservation.interface';
import { Room } from '../hospitality/room/room.model';
import { Shift } from '../shift/shift.model';
import { requestContext } from '../../utils/requestContext';
import { publish, rooms } from '../../utils/realtime';
import { localMinutes, parseTimeOfDay } from '../../utils/businessDate';
import { found, metaOf, paginationOf } from '../../utils/query';
import logger from '../../utils/logger';

type TId = Types.ObjectId | string;

type TRaise = {
  type: TAlertType;
  severity?: TAlertSeverity;
  locationId?: TId;
  title: string;
  message: string;
  ref?: { kind: string; id: TId };
  action?: IAlert['action'];
  dedupeKey?: string;
};

const ruleFor = async (type: TAlertType) => AlertRule.findOne({ type }).lean();

// Creates an alert once per dedupeKey, pushes it live and notifies the right people.
const raise = async (input: TRaise) => {
  const tenantId = requestContext.get()?.tenantId;
  if (!tenantId) return undefined;
  const rule = await ruleFor(input.type);
  if (rule && !rule.enabled) return undefined;

  let alert;
  try {
    alert = await Alert.create({ ...input, severity: input.severity || 'MEDIUM' });
  } catch (err: any) {
    if (err?.code === 11000) return Alert.findOne({ dedupeKey: input.dedupeKey, status: { $in: ['OPEN', 'ACKNOWLEDGED'] } }).lean();
    throw err;
  }

  const roomsToNotify = input.locationId ? [rooms.managers(input.locationId), rooms.tenant(tenantId)] : [rooms.tenant(tenantId)];
  void publish({ tenantId, locationId: input.locationId, rooms: roomsToNotify, event: 'alert', data: alert.toObject() });

  const roles = rule?.notifyRoles || ['TENANT_OWNER', 'TENANT_MANAGER'];
  const channels = rule?.channels || ['PUSH'];
  const recipients = await User.find({
    role: { $in: roles as any },
    isActive: true,
    ...(input.locationId ? { $or: [{ allLocations: true }, { locationIds: input.locationId }, { role: 'TENANT_OWNER' }] } : {}),
  })
    .select('email phone')
    .lean();
  for (const user of recipients) {
    for (const channel of channels) {
      await NotificationService.createAndSendNotification(
        { tenantId: new Types.ObjectId(tenantId), recipient: user._id as Types.ObjectId, type: channel, title: input.title, message: input.message, link: { kind: 'Alert', id: alert._id } },
        { email: user.email, phone: user.phone },
      ).catch((err) => logger.warn(err, 'Alert notification failed'));
    }
  }
  return alert;
};

const resolveByKey = async (dedupeKey: string) =>
  Alert.updateMany({ dedupeKey, status: { $in: ['OPEN', 'ACKNOWLEDGED'] } }, { status: 'RESOLVED', resolvedAt: new Date() });

const list = async (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 50);
  const where: Record<string, unknown> = { ...filter, status: query.status || { $in: ['OPEN', 'ACKNOWLEDGED'] } };
  if (query.type) where.type = query.type;
  if (query.severity) where.severity = query.severity;
  const [data, total] = await Promise.all([
    Alert.find(where).sort({ severity: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Alert.countDocuments(where),
  ]);
  return { data, meta: metaOf(page, limit, total) };
};

const acknowledge = async (id: string, userId: string) =>
  found(await Alert.findByIdAndUpdate(id, { status: 'ACKNOWLEDGED', acknowledgedBy: userId, acknowledgedAt: new Date() }, { returnDocument: 'after' }), 'Alert');

const resolve = async (id: string, userId: string) =>
  found(await Alert.findByIdAndUpdate(id, { status: 'RESOLVED', resolvedBy: userId, resolvedAt: new Date() }, { returnDocument: 'after' }), 'Alert');

const listRules = async () => AlertRule.find().lean();

const upsertRule = async (type: TAlertType, payload: { enabled?: boolean; threshold?: number; notifyRoles?: string[]; channels?: ('PUSH' | 'EMAIL' | 'SMS')[] }) =>
  AlertRule.findOneAndUpdate({ type }, { $set: { ...payload, type } }, { upsert: true, returnDocument: 'after' });

// ---------- Built-in checks (run by the scheduler for each tenant) ----------
const checkDirtyRooms = async (location: { _id: TId; businessDate: string; timezone: string; checkInTime: string }) => {
  const rule = await ruleFor('DIRTY_ROOM_BEFORE_ARRIVAL');
  const leadMinutes = rule?.threshold ?? 120;
  const nowMinutes = localMinutes(location.timezone);
  const arrivals = await RoomStay.find({ locationId: location._id, arrivalDate: location.businessDate, status: STAY_STATUS.RESERVED, roomId: { $ne: null } }).lean();
  for (const stay of arrivals) {
    const room = await Room.findById(stay.roomId).lean();
    if (!room) continue;
    const key = `dirty:${stay._id}`;
    if (room.housekeepingStatus === 'CLEAN' || room.housekeepingStatus === 'INSPECTED') {
      await resolveByKey(key);
      continue;
    }
    const reservation = await Reservation.findById(stay.reservationId).select('eta confirmationNumber').lean();
    const arrivalAt = reservation?.eta && /^\d{2}:\d{2}$/.test(reservation.eta) ? parseTimeOfDay(reservation.eta) : parseTimeOfDay(location.checkInTime);
    if (arrivalAt - nowMinutes > leadMinutes) continue;
    await raise({
      type: 'DIRTY_ROOM_BEFORE_ARRIVAL',
      severity: arrivalAt - nowMinutes < 30 ? 'HIGH' : 'MEDIUM',
      locationId: location._id,
      title: `Room ${room.roomNumber} not ready`,
      message: `Room ${room.roomNumber} is ${room.housekeepingStatus.toLowerCase()} and a guest (${reservation?.confirmationNumber}) arrives around ${reservation?.eta || location.checkInTime}.`,
      ref: { kind: 'Room', id: room._id },
      action: { label: 'Assign housekeeping', method: 'POST', path: '/api/v1/housekeeping/assign' },
      dedupeKey: key,
    });
  }
};

const checkLateTickets = async (locationId: TId) => {
  const { KdsServices } = await import('../restaurant/order/kds.service');
  const late = await KdsServices.lateTickets(locationId);
  for (const ticket of late) {
    await raise({
      type: 'TICKET_OVERDUE',
      severity: ticket.elapsedMinutes > ticket.targetMinutes * 1.5 ? 'HIGH' : 'MEDIUM',
      locationId,
      title: `Order ${ticket.orderNumber} is late`,
      message: `${ticket.elapsedMinutes} min since it was sent (target ${ticket.targetMinutes})${ticket.table ? `, table ${ticket.table}` : ''}.`,
      ref: { kind: 'Order', id: ticket.orderId as Types.ObjectId },
      dedupeKey: `late:${ticket.orderId}`,
    });
  }
};

const checkDeposits = async (location: { _id: TId; businessDate: string }) => {
  const overdue = await Reservation.find({
    locationId: location._id,
    status: { $in: ['TENTATIVE', 'CONFIRMED'] },
    'deposit.requiredMinor': { $gt: 0 },
    'deposit.dueDate': { $lt: location.businessDate },
    $expr: { $lt: ['$deposit.paidMinor', '$deposit.requiredMinor'] },
  }).lean();
  for (const r of overdue) {
    await raise({
      type: 'DEPOSIT_OVERDUE',
      severity: 'MEDIUM',
      locationId: location._id,
      title: `Deposit overdue: ${r.confirmationNumber}`,
      message: `${r.deposit.requiredMinor - r.deposit.paidMinor} still unpaid; due ${r.deposit.dueDate}. Arrival ${r.arrivalDate}.`,
      ref: { kind: 'Reservation', id: r._id },
      dedupeKey: `deposit:${r._id}`,
    });
  }
};

const checkLongShifts = async (locationId: TId) => {
  const rule = await ruleFor('SHIFT_OPEN_TOO_LONG');
  const hours = rule?.threshold ?? 14;
  const shifts = await Shift.find({ locationId, status: 'OPEN', openedAt: { $lt: new Date(Date.now() - hours * 3600 * 1000) } }).populate('userId', 'name').lean();
  for (const s of shifts) {
    await raise({
      type: 'SHIFT_OPEN_TOO_LONG',
      severity: 'LOW',
      locationId,
      title: 'Cash drawer still open',
      message: `${(s.userId as any)?.name || 'A cashier'} opened a drawer more than ${hours} hours ago.`,
      ref: { kind: 'Shift', id: s._id },
      dedupeKey: `shift:${s._id}`,
    });
  }
};

// Runs every built-in check for every active tenant.
const runChecks = async () => {
  const tenants = await requestContext.asSystem(() => Tenant.find({ isActive: true, status: { $in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } }).select('_id modules').lean());
  for (const tenant of tenants) {
    await requestContext.asTenant(String(tenant._id), async () => {
      const locations = await Location.find({ isActive: true }).lean();
      for (const location of locations) {
        try {
          if (tenant.modules.includes('HOSPITALITY') && location.hasRooms) {
            await checkDirtyRooms(location);
            await checkDeposits(location);
          }
          if (tenant.modules.includes('RESTAURANT')) await checkLateTickets(location._id);
          await checkLongShifts(location._id);
        } catch (err) {
          logger.error(err, `Alert checks failed for location ${location._id}`);
        }
      }
      if (tenant.modules.includes('INVENTORY')) {
        const { InventoryServices } = await import('../inventory/inventory.service');
        await InventoryServices.checkLowStock().catch((err: unknown) => logger.error(err, 'Low stock check failed'));
      }
    });
  }
};

export const AlertService = { raise, resolveByKey, list, acknowledge, resolve, listRules, upsertRule, runChecks };
