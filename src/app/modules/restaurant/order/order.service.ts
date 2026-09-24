import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { Order } from './order.model';
import { IDiscount, IOrder, IOrderItem, ITEM_STATUS, ORDER_SOURCE, ORDER_STATUS, ORDER_TYPE, PAYMENT_STATUS } from './order.interface';
import { OrderPricing } from './order.pricing';
import { MenuItem } from '../menuItem/menuItem.model';
import { MenuServices, TModifierPick } from '../menuItem/menu.service';
import { Table } from '../table/table.model';
import { TABLE_STATUS } from '../table/table.interface';
import { Outlet } from '../../outlet/outlet.model';
import { Location } from '../../location/location.model';
import { Tenant } from '../../tenant/tenant.model';
import { Device } from '../../device/device.model';
import { Guest } from '../../hospitality/guest/guest.model';
import { RoomStay } from '../../hospitality/reservation/reservation.model';
import { STAY_STATUS } from '../../hospitality/reservation/reservation.interface';
import { FolioLedger } from '../../hospitality/folio/folio.ledger';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE } from '../../hospitality/folio/folio.interface';
import { taxRulesFor, tenantTaxInclusive } from '../../finance/finance.service';
import { Payment } from '../../payment/payment.model';
import { PAYMENT_METHOD } from '../../payment/payment.interface';
import { registerPaymentTarget } from '../../payment/payment.service';
import { ApprovalService } from '../../approval/approval.service';
import { nextSequence } from '../../system/counter.model';
import { activity } from '../../auditLog/auditLog.service';
import { runInTransaction } from '../../../utils/transaction';
import { requestContext } from '../../../utils/requestContext';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { emitDomainEvent } from '../../../utils/domainEvents';
import { splitEvenly } from '../../../utils/money';
import { found, metaOf, paginationOf } from '../../../utils/query';

type TId = Types.ObjectId | string;
type TOrderDoc = Awaited<ReturnType<typeof Order.findById>> & {};

export type TItemInput = {
  menuItemId: string;
  quantity: number;
  modifiers?: TModifierPick[];
  specialInstructions?: string;
  course?: number;
  seat?: number;
  checkNo?: number;
};

// ---------- helpers ----------
const pricingOptions = async (order: { locationId: TId; outletId: TId; type: string }) => {
  const [rules, inclusive, outlet] = await Promise.all([
    taxRulesFor(order.locationId),
    tenantTaxInclusive(),
    Outlet.findById(order.outletId).select('serviceChargeBps').lean(),
  ]);
  // Service charge applies to table service only.
  const serviceChargeBps = order.type === ORDER_TYPE.DINE_IN ? outlet?.serviceChargeBps || 0 : 0;
  return { rules, inclusive, serviceChargeBps };
};

const reprice = async (order: any) => {
  OrderPricing.priceOrder(order, await pricingOptions(order));
  order.paymentStatus = paymentStatusOf(order.totals);
};

const paymentStatusOf = (totals: IOrder['totals']) => {
  if (totals.refundedMinor > 0) return totals.paidMinor > 0 ? PAYMENT_STATUS.PARTIALLY_REFUNDED : PAYMENT_STATUS.REFUNDED;
  if (totals.paidMinor <= 0) return PAYMENT_STATUS.UNPAID;
  return totals.paidMinor >= totals.totalMinor ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIALLY_PAID;
};

const history = (order: any, status: string, userId?: string, remarks?: string) => {
  order.statusHistory.push({ status, changedAt: new Date(), changedBy: userId, remarks });
};

const assertOpen = (order: { status: string; orderNumber: string }) => {
  if (order.status !== ORDER_STATUS.OPEN) throw new AppError(httpStatus.CONFLICT, `Order ${order.orderNumber} is ${order.status}`);
};

const tenantApproval = async () => {
  const tenantId = requestContext.get()?.tenantId;
  const tenant = await requestContext.asSystem(() => Tenant.findById(tenantId).select('settings.approval').lean());
  return tenant?.settings?.approval || { discountOverBps: 1000, discountOverMinor: 2000, voidAfterFire: true, refunds: true, folioAdjustOverMinor: 0, cashPayoutOverMinor: 5000 };
};

const publishOrder = (order: any, event: string, extraRooms: string[] = []) =>
  publish({
    tenantId: order.tenantId,
    locationId: order.locationId,
    rooms: [socketRooms.outlet(order.outletId), ...extraRooms],
    event,
    data: { orderId: order._id, orderNumber: order.orderNumber, status: order.status, tableId: order.tableId, totals: order.totals },
  });

// Sends a KDS ticket to each station that received items.
const publishToStations = (order: any, items: IOrderItem[], event = 'kds_ticket') => {
  const byStation = new Map<string, IOrderItem[]>();
  for (const item of items) {
    const key = String(item.stationId || 'none');
    byStation.set(key, [...(byStation.get(key) || []), item]);
  }
  for (const [stationId, stationItems] of byStation) {
    if (stationId === 'none') continue;
    void publish({
      tenantId: order.tenantId,
      locationId: order.locationId,
      rooms: [socketRooms.station(stationId)],
      event,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        type: order.type,
        items: stationItems.map((i) => ({ _id: i._id, name: i.name, quantity: i.quantity, modifiers: i.modifiers, specialInstructions: i.specialInstructions, course: i.course, seat: i.seat, status: i.status })),
      },
    });
  }
};

const refreshTableStatus = async (tableId?: TId) => {
  if (!tableId) return;
  const open = await Order.exists({ tableId, status: ORDER_STATUS.OPEN });
  const table = await Table.findById(tableId);
  if (!table) return;
  if (open && table.status !== TABLE_STATUS.BILL_REQUESTED) table.status = TABLE_STATUS.OCCUPIED;
  if (!open && (table.status === TABLE_STATUS.OCCUPIED || table.status === TABLE_STATUS.BILL_REQUESTED)) table.status = TABLE_STATUS.CLEANING;
  await table.save();
};

