import { Schema, model } from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../../errors/AppError';
import {
  FOLIO_LINE_TYPE,
  FOLIO_SOURCE,
  FOLIO_STATUS,
  FOLIO_TYPE,
  IFolio,
  IFolioInvoice,
  IFolioLine,
} from './folio.interface';

const folioSchema = new Schema<IFolio>(
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
    number: { type: String, required: true },
    type: { type: String, enum: Object.values(FOLIO_TYPE), default: FOLIO_TYPE.GUEST },
    name: { type: String, required: true },
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation' },
    roomStayId: { type: Schema.Types.ObjectId, ref: 'RoomStay' },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest' },
    companyAccountId: { type: Schema.Types.ObjectId, ref: 'CompanyAccount' },
    window: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: Object.values(FOLIO_STATUS),
      default: FOLIO_STATUS.OPEN,
    },
    currency: { type: String, default: 'USD' },
    balanceMinor: { type: Number, default: 0 },
    chargesMinor: { type: Number, default: 0 },
    paymentsMinor: { type: Number, default: 0 },
    creditLimitMinor: { type: Number, min: 0 },
    noPost: { type: Boolean, default: false },
    closedAt: { type: Date },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'FolioInvoice' },
  },
  { timestamps: true },
);

folioSchema.index({ tenantId: 1, locationId: 1, number: 1 }, { unique: true });
folioSchema.index({ tenantId: 1, roomStayId: 1 });
folioSchema.index({ tenantId: 1, reservationId: 1 });

export const Folio = model<IFolio>('Folio', folioSchema);

const taxLineSchema = new Schema(
  {
    name: { type: String, required: true },
    rateBps: { type: Number, required: true },
    amountMinor: { type: Number, required: true },
    taxRuleId: { type: Schema.Types.ObjectId, ref: 'TaxRule' },
  },
  { _id: false },
);

const folioLineSchema = new Schema<IFolioLine>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio', required: true, index: true },
    type: { type: String, enum: Object.values(FOLIO_LINE_TYPE), required: true },
    chargeCodeId: { type: Schema.Types.ObjectId, ref: 'ChargeCode' },
    code: { type: String, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitAmountMinor: { type: Number, required: true },
    netMinor: { type: Number, required: true },
    taxMinor: { type: Number, default: 0 },
    amountMinor: { type: Number, required: true },
    taxLines: [taxLineSchema],
    businessDate: { type: String, required: true },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    source: {
      kind: { type: String, enum: Object.values(FOLIO_SOURCE), required: true },
      refId: { type: Schema.Types.ObjectId },
      roomStayId: { type: Schema.Types.ObjectId, ref: 'RoomStay' },
      date: { type: String },
      itemRef: { type: String },
    },
    postingKey: { type: String },
    reversalOfId: { type: Schema.Types.ObjectId, ref: 'FolioLine' },
    reversedById: { type: Schema.Types.ObjectId, ref: 'FolioLine' },
    transferFolioId: { type: Schema.Types.ObjectId, ref: 'Folio' },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
    reason: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

folioLineSchema.index(
  { tenantId: 1, postingKey: 1 },
  { unique: true, partialFilterExpression: { postingKey: { $type: 'string' } } },
);
folioLineSchema.index({ tenantId: 1, locationId: 1, businessDate: 1 });
folioLineSchema.index({ tenantId: 1, 'source.refId': 1 });

// The ledger is append-only: amounts can never be edited and lines never deleted.
// The only permitted update links a line to the reversal that cancels it.
const IMMUTABLE_ALLOWED = new Set(['reversedById', '$set']);

folioLineSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], function (this: any) {
  const update = this.getUpdate() || {};
  const keys = Object.keys(update).flatMap((k) => (k === '$set' ? Object.keys(update.$set || {}) : [k]));
  if (keys.some((k) => !IMMUTABLE_ALLOWED.has(k))) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Folio lines are append-only; post a correction instead');
  }
});

folioLineSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new AppError(httpStatus.BAD_REQUEST, 'Folio lines cannot be deleted; post a reversal instead');
});

folioLineSchema.pre('save', function (this: any) {
  if (!this.isNew && this.modifiedPaths().some((p: string) => p !== 'reversedById')) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Folio lines are append-only; post a correction instead');
  }
});

export const FolioLine = model<IFolioLine>('FolioLine', folioLineSchema);

const folioInvoiceSchema = new Schema<IFolioInvoice>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    folioId: { type: Schema.Types.ObjectId, ref: 'Folio', required: true },
    number: { type: String, required: true },
    kind: { type: String, enum: ['INVOICE', 'CREDIT_NOTE'], default: 'INVOICE' },
    creditNoteOfId: { type: Schema.Types.ObjectId, ref: 'FolioInvoice' },
    issuedAt: { type: Date, default: Date.now },
    billTo: {
      name: { type: String, required: true },
      address: { type: String },
      taxId: { type: String },
      email: { type: String },
    },
    lines: [
      new Schema(
        {
          code: String,
          description: String,
          businessDate: String,
          quantity: Number,
          netMinor: Number,
          taxMinor: Number,
          amountMinor: Number,
        },
        { _id: false },
      ),
    ],
    taxSummary: [new Schema({ name: String, rateBps: Number, amountMinor: Number }, { _id: false })],
    netMinor: { type: Number, required: true },
    taxMinor: { type: Number, required: true },
    totalMinor: { type: Number, required: true },
    paidMinor: { type: Number, required: true },
    balanceMinor: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Gap-free invoice numbering per location (numbers come from a transactional counter).
folioInvoiceSchema.index({ tenantId: 1, locationId: 1, number: 1 }, { unique: true });

export const FolioInvoice = model<IFolioInvoice>('FolioInvoice', folioInvoiceSchema);
