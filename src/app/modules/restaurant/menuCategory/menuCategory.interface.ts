import { Types } from 'mongoose';

export interface IMenuCategory {
  name: string;
  description?: string;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}
