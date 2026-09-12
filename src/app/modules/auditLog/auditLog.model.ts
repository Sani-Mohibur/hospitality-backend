import { Schema, model } from 'mongoose';
import { IAuditLog } from './auditLog.interface';

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
    tenant: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
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

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
