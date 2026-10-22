import { Types } from 'mongoose';

// Raw, redacted record of every mutating request (kept for super admin / forensics).
export interface IAuditLog {
  action: string;
  entity: string;
  entityId?: Types.ObjectId;
  tenantId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  user?: Types.ObjectId;
  impersonatedBy?: Types.ObjectId;
  details: Record<string, any>;
  statusCode?: number;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: Date;
}

// Human-readable business event with before/after values, shown to managers
// ("Rina voided 2x Latte, reason: wrong item").
export interface IActivityEvent {
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId;
  actorId?: Types.ObjectId;
  actorName?: string;
  impersonatedBy?: Types.ObjectId;
  action: string;
  entity: string;
  entityId?: Types.ObjectId;
  message: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  meta?: Record<string, unknown>;
  approvedBy?: Types.ObjectId;
  createdAt?: Date;
}
