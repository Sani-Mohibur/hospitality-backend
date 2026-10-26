import { Types } from 'mongoose';

export interface IInitializeStockPayload {
  productId: string;
  variantId?: string;
  locationId: string;
  openingQuantity?: number;
  parLevel?: number;
  reorderPoint?: number;
  reorderQty?: number;
  supplierId?: string;
}

export interface IUpdateStockLevelsPayload {
  parLevel?: number;
  reorderPoint?: number;
  reorderQty?: number;
  supplierId?: string;
  isActive?: boolean;
}

export interface IAdjustStockPayload {
  stockItemId: string;
  quantityChange: number;
  type: 'ADD' | 'SUBTRACT';
  reason: string;
}

export interface ILogWastePayload {
  stockItemId: string;
  quantity: number;
  reason: string;
}

export interface IRestockSuggestion {
  stockItemId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  name: string;
  sku: string;
  barcode?: string;
  unitOfMeasure: string;
  onHand: number;
  reorderPoint: number;
  parLevel?: number;
  reorderQty?: number;
  pendingIncoming: number;
  suggestedQty: number;
  unitCost: number;
  estimatedCostMinor: number;
  supplier?: {
    _id: Types.ObjectId;
    name: string;
    email?: string;
    phone?: string;
    leadTimeDays: number;
  };
}