// Builds an order line from the menu. The price always comes from the server.
const buildItem = async (input: TItemInput, ctx: { locationId: TId; outletId: TId; defaultStationId?: TId; userId?: string }): Promise<IOrderItem> => {
  const menuItem = found(
    await MenuItem.findOne({
      _id: input.menuItemId,
      $or: [{ locationId: ctx.locationId }, { locationId: null }, { locationId: { $exists: false } }],
    }).lean(),
    'Menu item',
  );
  if (menuItem.outletIds?.length && !menuItem.outletIds.map(String).includes(String(ctx.outletId))) {
    throw new AppError(httpStatus.BAD_REQUEST, `${menuItem.name} is not sold in this outlet`);
  }
  const eff = MenuServices.effectiveItem(menuItem, ctx.locationId);
  if (!eff.available) throw new AppError(httpStatus.CONFLICT, `${menuItem.name} is sold out`);
  const modifiers = await MenuServices.priceModifiers(menuItem, input.modifiers);
  if (menuItem.availableQty !== undefined && menuItem.availableQty !== null) {
    await MenuServices.consumeAvailability(menuItem._id, input.quantity);
  }
  return {
    _id: new Types.ObjectId(),
    menuItemId: menuItem._id as Types.ObjectId,
    name: menuItem.name,
    categoryId: menuItem.categoryId,
    stationId: (menuItem.stationId || ctx.defaultStationId) as Types.ObjectId | undefined,
    taxCategory: menuItem.taxCategory,
    quantity: input.quantity,
    unitPriceMinor: eff.priceMinor,
    modifiers,
    specialInstructions: input.specialInstructions,
    course: input.course || menuItem.defaultCourse || 1,
    seat: input.seat,
    checkNo: input.checkNo || 1,
    status: ITEM_STATUS.NEW,
    addedBy: ctx.userId ? new Types.ObjectId(ctx.userId) : undefined,
  };
};

const nextOrderNumber = async (locationId: TId, businessDate: string) => {
  const seq = await nextSequence(`order:${locationId}:${businessDate}`);
  return String(seq).padStart(4, '0');
};

// Fires NEW items to the kitchen: a given course, specific items, or the lowest course waiting.
const fireItems = (order: any, options: { course?: number; itemIds?: string[]; all?: boolean } = {}) => {
  const waiting = order.items.filter((i: IOrderItem) => i.status === ITEM_STATUS.NEW);
  if (!waiting.length) return [];
  let toFire: IOrderItem[];
  if (options.itemIds?.length) toFire = waiting.filter((i: IOrderItem) => options.itemIds!.includes(String(i._id)));
  else if (options.all) toFire = waiting;
  else {
    const course = options.course ?? Math.min(...waiting.map((i: IOrderItem) => i.course || 1));
    toFire = waiting.filter((i: IOrderItem) => (i.course || 1) === course);
  }
  const now = new Date();
  for (const item of toFire) {
    item.status = ITEM_STATUS.QUEUED;
    item.firedAt = now;
  }
  return toFire;
};

// ---------- create / read ----------
export type TCreateOrder = {
  outletId: string;
  type?: keyof typeof ORDER_TYPE;
  tableId?: string;
  covers?: number;
  guestId?: string;
  roomStayId?: string;
  items: TItemInput[];
  notes?: string;
  clientOrderId?: string;
  // Number given by an offline device (must start with the device's prefix)
  orderNumber?: string;
  fire?: boolean | 'ALL';
  source?: keyof typeof ORDER_SOURCE;
  pendingAcceptance?: boolean;
  delivery?: IOrder['delivery'];
};

