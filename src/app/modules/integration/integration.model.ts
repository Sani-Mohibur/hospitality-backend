import { Schema, Types, model } from 'mongoose';

export const API_SCOPES = ['channel:read', 'channel:write', 'orders:write', 'reports:read'] as const;
export type TApiScope = (typeof API_SCOPES)[number];

// Key for a partner system (channel manager, aggregator, accounting). The full key is
// shown once; only its hash is stored.
export interface IApiKey {
  tenantId: Types.ObjectId;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: TApiScope[];
  locationIds: Types.ObjectId[];
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdBy?: Types.ObjectId;
}

const apiKeySchema = new Schema<IApiKey>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true },
    prefix: { type: String, required: true, unique: true },
    keyHash: { type: String, required: true, select: 0 },
    scopes: [{ type: String, enum: API_SCOPES }],
    locationIds: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const ApiKey = model<IApiKey>('ApiKey', apiKeySchema);

export const WEBHOOK_EVENTS = [
  'reservation.created',
  'reservation.updated',
  'reservation.cancelled',
  'availability.changed',
  'stay.checkedIn',
  'stay.checkedOut',
  'order.closed',
  'payment.completed',
  'payment.refunded',
] as const;

export interface IWebhookSubscription {
  tenantId: Types.ObjectId;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
  description?: string;
}

const webhookSubscriptionSchema = new Schema<IWebhookSubscription>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    url: { type: String, required: true },
    secret: { type: String, required: true, select: 0 },
    events: [{ type: String, enum: WEBHOOK_EVENTS }],
    isActive: { type: Boolean, default: true },
    failureCount: { type: Number, default: 0 },
    description: { type: String },
  },
  { timestamps: true },
);

export const WebhookSubscription = model<IWebhookSubscription>('WebhookSubscription', webhookSubscriptionSchema);

export interface IWebhookDelivery {
  tenantId: Types.ObjectId;
  subscriptionId: Types.ObjectId;
  event: string;
  payload: unknown;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  responseStatus?: number;
  lastError?: string;
  sentAt?: Date;
}

const webhookDeliverySchema = new Schema<IWebhookDelivery>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'WebhookSubscription', required: true },
    event: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    responseStatus: { type: Number },
    lastError: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: true },
);

webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });
webhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const WebhookDelivery = model<IWebhookDelivery>('WebhookDelivery', webhookDeliverySchema);
