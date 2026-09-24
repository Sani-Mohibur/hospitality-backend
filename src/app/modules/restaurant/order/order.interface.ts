import { Types } from 'mongoose';
import { TTaxLine } from '../../../utils/money';

export const ORDER_TYPE = {
  DINE_IN: 'DINE_IN',
  TAKEAWAY: 'TAKEAWAY',
  ROOM_SERVICE: 'ROOM_SERVICE',
  DELIVERY: 'DELIVERY',
} as const;

export const ORDER_SOURCE = {
  POS: 'POS',
  GUEST_QR: 'GUEST_QR',
  AGGREGATOR: 'AGGREGATOR',
  OFFLINE_SYNC: 'OFFLINE_SYNC',
} as const;

export const ORDER_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  VOIDED: 'VOIDED',
  MERGED: 'MERGED',
} as const;

export const PAYMENT_STATUS = {
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;

// Kitchen state per item: NEW = on the order but not sent; QUEUED = on the KDS.
export const ITEM_STATUS = {
  NEW: 'NEW',
  QUEUED: 'QUEUED',
  COOKING: 'COOKING',
  READY: 'READY',
  SERVED: 'SERVED',
  VOIDED: 'VOIDED',
} as const;

export type TOrderStatus = keyof typeof ORDER_STATUS;
export type TItemStatus = keyof typeof ITEM_STATUS;

export interface IOrderItemModifier {
  groupId?: Types.ObjectId;
  groupName?: string;
  optionId?: Types.ObjectId;
  name: string;
  priceMinor: number;
  quantity: number;
}

export interface IDiscount {
  type: 'PERCENT' | 'AMOUNT' | 'COMP';
  // bps for PERCENT, minor units for AMOUNT
  value: number;
  reason: string;
  by?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
}

export interface IOrderStatusHistory {
  status: string;
  changedAt: Date;
  changedBy?: Types.ObjectId;
  remarks?: string;
}

export interface IOrderItem {
  _id?: Types.ObjectId;
  menuItemId: Types.ObjectId;
  name: string;
  categoryId?: Types.ObjectId;
  stationId?: Types.ObjectId;
  taxCategory: string;
  quantity: number;
  // Snapshot of price when ordered (server-side, never from the client)
  unitPriceMinor: number;
  modifiers: IOrderItemModifier[];
  specialInstructions?: string;
  course: number;
  seat?: number;
  checkNo: number;
  status: TItemStatus;
  firedAt?: Date;
  startedAt?: Date;
  readyAt?: Date;
  servedAt?: Date;
  discount?: IDiscount;
  void?: { at: Date; by?: Types.ObjectId; reason: string; approvedBy?: Types.ObjectId; afterFire: boolean; waste: boolean };
  addedBy?: Types.ObjectId;
  // Calculated amounts (after discounts, incl. allocated service charge)
  calc?: { grossMinor: number; discountMinor: number; netMinor: number; serviceMinor: number; taxMinor: number; totalMinor: number; taxLines: TTaxLine[] };
}

export interface ICheck {
  checkNo: number;
  label?: string;
  // Set for "split evenly": the check owes a fixed share of the total
  fixedAmountMinor?: number;
}

export interface IOrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  totalMinor: number;
  tipMinor: number;
  paidMinor: number;
  refundedMinor: number;
  balanceMinor: number;
}

export interface IOrder {
  orderNumber: string;
  clientOrderId?: string;
  outletId: Types.ObjectId;
  tableId?: Types.ObjectId;
  type: keyof typeof ORDER_TYPE;
  source: keyof typeof ORDER_SOURCE;
  status: TOrderStatus;
  paymentStatus: keyof typeof PAYMENT_STATUS;
  businessDate: string;
  covers: number;
  serverId?: Types.ObjectId;
  deviceId?: Types.ObjectId;
  guestId?: Types.ObjectId;
  roomStayId?: Types.ObjectId;
  // Guest QR orders wait for staff to accept before reaching the kitchen
  pendingAcceptance: boolean;
  items: IOrderItem[];
  discounts: IDiscount[];
  checks: ICheck[];
  totals: IOrderTotals;
  taxLines: TTaxLine[];
  notes?: string;
  delivery?: { address?: string; phone?: string; aggregator?: string; externalId?: string; driver?: string };
  mergedIntoId?: Types.ObjectId;
  closedAt?: Date;
  voidReason?: string;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  statusHistory: IOrderStatusHistory[];
  isActive: boolean;
  isDeleted: boolean;
}
