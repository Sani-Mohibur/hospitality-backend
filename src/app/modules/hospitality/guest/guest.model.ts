import { Schema, model } from 'mongoose';
import { IGuest } from './guest.interface';

const guestSchema = new Schema<IGuest>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    nationality: { type: String },
    dateOfBirth: { type: String },
    address: { type: String },
    idType: { type: String },
    idNumberEnc: { type: String, select: 0 },
    idNumberLast4: { type: String },
    idExpiry: { type: String },
    documents: [
      new Schema(
        {
          type: { type: String, required: true },
          url: { type: String, required: true },
          publicId: { type: String },
          uploadedAt: { type: Date, default: Date.now },
          deleteAfter: { type: Date, required: true },
        },
        { _id: true },
      ),
    ],
    preferences: [{ type: String }],
    allergies: [{ type: String }],
    dietary: [{ type: String }],
    tags: [{ type: String }],
    notes: { type: String },
    companyAccountId: { type: Schema.Types.ObjectId, ref: 'CompanyAccount' },
    consent: {
      marketing: { type: Boolean, default: false },
      marketingAt: { type: Date },
      dataProcessing: { type: Boolean, default: true },
      dataProcessingAt: { type: Date },
      source: { type: String },
    },
    stats: {
      stays: { type: Number, default: 0 },
      nights: { type: Number, default: 0 },
      visits: { type: Number, default: 0 },
      totalSpendMinor: { type: Number, default: 0 },
      lastStayAt: { type: Date },
      lastVisitAt: { type: Date },
    },
    mergedIntoId: { type: Schema.Types.ObjectId, ref: 'Guest' },
    anonymizedAt: { type: Date },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

guestSchema.index({ tenantId: 1, email: 1 });
guestSchema.index({ tenantId: 1, phone: 1 });
guestSchema.index({ tenantId: 1, lastName: 1, firstName: 1 });

guestSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true }, mergedIntoId: null });
});

guestSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    delete ret.idNumberEnc;
    delete ret.__v;
    return ret;
  },
});

export const Guest = model<IGuest>('Guest', guestSchema);
