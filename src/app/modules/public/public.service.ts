import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../errors/AppError';
import { Location } from '../location/location.model';
import { Tenant } from '../tenant/tenant.model';
import { RoomCategory } from '../hospitality/roomCategory/roomCategory.model';
import { RatePlan } from '../hospitality/rate/rate.model';
import { RateServices } from '../hospitality/rate/rate.service';
import { HotelInventory } from '../hospitality/inventory/hotelInventory.service';
import { ReservationServices } from '../hospitality/reservation/reservation.service';
import { Reservation, RoomStay } from '../hospitality/reservation/reservation.model';
import { STAY_STATUS } from '../hospitality/reservation/reservation.interface';
import { Guest } from '../hospitality/guest/guest.model';
import { GuestServices } from '../hospitality/guest/guest.service';
import { Folio, FolioLine } from '../hospitality/folio/folio.model';
import { Room } from '../hospitality/room/room.model';
import { HousekeepingServices } from '../hospitality/housekeeping/housekeeping.service';
import { Table } from '../restaurant/table/table.model';
import { Order } from '../restaurant/order/order.model';
import { OrderServices, TItemInput } from '../restaurant/order/order.service';
import { MenuServices } from '../restaurant/menuItem/menu.service';
import { Outlet } from '../outlet/outlet.model';
import { PaymentService } from '../payment/payment.service';
import { AlertService } from '../alert/alert.service';
import { requestContext } from '../../utils/requestContext';
import { systemRequest } from '../../utils/systemRequest';
import { nightsBetween } from '../../utils/businessDate';
import { sha256 } from '../../utils/crypto';
import { sendEmail } from '../../utils/sendEmail';
import { found } from '../../utils/query';
import logger from '../../utils/logger';

type TGuestInput = { firstName: string; lastName: string; email: string; phone?: string };

// Runs fn inside the tenant that owns the public booking page.
const withBookingPage = async <T>(slug: string, fn: (location: any, tenant: any) => Promise<T>) => {
  const location = await requestContext.asSystem(() => Location.findOne({ 'publicBooking.slug': slug, 'publicBooking.enabled': true, isActive: true }).lean());
  if (!location) throw new AppError(httpStatus.NOT_FOUND, 'Booking page not found');
  const tenant = await requestContext.asSystem(() => Tenant.findById(location.tenantId).lean());
  if (!tenant || !tenant.isActive || ['SUSPENDED', 'CANCELLED'].includes(tenant.status) || !tenant.modules.includes('DISTRIBUTION')) {
    throw new AppError(httpStatus.NOT_FOUND, 'Booking page not found');
  }
  return requestContext.asTenant(String(tenant._id), () => fn(location, tenant), { locationId: String(location._id) });
};

// ---------- Booking engine ----------
const bookingPage = (slug: string) =>
  withBookingPage(slug, async (location, tenant) => {
    const [roomTypes, plans] = await Promise.all([
      RoomCategory.find({ locationId: location._id, isActive: true }).sort({ sortOrder: 1 }).select('name description capacity maxAdults maxChildren amenities images baseRateMinor').lean(),
      RatePlan.find({ locationId: location._id, isActive: true, isPublic: true }).select('name code description mealPlan cancellation deposit isRefundable minLos').lean(),
    ]);
    return {
      property: { name: location.name, address: location.address, phone: location.phone, email: location.email, checkInTime: location.checkInTime, checkOutTime: location.checkOutTime, businessDate: location.businessDate },
      brand: tenant.branding,
      currency: location.currency || tenant.currency,
      roomTypes,
      ratePlans: plans,
    };
  });

const bookingAvailability = (slug: string, q: { arrivalDate: string; departureDate: string; adults: number; children: number }) =>
  withBookingPage(slug, async (location) => {
    if (q.arrivalDate < location.businessDate) throw new AppError(httpStatus.BAD_REQUEST, 'Arrival is in the past');
    const nights = nightsBetween(q.arrivalDate, q.departureDate);
    if (!nights.length || nights.length > 60) throw new AppError(httpStatus.BAD_REQUEST, 'Stay must be 1-60 nights');
    const grid = await HotelInventory.availability(location._id, q.arrivalDate, nights[nights.length - 1]!);
    const plans = await RatePlan.find({ locationId: location._id, isActive: true, isPublic: true }).lean();
    const offers = [];
    for (const row of grid) {
      const available = Math.min(...row.days.map((d) => d.available));
      if (available <= 0) continue;
      for (const plan of plans) {
        if (plan.roomTypeIds?.length && !plan.roomTypeIds.map(String).includes(String(row.roomType._id))) continue;
        try {
          const quote = await RateServices.quoteStay({ ratePlanId: plan._id, roomTypeId: row.roomType._id, arrivalDate: q.arrivalDate, departureDate: q.departureDate, adults: q.adults, children: q.children });
          if (quote.restrictions.length) continue;
          offers.push({
            roomTypeId: row.roomType._id,
            roomType: row.roomType.name,
            ratePlanId: plan._id,
            ratePlan: plan.name,
            mealPlan: plan.mealPlan,
            refundable: plan.isRefundable,
            freeCancellationHours: plan.cancellation.freeUntilHours,
            roomsLeft: available,
            totalMinor: quote.totalMinor,
            nights: quote.nights,
            depositMinor: RateServices.depositAmount(plan.deposit, quote.nights, quote.totalMinor),
          });
        } catch {
          // room type does not fit the party; skip
        }
      }
    }
    return offers.sort((a, b) => a.totalMinor - b.totalMinor);
  });

