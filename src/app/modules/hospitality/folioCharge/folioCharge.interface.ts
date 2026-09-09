import { Types } from 'mongoose';

export const CHARGE_CATEGORY = {
  ROOM: 'ROOM',
  RESTAURANT: 'RESTAURANT',
  LAUNDRY: 'LAUNDRY',
  SPA: 'SPA',
  OTHER: 'OTHER',
} as const;

export type TChargeCategory = keyof typeof CHARGE_CATEGORY;

export interface IFolioCharge {
  folioId: Types.ObjectId;
  tenantId: Types.ObjectId;
  amount: number;
  chargeCategory: TChargeCategory;
  description: string;
  transactionDate: Date;
  isActive: boolean;
  isDeleted: boolean;
}
