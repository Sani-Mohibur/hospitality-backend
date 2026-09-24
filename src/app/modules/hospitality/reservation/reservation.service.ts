import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { Reservation, RoomStay } from './reservation.model';
import { BOOKING_SOURCE, RESERVATION_STATUS, STAY_STATUS, TReservationStatus } from './reservation.interface';
import { RatePlan } from '../rate/rate.model';
import { RateServices, TQuote } from '../rate/rate.service';
import { HotelInventory } from '../inventory/hotelInventory.service';
import { RoomNight } from '../inventory/hotelInventory.model';
import { Room } from '../room/room.model';
import { HOUSEKEEPING_STATUS, OCCUPANCY_STATUS } from '../room/room.interface';
import { Guest } from '../guest/guest.model';
import { GuestServices } from '../guest/guest.service';
import { Folio } from '../folio/folio.model';
import { FolioLedger } from '../folio/folio.ledger';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE, FOLIO_STATUS } from '../folio/folio.interface';
import { CompanyAccount } from '../companyAccount/companyAccount.model';
import { HousekeepingTask } from '../housekeeping/housekeeping.model';
import { Location } from '../../location/location.model';
import { nextSequence } from '../../system/counter.model';
import { ApprovalService } from '../../approval/approval.service';
import { activity } from '../../auditLog/auditLog.service';
import { runInTransaction } from '../../../utils/transaction';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { emitDomainEvent } from '../../../utils/domainEvents';
import { addDays, diffDays, nightsBetween, zonedDateTimeToUtc } from '../../../utils/businessDate';
import { escapeRegex, found, metaOf, paginationOf } from '../../../utils/query';
import { randomToken, sha256 } from '../../../utils/crypto';
import { requestContext } from '../../../utils/requestContext';

type TId = Types.ObjectId | string;

type TStayInput = {
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children?: number;
  roomId?: string;
  guestIds?: string[];
  notes?: string;
};

