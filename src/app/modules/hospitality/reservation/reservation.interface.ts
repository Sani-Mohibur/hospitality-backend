import { Types } from 'mongoose';

// Reservation-level status, derived from its room stays once guests arrive.
export const RESERVATION_STATUS = {
  TENTATIVE: 'TENTATIVE',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;

export const STAY_STATUS = {
  RESERVED: 'RESERVED',
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;

export const BOOKING_SOURCE = {
  DIRECT: 'DIRECT',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  WALK_IN: 'WALK_IN',
  BOOKING_ENGINE: 'BOOKING_ENGINE',
  CHANNEL: 'CHANNEL',
  COMPANY: 'COMPANY',
} as const;

export type TReservationStatus = keyof typeof RESERVATION_STATUS;
export type TStayStatus = keyof typeof STAY_STATUS;

export interface IPolicySnapshot {
  ratePlanCode: string;
  cancellation: { freeUntilHours: number; penalty: { type: string; value: number } };
  noShow: { penalty: { type: string; value: number } };
  deposit: { type: string; value: number; dueDaysBeforeArrival: number };
  guaranteeRequired: boolean;
  isRefundable: boolean;
}

export interface IReservation {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  confirmationNumber: string;
  status: TReservationStatus;
  source: keyof typeof BOOKING_SOURCE;
  channel?: { name?: string; externalRef?: string };
  bookerGuestId: Types.ObjectId;
  companyAccountId?: Types.ObjectId;
  allotmentId?: Types.ObjectId;
  groupName?: string;
  arrivalDate: string;
  departureDate: string;
  eta?: string;
  notes?: string;
  specialRequests?: string;
  policies: IPolicySnapshot;
  estimatedTotalMinor: number;
  deposit: { requiredMinor: number; dueDate?: string; paidMinor: number };
  guarantee: { type: 'NONE' | 'CARD' | 'DEPOSIT' | 'COMPANY'; reference?: string };
  cancelledAt?: Date;
  cancelReason?: string;
  cancellationFeeMinor?: number;
  preArrival?: { tokenHash?: string; sentAt?: Date; completedAt?: Date };
  createdBy?: Types.ObjectId;
  isDeleted: boolean;
}

export interface INightlyRate {
  date: string;
  amountMinor: number;
}

export interface IRoomStay {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  reservationId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  roomId?: Types.ObjectId;
  ratePlanId: Types.ObjectId;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  guestIds: Types.ObjectId[];
  status: TStayStatus;
  // Price agreed at booking, night by night (posted by the night audit)
  nightlyRates: INightlyRate[];
  packages: { chargeCode: string; label: string; amountMinor: number; per: 'PERSON' | 'ROOM' }[];
  folioId?: Types.ObjectId;
  checkedInAt?: Date;
  checkedInBy?: Types.ObjectId;
  checkedOutAt?: Date;
  checkedOutBy?: Types.ObjectId;
  noShowAt?: Date;
  registration?: { signedAt?: Date; signatureUrl?: string; idVerified?: boolean; ip?: string };
  notes?: string;
}