const bookingCreate = (
  slug: string,
  payload: { guest: TGuestInput; roomTypeId: string; ratePlanId: string; arrivalDate: string; departureDate: string; adults: number; children?: number; rooms?: number; specialRequests?: string; marketingConsent?: boolean },
) =>
  withBookingPage(slug, async (location, tenant) => {
    const req = systemRequest(String(tenant._id), String(location._id), 'booking-engine');
    const stays = Array.from({ length: Math.min(payload.rooms || 1, 10) }, () => ({
      roomTypeId: payload.roomTypeId,
      ratePlanId: payload.ratePlanId,
      arrivalDate: payload.arrivalDate,
      departureDate: payload.departureDate,
      adults: payload.adults,
      children: payload.children || 0,
    }));
    const reservation: any = await ReservationServices.createReservation(req, {
      locationId: String(location._id),
      guest: payload.guest,
      stays,
      source: 'BOOKING_ENGINE',
      specialRequests: payload.specialRequests,
      confirm: true,
    });
    if (payload.marketingConsent !== undefined) {
      await Guest.updateOne({ _id: reservation.bookerGuestId._id }, { 'consent.marketing': payload.marketingConsent, 'consent.marketingAt': new Date(), 'consent.source': 'booking-engine' });
    }
    let payment;
    if (reservation.deposit.requiredMinor > 0) {
      const folioId = reservation.stays[0].folioId;
      payment = await PaymentService.takePayment(req, { target: { kind: 'FOLIO', id: String(folioId) }, method: 'CARD_ONLINE', amountMinor: reservation.deposit.requiredMinor });
    }
    await sendEmail(
      payload.guest.email,
      `<p>Dear ${payload.guest.firstName},</p><p>Your booking ${reservation.confirmationNumber} at ${location.name} for ${payload.arrivalDate} to ${payload.departureDate} is ${reservation.status === 'CONFIRMED' ? 'confirmed' : 'received and waiting for the deposit'}.</p>`,
      `Booking ${reservation.confirmationNumber} - ${location.name}`,
    ).catch((err) => logger.warn(err, 'Booking confirmation email failed'));
    return {
      confirmationNumber: reservation.confirmationNumber,
      status: reservation.status,
      totalMinor: reservation.estimatedTotalMinor,
      deposit: reservation.deposit,
      payment: payment && { clientSecret: (payment as any).clientSecret, stripeAccount: (payment as any).stripeAccount, publishableKey: (payment as any).publishableKey, paymentId: (payment as any).payment?._id },
    };
  });

// ---------- Online check-in (pre-arrival link) ----------
const withPreArrival = async <T>(token: string, fn: (reservation: any) => Promise<T>) => {
  const reservation = await requestContext.asSystem(() => Reservation.findOne({ 'preArrival.tokenHash': sha256(token) }).lean());
  if (!reservation) throw new AppError(httpStatus.NOT_FOUND, 'Link not found or expired');
  if (!['TENTATIVE', 'CONFIRMED'].includes(reservation.status)) throw new AppError(httpStatus.GONE, 'This booking can no longer be checked in online');
  return requestContext.asTenant(String(reservation.tenantId), () => fn(reservation), { locationId: String(reservation.locationId) });
};

const preArrivalView = (token: string) =>
  withPreArrival(token, async (reservation) => {
    const [location, guest, stays] = await Promise.all([
      Location.findById(reservation.locationId).select('name address checkInTime').lean(),
      Guest.findById(reservation.bookerGuestId).select('firstName lastName email phone nationality address').lean(),
      RoomStay.find({ reservationId: reservation._id }).populate('roomTypeId', 'name').lean(),
    ]);
    return {
      confirmationNumber: reservation.confirmationNumber,
      arrivalDate: reservation.arrivalDate,
      departureDate: reservation.departureDate,
      property: location,
      guest,
      rooms: stays.map((s) => ({ roomType: (s.roomTypeId as any)?.name, adults: s.adults, children: s.children })),
      completed: Boolean(reservation.preArrival?.completedAt),
    };
  });