type TGuestInput = {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

export type TCreateReservation = {
  locationId: string;
  guest: TGuestInput;
  stays: TStayInput[];
  source?: keyof typeof BOOKING_SOURCE;
  channel?: { name?: string; externalRef?: string };
  companyAccountId?: string;
  allotmentId?: string;
  groupName?: string;
  eta?: string;
  notes?: string;
  specialRequests?: string;
  guarantee?: { type: 'NONE' | 'CARD' | 'DEPOSIT' | 'COMPANY'; reference?: string };
  confirm?: boolean;
  // Staff with rates.manage may book through closed dates / min-stay restrictions
  overrideRestrictions?: boolean;
};

const locationOf = async (locationId: TId) => found(await Location.findById(locationId).lean(), 'Location');

const confirmationNumber = async (locationId: TId, code?: string) => {
  const seq = await nextSequence(`reservation:${locationId}`);
  return `${(code || 'R').slice(0, 4)}${String(seq).padStart(6, '0')}`;
};

const guestName = (g: { firstName: string; lastName: string }) => `${g.firstName} ${g.lastName}`;

const resolveGuest = async (input: TGuestInput) => {
  if (input.id) return found(await Guest.findById(input.id), 'Guest');
  if (!input.firstName || !input.lastName) throw new AppError(httpStatus.BAD_REQUEST, 'Guest id or first and last name are required');
  return GuestServices.findOrCreate({ firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone });
};

// Reservation status follows its stays once guests arrive.
const recalcStatus = async (reservationId: TId) => {
  const reservation = found(await Reservation.findById(reservationId), 'Reservation');
  const stays = await RoomStay.find({ reservationId }).lean();
  const live = stays.filter((s) => s.status !== STAY_STATUS.CANCELLED);
  let status: TReservationStatus = reservation.status;
  if (!live.length) status = RESERVATION_STATUS.CANCELLED;
  else if (live.some((s) => s.status === STAY_STATUS.CHECKED_IN)) status = RESERVATION_STATUS.CHECKED_IN;
  else if (live.every((s) => s.status === STAY_STATUS.CHECKED_OUT || s.status === STAY_STATUS.NO_SHOW)) {
    status = live.some((s) => s.status === STAY_STATUS.CHECKED_OUT) ? RESERVATION_STATUS.CHECKED_OUT : RESERVATION_STATUS.NO_SHOW;
  } else if (status === RESERVATION_STATUS.CHECKED_IN || status === RESERVATION_STATUS.CANCELLED) {
    status = RESERVATION_STATUS.CONFIRMED;
  }
  const active = live.length ? live : stays;
  reservation.status = status;
  reservation.arrivalDate = active.reduce((m, s) => (s.arrivalDate < m ? s.arrivalDate : m), active[0]!.arrivalDate);
  reservation.departureDate = active.reduce((m, s) => (s.departureDate > m ? s.departureDate : m), active[0]!.departureDate);
  reservation.estimatedTotalMinor = live.reduce((sum, s) => sum + s.nightlyRates.reduce((a, n) => a + n.amountMinor, 0), 0);
  await reservation.save();
  return reservation;
};

const notifyLocation = (tenantId: TId, locationId: TId, event: string, data: unknown) =>
  publish({ tenantId, locationId, rooms: [socketRooms.location(locationId)], event, data });

const quoteAll = async (stays: TStayInput[], allowOverride: boolean) => {
  const quotes: TQuote[] = [];
  for (const s of stays) {
    const q = await RateServices.quoteStay({ ...s, children: s.children || 0 });
    if (q.restrictions.length && !allowOverride) {
      throw new AppError(httpStatus.CONFLICT, `Not bookable: ${q.restrictions.join('; ')}`);
    }
    quotes.push(q);
  }
  return quotes;
};

// ---------- Create ----------
const createReservation = async (req: Request | null, payload: TCreateReservation) => {
  const location = await locationOf(payload.locationId);
  if (!payload.stays.length) throw new AppError(httpStatus.BAD_REQUEST, 'At least one room is required');
  for (const s of payload.stays) {
    if (s.arrivalDate < location.businessDate) {
      throw new AppError(httpStatus.BAD_REQUEST, `Arrival ${s.arrivalDate} is before the hotel business date ${location.businessDate}`);
    }
  }
  if (payload.channel?.externalRef) {
    const existing = await Reservation.findOne({ 'channel.name': payload.channel.name, 'channel.externalRef': payload.channel.externalRef });
    if (existing) return getReservation(String(existing._id));
  }
  const canOverride = Boolean(payload.overrideRestrictions && req?.user.permissions.includes('rates.manage'));
  const quotes = await quoteAll(payload.stays, canOverride);
  const primaryPlan = found(await RatePlan.findById(payload.stays[0]!.ratePlanId).lean(), 'Rate plan');
  if (payload.companyAccountId) found(await CompanyAccount.findById(payload.companyAccountId), 'Company account');

  // Inventory rows are created outside the transaction (see hotelInventory.service).
  for (const s of payload.stays) {
    await HotelInventory.prepareTypeInventory(payload.locationId, s.roomTypeId, nightsBetween(s.arrivalDate, s.departureDate));
  }

  const booker = await resolveGuest(payload.guest);
  const total = quotes.reduce((sum, q) => sum + q.totalMinor, 0);
  const firstNights = quotes[0]!.nights;
  const depositRequired = RateServices.depositAmount(primaryPlan.deposit, firstNights, total);
  const guarantee = payload.guarantee || { type: payload.companyAccountId ? 'COMPANY' : 'NONE' };
  const needsGuarantee = primaryPlan.guaranteeRequired && guarantee.type === 'NONE';
  const confirmed = payload.confirm !== false && !needsGuarantee && depositRequired === 0;

  const reservationId = await runInTransaction(async () => {
    const [reservation] = await Reservation.create([
      {
        locationId: payload.locationId,
        confirmationNumber: await confirmationNumber(payload.locationId, location.code),
        status: confirmed ? RESERVATION_STATUS.CONFIRMED : RESERVATION_STATUS.TENTATIVE,
        source: payload.source || BOOKING_SOURCE.DIRECT,
        channel: payload.channel,
        bookerGuestId: booker._id,
        companyAccountId: payload.companyAccountId,
        allotmentId: payload.allotmentId,
        groupName: payload.groupName,
        arrivalDate: payload.stays.reduce((m, s) => (s.arrivalDate < m ? s.arrivalDate : m), payload.stays[0]!.arrivalDate),
        departureDate: payload.stays.reduce((m, s) => (s.departureDate > m ? s.departureDate : m), payload.stays[0]!.departureDate),
        eta: payload.eta,
        notes: payload.notes,
        specialRequests: payload.specialRequests,
        policies: RateServices.policiesOf(primaryPlan),
        estimatedTotalMinor: total,
        deposit: {
          requiredMinor: depositRequired,
          dueDate: depositRequired ? addDays(payload.stays[0]!.arrivalDate, -primaryPlan.deposit.dueDaysBeforeArrival) : undefined,
          paidMinor: 0,
        },
        guarantee,
        createdBy: req?.user.id,
      },
    ]);

    for (const [i, s] of payload.stays.entries()) {
      const quote = quotes[i]!;
      await HotelInventory.holdRoomType(payload.locationId, s.roomTypeId, s.arrivalDate, s.departureDate, {
        allotmentId: payload.allotmentId,
      });
      const [stay] = await RoomStay.create([
        {
          locationId: payload.locationId,
          reservationId: reservation!._id,
          roomTypeId: s.roomTypeId,
          ratePlanId: s.ratePlanId,
          arrivalDate: s.arrivalDate,
          departureDate: s.departureDate,
          adults: s.adults,
          children: s.children || 0,
          guestIds: s.guestIds?.length ? s.guestIds : [booker._id],
          nightlyRates: quote.nights,
          packages: quote.packages,
          notes: s.notes,
        },
      ]);
      if (s.roomId) {
        await HotelInventory.assignRoomNights(stay!, s.roomId);
        stay!.roomId = new Types.ObjectId(s.roomId);
      }
      const folio = await FolioLedger.createFolio({
        locationId: payload.locationId,
        name: `${guestName(booker)}${payload.stays.length > 1 ? ` (room ${i + 1})` : ''}`,
        reservationId: reservation!._id,
        roomStayId: stay!._id,
        guestId: booker._id,
      });
      stay!.folioId = folio._id;
      await stay!.save();
    }
    await activity.record({
      action: 'RESERVATION_CREATED',
      entity: 'Reservation',
      entityId: reservation!._id,
      locationId: payload.locationId,
      message: `Booked ${reservation!.confirmationNumber} for ${guestName(booker)}, ${payload.stays.length} room(s) ${reservation!.arrivalDate} to ${reservation!.departureDate}`,
    });
    return reservation!._id;
  });

  const result = await getReservation(String(reservationId));
  const tenantId = requestContext.get()!.tenantId!;
  void notifyLocation(tenantId, payload.locationId, 'reservation_created', { id: reservationId, confirmationNumber: result.confirmationNumber });
  emitDomainEvent('reservation.created', { tenantId, reservationId: String(reservationId), locationId: payload.locationId });
  emitDomainEvent('availability.changed', { tenantId, locationId: payload.locationId });
  return result;
};

// ---------- Read ----------
const getReservation = async (id: string) => {
  const reservation = found(
    await Reservation.findById(id).populate('bookerGuestId').populate('companyAccountId', 'name creditLimitMinor').lean(),
    'Reservation',
  );
  const stays = await RoomStay.find({ reservationId: id })
    .populate('roomId', 'roomNumber housekeepingStatus occupancyStatus')
    .populate('roomTypeId', 'name code')
    .populate('ratePlanId', 'name code')
    .populate('guestIds', 'firstName lastName email phone allergies preferences tags')
    .lean();
  const folios = await Folio.find({ reservationId: id }).select('number name window status balanceMinor chargesMinor paymentsMinor roomStayId').lean();
  return { ...reservation, stays, folios };
};

const listReservations = async (locationFilterObj: Record<string, unknown>, query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 25);
  const filter: Record<string, unknown> = { ...locationFilterObj };
  const date = typeof query.date === 'string' ? query.date : undefined;
  switch (query.view) {
    case 'arrivals':
      filter.arrivalDate = date;
      filter.status = { $in: [RESERVATION_STATUS.TENTATIVE, RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.CHECKED_IN] };
      break;
    case 'departures':
      filter.departureDate = date;
      filter.status = { $in: [RESERVATION_STATUS.CHECKED_IN, RESERVATION_STATUS.CHECKED_OUT] };
      break;
    case 'inhouse':
      filter.status = RESERVATION_STATUS.CHECKED_IN;
      break;
    default:
      if (query.status) filter.status = query.status;
      if (query.from || query.to) {
        filter.arrivalDate = { $lte: query.to || '9999-12-31' };
        filter.departureDate = { $gt: query.from || '0000-01-01' };
      }
  }
  if (query.source) filter.source = query.source;
  if (query.companyAccountId) filter.companyAccountId = query.companyAccountId;
  if (query.searchTerm) {
    const term = escapeRegex(String(query.searchTerm).trim());
    const guests = await Guest.find({
      $or: [{ firstName: { $regex: term, $options: 'i' } }, { lastName: { $regex: term, $options: 'i' } }, { email: { $regex: term, $options: 'i' } }],
    })
      .select('_id')
      .limit(200)
      .lean();
    filter.$or = [{ confirmationNumber: { $regex: term, $options: 'i' } }, { bookerGuestId: { $in: guests.map((g) => g._id) } }, { 'channel.externalRef': term }];
  }
  const [data, total] = await Promise.all([
    Reservation.find(filter).populate('bookerGuestId', 'firstName lastName email phone tags').sort({ arrivalDate: 1, createdAt: 1 }).skip(skip).limit(limit).lean(),
    Reservation.countDocuments(filter),
  ]);
  const ids = data.map((r) => r._id);
  const stays = await RoomStay.find({ reservationId: { $in: ids } }).populate('roomId', 'roomNumber').populate('roomTypeId', 'name code').lean();
  const byRes = new Map<string, typeof stays>();
  for (const s of stays) {
    const key = String(s.reservationId);
    byRes.set(key, [...(byRes.get(key) || []), s]);
  }
  return { data: data.map((r) => ({ ...r, stays: byRes.get(String(r._id)) || [] })), meta: metaOf(page, limit, total) };
};

