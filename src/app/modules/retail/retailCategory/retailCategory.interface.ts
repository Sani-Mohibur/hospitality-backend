import { Types } from 'mongoose';

// A retail category without locationId belongs to the tenant's master catalogue (all locations).
export interface IRetailCategory {
  name: string;
  code?: string;
  description?: string;
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId | null;
  sortOrder: number;
  isActive: boolean;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
