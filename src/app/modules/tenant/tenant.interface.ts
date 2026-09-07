import { Types } from 'mongoose';

export type TFeatureModule = string;

export interface ITenant {
  name: string;
  modules: TFeatureModule[];
  isActive: boolean;
  isDeleted: boolean;
  subscriptionId?: Types.ObjectId;
}
