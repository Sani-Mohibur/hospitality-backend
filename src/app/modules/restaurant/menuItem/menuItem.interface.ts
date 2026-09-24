import { Types } from 'mongoose';

export interface IModifierOption {
  _id?: Types.ObjectId;
  name: string;
  priceMinor: number;
  isDefault: boolean;
  isAvailable: boolean;
}

// "Choose a side" (required, exactly 1) or "Extras" (optional, up to 3).
export interface IModifierGroup {
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId;
  name: string;
  minSelect: number;
  maxSelect: number;
  // How many times one option may be picked (e.g. extra shot x2)
  maxPerOption: number;
  options: IModifierOption[];
  isActive: boolean;
  isDeleted: boolean;
}

export interface IMenuItem {
  name: string;
  description?: string;
  sku?: string;
  priceMinor: number;
  categoryId: Types.ObjectId;
  tenantId: Types.ObjectId;
  // Empty for master-menu items shared by all locations
  locationId?: Types.ObjectId;
  outletIds: Types.ObjectId[];
  taxCategory: string;
  // Kitchen/bar screen the item is sent to (falls back to the outlet default)
  stationId?: Types.ObjectId;
  defaultCourse: number;
  modifierGroupIds: Types.ObjectId[];
  imageUrl?: string;
  allergens: string[];
  // "86": sold out now; availableQty counts down when set (limited specials)
  isSoldOut: boolean;
  availableQty?: number;
  prepMinutes?: number;
  locationOverrides: { locationId: Types.ObjectId; priceMinor?: number; isAvailable?: boolean }[];
  sortOrder: number;
  isActive: boolean;
  isDeleted: boolean;
}
