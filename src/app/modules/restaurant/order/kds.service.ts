import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { Order } from './order.model';
import { IOrderItem, ITEM_STATUS, ORDER_STATUS } from './order.interface';
import { Station, Outlet } from '../../outlet/outlet.model';
import { Guest } from '../../hospitality/guest/guest.model';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { found } from '../../../utils/query';

type TId = Types.ObjectId | string;

const ACTIVE = [ITEM_STATUS.QUEUED, ITEM_STATUS.COOKING, ITEM_STATUS.READY];

// Live tickets for a station (or a whole outlet), oldest first, with timers.
const queue = async (locationId: TId, filter: { stationId?: string; outletId?: string }) => {
  const station = filter.stationId ? found(await Station.findById(filter.stationId).lean(), 'Station') : undefined;
  const outletId = station?.outletId || filter.outletId;
  const target = station?.targetMinutes || (outletId ? (await Outlet.findById(outletId).lean())?.ticketTargetMinutes : undefined) || 15;
  const where: Record<string, unknown> = {
    locationId,
    status: ORDER_STATUS.OPEN,
    pendingAcceptance: false,
    items: { $elemMatch: { status: { $in: ACTIVE }, ...(filter.stationId ? { stationId: new Types.ObjectId(filter.stationId) } : {}) } },
  };
  if (outletId && !filter.stationId) where.outletId = outletId;
  const orders = await Order.find(where).populate('tableId', 'tableNumber').populate('serverId', 'name').sort({ createdAt: 1 }).lean();
  const guestIds = orders.map((o) => o.guestId).filter(Boolean);
  const guests = await Guest.find({ _id: { $in: guestIds } }).select('allergies dietary firstName').lean();
  const allergyBy = new Map(guests.map((g) => [String(g._id), [...(g.allergies || []), ...(g.dietary || [])]]));
  const now = Date.now();

  return orders
    .map((o) => {
      const items = o.items.filter((i) => ACTIVE.includes(i.status as any) && (!filter.stationId || String(i.stationId) === filter.stationId));
      const firstFired = Math.min(...items.map((i) => (i.firedAt ? new Date(i.firedAt).getTime() : now)));
      const elapsedMinutes = Math.floor((now - firstFired) / 60000);
      return {
        orderId: o._id,
        orderNumber: o.orderNumber,
        type: o.type,
        table: (o.tableId as any)?.tableNumber,
        server: (o.serverId as any)?.name,
        covers: o.covers,
        // In-house guest allergies travel with the ticket.
        allergies: o.guestId ? allergyBy.get(String(o.guestId)) || [] : [],
        firedAt: new Date(firstFired),
        elapsedMinutes,
        targetMinutes: target,
        // green / amber / red ticket colour on the KDS
        urgency: elapsedMinutes >= target ? 'LATE' : elapsedMinutes >= target * 0.75 ? 'WARNING' : 'OK',
        items: items.map((i) => ({
          _id: i._id,
          name: i.name,
          quantity: i.quantity,
          modifiers: i.modifiers,
          specialInstructions: i.specialInstructions,
          course: i.course,
          seat: i.seat,
          status: i.status,
          stationId: i.stationId,
        })),
      };
    })
    .filter((t) => t.items.length);
};

// Counts of everything still to cook, by item (e.g. "12 x burger").
const allDay = async (locationId: TId, stationId?: string) =>
  Order.aggregate([
    { $match: { locationId: new Types.ObjectId(String(locationId)), status: ORDER_STATUS.OPEN } },
    { $unwind: '$items' },
    { $match: { 'items.status': { $in: [ITEM_STATUS.QUEUED, ITEM_STATUS.COOKING] }, ...(stationId ? { 'items.stationId': new Types.ObjectId(stationId) } : {}) } },
    { $group: { _id: '$items.menuItemId', name: { $first: '$items.name' }, quantity: { $sum: '$items.quantity' } } },
    { $sort: { quantity: -1 } },
  ]);

