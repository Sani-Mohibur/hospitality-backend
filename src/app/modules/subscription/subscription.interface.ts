import { Types } from 'mongoose';

export const SUBSCRIPTION_STATUS = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
} as const;

export type TSubscriptionStatus = keyof typeof SUBSCRIPTION_STATUS;

export interface ISubscriptionItem {
  moduleCode: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
}

export interface ISubscription {
  tenantId: Types.ObjectId;
  planName: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  status: TSubscriptionStatus;
  currency: string;
  items: ISubscriptionItem[];
  // Monthly list price before discounts
  monthlyMinor: number;
  // Amount charged per billing cycle (yearly = 10 months)
  cycleAmountMinor: number;
  discountBps: number;
  creditBalanceMinor: number;
  features: string[];
  trialEndsAt?: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextBillingDate: Date;
  cancelAtPeriodEnd: boolean;
  lastRecalculatedAt?: Date;
}

export const INVOICE_STATUS = {
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
  UNCOLLECTIBLE: 'UNCOLLECTIBLE',
} as const;

export interface IPlatformInvoice {
  tenantId: Types.ObjectId;
  subscriptionId: Types.ObjectId;
  number: string;
  periodStart: Date;
  periodEnd: Date;
  lines: ISubscriptionItem[];
  subtotalMinor: number;
  discountMinor: number;
  creditAppliedMinor: number;
  totalMinor: number;
  currency: string;
  status: keyof typeof INVOICE_STATUS;
  dueDate: Date;
  paidAt?: Date;
  paymentRef?: string;
  remindersSent: number;
}
