import { Types } from 'mongoose';

export interface ISubscription {
  tenantId: Types.ObjectId;
  planName: string;
  price: number;
  billingCycle: 'MONTHLY' | 'YEARLY';
  status: 'ACTIVE' | 'OVERDUE' | 'CANCELLED';
  features: string[]; // List of enabled features/modules for this subscription
  nextBillingDate: Date;
  appliedCredits: number;
  appliedDiscounts: number;
}