// ---------- Update ----------
const updateReservation = async (
  id: string,
  payload: { notes?: string; specialRequests?: string; eta?: string; companyAccountId?: string | null; groupName?: string; guarantee?: { type: 'NONE' | 'CARD' | 'DEPOSIT' | 'COMPANY'; reference?: string }; bookerGuestId?: string },
) => {
  const reservation = found(await Reservation.findById(id), 'Reservation');
  if (reservation.status === RESERVATION_STATUS.CANCELLED || reservation.status === RESERVATION_STATUS.CHECKED_OUT) {
    throw new AppError(httpStatus.CONFLICT, `Reservation is ${reservation.status}`);
  }
  const before = reservation.toObject();
  if (payload.companyAccountId) found(await CompanyAccount.findById(payload.companyAccountId), 'Company account');
  if (payload.bookerGuestId) found(await Guest.findById(payload.bookerGuestId), 'Guest');
  const { companyAccountId, bookerGuestId, ...rest } = payload;
  Object.assign(reservation, rest);
  if (companyAccountId !== undefined) reservation.companyAccountId = companyAccountId ? new Types.ObjectId(companyAccountId) : undefined;
  if (bookerGuestId) reservation.bookerGuestId = new Types.ObjectId(bookerGuestId);
  await reservation.save();
  await activity.record({ action: 'RESERVATION_UPDATED', entity: 'Reservation', entityId: reservation._id, message: `Updated ${reservation.confirmationNumber}`, before, after: reservation.toObject() });
  return getReservation(id);
};

const confirmReservation = async (id: string, guarantee?: { type: 'NONE' | 'CARD' | 'DEPOSIT' | 'COMPANY'; reference?: string }) => {
  const reservation = found(await Reservation.findById(id), 'Reservation');
  if (reservation.status !== RESERVATION_STATUS.TENTATIVE) throw new AppError(httpStatus.CONFLICT, `Reservation is ${reservation.status}`);
  if (guarantee) reservation.guarantee = guarantee;
  if (reservation.policies.guaranteeRequired && reservation.guarantee.type === 'NONE' && reservation.deposit.paidMinor < reservation.deposit.requiredMinor) {
    throw new AppError(httpStatus.CONFLICT, 'This rate needs a guarantee or the deposit before it can be confirmed');
  }
  reservation.status = RESERVATION_STATUS.CONFIRMED;
  await reservation.save();
  await activity.record({ action: 'RESERVATION_CONFIRMED', entity: 'Reservation', entityId: reservation._id, message: `Confirmed ${reservation.confirmationNumber}` });
  return reservation;
};

