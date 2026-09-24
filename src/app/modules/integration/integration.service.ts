import httpStatus from 'http-status';
import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import AppError from '../../errors/AppError';
import { ApiKey, TApiScope, WEBHOOK_EVENTS, WebhookDelivery, WebhookSubscription } from './integration.model';
import { Tenant } from '../tenant/tenant.model';
import { Location } from '../location/location.model';
import { RoomCategory } from '../hospitality/roomCategory/roomCategory.model';
import { RatePlan } from '../hospitality/rate/rate.model';
import { RateServices } from '../hospitality/rate/rate.service';
import { HotelInventory } from '../hospitality/inventory/hotelInventory.service';
import { ReservationServices } from '../hospitality/reservation/reservation.service';
import { Reservation, RoomStay } from '../hospitality/reservation/reservation.model';
import { MenuItem } from '../restaurant/menuItem/menuItem.model';
import { OrderServices } from '../restaurant/order/order.service';
import { Order } from '../restaurant/order/order.model';
import { Outlet } from '../outlet/outlet.model';
import { PaymentService } from '../payment/payment.service';
import { requestContext } from '../../utils/requestContext';
import { systemRequest } from '../../utils/systemRequest';
import { onDomainEvent, TDomainEvent } from '../../utils/domainEvents';
import { hmacSha256, randomToken, sha256 } from '../../utils/crypto';
import { dateRange, nightsBetween } from '../../utils/businessDate';
import catchAsync from '../../utils/catchAsync';
import { found } from '../../utils/query';

// ---------- API keys ----------
const createApiKey = async (payload: { name: string; scopes: TApiScope[]; locationIds?: string[] }, userId: string) => {
  const prefix = randomToken(6).replace(/[-_]/g, 'x');
  const secret = randomToken(24);
  const key = await ApiKey.create({ ...payload, prefix, keyHash: sha256(secret), createdBy: userId });
  return { apiKey: `hpos_${prefix}_${secret}`, id: key._id, name: key.name, scopes: key.scopes, note: 'Store this key now; it is not shown again.' };
};

// X-Api-Key authentication for partner systems.
export const apiKeyAuth = (scope: TApiScope) =>
  catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    const raw = String(req.headers['x-api-key'] || '');
    const match = /^hpos_([A-Za-z0-9]+)_(.+)$/.exec(raw);
    if (!match) throw new AppError(httpStatus.UNAUTHORIZED, 'Missing or malformed X-Api-Key');
    const key = await requestContext.asSystem(() => ApiKey.findOne({ prefix: match[1], revokedAt: null }).select('+keyHash').lean());
    if (!key || key.keyHash !== sha256(match[2]!)) throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid API key');
    if (!key.scopes.includes(scope)) throw new AppError(httpStatus.FORBIDDEN, `API key lacks scope ${scope}`);
    const tenant = await requestContext.asSystem(() => Tenant.findById(key.tenantId).select('isActive status').lean());
    if (!tenant?.isActive || ['SUSPENDED', 'CANCELLED'].includes(tenant.status)) throw new AppError(httpStatus.FORBIDDEN, 'Account inactive');
    const locationId = String(req.body?.locationId || req.query.locationId || '');
    if (!locationId || !Types.ObjectId.isValid(locationId)) throw new AppError(httpStatus.BAD_REQUEST, 'locationId is required');
    if (key.locationIds.length && !key.locationIds.map(String).includes(locationId)) throw new AppError(httpStatus.FORBIDDEN, 'API key is not valid for this location');
    requestContext.set({ tenantId: String(key.tenantId), locationId, bypassTenantScope: false });
    const exists = await Location.exists({ _id: locationId });
    if (!exists) throw new AppError(httpStatus.NOT_FOUND, 'Location not found');
    await requestContext.asSystem(() => ApiKey.updateOne({ _id: key._id }, { lastUsedAt: new Date() }));
    const sys = systemRequest(String(key.tenantId), locationId, `api:${key.name}`);
    req.user = sys.user;
    req.locationId = locationId;
    next();
  });

// ---------- Channel manager ----------
// Availability, rates and restrictions (ARI) per room type and channel-mapped rate plan.
const ari = async (locationId: string, from: string, to: string) => {
  const dates = dateRange(from, to);
  if (dates.length > 180) throw new AppError(httpStatus.BAD_REQUEST, 'Request at most 180 days');
  const [grid, plans, types] = await Promise.all([
    HotelInventory.availability(locationId, from, to),
    RatePlan.find({ locationId, isActive: true, isPublic: true }).lean(),
    RoomCategory.find({ locationId, isActive: true }).select('code name').lean(),
  ]);
  const roomTypes = [];
  for (const row of grid) {
    const type = types.find((t) => String(t._id) === String(row.roomType._id));
    const rates = [];
    for (const plan of plans.filter((p) => !p.roomTypeIds?.length || p.roomTypeIds.map(String).includes(String(row.roomType._id)))) {
      const calendar = await RateServices.rateCalendar({ ratePlanId: String(plan._id), roomTypeId: String(row.roomType._id), from, to });
      rates.push({ ratePlanId: plan._id, ratePlanCode: plan.channelCode || plan.code, days: calendar });
    }
    roomTypes.push({ roomTypeId: row.roomType._id, roomTypeCode: type?.code, name: row.roomType.name, availability: row.days.map((d) => ({ date: d.date, available: d.available })), rates });
  }
  return { locationId, from, to, roomTypes };
};

