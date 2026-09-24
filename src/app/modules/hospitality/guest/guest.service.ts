import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../../config';
import AppError from '../../../errors/AppError';
import { IGuest } from './guest.interface';
import { Guest } from './guest.model';
import { decrypt, encrypt } from '../../../utils/crypto';
import { escapeRegex, found, metaOf, paginationOf } from '../../../utils/query';
import { activity } from '../../auditLog/auditLog.service';
import { Reservation, RoomStay } from '../reservation/reservation.model';
import { Folio } from '../folio/folio.model';
import { Room } from '../room/room.model';
import { STAY_STATUS } from '../reservation/reservation.interface';
import { fileUploader } from '../../../utils/fileUploader';
import { fileDeleter } from '../../../utils/deleteFile';
import logger from '../../../utils/logger';

type TGuestInput = Partial<Omit<IGuest, 'idNumberEnc' | 'idNumberLast4' | 'stats' | 'documents'>> & { idNumber?: string };

const withIdNumber = (payload: TGuestInput) => {
  const { idNumber, ...rest } = payload;
  if (idNumber === undefined) return rest;
  if (!idNumber) return { ...rest, idNumberEnc: undefined, idNumberLast4: undefined };
  return { ...rest, idNumberEnc: encrypt(idNumber), idNumberLast4: idNumber.slice(-4) };
};

const stampConsent = (payload: TGuestInput) => {
  if (!payload.consent) return payload;
  const now = new Date();
  return {
    ...payload,
    consent: {
      ...payload.consent,
      marketingAt: payload.consent.marketing !== undefined ? now : undefined,
      dataProcessingAt: payload.consent.dataProcessing !== undefined ? now : undefined,
    },
  };
};

// Likely duplicates by email, phone or exact name, shown before creating a new profile.
const findDuplicates = async (payload: { email?: string; phone?: string; firstName?: string; lastName?: string }) => {
  const or: Record<string, unknown>[] = [];
  if (payload.email) or.push({ email: payload.email.toLowerCase() });
  if (payload.phone) or.push({ phone: payload.phone });
  if (payload.firstName && payload.lastName) {
    or.push({
      firstName: { $regex: `^${escapeRegex(payload.firstName)}$`, $options: 'i' },
      lastName: { $regex: `^${escapeRegex(payload.lastName)}$`, $options: 'i' },
    });
  }
  if (!or.length) return [];
  return Guest.find({ $or: or }).limit(10).lean();
};

const createGuest = async (payload: TGuestInput, options: { allowDuplicate?: boolean } = {}) => {
  if (!options.allowDuplicate && (payload.email || payload.phone)) {
    const dup = await Guest.findOne({
      $or: [...(payload.email ? [{ email: payload.email.toLowerCase() }] : []), ...(payload.phone ? [{ phone: payload.phone }] : [])],
    }).lean();
    if (dup) {
      throw new AppError(httpStatus.CONFLICT, `A guest with this email or phone exists (${dup.firstName} ${dup.lastName}, id ${dup._id})`);
    }
  }
  const [guest] = await Guest.create([withIdNumber(stampConsent(payload))]);
  return guest!;
};

// Finds a guest by email/phone or creates one (used by bookings and the booking engine).
const findOrCreate = async (payload: TGuestInput) => {
  if (payload.email || payload.phone) {
    const existing = await Guest.findOne({
      $or: [...(payload.email ? [{ email: payload.email.toLowerCase() }] : []), ...(payload.phone ? [{ phone: payload.phone }] : [])],
    });
    if (existing) return existing;
  }
  return createGuest(payload, { allowDuplicate: true });
};

const searchGuests = async (query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 25);
  const filter: Record<string, unknown> = {};
  if (query.searchTerm) {
    const term = escapeRegex(String(query.searchTerm).trim());
    filter.$or = [
      { firstName: { $regex: term, $options: 'i' } },
      { lastName: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { phone: { $regex: term, $options: 'i' } },
    ];
  }
  if (query.tag) filter.tags = query.tag;
  if (query.companyAccountId) filter.companyAccountId = query.companyAccountId;
  const [data, total] = await Promise.all([
    Guest.find(filter).sort({ lastName: 1, firstName: 1 }).skip(skip).limit(limit).lean(),
    Guest.countDocuments(filter),
  ]);
  return { data, meta: metaOf(page, limit, total) };
};

