import { Document, Types } from 'mongoose';

export interface IPayment extends Document {
  tenant: Types.ObjectId;
  referenceId: Types.ObjectId; // Folio ID (for Hospitality) or Order ID (for Restaurant)
  module: 'HOSPITALITY' | 'RESTAURANT';
  amount: number;
  currency: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  transactionId?: string; // Stripe payment intent ID
  paymentMethod?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
