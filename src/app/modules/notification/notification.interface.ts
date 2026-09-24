import { Types } from 'mongoose';

export interface INotification {
  tenantId: Types.ObjectId;
  recipient: Types.ObjectId; // User ID
  type: 'EMAIL' | 'SMS' | 'PUSH';
  title: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  readAt?: Date;
  // What to open when tapped (e.g. { kind: 'Alert', id })
  link?: { kind: string; id: Types.ObjectId };
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}
