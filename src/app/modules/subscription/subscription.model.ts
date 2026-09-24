import { Schema, model } from 'mongoose';
import { INVOICE_STATUS, IPlatformInvoice, ISubscription, SUBSCRIPTION_STATUS } from './subscription.interface';

const itemSchema = new Schema(
  {
    moduleCode: { type: String, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPriceMinor: { type: Number, required: true },
    amountMinor: { type: Number, required: true },
  },
  { _id: false },
);

const subscriptionSchema = new Schema<ISubscription>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
    },
    planName: {
      type: String,
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['MONTHLY', 'YEARLY'],
      default: 'MONTHLY',
    },
    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.TRIALING,
    },
    currency: { type: String, default: 'USD' },
    items: [itemSchema],
    monthlyMinor: { type: Number, default: 0 },
    cycleAmountMinor: { type: Number, default: 0 },
    discountBps: { type: Number, default: 0, min: 0, max: 10000 },
    creditBalanceMinor: { type: Number, default: 0, min: 0 },
    features: [
      {
        type: String,
      },
    ],
    trialEndsAt: { type: Date },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    nextBillingDate: {
      type: Date,
      required: true,
    },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    lastRecalculatedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema);

const platformInvoiceSchema = new Schema<IPlatformInvoice>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', required: true },
    number: { type: String, required: true, unique: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    lines: [itemSchema],
    subtotalMinor: { type: Number, required: true },
    discountMinor: { type: Number, default: 0 },
    creditAppliedMinor: { type: Number, default: 0 },
    totalMinor: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: Object.values(INVOICE_STATUS), default: INVOICE_STATUS.OPEN },
    dueDate: { type: Date, required: true },
    paidAt: { type: Date },
    paymentRef: { type: String },
    remindersSent: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const PlatformInvoice = model<IPlatformInvoice>('PlatformInvoice', platformInvoiceSchema);
