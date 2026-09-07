import { Schema, model } from 'mongoose';
import { ISubscription } from './subscription.interface';

const subscriptionSchema = new Schema<ISubscription>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    planName: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['MONTHLY', 'YEARLY'],
      required: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'OVERDUE', 'CANCELLED'],
      default: 'ACTIVE',
    },
    features: [
      {
        type: String,
      },
    ],
    nextBillingDate: {
      type: Date,
      required: true,
    },
    appliedCredits: {
      type: Number,
      default: 0,
    },
    appliedDiscounts: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema);