// Called by the payment flow: deposits paid before arrival confirm a tentative booking.
const onFolioPayment = async (folioId: TId, amountMinor: number) => {
  const folio = await Folio.findById(folioId).lean();
  if (!folio?.reservationId) return;
  const reservation = await Reservation.findById(folio.reservationId);
  if (!reservation || ![RESERVATION_STATUS.TENTATIVE, RESERVATION_STATUS.CONFIRMED].includes(reservation.status as any)) return;
  reservation.deposit.paidMinor += amountMinor;
  if (reservation.status === RESERVATION_STATUS.TENTATIVE && reservation.deposit.paidMinor >= reservation.deposit.requiredMinor) {
    reservation.status = RESERVATION_STATUS.CONFIRMED;
    if (reservation.guarantee.type === 'NONE') reservation.guarantee = { type: 'DEPOSIT' };
  }
  await reservation.save();
};

// Change dates, room type, rate plan or guest count of one room. In-house stays can
// only change their departure (extend or shorten) and guest count.
const modifyStay = async (
  req: Request,
  stayId: string,
  payload: { arrivalDate?: string; departureDate?: string; roomTypeId?: string; ratePlanId?: string; adults?: number; children?: number; keepRates?: boolean },
) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  const location = await locationOf(stay.locationId);
  if (stay.status !== STAY_STATUS.RESERVED && stay.status !== STAY_STATUS.CHECKED_IN) {
    throw new AppError(httpStatus.CONFLICT, `Stay is ${stay.status}`);
  }
  const inHouse = stay.status === STAY_STATUS.CHECKED_IN;
  if (inHouse && (payload.arrivalDate || payload.roomTypeId || payload.ratePlanId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'In-house guests can only change departure or guest count; use room move to change rooms');
  }
  const next = {
    arrivalDate: payload.arrivalDate || stay.arrivalDate,
    departureDate: payload.departureDate || stay.departureDate,
    roomTypeId: payload.roomTypeId || String(stay.roomTypeId),
    ratePlanId: payload.ratePlanId || String(stay.ratePlanId),
    adults: payload.adults ?? stay.adults,
    children: payload.children ?? stay.children,
  };
  if (next.departureDate <= next.arrivalDate) throw new AppError(httpStatus.BAD_REQUEST, 'Departure must be after arrival');
  if (!inHouse && next.arrivalDate < location.businessDate) throw new AppError(httpStatus.BAD_REQUEST, 'Arrival cannot be in the past');
  if (inHouse && next.departureDate <= location.businessDate) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Departure cannot be before tomorrow for an in-house guest; check out instead');
  }

  const canOverride = req.user.permissions.includes('rates.manage');
  const quote = await RateServices.quoteStay(next);
  if (quote.restrictions.length && !canOverride) throw new AppError(httpStatus.CONFLICT, `Not bookable: ${quote.restrictions.join('; ')}`);
  await HotelInventory.prepareTypeInventory(stay.locationId, next.roomTypeId, nightsBetween(next.arrivalDate, next.departureDate));

  const before = stay.toObject();
  await runInTransaction(async () => {
    const oldNights = nightsBetween(stay.arrivalDate, stay.departureDate);
    await HotelInventory.releaseRoomType(stay.roomTypeId, oldNights);
    await HotelInventory.holdRoomType(stay.locationId, next.roomTypeId, next.arrivalDate, next.departureDate);

    // Nights already posted keep their price; new nights take the new quote.
    const posted = inHouse ? stay.nightlyRates.filter((n) => n.date < location.businessDate) : [];
    const oldByDate = new Map(stay.nightlyRates.map((n) => [n.date, n.amountMinor]));
    const nightly = quote.nights
      .filter((n) => !posted.some((p) => p.date === n.date))
      .map((n) => ({ date: n.date, amountMinor: payload.keepRates && oldByDate.has(n.date) ? oldByDate.get(n.date)! : n.amountMinor }));

    if (stay.roomId) {
      const sameType = String(stay.roomTypeId) === next.roomTypeId;
      await HotelInventory.unassignRoomNights(stay._id, inHouse ? location.businessDate : undefined);
      Object.assign(stay, next);
      if (sameType) {
        await HotelInventory.assignRoomNights(stay, stay.roomId, inHouse ? location.businessDate : undefined);
      } else {
        stay.roomId = undefined;
      }
    } else {
      Object.assign(stay, next);
    }
    stay.roomTypeId = new Types.ObjectId(next.roomTypeId);
    stay.ratePlanId = new Types.ObjectId(next.ratePlanId);
    stay.nightlyRates = [...posted, ...nightly] as any;
    stay.packages = quote.packages as any;
    await stay.save();
    await recalcStatus(stay.reservationId);
    await activity.record({
      action: 'STAY_MODIFIED',
      entity: 'RoomStay',
      entityId: stay._id,
      message: `Changed stay to ${next.arrivalDate} – ${next.departureDate}`,
      before,
      after: stay.toObject(),
    });
  });
  emitDomainEvent('availability.changed', { tenantId: req.user.tenantId!, locationId: String(stay.locationId) });
  return getReservation(String(stay.reservationId));
};

const assignRoom = async (stayId: string, roomId: string) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  if (stay.status !== STAY_STATUS.RESERVED) throw new AppError(httpStatus.CONFLICT, 'Only upcoming stays can be assigned here; use room move for in-house guests');
  await runInTransaction(async () => {
    await HotelInventory.unassignRoomNights(stay._id);
    const room = await HotelInventory.assignRoomNights(stay, roomId);
    stay.roomId = room._id as Types.ObjectId;
    await stay.save();
    await activity.record({ action: 'ROOM_ASSIGNED', entity: 'RoomStay', entityId: stay._id, message: `Assigned room ${room.roomNumber}` });
  });
  return stay;
};

