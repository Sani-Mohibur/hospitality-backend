import { Types } from 'mongoose';

// A stock item at one location. `quantity` is a cache of the movement ledger and is
// only ever changed together with a StockMovement.
export interface IInventoryItem {
  name: string;
  sku: string;
  category?: string;
  unitOfMeasure: string;
  quantity: number;
  // Moving-average cost per unit, in minor units
  unitCost: number;
  parLevel?: number;
  reorderPoint?: number;
  reorderQty?: number;
  supplierId?: Types.ObjectId;
  isMinibar: boolean;
  locationId: Types.ObjectId;
  tenantId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}

export const MOVEMENT_TYPE = {
  OPENING: 'OPENING',
  RECEIPT: 'RECEIPT',
  SALE: 'SALE',
  SALE_REVERSAL: 'SALE_REVERSAL',
  WASTE: 'WASTE',
  ADJUSTMENT: 'ADJUSTMENT',
  COUNT: 'COUNT',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  MINIBAR: 'MINIBAR',
} as const;

export type TMovementType = keyof typeof MOVEMENT_TYPE;

export interface IStockMovement {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  stockItemId: Types.ObjectId;
  type: TMovementType;
  // Signed: + into stock, - out of stock
  quantity: number;
  unitCost: number;
  quantityAfter: number;
  reason?: string;
  ref?: { kind: string; id: string };
  createdBy?: Types.ObjectId;
  createdAt?: Date;
}

// How much stock one menu item (or one modifier option) uses, by stock SKU so the
// same recipe works at every location.
export interface IRecipe {
  tenantId: Types.ObjectId;
  menuItemId: Types.ObjectId;
  yieldNote?: string;
  ingredients: { sku: string; quantity: number }[];
  modifierIngredients: { optionId: Types.ObjectId; sku: string; quantity: number }[];
}

export interface ISupplier {
  tenantId: Types.ObjectId;
  name: string;
  code?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxNumber?: string;
  leadTimeDays: number;
  notes?: string;
  isActive: boolean;
}

export const PO_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;

export interface IPurchaseOrder {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  supplierId: Types.ObjectId;
  number: string;
  status: keyof typeof PO_STATUS;
  lines: { stockItemId: Types.ObjectId; quantity: number; unitCost: number; receivedQty: number }[];
  expectedAt?: Date;
  notes?: string;
  createdBy?: Types.ObjectId;
  sentAt?: Date;
  receivedAt?: Date;
}

export interface IStockCount {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  status: 'OPEN' | 'POSTED';
  lines: { stockItemId: Types.ObjectId; expected: number; counted?: number }[];
  countedBy?: Types.ObjectId;
  postedAt?: Date;
  notes?: string;
}
