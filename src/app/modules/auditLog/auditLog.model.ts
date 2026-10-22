import { Schema, model } from 'mongoose';
import { IActivityEvent, IAuditLog } from './auditLog.interface';

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      required: true,
    },
    entity: {
      type: String,
      required: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    impersonatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
    statusCode: { type: Number },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Raw request logs are kept for one year.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);

const activityEventSchema = new Schema<IActivityEvent>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String },
    impersonatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    message: { type: String, required: true },
    changes: { type: Schema.Types.Mixed },
    meta: { type: Schema.Types.Mixed },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activityEventSchema.index({ tenantId: 1, createdAt: -1 });
activityEventSchema.index({ tenantId: 1, entity: 1, entityId: 1 });

export const ActivityEvent = model<IActivityEvent>('ActivityEvent', activityEventSchema);
