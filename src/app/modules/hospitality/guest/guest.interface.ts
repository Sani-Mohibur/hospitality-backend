import { Types } from 'mongoose';

export interface IGuest {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  idType?: string;
  idNumber?: string;
  tenantId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}
