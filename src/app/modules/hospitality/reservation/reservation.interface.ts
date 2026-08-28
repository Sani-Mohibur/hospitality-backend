import { Types } from 'mongoose';

export const RESERVATION_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
  CANCELLED: 'CANCELLED',
} as const;

export type TReservationStatus = keyof typeof RESERVATION_STATUS;

export interface IReservation {
  guestId: Types.ObjectId;
  roomId: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  checkInDate: Date;
  checkOutDate: Date;
  status: TReservationStatus;
  totalAmount: number;
  paidAmount: number;
  isActive: boolean;
  isDeleted: boolean;
}