const getGuest = async (id: string, canSeePii: boolean) => {
  const guest = found(await Guest.findById(id).select('+idNumberEnc').lean(), 'Guest');
  const { idNumberEnc, ...rest } = guest;
  let idNumber: string | undefined;
  if (canSeePii && idNumberEnc) {
    try {
      idNumber = decrypt(idNumberEnc);
    } catch {
      idNumber = undefined;
    }
  }
  const stays = await RoomStay.find({ guestIds: guest._id }).sort({ arrivalDate: -1 }).limit(20).populate('roomId', 'roomNumber').lean();
  return { ...rest, idNumber, recentStays: stays };
};

const updateGuest = async (id: string, payload: TGuestInput) => {
  const guest = found(await Guest.findById(id), 'Guest');
  const before = guest.toObject();
  Object.assign(guest, withIdNumber(stampConsent(payload)));
  await guest.save();
  await activity.record({ action: 'GUEST_UPDATED', entity: 'Guest', entityId: guest._id, message: `Updated guest ${guest.firstName} ${guest.lastName}`, before, after: guest.toObject() });
  return guest;
};

// Merges a duplicate into the surviving profile and re-points every reference.
const mergeGuests = async (keepId: string, mergeId: string) => {
  if (keepId === mergeId) throw new AppError(httpStatus.BAD_REQUEST, 'Choose two different guests');
  const keep = found(await Guest.findById(keepId), 'Guest to keep');
  const merge = found(await Guest.findById(mergeId).select('+idNumberEnc'), 'Guest to merge');
  const keepOid = keep._id;
  const mergeOid = merge._id;

  await Reservation.updateMany({ bookerGuestId: mergeOid }, { bookerGuestId: keepOid });
  await RoomStay.updateMany({ guestIds: mergeOid }, { $set: { 'guestIds.$[g]': keepOid } }, { arrayFilters: [{ g: mergeOid }] });
  await Folio.updateMany({ guestId: mergeOid }, { guestId: keepOid });
  const { Order } = await import('../../restaurant/order/order.model');
  await Order.updateMany({ guestId: mergeOid }, { guestId: keepOid });

  for (const field of ['email', 'phone', 'nationality', 'dateOfBirth', 'address', 'idType', 'idNumberEnc', 'idNumberLast4'] as const) {
    if (!(keep as any)[field] && (merge as any)[field]) (keep as any)[field] = (merge as any)[field];
  }
  keep.preferences = [...new Set([...keep.preferences, ...merge.preferences])];
  keep.allergies = [...new Set([...keep.allergies, ...merge.allergies])];
  keep.dietary = [...new Set([...keep.dietary, ...merge.dietary])];
  keep.tags = [...new Set([...keep.tags, ...merge.tags])];
  keep.documents.push(...merge.documents);
  keep.stats.stays += merge.stats.stays;
  keep.stats.nights += merge.stats.nights;
  keep.stats.visits += merge.stats.visits;
  keep.stats.totalSpendMinor += merge.stats.totalSpendMinor;
  keep.notes = [keep.notes, merge.notes].filter(Boolean).join('\n') || undefined;
  await keep.save();

  merge.mergedIntoId = keepOid as Types.ObjectId;
  merge.isActive = false;
  await merge.save();
  await activity.record({
    action: 'GUEST_MERGED',
    entity: 'Guest',
    entityId: keepOid,
    message: `Merged ${merge.firstName} ${merge.lastName} into ${keep.firstName} ${keep.lastName}`,
    meta: { mergedId: mergeOid },
  });
  return keep;
};

// Data subject export: everything held about the guest.
const exportGuest = async (id: string) => {
  const guest = found(await Guest.findById(id).select('+idNumberEnc').lean(), 'Guest');
  const [reservations, stays, folios] = await Promise.all([
    Reservation.find({ bookerGuestId: guest._id }).lean(),
    RoomStay.find({ guestIds: guest._id }).lean(),
    Folio.find({ guestId: guest._id }).lean(),
  ]);
  const { Order } = await import('../../restaurant/order/order.model');
  const orders = await Order.find({ guestId: guest._id }).select('orderNumber createdAt totals').lean();
  return {
    exportedAt: new Date(),
    profile: { ...guest, idNumberEnc: undefined, idNumber: guest.idNumberEnc ? decrypt(guest.idNumberEnc) : undefined },
    reservations,
    stays,
    folios,
    orders,
  };
};