const createOrder = async (req: Request | null, payload: TCreateOrder, ctx?: { locationId: string; userId?: string; deviceId?: string }) => {
  const locationId = ctx?.locationId || req!.locationId!;
  const userId = ctx?.userId || req?.user.id;
  const deviceId = ctx?.deviceId || req?.user.deviceId;
  if (payload.clientOrderId) {
    const existing = await Order.findOne({ clientOrderId: payload.clientOrderId }).lean();
    if (existing) return existing;
  }
  const outlet = found(await Outlet.findOne({ _id: payload.outletId, locationId, isActive: true }).lean(), 'Outlet');
  const location = found(await Location.findById(locationId).lean(), 'Location');
  const type = payload.type || (outlet.type === 'ROOM_SERVICE' ? ORDER_TYPE.ROOM_SERVICE : ORDER_TYPE.DINE_IN);
  if (type === ORDER_TYPE.DINE_IN && payload.tableId) {
    const table = found(await Table.findOne({ _id: payload.tableId, outletId: outlet._id }).lean(), 'Table');
    const busy = await Order.findOne({ tableId: table._id, status: ORDER_STATUS.OPEN }).select('orderNumber').lean();
    if (busy && payload.source !== ORDER_SOURCE.GUEST_QR) {
      throw new AppError(httpStatus.CONFLICT, `Table ${table.tableNumber} already has open order ${busy.orderNumber}; add items to it`);
    }
  }

  let guestId = payload.guestId;
  if (payload.roomStayId) {
    const stay = found(await RoomStay.findOne({ _id: payload.roomStayId, locationId, status: STAY_STATUS.CHECKED_IN }).lean(), 'In-house stay');
    guestId = guestId || String(stay.guestIds[0]);
  }

  let orderNumber: string;
  if (payload.orderNumber) {
    const device = deviceId ? await Device.findById(deviceId).lean() : null;
    if (!device || !payload.orderNumber.startsWith(`${device.orderPrefix}-`)) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Offline order numbers must start with the device prefix');
    }
    orderNumber = payload.orderNumber;
  } else {
    orderNumber = await nextOrderNumber(locationId, location.businessDate);
  }

  const order = await runInTransaction(async () => {
    const items = [];
    for (const input of payload.items) items.push(await buildItem(input, { locationId, outletId: outlet._id, defaultStationId: outlet.defaultStationId, userId }));
    const doc: any = new Order({
      orderNumber,
      clientOrderId: payload.clientOrderId,
      outletId: outlet._id,
      tableId: payload.tableId,
      type,
      source: payload.source || (payload.orderNumber ? ORDER_SOURCE.OFFLINE_SYNC : ORDER_SOURCE.POS),
      businessDate: location.businessDate,
      covers: payload.covers ?? 1,
      serverId: userId,
      deviceId,
      guestId,
      roomStayId: payload.roomStayId,
      pendingAcceptance: Boolean(payload.pendingAcceptance),
      items,
      discounts: [],
      checks: [{ checkNo: 1 }],
      notes: payload.notes,
      delivery: payload.delivery,
      locationId,
      statusHistory: [],
    });
    history(doc, ORDER_STATUS.OPEN, userId);
    if (!doc.pendingAcceptance && payload.fire !== false) fireItems(doc, { all: payload.fire === 'ALL' });
    await reprice(doc);
    await doc.save();
    await refreshTableStatus(doc.tableId);
    await activity.record({ action: 'ORDER_CREATED', entity: 'Order', entityId: doc._id, locationId, actorId: userId, message: `Order ${orderNumber} opened (${items.length} item(s))` });
    return doc;
  });

  void publishOrder(order, 'new_order');
  const fired = order.items.filter((i: IOrderItem) => i.status === ITEM_STATUS.QUEUED);
  if (fired.length) {
    publishToStations(order, fired);
    emitDomainEvent('order.itemsFired', { tenantId: String(order.tenantId), orderId: String(order._id), itemIds: fired.map((i: IOrderItem) => String(i._id)) });
  }
  emitDomainEvent('order.created', { tenantId: String(order.tenantId), orderId: String(order._id) });
  return order;
};

const getOrder = async (id: string) => {
  const order = found(
    await Order.findById(id).populate('tableId', 'tableNumber').populate('serverId', 'name').populate('guestId', 'firstName lastName allergies preferences tags stats').lean(),
    'Order',
  );
  const payments = await Payment.find({ 'target.kind': 'ORDER', 'target.id': order._id }).sort({ createdAt: 1 }).lean();
  return { ...order, payments };
};

const listOrders = async (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 50);
  const where: Record<string, unknown> = { ...filter };
  for (const key of ['status', 'outletId', 'tableId', 'type', 'businessDate', 'serverId', 'paymentStatus', 'source']) {
    if (query[key]) where[key] = query[key];
  }
  if (query.pendingAcceptance === 'true') where.pendingAcceptance = true;
  const [data, total] = await Promise.all([
    Order.find(where).populate('tableId', 'tableNumber').populate('serverId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(where),
  ]);
  return { data, meta: metaOf(page, limit, total) };
};

// ---------- item changes ----------
const loadOpen = async (orderId: string) => {
  const order = found(await Order.findById(orderId), 'Order');
  assertOpen(order);
  return order;
};

const addItems = async (req: Request, orderId: string, items: TItemInput[], fire: boolean | 'ALL' = true) => {
  const order = await runInTransaction(async () => {
    const doc: any = await loadOpen(orderId);
    const outlet = found(await Outlet.findById(doc.outletId).lean(), 'Outlet');
    for (const input of items) doc.items.push(await buildItem(input, { locationId: doc.locationId, outletId: doc.outletId, defaultStationId: outlet.defaultStationId, userId: req.user.id }));
    if (!doc.pendingAcceptance && fire !== false) fireItems(doc, { all: fire === 'ALL' });
    await reprice(doc);
    await doc.save();
    await activity.record({ action: 'ORDER_ITEMS_ADDED', entity: 'Order', entityId: doc._id, message: `Added ${items.length} item(s) to order ${doc.orderNumber}` });
    return doc;
  });
  const fired = order.items.filter((i: IOrderItem) => i.status === ITEM_STATUS.QUEUED && items.length && i.firedAt && Date.now() - i.firedAt.getTime() < 5000);
  if (fired.length) {
    publishToStations(order, fired);
    emitDomainEvent('order.itemsFired', { tenantId: String(order.tenantId), orderId, itemIds: fired.map((i: IOrderItem) => String(i._id)) });
  }
  void publishOrder(order, 'order_updated');
  return order;
};

const updateItem = async (orderId: string, itemId: string, payload: { quantity?: number; specialInstructions?: string; seat?: number; course?: number; checkNo?: number }) => {
  const order = await loadOpen(orderId);
  const item = (order.items as any).id(itemId);
  if (!item) throw new AppError(httpStatus.NOT_FOUND, 'Item not found');
  const kitchenFields = payload.quantity !== undefined || payload.specialInstructions !== undefined || payload.course !== undefined;
  if (kitchenFields && item.status !== ITEM_STATUS.NEW) throw new AppError(httpStatus.CONFLICT, 'Item was already sent to the kitchen; void and re-add it');
  Object.assign(item, payload);
  await reprice(order);
  await order.save();
  void publishOrder(order, 'order_updated');
  return order;
};

