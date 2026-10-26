import { Types } from 'mongoose';

export const RETAIL_TRANSFER_STATUS = {
  DRAFT: 'DRAFT',
  DISPATCHED: 'DISPATCHED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;

export type TRetailTransferStatus = keyof typeof RETAIL_TRANSFER_STATUS;

export interface IRetailTransferLine {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  stockItemId: Types.ObjectId;
  sku: string;
  productName: string;
  quantity: number;
  unitCost: number;
}

export interface IRetailTransfer {
  tenantId: Types.ObjectId;
  transferNumber: string;
  fromLocationId: Types.ObjectId;
  toLocationId: Types.ObjectId;
  status: TRetailTransferStatus;
  lines: IRetailTransferLine[];
  notes?: string;
  dispatchedAt?: Date;
  dispatchedBy?: Types.ObjectId;
  receivedAt?: Date;
  receivedBy?: Types.ObjectId;
  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancellationReason?: string;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}