const preArrivalSubmit = (
  token: string,
  payload: { guest: { firstName: string; lastName: string; email?: string; phone?: string; address?: string; nationality?: string; dateOfBirth?: string; idType?: string; idNumber?: string }; eta?: string; signatureUrl?: string; acceptTerms: boolean },
  ip?: string,
) =>
  withPreArrival(token, async (reservation) => {
    if (!payload.acceptTerms) throw new AppError(httpStatus.BAD_REQUEST, 'Please accept the house terms');
    await GuestServices.updateGuest(String(reservation.bookerGuestId), payload.guest);
    await RoomStay.updateMany(
      { reservationId: reservation._id },
      { registration: { signedAt: new Date(), signatureUrl: payload.signatureUrl, idVerified: false, ip } },
    );
    await Reservation.updateOne({ _id: reservation._id }, { eta: payload.eta, 'preArrival.completedAt': new Date() });
    return { completed: true };
  });

// ---------- Guest QR (room and table codes) ----------
type TQrTarget = { kind: 'ROOM'; room: any; tenant: any } | { kind: 'TABLE'; table: any; tenant: any };

const withQr = async <T>(token: string, fn: (target: TQrTarget) => Promise<T>) => {
  const [room, table] = await requestContext.asSystem(() => Promise.all([Room.findOne({ qrToken: token, isActive: true }).lean(), Table.findOne({ qrToken: token, isActive: true }).lean()]));
  const doc = room || table;
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, 'This code is not valid any more');
  const tenant = await requestContext.asSystem(() => Tenant.findById(doc.tenantId).lean());
  if (!tenant || !tenant.isActive || ['SUSPENDED', 'CANCELLED'].includes(tenant.status)) throw new AppError(httpStatus.NOT_FOUND, 'Service unavailable');
  return requestContext.asTenant(String(tenant._id), () => fn(room ? { kind: 'ROOM', room, tenant } : { kind: 'TABLE', table, tenant }), { locationId: String(doc.locationId) });
};

const inHouseStay = async (roomId: Types.ObjectId) => RoomStay.findOne({ roomId, status: STAY_STATUS.CHECKED_IN }).lean();

const verifyRoomGuest = async (stay: any, lastName?: string) => {
  if (!lastName) throw new AppError(httpStatus.BAD_REQUEST, 'Enter your last name');
  const guests = await Guest.find({ _id: { $in: stay.guestIds } }).select('lastName').lean();
  if (!guests.some((g) => g.lastName.trim().toLowerCase() === lastName.trim().toLowerCase())) {
    throw new AppError(httpStatus.FORBIDDEN, 'The name does not match this room');
  }
};

const qrContext = (token: string) =>
  withQr(token, async (target) => {
    if (target.kind === 'ROOM') {
      const stay = await inHouseStay(target.room._id);
      const outlets = await Outlet.find({ locationId: target.room.locationId, isActive: true, $or: [{ type: 'ROOM_SERVICE' }, { allowChargeToRoom: true }] }).select('name type').lean();
      const guest = stay ? await Guest.findById(stay.guestIds[0]).select('firstName').lean() : null;
      return {
        kind: 'ROOM',
        roomNumber: target.room.roomNumber,
        inHouse: Boolean(stay),
        welcomeName: guest?.firstName,
        outlets,
        canRequestHousekeeping: Boolean(stay),
        brand: target.tenant.branding,
      };
    }
    const outlet = await Outlet.findById(target.table.outletId).select('name type').lean();
    return { kind: 'TABLE', tableNumber: target.table.tableNumber, outlet, brand: target.tenant.branding };
  });

const qrMenu = (token: string, outletId?: string) =>
  withQr(token, async (target) => {
    const id = target.kind === 'TABLE' ? target.table.outletId : outletId;
    if (!id) throw new AppError(httpStatus.BAD_REQUEST, 'Choose an outlet');
    if (target.kind === 'ROOM') found(await Outlet.findOne({ _id: id, locationId: target.room.locationId }).lean(), 'Outlet');
    return MenuServices.outletMenu(id);
  });