const fire = async (req: Request, orderId: string, options: { course?: number; itemIds?: string[] }) => {
  const order: any = await loadOpen(orderId);
  if (order.pendingAcceptance) throw new AppError(httpStatus.CONFLICT, 'Accept the guest order first');
  const fired = fireItems(order, { ...options, all: !options.course && !options.itemIds?.length ? false : undefined });
  if (!fired.length) throw new AppError(httpStatus.CONFLICT, 'Nothing waiting to be sent');
  await order.save();
  await activity.record({ action: 'COURSE_FIRED', entity: 'Order', entityId: order._id, message: `Fired ${fired.length} item(s) on order ${order.orderNumber}` });
  publishToStations(order, fired);
  emitDomainEvent('order.itemsFired', { tenantId: req.user.tenantId!, orderId, itemIds: fired.map((i: IOrderItem) => String(i._id)) });
  void publishOrder(order, 'order_updated');
  return order;
};

// Guest QR orders reach the kitchen only after a staff member accepts them.
const accept = async (req: Request, orderId: string) => {
  const order: any = await loadOpen(orderId);
  if (!order.pendingAcceptance) return order;
  order.pendingAcceptance = false;
  order.serverId = order.serverId || req.user.id;
  const fired = fireItems(order, { all: true });
  history(order, 'ACCEPTED', req.user.id);
  await order.save();
  publishToStations(order, fired);
  emitDomainEvent('order.itemsFired', { tenantId: req.user.tenantId!, orderId, itemIds: fired.map((i: IOrderItem) => String(i._id)) });
  void publishOrder(order, 'order_updated');
  return order;
};

const markServed = async (req: Request, orderId: string, itemIds: string[]) => {
  const order: any = found(await Order.findById(orderId), 'Order');
  const now = new Date();
  for (const item of order.items) {
    if (itemIds.includes(String(item._id)) && [ITEM_STATUS.QUEUED, ITEM_STATUS.COOKING, ITEM_STATUS.READY].includes(item.status)) {
      item.status = ITEM_STATUS.SERVED;
      item.servedAt = now;
      item.readyAt = item.readyAt || now;
    }
  }
  await order.save();
  publishToStations(order, order.items.filter((i: IOrderItem) => itemIds.includes(String(i._id))), 'kds_items_updated');
  void publishOrder(order, 'order_updated');
  return order;
};

// ---------- voids, comps, discounts ----------
const voidItem = async (req: Request, orderId: string, itemId: string, payload: { reason: string; waste?: boolean }) => {
  const order: any = await loadOpen(orderId);
  const item = order.items.id(itemId);
  if (!item || item.status === ITEM_STATUS.VOIDED) throw new AppError(httpStatus.NOT_FOUND, 'Item not found');
  const afterFire = item.status !== ITEM_STATUS.NEW;
  const rules = await tenantApproval();
  const approvedBy = await ApprovalService.requireApproval(req, 'VOID_ITEM', afterFire && rules.voidAfterFire);
  const before = item.calc?.totalMinor || 0;
  item.status = ITEM_STATUS.VOIDED;
  item.void = { at: new Date(), by: req.user.id, reason: payload.reason, approvedBy, afterFire, waste: payload.waste ?? afterFire };
  await reprice(order);
  if (order.totals.paidMinor > order.totals.totalMinor) throw new AppError(httpStatus.CONFLICT, 'Refund the payment before voiding paid items');
  await order.save();
  await activity.record({
    action: 'ITEM_VOIDED',
    entity: 'Order',
    entityId: order._id,
    approvedBy,
    message: `Voided ${item.quantity}x ${item.name} (${before}) on order ${order.orderNumber}. Reason: ${payload.reason}`,
    meta: { afterFire, waste: item.void.waste },
  });
  if (afterFire) {
    publishToStations(order, [item], 'kds_items_voided');
    emitDomainEvent('order.itemsVoided', { tenantId: req.user.tenantId!, orderId, itemIds: [itemId], waste: item.void.waste });
  }
  void publishOrder(order, 'order_updated');
  return order;
};

const voidOrder = async (req: Request, orderId: string, reason: string) => {
  const order: any = await loadOpen(orderId);
  if (order.totals.paidMinor > 0) throw new AppError(httpStatus.CONFLICT, 'Refund payments before voiding the order');
  const fired = order.items.some((i: IOrderItem) => i.status !== ITEM_STATUS.NEW && i.status !== ITEM_STATUS.VOIDED);
  const approvedBy = await ApprovalService.requireApproval(req, 'VOID_ORDER', fired || order.totals.totalMinor > 0);
  const now = new Date();
  const voided: IOrderItem[] = [];
  for (const item of order.items) {
    if (item.status === ITEM_STATUS.VOIDED) continue;
    item.void = { at: now, by: req.user.id, reason, approvedBy, afterFire: item.status !== ITEM_STATUS.NEW, waste: item.status !== ITEM_STATUS.NEW };
    item.status = ITEM_STATUS.VOIDED;
    voided.push(item);
  }
  order.status = ORDER_STATUS.VOIDED;
  order.voidReason = reason;
  order.closedAt = now;
  history(order, ORDER_STATUS.VOIDED, req.user.id, reason);
  await reprice(order);
  await order.save();
  await refreshTableStatus(order.tableId);
  await activity.record({ action: 'ORDER_VOIDED', entity: 'Order', entityId: order._id, approvedBy, message: `Voided order ${order.orderNumber}. Reason: ${reason}` });
  publishToStations(order, voided.filter((i) => i.void?.afterFire), 'kds_items_voided');
  emitDomainEvent('order.itemsVoided', { tenantId: req.user.tenantId!, orderId, itemIds: voided.filter((i) => i.void?.afterFire).map((i) => String(i._id)), waste: true });
  void publishOrder(order, 'order_updated');
  return order;
};

