import { Types } from 'mongoose';
import { TTaxLine } from '../../../utils/money';

export const FOLIO_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;

// GUEST = a stay's bill, COMPANY = city ledger, HOUSE = internal account,
// NON_RESIDENT = an outside guest paying on account.
export const FOLIO_TYPE = {
  GUEST: 'GUEST',
  COMPANY: 'COMPANY',
  HOUSE: 'HOUSE',
  NON_RESIDENT: 'NON_RESIDENT',
} as const;

export const FOLIO_LINE_TYPE = {
  CHARGE: 'CHARGE',
  PAYMENT: 'PAYMENT',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
} as const;

export const FOLIO_SOURCE = {
  ROOM_NIGHT: 'ROOM_NIGHT',
  PACKAGE: 'PACKAGE',
  POS: 'POS',
  MANUAL: 'MANUAL',
  MINIBAR: 'MINIBAR',
  NO_SHOW: 'NO_SHOW',
  CANCELLATION: 'CANCELLATION',
  PAYMENT: 'PAYMENT',
  TRANSFER: 'TRANSFER',
  REVERSAL: 'REVERSAL',
  QR_ORDER: 'QR_ORDER',
} as const;

export type TFolioStatus = keyof typeof FOLIO_STATUS;

export interface IFolio {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  number: string;
  type: keyof typeof FOLIO_TYPE;
  name: string;
  reservationId?: Types.ObjectId;
  roomStayId?: Types.ObjectId;
  guestId?: Types.ObjectId;
  companyAccountId?: Types.ObjectId;
  // Split billing: window 1 = main bill, 2 = e.g. extras paid by the guest
  window: number;
  status: TFolioStatus;
  currency: string;
  balanceMinor: number;
  chargesMinor: number;
  paymentsMinor: number;
  creditLimitMinor?: number;
  // Guest asked that no outlet charges be posted to the room
  noPost: boolean;
  closedAt?: Date;
  invoiceId?: Types.ObjectId;
}

// Append-only ledger line. Amounts are signed: charges > 0, payments < 0.
export interface IFolioLine {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  folioId: Types.ObjectId;
  type: keyof typeof FOLIO_LINE_TYPE;
  chargeCodeId?: Types.ObjectId;
  code: string;
  description: string;
  quantity: number;
  unitAmountMinor: number;
  netMinor: number;
  taxMinor: number;
  amountMinor: number;
  taxLines: TTaxLine[];
  businessDate: string;
  postedBy?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  source: { kind: keyof typeof FOLIO_SOURCE; refId?: Types.ObjectId; roomStayId?: Types.ObjectId; date?: string; itemRef?: string };
  // Unique key that makes automatic postings idempotent (e.g. RN:<stay>:<date>)
  postingKey?: string;
  reversalOfId?: Types.ObjectId;
  reversedById?: Types.ObjectId;
  transferFolioId?: Types.ObjectId;
  paymentId?: Types.ObjectId;
  reason?: string;
  createdAt?: Date;
}

export interface IFolioInvoice {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  folioId: Types.ObjectId;
  number: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  creditNoteOfId?: Types.ObjectId;
  issuedAt: Date;
  billTo: { name: string; address?: string; taxId?: string; email?: string };
  lines: { code: string; description: string; businessDate: string; quantity: number; netMinor: number; taxMinor: number; amountMinor: number }[];
  taxSummary: { name: string; rateBps: number; amountMinor: number }[];
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  currency: string;
  issuedBy?: Types.ObjectId;
}
