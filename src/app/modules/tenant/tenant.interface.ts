import { FEATURE_MODULES } from '../user/user.constant';

export type TFeatureModule = keyof typeof FEATURE_MODULES;

export interface ITenant {
  name: string;
  modules: TFeatureModule[];
  isActive: boolean;
  isDeleted: boolean;
}