type TChannelBooking = {
  locationId: string;
  channelName: string;
  externalRef: string;
  action: 'NEW' | 'MODIFY' | 'CANCEL';
  guest: { firstName: string; lastName: string; email?: string; phone?: string };
  stays?: { roomTypeId?: string; roomTypeCode?: string; ratePlanId?: string; ratePlanCode?: string; arrivalDate: string; departureDate: string; adults: number; children?: number; nightly?: { date: string; amountMinor: number }[] }[];
  notes?: string;
  prepaid?: boolean;
};

const resolveStay = async (locationId: string, s: NonNullable<TChannelBooking['stays']>[number]) => {
  const roomType = s.roomTypeId
    ? found(await RoomCategory.findOne({ _id: s.roomTypeId, locationId }).lean(), 'Room type')
    : found(await RoomCategory.findOne({ code: s.roomTypeCode?.toUpperCase(), locationId }).lean(), `Room type ${s.roomTypeCode}`);
  const plan = s.ratePlanId
    ? found(await RatePlan.findOne({ _id: s.ratePlanId, locationId }).lean(), 'Rate plan')
    : found(await RatePlan.findOne({ locationId, $or: [{ channelCode: s.ratePlanCode }, { code: s.ratePlanCode?.toUpperCase() }] }).lean(), `Rate plan ${s.ratePlanCode}`);
  return { roomTypeId: String(roomType._id), ratePlanId: String(plan._id), arrivalDate: s.arrivalDate, departureDate: s.departureDate, adults: s.adults, children: s.children || 0 };
};

// Inbound booking from a channel manager / OTA. Idempotent on (channel, externalRef).
const channelBooking = async (req: Request, payload: TChannelBooking) => {
  const existing = await Reservation.findOne({ 'channel.name': payload.channelName, 'channel.externalRef': payload.externalRef });
  if (payload.action === 'CANCEL') {
    if (!existing) throw new AppError(httpStatus.NOT_FOUND, 'Reservation not found');
    if (existing.status === 'CANCELLED') return ReservationServices.getReservation(String(existing._id));
    return ReservationServices.cancelReservation(req, String(existing._id), { reason: `Cancelled by ${payload.channelName}`, waiveFee: true });
  }
  if (payload.action === 'MODIFY' && existing) {
    // Channels send the whole booking again: cancel the old rooms, book the new ones.
    const stays = await RoomStay.find({ reservationId: existing._id, status: 'RESERVED' });
    if (stays.length) await ReservationServices.cancelReservation(req, String(existing._id), { reason: `Modified by ${payload.channelName}`, waiveFee: true, stayIds: stays.map((s) => String(s._id)) });
    await Reservation.updateOne({ _id: existing._id }, { $unset: { 'channel.externalRef': 1 } });
  }
  if (!payload.stays?.length) throw new AppError(httpStatus.BAD_REQUEST, 'stays are required');
  const stays = [];
  for (const s of payload.stays) stays.push(await resolveStay(payload.locationId, s));
  const reservation: any = await ReservationServices.createReservation(req, {
    locationId: payload.locationId,
    guest: payload.guest,
    stays,
    source: 'CHANNEL',
    channel: { name: payload.channelName, externalRef: payload.externalRef },
    notes: payload.notes,
    guarantee: { type: payload.prepaid ? 'DEPOSIT' : 'CARD', reference: payload.channelName },
    confirm: true,
    overrideRestrictions: true,
  });
  // The channel sold at its own price: keep it night by night.
  for (const [i, s] of payload.stays.entries()) {
    if (!s.nightly?.length || !reservation.stays[i]) continue;
    const expected = nightsBetween(s.arrivalDate, s.departureDate);
    if (s.nightly.length !== expected.length) continue;
    await RoomStay.updateOne({ _id: reservation.stays[i]._id }, { nightlyRates: s.nightly });
  }
  if (existing && payload.action === 'MODIFY') {
    await Reservation.updateOne({ _id: existing._id }, { status: 'CANCELLED', cancelReason: `Replaced by ${reservation.confirmationNumber}` });
  }
  await ReservationServices.recalcStatus(reservation._id);
  return ReservationServices.getReservation(String(reservation._id));
};