// Discounts over the tenant threshold (or any comp) need a manager.
const applyDiscount = async (req: Request, orderId: string, payload: IDiscount & { itemId?: string }) => {
  const order: any = await loadOpen(orderId);
  const rules = await tenantApproval();
  const base = payload.itemId ? order.items.id(payload.itemId)?.calc?.grossMinor || 0 : order.totals.subtotalMinor;
  const value = payload.type === 'PERCENT' ? Math.round((base * payload.value) / 10000) : payload.type === 'COMP' ? base : payload.value;
  const needs = payload.type === 'COMP' || (payload.type === 'PERCENT' && payload.value > rules.discountOverBps) || value > rules.discountOverMinor;
  const approvedBy = await ApprovalService.requireApproval(req, payload.type === 'COMP' ? 'COMP' : 'DISCOUNT', needs);
  const discount = { type: payload.type, value: payload.value, reason: payload.reason, by: req.user.id, approvedBy };
  if (payload.itemId) {
    const item = order.items.id(payload.itemId);
    if (!item || item.status === ITEM_STATUS.VOIDED) throw new AppError(httpStatus.NOT_FOUND, 'Item not found');
    item.discount = discount;
  } else {
    order.discounts.push(discount);
  }
  await reprice(order);
  await order.save();
  await activity.record({
    action: payload.type === 'COMP' ? 'COMP' : 'DISCOUNT',
    entity: 'Order',
    entityId: order._id,
    approvedBy,
    message: `${payload.type === 'COMP' ? 'Comped' : 'Discount'} ${value} on order ${order.orderNumber}${payload.itemId ? ' (item)' : ''}: ${payload.reason}`,
    meta: { type: payload.type, value: payload.value, amountMinor: value },
  });
  void publishOrder(order, 'order_updated');
  return order;
};

const removeDiscount = async (orderId: string, payload: { discountId?: string; itemId?: string }) => {
  const order: any = await loadOpen(orderId);
  if (payload.itemId) {
    const item = order.items.id(payload.itemId);
    if (item) item.discount = undefined;
  } else if (payload.discountId) {
    order.discounts = order.discounts.filter((d: any) => String(d._id) !== payload.discountId);
  }
  await reprice(order);
  await order.save();
  return order;
};

// ---------- split checks ----------
const splitChecks = async (
  orderId: string,
  payload: { mode: 'ITEMS'; assignments: { itemId: string; checkNo: number }[] } | { mode: 'SEATS' } | { mode: 'EVEN'; parts: number } | { mode: 'RESET' },
) => {
  const order: any = await loadOpen(orderId);
  if (order.totals.paidMinor > 0) throw new AppError(httpStatus.CONFLICT, 'Change the split before taking payments');
  if (payload.mode === 'ITEMS') {
    for (const a of payload.assignments) {
      const item = order.items.id(a.itemId);
      if (!item) throw new AppError(httpStatus.NOT_FOUND, `Item ${a.itemId} not found`);
      item.checkNo = a.checkNo;
    }
    const numbers = [...new Set(order.items.map((i: IOrderItem) => i.checkNo || 1))] as number[];
    order.checks = numbers.sort().map((n) => ({ checkNo: n }));
  } else if (payload.mode === 'SEATS') {
    for (const item of order.items) item.checkNo = item.seat || 1;
    const numbers = [...new Set(order.items.map((i: IOrderItem) => i.checkNo))] as number[];
    order.checks = numbers.sort().map((n) => ({ checkNo: n, label: `Seat ${n}` }));
  } else if (payload.mode === 'EVEN') {
    if (payload.parts < 2 || payload.parts > 20) throw new AppError(httpStatus.BAD_REQUEST, 'Split into 2 to 20 parts');
    for (const item of order.items) item.checkNo = 1;
    order.checks = splitEvenly(order.totals.totalMinor, payload.parts).map((amount, i) => ({ checkNo: i + 1, fixedAmountMinor: amount }));
  } else {
    for (const item of order.items) item.checkNo = 1;
    order.checks = [{ checkNo: 1 }];
  }
  await order.save();
  return checksSummary(order);
};

const checksSummary = async (order: any) => {
  const payments = await Payment.find({ 'target.kind': 'ORDER', 'target.id': order._id, status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } }).lean();
  return order.checks.map((c: { checkNo: number; label?: string }) => {
    const total = OrderPricing.checkTotal(order, c.checkNo);
    const paid = payments.filter((p) => (p.target.checkNo || 1) === c.checkNo).reduce((s, p) => s + p.amountMinor, 0);
    return { checkNo: c.checkNo, label: c.label, totalMinor: total, paidMinor: paid, balanceMinor: total - paid };
  });
};

// ---------- table operations ----------
const transferTable = async (req: Request, orderId: string, tableId: string) => {
  const order: any = await loadOpen(orderId);
  const table = found(await Table.findOne({ _id: tableId, locationId: order.locationId }).lean(), 'Table');
  const busy = await Order.exists({ tableId: table._id, status: ORDER_STATUS.OPEN, _id: { $ne: order._id } });
  if (busy) throw new AppError(httpStatus.CONFLICT, `Table ${table.tableNumber} is occupied; merge instead`);
  const from = order.tableId;
  order.tableId = table._id;
  order.outletId = table.outletId;
  history(order, 'TABLE_TRANSFER', req.user.id, `to ${table.tableNumber}`);
  await order.save();
  await refreshTableStatus(from);
  await refreshTableStatus(table._id);
  await activity.record({ action: 'TABLE_TRANSFER', entity: 'Order', entityId: order._id, message: `Moved order ${order.orderNumber} to table ${table.tableNumber}` });
  void publishOrder(order, 'order_updated');
  return order;
};

