import { Document, Types } from 'mongoose';

export interface INotification extends Document {
  tenant: Types.ObjectId;
  recipient: Types.ObjectId; // User ID
  type: 'EMAIL' | 'SMS' | 'PUSH';
  title: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  readAt?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