const unassignRoom = async (stayId: string) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  if (stay.status !== STAY_STATUS.RESERVED) throw new AppError(httpStatus.CONFLICT, 'Only upcoming stays can be unassigned');
  await runInTransaction(async () => {
    await HotelInventory.unassignRoomNights(stay._id);
    stay.roomId = undefined;
    await stay.save();
  });
  return stay;
};

// Auto-assigns clean free rooms to today's arrivals without a room.
const autoAssign = async (locationId: string, date: string) => {
  const stays = await RoomStay.find({ locationId, arrivalDate: date, status: STAY_STATUS.RESERVED, roomId: null });
  const assigned = [];
  for (const stay of stays) {
    const free = await HotelInventory.freeRooms(locationId, stay.roomTypeId, stay.arrivalDate, stay.departureDate);
    const pick = free.find((r) => r.housekeepingStatus === 'INSPECTED' || r.housekeepingStatus === 'CLEAN') || free[0];
    if (!pick) continue;
    try {
      await assignRoom(String(stay._id), String(pick._id));
      assigned.push({ stayId: stay._id, roomNumber: pick.roomNumber });
    } catch {
      // Another request took the room; leave this arrival for manual assignment.
    }
  }
  return { assigned, unassigned: stays.length - assigned.length };
};

// In-house room move (upgrade, maintenance issue). Remaining nights move to the new room.
const roomMove = async (req: Request, stayId: string, payload: { roomId: string; reason: string; reprice?: boolean }) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  if (stay.status !== STAY_STATUS.CHECKED_IN || !stay.roomId) throw new AppError(httpStatus.CONFLICT, 'Only in-house guests can be moved');
  const location = await locationOf(stay.locationId);
  const newRoom = found(await Room.findOne({ _id: payload.roomId, locationId: stay.locationId }).lean(), 'Room');
  if (newRoom.occupancyStatus === OCCUPANCY_STATUS.OCCUPIED) throw new AppError(httpStatus.CONFLICT, `Room ${newRoom.roomNumber} is occupied`);
  const oldRoomId = stay.roomId;
  const typeChanges = String(newRoom.roomCategoryId) !== String(stay.roomTypeId);
  const remaining = nightsBetween(location.businessDate, stay.departureDate);
  if (typeChanges) await HotelInventory.prepareTypeInventory(stay.locationId, newRoom.roomCategoryId, remaining);

  await runInTransaction(async () => {
    await HotelInventory.unassignRoomNights(stay._id, location.businessDate);
    if (typeChanges) {
      await HotelInventory.releaseRoomType(stay.roomTypeId, remaining);
      await HotelInventory.holdRoomType(stay.locationId, newRoom.roomCategoryId, location.businessDate, stay.departureDate);
      stay.roomTypeId = newRoom.roomCategoryId;
      if (payload.reprice) {
        const quote = await RateServices.quoteStay({
          ratePlanId: stay.ratePlanId,
          roomTypeId: newRoom.roomCategoryId,
          arrivalDate: location.businessDate,
          departureDate: stay.departureDate,
          adults: stay.adults,
          children: stay.children,
        });
        stay.nightlyRates = [...stay.nightlyRates.filter((n) => n.date < location.businessDate), ...quote.nights] as any;
      }
    }
    await HotelInventory.assignRoomNights(stay, newRoom._id, location.businessDate);
    stay.roomId = newRoom._id as Types.ObjectId;
    await stay.save();
    await Room.updateOne({ _id: oldRoomId }, { occupancyStatus: OCCUPANCY_STATUS.VACANT, housekeepingStatus: HOUSEKEEPING_STATUS.DIRTY, $unset: { currentStayId: 1 } });
    await Room.updateOne({ _id: newRoom._id }, { occupancyStatus: OCCUPANCY_STATUS.OCCUPIED, currentStayId: stay._id });
    await HousekeepingTask.create([{ locationId: stay.locationId, roomId: oldRoomId, businessDate: location.businessDate, type: 'DEPARTURE', priority: 5, notes: 'Room move' }]);
    await activity.record({ action: 'ROOM_MOVE', entity: 'RoomStay', entityId: stay._id, message: `Moved guest to room ${newRoom.roomNumber}. Reason: ${payload.reason}` });
  });
  void notifyLocation(req.user.tenantId!, stay.locationId, 'rooms_changed', { roomIds: [oldRoomId, newRoom._id] });
  return getReservation(String(stay.reservationId));
};

// ---------- Cancellation / no-show ----------
const cancellationDeadline = (arrivalDate: string, checkInTime: string, timezone: string, freeUntilHours: number) =>
  new Date(zonedDateTimeToUtc(arrivalDate, checkInTime, timezone).getTime() - freeUntilHours * 3600 * 1000);

const releaseStayInventory = async (stay: { _id: TId; roomTypeId: TId; arrivalDate: string; departureDate: string }, fromDate?: string) => {
  const nights = nightsBetween(fromDate && fromDate > stay.arrivalDate ? fromDate : stay.arrivalDate, stay.departureDate);
  await HotelInventory.releaseRoomType(stay.roomTypeId, nights);
  await HotelInventory.unassignRoomNights(stay._id, fromDate);
};