// Moves every item of the source orders onto the target order (tables pushed together).
const mergeOrders = async (req: Request, targetOrderId: string, sourceOrderIds: string[]) =>
  runInTransaction(async () => {
    const target: any = await loadOpen(targetOrderId);
    for (const id of sourceOrderIds) {
      if (id === targetOrderId) continue;
      const source: any = await loadOpen(id);
      if (source.totals.paidMinor > 0) throw new AppError(httpStatus.CONFLICT, `Order ${source.orderNumber} has payments`);
      for (const item of source.items) target.items.push(item.toObject());
      target.discounts.push(...source.discounts.map((d: any) => d.toObject()));
      target.covers += source.covers;
      source.status = ORDER_STATUS.MERGED;
      source.mergedIntoId = target._id;
      source.closedAt = new Date();
      history(source, ORDER_STATUS.MERGED, req.user.id, `into ${target.orderNumber}`);
      await source.save();
      await refreshTableStatus(source.tableId);
    }
    await reprice(target);
    await target.save();
    await activity.record({ action: 'ORDERS_MERGED', entity: 'Order', entityId: target._id, message: `Merged ${sourceOrderIds.length} order(s) into ${target.orderNumber}` });
    void publishOrder(target, 'order_updated');
    return target;
  });

// Moves some items into a new order (e.g. part of the party leaves to another table).
const splitOrder = async (req: Request, orderId: string, payload: { itemIds: string[]; tableId?: string }) =>
  runInTransaction(async () => {
    const order: any = await loadOpen(orderId);
    if (order.totals.paidMinor > 0) throw new AppError(httpStatus.CONFLICT, 'Split before taking payments');
    const moving = order.items.filter((i: any) => payload.itemIds.includes(String(i._id)));
    if (!moving.length || moving.length === order.items.length) throw new AppError(httpStatus.BAD_REQUEST, 'Choose some, not all, items to move');
    order.items = order.items.filter((i: any) => !payload.itemIds.includes(String(i._id)));
    const location = found(await Location.findById(order.locationId).lean(), 'Location');
    const created: any = new Order({
      orderNumber: await nextOrderNumber(order.locationId, location.businessDate),
      outletId: order.outletId,
      tableId: payload.tableId || order.tableId,
      type: order.type,
      source: order.source,
      businessDate: order.businessDate,
      covers: 1,
      serverId: order.serverId,
      guestId: order.guestId,
      items: moving.map((i: any) => i.toObject()),
      discounts: [],
      checks: [{ checkNo: 1 }],
      locationId: order.locationId,
      statusHistory: [],
    });
    history(created, ORDER_STATUS.OPEN, req.user.id, `split from ${order.orderNumber}`);
    await reprice(order);
    await reprice(created);
    await order.save();
    await created.save();
    await refreshTableStatus(created.tableId);
    return { original: order, created };
  });

const requestBill = async (orderId: string) => {
  const order = await loadOpen(orderId);
  if (order.tableId) await Table.updateOne({ _id: order.tableId }, { status: TABLE_STATUS.BILL_REQUESTED });
  void publishOrder(order, 'bill_requested');
  return order;
};

// Zero-total orders (fully comped) close without payment.
const closeIfSettled = async (order: any, userId?: string) => {
  if (order.status !== ORDER_STATUS.OPEN || order.totals.balanceMinor > 0 || order.pendingAcceptance) return false;
  order.status = ORDER_STATUS.CLOSED;
  order.closedAt = new Date();
  history(order, ORDER_STATUS.CLOSED, userId);
  await order.save();
  await refreshTableStatus(order.tableId);
  return true;
};

const closeOrder = async (req: Request, orderId: string) => {
  const order: any = await loadOpen(orderId);
  if (order.totals.balanceMinor > 0) throw new AppError(httpStatus.CONFLICT, `Order still owes ${order.totals.balanceMinor}`);
  await closeIfSettled(order, req.user.id);
  emitDomainEvent('order.closed', { tenantId: req.user.tenantId!, orderId });
  void publishOrder(order, 'order_closed');
  return order;
};

const reopenOrder = async (req: Request, orderId: string, reason: string) => {
  const order: any = found(await Order.findById(orderId), 'Order');
  if (order.status !== ORDER_STATUS.CLOSED) throw new AppError(httpStatus.CONFLICT, 'Only closed orders can be reopened');
  const approvedBy = await ApprovalService.requireApproval(req, 'REOPEN_ORDER');
  order.status = ORDER_STATUS.OPEN;
  order.closedAt = undefined;
  history(order, 'REOPENED', req.user.id, reason);
  await order.save();
  await refreshTableStatus(order.tableId);
  await activity.record({ action: 'ORDER_REOPENED', entity: 'Order', entityId: order._id, approvedBy, message: `Reopened order ${order.orderNumber}: ${reason}` });
  return order;
};

// Links the order to a guest profile / in-house stay (allergy badge, loyalty, charge to room).
const setGuest = async (orderId: string, payload: { guestId?: string | null; roomStayId?: string | null }) => {
  const order: any = await loadOpen(orderId);
  if (payload.roomStayId) {
    const stay = found(await RoomStay.findOne({ _id: payload.roomStayId, status: STAY_STATUS.CHECKED_IN }).lean(), 'In-house stay');
    order.roomStayId = stay._id;
    order.guestId = payload.guestId || stay.guestIds[0];
  } else {
    if (payload.guestId) found(await Guest.findById(payload.guestId).lean(), 'Guest');
    order.guestId = payload.guestId || undefined;
    if (payload.roomStayId === null) order.roomStayId = undefined;
  }
  await order.save();
  return getOrder(orderId);
};