// ---------- Delivery aggregators ----------
const aggregatorOrder = async (
  req: Request,
  payload: {
    locationId: string;
    outletId: string;
    aggregator: string;
    externalId: string;
    customer: { name?: string; phone?: string; address?: string };
    items: { menuItemId?: string; sku?: string; quantity: number; specialInstructions?: string; modifiers?: { groupId: string; optionId: string }[] }[];
    notes?: string;
    paid: boolean;
  },
) => {
  const existing = await Order.findOne({ 'delivery.aggregator': payload.aggregator, 'delivery.externalId': payload.externalId }).lean();
  if (existing) return existing;
  found(await Outlet.findOne({ _id: payload.outletId, locationId: payload.locationId }).lean(), 'Outlet');
  const items = [];
  for (const i of payload.items) {
    const menuItem = i.menuItemId ? await MenuItem.findById(i.menuItemId).lean() : await MenuItem.findOne({ sku: i.sku }).lean();
    if (!menuItem) throw new AppError(httpStatus.BAD_REQUEST, `Unknown item ${i.menuItemId || i.sku}`);
    items.push({ menuItemId: String(menuItem._id), quantity: i.quantity, specialInstructions: i.specialInstructions, modifiers: i.modifiers });
  }
  const order: any = await OrderServices.createOrder(
    req,
    {
      outletId: payload.outletId,
      type: 'DELIVERY',
      items,
      notes: [payload.customer.name, payload.notes].filter(Boolean).join(' - '),
      source: 'AGGREGATOR',
      fire: 'ALL',
      delivery: { aggregator: payload.aggregator, externalId: payload.externalId, address: payload.customer.address, phone: payload.customer.phone },
    },
    { locationId: payload.locationId },
  );
  if (payload.paid && order.totals.balanceMinor > 0) {
    await PaymentService.takePayment(req, { target: { kind: 'ORDER', id: String(order._id) }, method: 'CARD_EXTERNAL', amountMinor: order.totals.balanceMinor, reference: `${payload.aggregator}:${payload.externalId}` });
  }
  return Order.findById(order._id).lean();
};

// ---------- Outbound webhooks ----------
const createSubscription = async (payload: { url: string; events: string[]; description?: string }) => {
  const secret = randomToken(24);
  const sub = await WebhookSubscription.create({ ...payload, secret });
  return { id: sub._id, url: sub.url, events: sub.events, secret, note: 'Verify deliveries with HMAC-SHA256 of the raw body using this secret (header X-HPOS-Signature).' };
};

// Queue a delivery for every subscription listening to the event.
const enqueue = async (event: string, payload: Record<string, unknown>) => {
  const subs = await WebhookSubscription.find({ isActive: true, events: event }).select('_id').lean();
  if (!subs.length) return;
  await WebhookDelivery.insertMany(subs.map((s) => ({ subscriptionId: s._id, event, payload: { event, occurredAt: new Date(), data: payload } })));
};

for (const event of WEBHOOK_EVENTS) {
  onDomainEvent(event as TDomainEvent, async (payload) => {
    const { tenantId: _t, ...data } = payload;
    await enqueue(event, data);
  });
}

// Scheduler job: sends due deliveries with exponential backoff (max 8 attempts).
const deliverPending = async () => {
  const due = await requestContext.asSystem(() => WebhookDelivery.find({ status: 'PENDING', nextAttemptAt: { $lte: new Date() } }).limit(100));
  for (const delivery of due) {
    await requestContext.asTenant(String(delivery.tenantId), async () => {
      const sub = await WebhookSubscription.findById(delivery.subscriptionId).select('+secret');
      if (!sub || !sub.isActive) {
        delivery.status = 'FAILED';
        delivery.lastError = 'Subscription inactive';
        await delivery.save();
        return;
      }
      const body = JSON.stringify(delivery.payload);
      delivery.attempts += 1;
      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-HPOS-Event': delivery.event, 'X-HPOS-Delivery': String(delivery._id), 'X-HPOS-Signature': `sha256=${hmacSha256(sub.secret, body)}` },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        delivery.responseStatus = res.status;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        delivery.status = 'SENT';
        delivery.sentAt = new Date();
        sub.failureCount = 0;
      } catch (err: any) {
        delivery.lastError = String(err?.message || err);
        sub.failureCount += 1;
        if (delivery.attempts >= 8) {
          delivery.status = 'FAILED';
          const { AlertService } = await import('../alert/alert.service');
          await AlertService.raise({ type: 'WEBHOOK_FAILING', severity: 'MEDIUM', title: 'Integration webhook failing', message: `${sub.url}: ${delivery.lastError}`, dedupeKey: `webhook:${sub._id}` });
        } else {
          delivery.nextAttemptAt = new Date(Date.now() + 2 ** delivery.attempts * 30_000);
        }
      }
      await delivery.save();
      await sub.save();
    });
  }
  return due.length;
};

export const IntegrationServices = {
  createApiKey,
  ari,
  channelBooking,
  aggregatorOrder,
  createSubscription,
  deliverPending,
};

