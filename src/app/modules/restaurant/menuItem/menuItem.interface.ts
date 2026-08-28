import { Types } from 'mongoose';

export interface IModifier {
  name: string;
  price: number;
}

export interface IMenuItem {
  name: string;
  description?: string;
  price: number;
  categoryId: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  modifiers?: IModifier[];
  isActive: boolean;
  isDeleted: boolean;
}
