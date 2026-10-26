import { Schema, model } from 'mongoose';
import { ILocation } from './location.interface';

const locationSchema = new Schema<ILocation>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: { type: String, uppercase: true, trim: true },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    address: {
      type: String,
    },
    phone: { type: String },
    email: { type: String },
    timezone: { type: String, default: 'UTC' },
    currency: { type: String, uppercase: true },
    businessDate: { type: String, required: true },
    checkInTime: { type: String, default: '14:00' },
    checkOutTime: { type: String, default: '11:00' },
    branchType: {
      type: String,
      enum: ['HOSPITALITY', 'RESTAURANT'],
    },
    hasRooms: { type: Boolean, default: false },
    nightAudit: {
      autoRun: { type: Boolean, default: false },
      runAt: { type: String, default: '03:00' },
      lastRunAt: { type: Date },
    },
    publicBooking: {
      enabled: { type: Boolean, default: false },
      slug: { type: String, lowercase: true, trim: true },
    },
    invoicePrefix: { type: String, default: 'INV' },
    coordinates: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    mapUrl: { type: String },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

locationSchema.index(
  { 'publicBooking.slug': 1 },
  { unique: true, partialFilterExpression: { 'publicBooking.slug': { $type: 'string' } } },
);

locationSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const Location = model<ILocation>('Location', locationSchema);
