import { Types } from 'mongoose';

export interface IRoomCategory {
  name: string;
  description?: string;
  basePrice: number;
  capacity: number;
  tenantId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}