// Guest orders wait for staff to accept them before they reach the kitchen.
const qrOrder = (token: string, payload: { items: TItemInput[]; outletId?: string; lastName?: string; notes?: string }) =>
  withQr(token, async (target) => {
    if (target.kind === 'ROOM') {
      const stay = await inHouseStay(target.room._id);
      if (!stay) throw new AppError(httpStatus.CONFLICT, 'Room ordering is available to checked-in guests');
      await verifyRoomGuest(stay, payload.lastName);
      const outlet = found(await Outlet.findOne({ _id: payload.outletId, locationId: target.room.locationId, isActive: true }).lean(), 'Outlet');
      const order = await OrderServices.createOrder(null, {
        outletId: String(outlet._id),
        type: 'ROOM_SERVICE',
        roomStayId: String(stay._id),
        items: payload.items,
        notes: [`Room ${target.room.roomNumber}`, payload.notes].filter(Boolean).join(' - '),
        source: 'GUEST_QR',
        pendingAcceptance: true,
      }, { locationId: String(target.room.locationId) });
      return { orderId: order._id, orderNumber: order.orderNumber, totals: order.totals, status: 'WAITING_FOR_ACCEPTANCE' };
    }
    const order = await OrderServices.createOrder(null, {
      outletId: String(target.table.outletId),
      type: 'DINE_IN',
      tableId: String(target.table._id),
      items: payload.items,
      notes: payload.notes,
      source: 'GUEST_QR',
      pendingAcceptance: true,
    }, { locationId: String(target.table.locationId) });
    return { orderId: order._id, orderNumber: order.orderNumber, totals: order.totals, status: 'WAITING_FOR_ACCEPTANCE' };
  });

const qrRequest = (token: string, payload: { notes: string; lastName?: string }) =>
  withQr(token, async (target) => {
    if (target.kind !== 'ROOM') throw new AppError(httpStatus.BAD_REQUEST, 'Requests are for rooms');
    const stay = await inHouseStay(target.room._id);
    if (!stay) throw new AppError(httpStatus.CONFLICT, 'Requests are available to checked-in guests');
    await verifyRoomGuest(stay, payload.lastName);
    const task = await HousekeepingServices.createRequest(target.room.locationId, target.room._id, payload.notes, 'GUEST_QR', target.tenant._id);
    await AlertService.raise({
      type: 'GUEST_REQUEST',
      severity: 'LOW',
      locationId: target.room.locationId,
      title: `Room ${target.room.roomNumber} request`,
      message: payload.notes,
      ref: { kind: 'HousekeepingTask', id: task._id },
      dedupeKey: `request:${task._id}`,
    });
    return { received: true };
  });

// The live bill: the room's folio, or the table's open order.
const qrBill = (token: string, lastName?: string) =>
  withQr(token, async (target) => {
    if (target.kind === 'ROOM') {
      const stay = await inHouseStay(target.room._id);
      if (!stay?.folioId) throw new AppError(httpStatus.CONFLICT, 'No open bill for this room');
      await verifyRoomGuest(stay, lastName);
      const folio = found(await Folio.findById(stay.folioId).lean(), 'Folio');
      const lines = await FolioLine.find({ folioId: folio._id, reversedById: null, reversalOfId: null }).select('description businessDate amountMinor type').sort({ createdAt: 1 }).lean();
      return { kind: 'ROOM', currency: folio.currency, balanceMinor: folio.balanceMinor, lines };
    }
    const order = await Order.findOne({ tableId: target.table._id, status: 'OPEN', pendingAcceptance: false }).lean();
    if (!order) return { kind: 'TABLE', balanceMinor: 0, items: [] };
    return {
      kind: 'TABLE',
      orderId: order._id,
      balanceMinor: order.totals.balanceMinor,
      totals: order.totals,
      items: order.items.filter((i) => i.status !== 'VOIDED').map((i) => ({ name: i.name, quantity: i.quantity, totalMinor: i.calc?.totalMinor })),
    };
  });

const qrPay = (token: string, payload: { amountMinor: number; tipMinor?: number; lastName?: string }) =>
  withQr(token, async (target) => {
    const tenantId = String(target.tenant._id);
    if (target.kind === 'ROOM') {
      const stay = await inHouseStay(target.room._id);
      if (!stay?.folioId) throw new AppError(httpStatus.CONFLICT, 'No open bill for this room');
      await verifyRoomGuest(stay, payload.lastName);
      const req = systemRequest(tenantId, String(target.room.locationId), 'guest-qr');
      return PaymentService.takePayment(req, { target: { kind: 'FOLIO', id: String(stay.folioId) }, method: 'CARD_ONLINE', amountMinor: payload.amountMinor, tipMinor: payload.tipMinor });
    }
    const order = found(await Order.findOne({ tableId: target.table._id, status: 'OPEN', pendingAcceptance: false }).lean(), 'Open bill');
    const req = systemRequest(tenantId, String(target.table.locationId), 'guest-qr');
    return PaymentService.takePayment(req, { target: { kind: 'ORDER', id: String(order._id) }, method: 'CARD_ONLINE', amountMinor: payload.amountMinor, tipMinor: payload.tipMinor });
  });

export const PublicServices = {
  bookingPage,
  bookingAvailability,
  bookingCreate,
  preArrivalView,
  preArrivalSubmit,
  qrContext,
  qrMenu,
  qrOrder,
  qrRequest,
  qrBill,
  qrPay,
};