// Right to erasure: personal data is removed; financial records keep only the id.
const anonymizeGuest = async (id: string) => {
  const guest = found(await Guest.findById(id), 'Guest');
  const active = await RoomStay.exists({ guestIds: guest._id, status: { $in: [STAY_STATUS.RESERVED, STAY_STATUS.CHECKED_IN] } });
  if (active) throw new AppError(httpStatus.CONFLICT, 'Guest has an upcoming or current stay');
  for (const doc of guest.documents) {
    if (doc.publicId) await fileDeleter.deleteFromCloudinary(doc.publicId).catch(() => undefined);
  }
  Object.assign(guest, {
    firstName: 'Anonymized',
    lastName: 'Guest',
    email: undefined,
    phone: undefined,
    address: undefined,
    dateOfBirth: undefined,
    nationality: undefined,
    idType: undefined,
    idNumberEnc: undefined,
    idNumberLast4: undefined,
    idExpiry: undefined,
    documents: [],
    notes: undefined,
    preferences: [],
    allergies: [],
    dietary: [],
    anonymizedAt: new Date(),
    consent: { marketing: false, dataProcessing: false },
  });
  await guest.save();
  await activity.record({ action: 'GUEST_ANONYMIZED', entity: 'Guest', entityId: guest._id, message: 'Guest personal data erased on request' });
  return { anonymized: true };
};

const addDocument = async (id: string, type: string, file: Express.Multer.File) => {
  const guest = found(await Guest.findById(id), 'Guest');
  const upload = await fileUploader.uploadToCloudinary(file);
  const deleteAfter = new Date(Date.now() + config.security.id_document_retention_days * 24 * 3600 * 1000);
  guest.documents.push({ type, url: upload.url, publicId: upload.public_id, uploadedAt: new Date(), deleteAfter });
  await guest.save();
  return guest.documents[guest.documents.length - 1];
};

// Retention job: ID scans are deleted after the legal retention period.
const purgeExpiredDocuments = async () => {
  const guests = await Guest.find({ 'documents.deleteAfter': { $lt: new Date() } });
  let removed = 0;
  for (const guest of guests) {
    const keep = [];
    for (const doc of guest.documents) {
      if (doc.deleteAfter < new Date()) {
        if (doc.publicId) await fileDeleter.deleteFromCloudinary(doc.publicId).catch((err) => logger.warn(err, 'Document delete failed'));
        removed += 1;
      } else keep.push(doc);
    }
    guest.documents = keep as any;
    await guest.save();
  }
  return removed;
};

// In-house lookup for POS "charge to room" and guest recognition.
const inHouse = async (locationId: string, query: { roomNumber?: string; searchTerm?: string }) => {
  const stayFilter: Record<string, unknown> = { locationId: new Types.ObjectId(locationId), status: STAY_STATUS.CHECKED_IN };
  if (query.roomNumber) {
    const room = await Room.findOne({ locationId, roomNumber: query.roomNumber }).lean();
    if (!room) return [];
    stayFilter.roomId = room._id;
  }
  const stays = await RoomStay.find(stayFilter).populate('roomId', 'roomNumber').populate('guestIds').lean();
  const term = query.searchTerm?.toLowerCase();
  const out = [];
  for (const stay of stays) {
    const guests = (stay.guestIds as any[]).filter(
      (g) => !term || `${g.firstName} ${g.lastName}`.toLowerCase().includes(term),
    );
    if (!guests.length) continue;
    const folio = stay.folioId ? await Folio.findById(stay.folioId).select('number balanceMinor creditLimitMinor noPost status').lean() : null;
    out.push({
      roomStayId: stay._id,
      roomNumber: (stay.roomId as any)?.roomNumber,
      departureDate: stay.departureDate,
      guests: guests.map((g) => ({
        _id: g._id,
        name: `${g.firstName} ${g.lastName}`,
        allergies: g.allergies,
        preferences: g.preferences,
        tags: g.tags,
        stays: g.stats?.stays,
      })),
      folio: folio && {
        _id: folio._id,
        number: folio.number,
        canCharge: folio.status === 'OPEN' && !folio.noPost,
        creditRemainingMinor: folio.creditLimitMinor !== undefined && folio.creditLimitMinor !== null ? folio.creditLimitMinor - folio.balanceMinor : null,
      },
    });
  }
  return out;
};

export const GuestServices = {
  createGuest,
  findOrCreate,
  findDuplicates,
  searchGuests,
  getGuest,
  updateGuest,
  mergeGuests,
  exportGuest,
  anonymizeGuest,
  addDocument,
  purgeExpiredDocuments,
  inHouse,
};
