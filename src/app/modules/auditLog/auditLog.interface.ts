import { Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  action: string;
  entity: string;
  entityId?: Types.ObjectId;
  tenant?: Types.ObjectId;
  user?: Types.ObjectId;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}
