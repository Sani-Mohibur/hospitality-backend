import { Types } from 'mongoose';

export const RETAIL_PO_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;

export type TRetailPOStatus = keyof typeof RETAIL_PO_STATUS;

export interface IRetailPOLine {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  stockItemId: Types.ObjectId;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
  receivedQty: number;
  totalMinor: number;
}

export interface IRetailPurchaseOrder {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  supplierId: Types.ObjectId;
  poNumber: string;
  status: TRetailPOStatus;
  lines: IRetailPOLine[];
  subtotalMinor: number;
  notes?: string;
  expectedAt?: Date;
  sentAt?: Date;
  receivedAt?: Date;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IReceiveGoodsLineInput {
  stockItemId: string;
  receivedQuantity: number;
  unitCost?: number;
}