// ---------- receipt ----------
const receipt = async (orderId: string, checkNo?: number) => {
  const order: any = await getOrder(orderId);
  const outlet = await Outlet.findById(order.outletId).lean();
  const location = await Location.findById(order.locationId).lean();
  const tenant = await requestContext.asSystem(() => Tenant.findById(order.tenantId).select('name branding currency').lean());
  const items = order.items.filter((i: IOrderItem) => i.status !== ITEM_STATUS.VOIDED && (!checkNo || (i.checkNo || 1) === checkNo));
  const money = (v: number) => (v / 100).toFixed(2);
  const width = 42;
  const line = (left: string, right = '') => `${left.slice(0, width - right.length - 1).padEnd(width - right.length)}${right}`;
  const text = [
    (tenant?.branding?.displayName || tenant?.name || '').slice(0, width),
    `${outlet?.name || ''} - ${location?.name || ''}`.slice(0, width),
    location?.address?.slice(0, width) || '',
    '-'.repeat(width),
    line(`Order ${order.orderNumber}${checkNo ? ` / check ${checkNo}` : ''}`, new Date(order.createdAt).toISOString().slice(0, 16).replace('T', ' ')),
    order.tableId?.tableNumber ? `Table ${order.tableId.tableNumber}  Covers ${order.covers}` : order.type,
    '-'.repeat(width),
    ...items.flatMap((i: IOrderItem) => [
      line(`${i.quantity} x ${i.name}`, money(i.calc?.grossMinor || 0)),
      ...i.modifiers.map((m) => line(`   + ${m.name}`)),
      ...(i.calc?.discountMinor ? [line('   discount', `-${money(i.calc.discountMinor)}`)] : []),
    ]),
    '-'.repeat(width),
    line('Subtotal', money(order.totals.subtotalMinor)),
    ...(order.totals.discountMinor ? [line('Discounts', `-${money(order.totals.discountMinor)}`)] : []),
    ...(order.totals.serviceChargeMinor ? [line('Service charge', money(order.totals.serviceChargeMinor))] : []),
    ...order.taxLines.map((t: { name: string; rateBps: number; amountMinor: number }) => line(`${t.name} ${t.rateBps / 100}%`, money(t.amountMinor))),
    line('TOTAL', money(checkNo ? OrderPricing.checkTotal(order, checkNo) : order.totals.totalMinor)),
    ...order.payments
      .filter((p: any) => !checkNo || (p.target.checkNo || 1) === checkNo)
      .map((p: any) => line(`Paid ${p.method.replace(/_/g, ' ').toLowerCase()}${p.folioPosting?.roomNumber ? ` room ${p.folioPosting.roomNumber}` : ''}`, money(p.amountMinor + p.tipMinor))),
    '-'.repeat(width),
    'Thank you',
  ].join('\n');
  return { order: { _id: order._id, orderNumber: order.orderNumber }, currency: tenant?.currency, items, totals: order.totals, taxLines: order.taxLines, checkNo, text };
};

// ---------- payment target: outlet orders ----------
const chargeCodeFor = (taxCategory: string) =>
  ({ FOOD: 'FOOD', BEVERAGE: 'BEV', ALCOHOL: 'ALC', MINIBAR: 'MINI', SPA: 'SPA', LAUNDRY: 'LNDRY' })[taxCategory] || 'MISC';

// Posts an itemised copy of the check to the guest's (or company's) folio.
const postCheckToFolio = async (order: any, payment: any) => {
  const checkNo = payment.target.checkNo || 1;
  const fixed = order.checks.find((c: any) => c.checkNo === checkNo && c.fixedAmountMinor !== undefined && c.fixedAmountMinor !== null);
  const lineIds: Types.ObjectId[] = [];
  const outlet = await Outlet.findById(order.outletId).select('name').lean();
  const source = { kind: FOLIO_SOURCE.POS, refId: order._id };
  if (fixed) {
    // Even split: one summary line with a proportional share of the tax.
    const share = payment.amountMinor / Math.max(order.totals.totalMinor, 1);
    const taxLines = order.taxLines.map((t: any) => ({ name: t.name, rateBps: t.rateBps, amountMinor: Math.round(t.amountMinor * share) }));
    const tax = taxLines.reduce((s: number, t: { amountMinor: number }) => s + t.amountMinor, 0);
    const posted = await FolioLedger.postLine({
      folioId: payment.folioPosting.folioId,
      type: FOLIO_LINE_TYPE.CHARGE,
      code: 'FOOD',
      description: `${outlet?.name || 'Outlet'} order ${order.orderNumber} (share ${checkNo}/${order.checks.length})`,
      unitAmountMinor: payment.amountMinor,
      source: { ...source, itemRef: `check:${checkNo}` },
      postingKey: `POS:${payment._id}:share`,
      paymentId: payment._id,
      taxOverride: { netMinor: payment.amountMinor - tax, taxMinor: tax, taxLines },
    });
    return [posted._id as Types.ObjectId];
  }
  const items = order.items.filter((i: any) => i.status !== ITEM_STATUS.VOIDED && (i.checkNo || 1) === checkNo);
  for (const item of items) {
    const itemTax = item.calc.taxMinor;
    const total = item.calc.totalMinor;
    const posted = await FolioLedger.postLine({
      folioId: payment.folioPosting.folioId,
      type: FOLIO_LINE_TYPE.CHARGE,
      code: chargeCodeFor(item.taxCategory),
      description: `${outlet?.name || 'Outlet'} #${order.orderNumber}: ${item.quantity}x ${item.name}`,
      quantity: 1,
      unitAmountMinor: total,
      source: { ...source, itemRef: String(item._id) },
      postingKey: `POS:${payment._id}:${item._id}`,
      paymentId: payment._id,
      taxOverride: { netMinor: total - itemTax, taxMinor: itemTax, taxLines: item.calc.taxLines || [] },
    });
    lineIds.push(posted._id as Types.ObjectId);
  }
  if (payment.tipMinor) {
    const tip = await FolioLedger.postLine({
      folioId: payment.folioPosting.folioId,
      type: FOLIO_LINE_TYPE.CHARGE,
      code: 'TIP',
      description: `Gratuity ${outlet?.name || ''} #${order.orderNumber}`,
      unitAmountMinor: payment.tipMinor,
      source: { ...source, itemRef: 'tip' },
      postingKey: `POS:${payment._id}:tip`,
      paymentId: payment._id,
      taxOverride: { netMinor: payment.tipMinor, taxMinor: 0, taxLines: [] },
    });
    lineIds.push(tip._id as Types.ObjectId);
  }
  return lineIds;
};