const cancelFeePreview = async (id: string) => {
  const reservation = found(await Reservation.findById(id).lean(), 'Reservation');
  const location = await locationOf(reservation.locationId);
  const deadline = cancellationDeadline(reservation.arrivalDate, location.checkInTime, location.timezone, reservation.policies.cancellation.freeUntilHours);
  const stays = await RoomStay.find({ reservationId: id, status: STAY_STATUS.RESERVED }).lean();
  const late = new Date() > deadline || !reservation.policies.isRefundable;
  const fee = late
    ? stays.reduce((sum, s) => sum + RateServices.penaltyAmount(reservation.policies.cancellation.penalty, s.nightlyRates, s.nightlyRates.reduce((a, n) => a + n.amountMinor, 0)), 0)
    : 0;
  return { freeCancellationUntil: deadline, feeMinor: fee, refundable: reservation.policies.isRefundable };
};

const cancelReservation = async (req: Request, id: string, payload: { reason: string; waiveFee?: boolean; stayIds?: string[] }) => {
  const reservation = found(await Reservation.findById(id), 'Reservation');
  if ([RESERVATION_STATUS.CHECKED_IN, RESERVATION_STATUS.CHECKED_OUT, RESERVATION_STATUS.CANCELLED].includes(reservation.status as any)) {
    if (!payload.stayIds?.length) throw new AppError(httpStatus.CONFLICT, `Reservation is ${reservation.status}`);
  }
  const { feeMinor } = await cancelFeePreview(id);
  const approvedBy = feeMinor > 0 && payload.waiveFee ? await ApprovalService.requireApproval(req, 'NO_SHOW_WAIVE') : undefined;
  const stays = await RoomStay.find({
    reservationId: id,
    status: STAY_STATUS.RESERVED,
    ...(payload.stayIds?.length ? { _id: { $in: payload.stayIds } } : {}),
  });
  if (!stays.length) throw new AppError(httpStatus.CONFLICT, 'Nothing to cancel');
  const cancelsAll = !payload.stayIds?.length;
  const fee = cancelsAll && !payload.waiveFee ? feeMinor : 0;

  await runInTransaction(async () => {
    for (const stay of stays) {
      await releaseStayInventory(stay);
      stay.status = STAY_STATUS.CANCELLED;
      await stay.save();
    }
    if (fee > 0 && stays[0]?.folioId) {
      await FolioLedger.postLine({
        folioId: stays[0].folioId,
        type: FOLIO_LINE_TYPE.CHARGE,
        code: 'CXL',
        description: `Cancellation fee ${reservation.confirmationNumber}`,
        unitAmountMinor: fee,
        source: { kind: FOLIO_SOURCE.CANCELLATION, refId: reservation._id },
        postingKey: `CXL:${reservation._id}`,
        skipCreditLimit: true,
      });
    }
    if (cancelsAll) {
      reservation.cancelledAt = new Date();
      reservation.cancelReason = payload.reason;
      reservation.cancellationFeeMinor = fee;
      await reservation.save();
    }
    await recalcStatus(reservation._id);
    await activity.record({
      action: 'RESERVATION_CANCELLED',
      entity: 'Reservation',
      entityId: reservation._id,
      approvedBy,
      message: `Cancelled ${stays.length} room(s) on ${reservation.confirmationNumber}. Fee ${fee}${payload.waiveFee ? ' (waived)' : ''}. Reason: ${payload.reason}`,
    });
  });
  emitDomainEvent('reservation.cancelled', { tenantId: req.user.tenantId!, reservationId: id, locationId: String(reservation.locationId) });
  emitDomainEvent('availability.changed', { tenantId: req.user.tenantId!, locationId: String(reservation.locationId) });
  return getReservation(id);
};

// Marks a stay as no-show, frees its room and posts the no-show fee when guaranteed.
const markNoShow = async (stayId: TId, options: { waiveFee?: boolean; approvedBy?: string } = {}) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  if (stay.status !== STAY_STATUS.RESERVED) throw new AppError(httpStatus.CONFLICT, `Stay is ${stay.status}`);
  const reservation = found(await Reservation.findById(stay.reservationId), 'Reservation');
  const guaranteed = reservation.guarantee.type !== 'NONE' || reservation.deposit.paidMinor > 0;
  const total = stay.nightlyRates.reduce((a, n) => a + n.amountMinor, 0);
  const fee = guaranteed && !options.waiveFee ? RateServices.penaltyAmount(reservation.policies.noShow.penalty, stay.nightlyRates, total) : 0;
  await runInTransaction(async () => {
    await releaseStayInventory(stay);
    stay.status = STAY_STATUS.NO_SHOW;
    stay.noShowAt = new Date();
    await stay.save();
    if (fee > 0 && stay.folioId) {
      await FolioLedger.postLine({
        folioId: stay.folioId,
        type: FOLIO_LINE_TYPE.CHARGE,
        code: 'CXL',
        description: `No-show fee ${reservation.confirmationNumber}`,
        unitAmountMinor: fee,
        source: { kind: FOLIO_SOURCE.NO_SHOW, refId: stay._id },
        postingKey: `NOSHOW:${stay._id}`,
        skipCreditLimit: true,
      });
    }
    await recalcStatus(reservation._id);
    await activity.record({
      action: 'NO_SHOW',
      entity: 'RoomStay',
      entityId: stay._id,
      approvedBy: options.approvedBy,
      message: `No-show on ${reservation.confirmationNumber}${fee ? `, fee ${fee}` : ''}`,
    });
  });
  emitDomainEvent('stay.noShow', { tenantId: String(stay.tenantId), stayId: String(stay._id), locationId: String(stay.locationId) });
  return { stayId: stay._id, feeMinor: fee };
};

