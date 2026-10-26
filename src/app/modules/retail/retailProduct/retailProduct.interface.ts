import { Types } from 'mongoose';
import { TTaxCategory } from '../../../utils/money';

export interface IRetailVariantAttribute {
  name: string;
  value: string;
}

export interface IRetailProductVariant {
  _id?: Types.ObjectId;
  name: string;
  sku: string;
  barcode?: string;
  priceMinor: number;
  costPriceMinor: number;
  attributes: IRetailVariantAttribute[];
  isActive: boolean;
}

export interface IRetailProduct {
  name: string;
  description?: string;
  categoryId: Types.ObjectId;
  sku: string;
  barcode?: string;
  priceMinor: number;
  costPriceMinor: number;
  taxCategory: TTaxCategory;
  unitOfMeasure: string;
  imageUrl?: string;
  tags?: string[];
  tenantId: Types.ObjectId;
  // Omit or null for master catalogue available across all tenant locations
  locationId?: Types.ObjectId | null;
  hasVariants: boolean;
  variants: IRetailProductVariant[];
  sortOrder: number;
  isActive: boolean;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