registerPaymentTarget('ORDER', {
  due: async (orderId, checkNo) => {
    const order: any = found(await Order.findById(orderId).lean(), 'Order');
    if (order.status !== ORDER_STATUS.OPEN) throw new AppError(httpStatus.CONFLICT, `Order is ${order.status}`);
    if (order.pendingAcceptance) throw new AppError(httpStatus.CONFLICT, 'Accept the guest order first');
    let balance = order.totals.balanceMinor;
    if (checkNo) {
      const summary = await checksSummary(order);
      const check = summary.find((c: { checkNo: number }) => c.checkNo === checkNo);
      if (!check) throw new AppError(httpStatus.NOT_FOUND, `Check ${checkNo} not found`);
      balance = check.balanceMinor;
    }
    const tenant = await requestContext.asSystem(() => Tenant.findById(order.tenantId).select('currency').lean());
    return { locationId: order.locationId, outletId: order.outletId, balanceMinor: balance, currency: tenant?.currency || 'USD', label: `Order ${order.orderNumber}` };
  },
  onCompleted: async (payment) => {
    const order: any = found(await Order.findById(payment.target.id), 'Order');
    let lineIds: Types.ObjectId[] | undefined;
    if (payment.method === PAYMENT_METHOD.CHARGE_TO_ROOM || payment.method === PAYMENT_METHOD.CITY_LEDGER) {
      const checkNo = payment.target.checkNo || 1;
      const summary = await checksSummary(order);
      const due = payment.target.checkNo ? summary.find((c: { checkNo: number }) => c.checkNo === checkNo)?.balanceMinor : order.totals.balanceMinor;
      if (payment.amountMinor !== due) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Charge the full check to the room; split the check first for partial amounts');
      }
      if (!payment.target.checkNo && order.checks.length > 1) {
        throw new AppError(httpStatus.BAD_REQUEST, 'This order has several checks; charge one check at a time');
      }
      lineIds = await postCheckToFolio(order, payment);
      if (payment.method === PAYMENT_METHOD.CHARGE_TO_ROOM && payment.folioPosting?.roomStayId && !order.roomStayId) {
        const stay = await RoomStay.findById(payment.folioPosting.roomStayId).lean();
        order.roomStayId = stay?._id;
        order.guestId = order.guestId || stay?.guestIds[0];
      }
    }
    order.totals.paidMinor += payment.amountMinor;
    order.totals.tipMinor += payment.tipMinor;
    order.totals.balanceMinor = order.totals.totalMinor - order.totals.paidMinor;
    order.paymentStatus = paymentStatusOf(order.totals);
    await order.save();
    const closed = await closeIfSettled(order, payment.createdBy ? String(payment.createdBy) : undefined);
    if (closed) emitDomainEvent('order.closed', { tenantId: String(order.tenantId), orderId: String(order._id) });
    void publishOrder(order, closed ? 'order_closed' : 'order_updated');
    return lineIds;
  },
  onRefunded: async (payment, amountMinor, reason) => {
    const order: any = found(await Order.findById(payment.target.id), 'Order');
    const tipPart = Math.max(0, amountMinor - payment.amountMinor);
    order.totals.paidMinor = Math.max(0, order.totals.paidMinor - (amountMinor - tipPart));
    order.totals.tipMinor = Math.max(0, order.totals.tipMinor - tipPart);
    order.totals.refundedMinor += amountMinor;
    order.totals.balanceMinor = order.totals.totalMinor - order.totals.paidMinor;
    order.paymentStatus = paymentStatusOf(order.totals);
    await order.save();
    if (payment.folioPosting?.folioId && payment.folioLineIds?.length) {
      const full = amountMinor >= payment.amountMinor + payment.tipMinor;
      if (full) {
        for (const lineId of payment.folioLineIds) await FolioLedger.reverseLine(lineId, `POS refund: ${reason}`);
      } else {
        await FolioLedger.postLine({
          folioId: payment.folioPosting.folioId,
          type: FOLIO_LINE_TYPE.ADJUSTMENT,
          code: 'FOOD',
          description: `Refund order ${order.orderNumber}: ${reason}`,
          unitAmountMinor: -amountMinor,
          source: { kind: FOLIO_SOURCE.POS, refId: order._id },
          paymentId: payment._id,
          skipCreditLimit: true,
          taxOverride: { netMinor: -amountMinor, taxMinor: 0, taxLines: [] },
        });
      }
    }
  },
});

export const OrderServices = {
  createOrder,
  getOrder,
  listOrders,
  addItems,
  updateItem,
  fire,
  accept,
  markServed,
  voidItem,
  voidOrder,
  applyDiscount,
  removeDiscount,
  splitChecks,
  checksSummary,
  transferTable,
  mergeOrders,
  splitOrder,
  requestBill,
  closeOrder,
  reopenOrder,
  setGuest,
  receipt,
  refreshTableStatus,
};

export type { TOrderDoc };
