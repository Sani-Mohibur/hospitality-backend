import { Types } from 'mongoose';

export interface ILocation {
  name: string;
  tenantId: Types.ObjectId;
  address?: string;
  isActive: boolean;
  isDeleted: boolean;
}
