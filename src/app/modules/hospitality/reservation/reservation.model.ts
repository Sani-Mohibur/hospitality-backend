import { Schema, model } from 'mongoose';
import { BOOKING_SOURCE, IReservation, IRoomStay, RESERVATION_STATUS, STAY_STATUS } from './reservation.interface';

const reservationSchema = new Schema<IReservation>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    confirmationNumber: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(RESERVATION_STATUS),
      default: RESERVATION_STATUS.TENTATIVE,
    },
    source: { type: String, enum: Object.values(BOOKING_SOURCE), default: BOOKING_SOURCE.DIRECT },
    channel: {
      name: { type: String },
      externalRef: { type: String },
    },
    bookerGuestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    companyAccountId: { type: Schema.Types.ObjectId, ref: 'CompanyAccount' },
    allotmentId: { type: Schema.Types.ObjectId, ref: 'Allotment' },
    groupName: { type: String },
    arrivalDate: { type: String, required: true },
    departureDate: { type: String, required: true },
    eta: { type: String },
    notes: { type: String },
    specialRequests: { type: String },
    policies: { type: Schema.Types.Mixed, required: true },
    estimatedTotalMinor: { type: Number, default: 0 },
    deposit: {
      requiredMinor: { type: Number, default: 0 },
      dueDate: { type: String },
      paidMinor: { type: Number, default: 0 },
    },
    guarantee: {
      type: { type: String, enum: ['NONE', 'CARD', 'DEPOSIT', 'COMPANY'], default: 'NONE' },
      reference: { type: String },
    },
    cancelledAt: { type: Date },
    cancelReason: { type: String },
    cancellationFeeMinor: { type: Number },
    preArrival: {
      tokenHash: { type: String },
      sentAt: { type: Date },
      completedAt: { type: Date },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reservationSchema.index({ tenantId: 1, locationId: 1, confirmationNumber: 1 }, { unique: true });
reservationSchema.index({ tenantId: 1, locationId: 1, arrivalDate: 1 });
reservationSchema.index(
  { tenantId: 1, 'channel.name': 1, 'channel.externalRef': 1 },
  { unique: true, partialFilterExpression: { 'channel.externalRef': { $type: 'string' } } },
);

reservationSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const Reservation = model<IReservation>('Reservation', reservationSchema);

const roomStaySchema = new Schema<IRoomStay>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomCategory', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan', required: true },
    arrivalDate: { type: String, required: true },
    departureDate: { type: String, required: true },
    adults: { type: Number, default: 1, min: 1 },
    children: { type: Number, default: 0, min: 0 },
    guestIds: [{ type: Schema.Types.ObjectId, ref: 'Guest' }],
    status: { type: String, enum: Object.values(STAY_STATUS), default: STAY_STATUS.RESERVED },
    nightlyRates: [
      new Schema({ date: { type: String, required: true }, amountMinor: { type: Number, required: true } }, { _id: false }),
    ],
    packages: [
      new Schema(
        {
          chargeCode: { type: String, required: true },
          label: { type: String, required: true },
          amountMinor: { type: Number, required: true },
          per: { type: String, enum: ['PERSON', 'ROOM'], default: 'PERSON' },
        },
        { _id: false },
      ),
    ],
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio' },
    checkedInAt: { type: Date },
    checkedInBy: { type: Schema.Types.ObjectId, ref: 'User' },
    checkedOutAt: { type: Date },
    checkedOutBy: { type: Schema.Types.ObjectId, ref: 'User' },
    noShowAt: { type: Date },
    registration: {
      signedAt: { type: Date },
      signatureUrl: { type: String },
      idVerified: { type: Boolean },
      ip: { type: String },
    },
    notes: { type: String },
  },
  { timestamps: true },
);

roomStaySchema.index({ tenantId: 1, locationId: 1, arrivalDate: 1, status: 1 });
roomStaySchema.index({ tenantId: 1, locationId: 1, departureDate: 1, status: 1 });
roomStaySchema.index({ tenantId: 1, roomId: 1, status: 1 });

export const RoomStay = model<IRoomStay>('RoomStay', roomStaySchema);
