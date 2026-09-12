import { Types } from 'mongoose';

export interface IInventoryItem {
  name: string;
  sku?: string;
  category?: string;
  unitOfMeasure: string;
  quantity: number;
  unitCost: number;
  locationId: Types.ObjectId;
  tenantId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}