// ---------- Check-in / check-out ----------
const checkIn = async (
  req: Request,
  stayId: string,
  payload: { roomId?: string; guestIds?: string[]; allowDirtyRoom?: boolean; registration?: { signatureUrl?: string; idVerified?: boolean } },
) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  if (stay.status !== STAY_STATUS.RESERVED) throw new AppError(httpStatus.CONFLICT, `Stay is ${stay.status}`);
  const location = await locationOf(stay.locationId);
  if (stay.arrivalDate !== location.businessDate) {
    throw new AppError(httpStatus.CONFLICT, `Arrival is ${stay.arrivalDate}; the hotel business date is ${location.businessDate}`);
  }
  const reservation = found(await Reservation.findById(stay.reservationId), 'Reservation');
  const warnings: string[] = [];
  if (reservation.deposit.requiredMinor > reservation.deposit.paidMinor) {
    warnings.push(`Deposit outstanding: ${reservation.deposit.requiredMinor - reservation.deposit.paidMinor}`);
  }

  await runInTransaction(async () => {
    if (payload.roomId && String(stay.roomId) !== payload.roomId) {
      await HotelInventory.unassignRoomNights(stay._id);
      const room = await HotelInventory.assignRoomNights(stay, payload.roomId);
      stay.roomId = room._id as Types.ObjectId;
    }
    if (!stay.roomId) throw new AppError(httpStatus.BAD_REQUEST, 'Assign a room before check-in');
    const room = found(await Room.findById(stay.roomId), 'Room');
    if (room.occupancyStatus === OCCUPANCY_STATUS.OCCUPIED) throw new AppError(httpStatus.CONFLICT, `Room ${room.roomNumber} is still occupied`);
    const ready = room.housekeepingStatus === HOUSEKEEPING_STATUS.CLEAN || room.housekeepingStatus === HOUSEKEEPING_STATUS.INSPECTED;
    if (!ready && !payload.allowDirtyRoom) throw new AppError(httpStatus.CONFLICT, `Room ${room.roomNumber} is ${room.housekeepingStatus}`);
    if (!ready) warnings.push(`Room ${room.roomNumber} checked in while ${room.housekeepingStatus}`);

    if (payload.guestIds?.length) stay.guestIds = payload.guestIds.map((g) => new Types.ObjectId(g));
    stay.status = STAY_STATUS.CHECKED_IN;
    stay.checkedInAt = new Date();
    stay.checkedInBy = new Types.ObjectId(req.user.id);
    if (payload.registration) stay.registration = { ...payload.registration, signedAt: new Date(), ip: req.ip };
    if (!stay.folioId) {
      const guest = found(await Guest.findById(stay.guestIds[0]).lean(), 'Guest');
      const folio = await FolioLedger.createFolio({ locationId: stay.locationId, name: guestName(guest), reservationId: reservation._id, roomStayId: stay._id, guestId: guest._id });
      stay.folioId = folio._id;
    }
    await stay.save();
    room.occupancyStatus = OCCUPANCY_STATUS.OCCUPIED;
    room.currentStayId = stay._id as Types.ObjectId;
    await room.save();
    await recalcStatus(reservation._id);
    await activity.record({ action: 'CHECK_IN', entity: 'RoomStay', entityId: stay._id, message: `Checked in ${reservation.confirmationNumber} to room ${room.roomNumber}` });
  });

  void notifyLocation(req.user.tenantId!, stay.locationId, 'stay_checked_in', { stayId, roomId: stay.roomId });
  emitDomainEvent('stay.checkedIn', { tenantId: req.user.tenantId!, stayId, locationId: String(stay.locationId) });
  return { reservation: await getReservation(String(stay.reservationId)), warnings };
};

const undoCheckIn = async (req: Request, stayId: string) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  if (stay.status !== STAY_STATUS.CHECKED_IN) throw new AppError(httpStatus.CONFLICT, 'Stay is not checked in');
  const location = await locationOf(stay.locationId);
  if (stay.arrivalDate !== location.businessDate) throw new AppError(httpStatus.CONFLICT, 'Check-in can only be undone on the arrival day');
  const folio = stay.folioId ? await Folio.findById(stay.folioId).lean() : null;
  if (folio && folio.chargesMinor !== 0) throw new AppError(httpStatus.CONFLICT, 'Charges were already posted; move or reverse them first');
  await runInTransaction(async () => {
    stay.status = STAY_STATUS.RESERVED;
    stay.checkedInAt = undefined;
    await stay.save();
    await Room.updateOne({ _id: stay.roomId }, { occupancyStatus: OCCUPANCY_STATUS.VACANT, $unset: { currentStayId: 1 } });
    await recalcStatus(stay.reservationId);
    await activity.record({ action: 'CHECK_IN_UNDONE', entity: 'RoomStay', entityId: stay._id, message: 'Check-in reversed' });
  });
  void notifyLocation(req.user.tenantId!, stay.locationId, 'rooms_changed', { roomIds: [stay.roomId] });
  return getReservation(String(stay.reservationId));
};

