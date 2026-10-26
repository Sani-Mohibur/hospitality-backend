import { Schema, model } from 'mongoose';
import { ITenant, TENANT_STATUS } from './tenant.interface';

const tenantSchema = new Schema<ITenant>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    modules: [
      {
        type: String,
      },
    ],
    status: { type: String, enum: Object.values(TENANT_STATUS), default: TENANT_STATUS.TRIALING },
    trialEndsAt: { type: Date },
    currency: { type: String, default: 'USD', uppercase: true, minlength: 3, maxlength: 3 },
    settings: {
      taxInclusive: { type: Boolean, default: false },
      locale: { type: String, default: 'en' },
      defaultTimezone: { type: String, default: 'UTC' },
      approval: {
        discountOverBps: { type: Number, default: 1000 },
        discountOverMinor: { type: Number, default: 2000 },
        voidAfterFire: { type: Boolean, default: true },
        refunds: { type: Boolean, default: true },
        folioAdjustOverMinor: { type: Number, default: 0 },
        cashPayoutOverMinor: { type: Number, default: 5000 },
      },
      offlineRoomChargeLimitMinor: { type: Number, default: 10000 },
    },
    branding: {
      displayName: { type: String },
      logoUrl: { type: String },
      primaryColor: { type: String },
      customDomain: { type: String },
    },
    stripe: {
      accountId: { type: String },
      chargesEnabled: { type: Boolean, default: false },
      payoutsEnabled: { type: Boolean, default: false },
      detailsSubmitted: { type: Boolean, default: false },
      platformFeeBps: { type: Number },
    },
    loyalty: {
      enabled: { type: Boolean, default: false },
      pointsPerMajorUnit: { type: Number, default: 1 },
      pointValueMinor: { type: Number, default: 1 },
    },
    featureFlags: { type: Map, of: Boolean, default: {} },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner' },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
    },
    lastActivityAt: { type: Date },
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

tenantSchema.pre(['find', 'findOne'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const Tenant = model<ITenant>('Tenant', tenantSchema);
