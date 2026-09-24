import { Types } from 'mongoose';

// OCCUPIED/BILL_REQUESTED follow the table's open order; staff set CLEANING/OPEN.
// "Reserved" is not stored: it is derived from upcoming table bookings.
export const TABLE_STATUS = {
  OPEN: 'OPEN',
  OCCUPIED: 'OCCUPIED',
  BILL_REQUESTED: 'BILL_REQUESTED',
  CLEANING: 'CLEANING',
} as const;

export interface ITable {
  tableNumber: string;
  capacity: number;
  status: (typeof TABLE_STATUS)[keyof typeof TABLE_STATUS];
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  outletId: Types.ObjectId;
  zone?: string;
  shape: 'SQUARE' | 'ROUND' | 'RECT' | 'BAR';
  position?: { x: number; y: number; w: number; h: number; rotation: number };
  qrToken?: string;
  isActive: boolean;
  isDeleted: boolean;
}
