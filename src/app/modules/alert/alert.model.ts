import { Schema, Types, model } from 'mongoose';

export const ALERT_TYPE = {
  DIRTY_ROOM_BEFORE_ARRIVAL: 'DIRTY_ROOM_BEFORE_ARRIVAL',
  TICKET_OVERDUE: 'TICKET_OVERDUE',
  LOW_STOCK: 'LOW_STOCK',
  DEPOSIT_OVERDUE: 'DEPOSIT_OVERDUE',
  SHIFT_OPEN_TOO_LONG: 'SHIFT_OPEN_TOO_LONG',
  CASH_VARIANCE: 'CASH_VARIANCE',
  MAINTENANCE_ISSUE: 'MAINTENANCE_ISSUE',
  NIGHT_AUDIT_FAILED: 'NIGHT_AUDIT_FAILED',
  OFFLINE_ROOM_CHARGE_LIMIT: 'OFFLINE_ROOM_CHARGE_LIMIT',
  UNUSUAL_VOIDS: 'UNUSUAL_VOIDS',
  GUEST_REQUEST: 'GUEST_REQUEST',
  WEBHOOK_FAILING: 'WEBHOOK_FAILING',
} as const;

export type TAlertType = keyof typeof ALERT_TYPE;
export type TAlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

// Actionable alert: every alert points to the thing to fix (`ref`) and can be
// acknowledged or resolved. `dedupeKey` stops the same problem alerting twice.
export interface IAlert {
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId;
  type: TAlertType;
  severity: TAlertSeverity;
  title: string;
  message: string;
  ref?: { kind: string; id: Types.ObjectId };
  action?: { label: string; method: string; path: string };
  dedupeKey?: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  acknowledgedBy?: Types.ObjectId;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
}

const alertSchema = new Schema<IAlert>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    type: { type: String, enum: Object.values(ALERT_TYPE), required: true },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    ref: { kind: String, id: Schema.Types.ObjectId },
    action: { label: String, method: String, path: String },
    dedupeKey: { type: String },
    status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'], default: 'OPEN' },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

alertSchema.index({ tenantId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, status: { $in: ['OPEN', 'ACKNOWLEDGED'] } } });
alertSchema.index({ tenantId: 1, locationId: 1, status: 1, createdAt: -1 });

export const Alert = model<IAlert>('Alert', alertSchema);

// Per-tenant switches and thresholds for the built-in alert checks.
export interface IAlertRule {
  tenantId: Types.ObjectId;
  type: TAlertType;
  enabled: boolean;
  // Meaning depends on the type (minutes before arrival, minutes late, hours open...)
  threshold?: number;
  notifyRoles: string[];
  channels: ('PUSH' | 'EMAIL' | 'SMS')[];
}

const alertRuleSchema = new Schema<IAlertRule>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    type: { type: String, enum: Object.values(ALERT_TYPE), required: true },
    enabled: { type: Boolean, default: true },
    threshold: { type: Number },
    notifyRoles: { type: [String], default: ['TENANT_OWNER', 'TENANT_MANAGER'] },
    channels: { type: [String], default: ['PUSH'] },
  },
  { timestamps: true },
);

alertRuleSchema.index({ tenantId: 1, type: 1 }, { unique: true });

export const AlertRule = model<IAlertRule>('AlertRule', alertRuleSchema);
