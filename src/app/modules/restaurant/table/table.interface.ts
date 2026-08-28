import { Types } from 'mongoose';

export const TABLE_STATUS = {
  OPEN: 'OPEN',
  OCCUPIED: 'OCCUPIED',
  RESERVED: 'RESERVED',
  CLEANING: 'CLEANING',
} as const;

export interface ITable {
  tableNumber: string;
  capacity: number;
  status: typeof TABLE_STATUS[keyof typeof TABLE_STATUS];
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}