const notifyStations = (order: any, items: IOrderItem[], event: string) => {
  const stations = new Set(items.map((i) => String(i.stationId)).filter((s) => s !== 'undefined'));
  void publish({
    tenantId: order.tenantId,
    locationId: order.locationId,
    rooms: [...[...stations].map((s) => socketRooms.station(s)), socketRooms.outlet(order.outletId)],
    event,
    data: { orderId: order._id, orderNumber: order.orderNumber, items: items.map((i) => ({ _id: i._id, status: i.status, name: i.name })) },
  });
};

const setItemStatus = async (req: Request, orderId: string, itemIds: string[], status: 'COOKING' | 'READY') => {
  const order: any = found(await Order.findById(orderId), 'Order');
  const now = new Date();
  const changed: IOrderItem[] = [];
  for (const item of order.items) {
    if (!itemIds.includes(String(item._id))) continue;
    if (!ACTIVE.includes(item.status)) throw new AppError(httpStatus.CONFLICT, `${item.name} is ${item.status}`);
    item.status = status;
    if (status === ITEM_STATUS.COOKING) item.startedAt = item.startedAt || now;
    if (status === ITEM_STATUS.READY) item.readyAt = now;
    changed.push(item);
  }
  await order.save();
  notifyStations(order, changed, status === 'READY' ? 'items_ready' : 'kds_items_updated');
  void req;
  return order;
};

// Bump: every active item of this ticket at the station is ready.
const bump = async (req: Request, orderId: string, stationId: string) => {
  const order: any = found(await Order.findById(orderId), 'Order');
  const items = order.items.filter((i: IOrderItem) => String(i.stationId) === stationId && [ITEM_STATUS.QUEUED, ITEM_STATUS.COOKING].includes(i.status as any));
  if (!items.length) throw new AppError(httpStatus.CONFLICT, 'Nothing to bump');
  return setItemStatus(req, orderId, items.map((i: IOrderItem) => String(i._id)), 'READY');
};

// Recall: brings a bumped ticket back to the screen.
const recall = async (req: Request, orderId: string, stationId: string) => {
  const order: any = found(await Order.findById(orderId), 'Order');
  const items = order.items.filter((i: IOrderItem) => String(i.stationId) === stationId && i.status === ITEM_STATUS.READY);
  if (!items.length) throw new AppError(httpStatus.CONFLICT, 'Nothing to recall');
  for (const item of items) {
    item.status = ITEM_STATUS.COOKING;
    item.readyAt = undefined;
  }
  await order.save();
  notifyStations(order, items, 'kds_ticket_recalled');
  void req;
  return order;
};

// Average fired→ready minutes per item and station (prep-time analytics).
const prepTimes = async (locationId: TId, from: string, to: string) =>
  Order.aggregate([
    { $match: { locationId: new Types.ObjectId(String(locationId)), businessDate: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
    { $match: { 'items.firedAt': { $ne: null }, 'items.readyAt': { $ne: null } } },
    {
      $group: {
        _id: { item: '$items.name', stationId: '$items.stationId' },
        tickets: { $sum: 1 },
        avgMinutes: { $avg: { $divide: [{ $subtract: ['$items.readyAt', '$items.firedAt'] }, 60000] } },
        maxMinutes: { $max: { $divide: [{ $subtract: ['$items.readyAt', '$items.firedAt'] }, 60000] } },
      },
    },
    { $lookup: { from: 'stations', localField: '_id.stationId', foreignField: '_id', as: 'station' } },
    {
      $project: {
        _id: 0,
        item: '$_id.item',
        station: { $first: '$station.name' },
        tickets: 1,
        avgMinutes: { $round: ['$avgMinutes', 1] },
        maxMinutes: { $round: ['$maxMinutes', 1] },
      },
    },
    { $sort: { avgMinutes: -1 } },
  ]);

// Orders whose oldest active item is past the station/outlet target (for alerts).
const lateTickets = async (locationId: TId) => {
  const tickets = await queue(locationId, {});
  return tickets.filter((t) => t.urgency === 'LATE');
};

export const KdsServices = { queue, allDay, setItemStatus, bump, recall, prepTimes, lateTickets };
