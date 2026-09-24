import { Types } from 'mongoose';

// A category without locationId belongs to the tenant's master menu (all locations).
export interface IMenuCategory {
  name: string;
  description?: string;
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId;
  // Outlets that show this category; empty = every outlet of the location
  outletIds: Types.ObjectId[];
  sortOrder: number;
  isActive: boolean;
  isDeleted: boolean;
}

// A time-based menu (breakfast, lunch, happy hour) for one or more outlets.
export interface IMenuSchedule {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  outletIds: Types.ObjectId[];
  categoryIds: Types.ObjectId[];
  // days: 0 = Sunday; from/to local time HH:mm (to may be past midnight, e.g. 22:00-02:00)
  windows: { days: number[]; from: string; to: string }[];
  isActive: boolean;
}
