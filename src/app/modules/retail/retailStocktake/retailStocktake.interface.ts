import { Types } from 'mongoose';

export const RETAIL_STOCKTAKE_STATUS = {
  DRAFT: 'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type TRetailStocktakeStatus = keyof typeof RETAIL_STOCKTAKE_STATUS;

export interface IRetailStocktakeLine {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  stockItemId: Types.ObjectId;
  sku: string;
  productName: string;
  categoryName: string;
  systemQty: number;
  countedQty?: number;
  varianceQty?: number;
  unitCost: number;
  varianceCostMinor?: number;
}

export interface IRetailStocktake {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  stocktakeNumber: string;
  name: string;
  categoryId?: Types.ObjectId;
  status: TRetailStocktakeStatus;
  lines: IRetailStocktakeLine[];
  totalSystemQty: number;
  totalCountedQty: number;
  totalVarianceQty: number;
  totalVarianceCostMinor: number;
  notes?: string;
  startedBy?: Types.ObjectId;
  startedAt?: Date;
  completedBy?: Types.ObjectId;
  completedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}