const checkOut = async (req: Request, stayId: string, payload: { transferToCompany?: boolean; billTo?: { name?: string; address?: string; taxId?: string } }) => {
  const stay = found(await RoomStay.findById(stayId), 'Room stay');
  if (stay.status !== STAY_STATUS.CHECKED_IN) throw new AppError(httpStatus.CONFLICT, `Stay is ${stay.status}`);
  const location = await locationOf(stay.locationId);
  const reservation = found(await Reservation.findById(stay.reservationId), 'Reservation');
  const folios = await Folio.find({ roomStayId: stay._id, status: FOLIO_STATUS.OPEN });

  const outstanding = folios.filter((f) => f.balanceMinor !== 0);
  if (outstanding.length && !payload.transferToCompany) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Settle the balance first: ${outstanding.map((f) => `${f.number} ${f.balanceMinor}`).join(', ')}. Or transfer it to the company account.`,
    );
  }
  let companyFolioId: Types.ObjectId | undefined;
  if (outstanding.length && payload.transferToCompany) {
    if (!reservation.companyAccountId) throw new AppError(httpStatus.BAD_REQUEST, 'This reservation has no company account');
    companyFolioId = await companyFolioFor(reservation.companyAccountId, stay.locationId);
  }

  const earlyDeparture = stay.departureDate > location.businessDate;
  const nightsStayed = diffDays(stay.arrivalDate, earlyDeparture ? location.businessDate : stay.departureDate);

  await runInTransaction(async () => {
    if (earlyDeparture) {
      await releaseStayInventory(stay, location.businessDate);
      stay.departureDate = location.businessDate;
      stay.nightlyRates = stay.nightlyRates.filter((n) => n.date < location.businessDate) as any;
    }
    for (const folio of folios) {
      if (folio.balanceMinor !== 0 && companyFolioId) {
        await FolioLedger.transferBalance(folio._id, companyFolioId, `Check-out ${reservation.confirmationNumber}`);
      }
      await FolioLedger.closeFolio(folio._id, payload.billTo);
    }
    stay.status = STAY_STATUS.CHECKED_OUT;
    stay.checkedOutAt = new Date();
    stay.checkedOutBy = new Types.ObjectId(req.user.id);
    await stay.save();
    await Room.updateOne(
      { _id: stay.roomId },
      { occupancyStatus: OCCUPANCY_STATUS.VACANT, housekeepingStatus: HOUSEKEEPING_STATUS.DIRTY, $unset: { currentStayId: 1 } },
    );
    const arrivingToday = await RoomNight.exists({ roomId: stay.roomId, date: location.businessDate, roomStayId: { $ne: stay._id } });
    await HousekeepingTask.create([
      { locationId: stay.locationId, roomId: stay.roomId, businessDate: location.businessDate, type: 'DEPARTURE', priority: arrivingToday ? 10 : 5 },
    ]);
    const spend = folios.reduce((s, f) => s + f.chargesMinor, 0);
    await Guest.updateMany(
      { _id: { $in: stay.guestIds } },
      { $inc: { 'stats.stays': 1, 'stats.nights': nightsStayed, 'stats.totalSpendMinor': spend }, $set: { 'stats.lastStayAt': new Date() } },
    );
    await recalcStatus(reservation._id);
    await activity.record({
      action: 'CHECK_OUT',
      entity: 'RoomStay',
      entityId: stay._id,
      message: `Checked out ${reservation.confirmationNumber}${earlyDeparture ? ' (early departure)' : ''}`,
    });
  });

  void notifyLocation(req.user.tenantId!, stay.locationId, 'stay_checked_out', { stayId, roomId: stay.roomId });
  emitDomainEvent('stay.checkedOut', { tenantId: req.user.tenantId!, stayId, locationId: String(stay.locationId), guestIds: stay.guestIds.map(String) });
  return getReservation(String(stay.reservationId));
};

// City-ledger folio of a company in a location (created on first use).
const companyFolioFor = async (companyAccountId: TId, locationId: TId) => {
  const company = found(await CompanyAccount.findById(companyAccountId), 'Company account');
  const existing = company.folios.find((f) => String(f.locationId) === String(locationId));
  if (existing) {
    const folio = await Folio.findOne({ _id: existing.folioId, status: FOLIO_STATUS.OPEN }).lean();
    if (folio) return folio._id as Types.ObjectId;
  }
  const folio = await FolioLedger.createFolio({
    locationId,
    type: 'COMPANY',
    name: company.name,
    companyAccountId: company._id,
    creditLimitMinor: company.creditLimitMinor || undefined,
  });
  company.folios = company.folios.filter((f) => String(f.locationId) !== String(locationId)) as any;
  company.folios.push({ locationId: new Types.ObjectId(String(locationId)), folioId: folio._id });
  await company.save();
  return folio._id;
};

// Walk-in: book for tonight and check in at once.
const walkIn = async (req: Request, payload: Omit<TCreateReservation, 'stays'> & { stay: Omit<TStayInput, 'arrivalDate'> & { roomId: string }; allowDirtyRoom?: boolean }) => {
  const location = await locationOf(payload.locationId);
  const reservation = await createReservation(req, {
    ...payload,
    source: BOOKING_SOURCE.WALK_IN,
    confirm: true,
    stays: [{ ...payload.stay, arrivalDate: location.businessDate }],
  });
  const stay = reservation.stays[0]!;
  return checkIn(req, String(stay._id), { roomId: payload.stay.roomId, allowDirtyRoom: payload.allowDirtyRoom });
};

// ---------- Online check-in link ----------
const createPreArrivalLink = async (id: string) => {
  const reservation = found(await Reservation.findById(id), 'Reservation');
  const token = randomToken(24);
  reservation.preArrival = { tokenHash: sha256(token), sentAt: new Date() };
  await reservation.save();
  return { token, reservationId: reservation._id };
};

export const ReservationServices = {
  createReservation,
  getReservation,
  listReservations,
  updateReservation,
  confirmReservation,
  onFolioPayment,
  modifyStay,
  assignRoom,
  unassignRoom,
  autoAssign,
  roomMove,
  cancelFeePreview,
  cancelReservation,
  markNoShow,
  checkIn,
  undoCheckIn,
  checkOut,
  companyFolioFor,
  walkIn,
  createPreArrivalLink,
  recalcStatus,
};
