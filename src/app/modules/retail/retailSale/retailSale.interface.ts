import { Types } from 'mongoose';
import { TPaymentMethod } from '../../payment/payment.interface';
import { TTaxCategory, TTaxLine } from '../../../utils/money';

export const RETAIL_SALE_STATUS = {
  COMPLETED: 'COMPLETED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  VOIDED: 'VOIDED',
} as const;

export type TRetailSaleStatus = keyof typeof RETAIL_SALE_STATUS;

export const RETAIL_PAYMENT_STATUS = {
  PAID: 'PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;

export type TRetailPaymentStatus = keyof typeof RETAIL_PAYMENT_STATUS;

export interface IRetailSaleLineDiscount {
  type: 'PERCENT' | 'AMOUNT' | 'COMP';
  value: number; // bps for PERCENT, minor units for AMOUNT
  amountMinor: number;
  reason?: string;
  approvedBy?: Types.ObjectId;
}

export interface IRetailSaleLine {
  _id?: Types.ObjectId;
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  stockItemId: Types.ObjectId;
  name: string;
  sku: string;
  barcode?: string;
  categoryName?: string;
  taxCategory: TTaxCategory;
  quantity: number;
  unitPriceMinor: number; // snapshot
  costPriceMinor: number; // snapshot
  discount?: IRetailSaleLineDiscount;
  grossMinor: number; // quantity * unitPriceMinor
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxLines: TTaxLine[];
  returnedQuantity: number;
}

export interface IRetailSaleDiscount {
  type: 'PERCENT' | 'AMOUNT' | 'COMP';
  value: number; // bps for PERCENT, minor units for AMOUNT
  amountMinor: number;
  reason: string;
  approvedBy?: Types.ObjectId;
}

export interface IRetailSalePayment {
  paymentId?: Types.ObjectId;
  method: TPaymentMethod;
  amountMinor: number;
  tenderedMinor?: number;
  changeMinor?: number;
  reference?: string;
  note?: string;
  status: string;
  roomCharge?: {
    roomNumber?: string;
    roomStayId?: Types.ObjectId;
    folioId?: Types.ObjectId;
    guestName?: string;
  };
  companyAccountId?: Types.ObjectId;
  completedAt: Date;
}

export interface IRetailSale {
  _id?: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  receiptNumber: string;
  invoiceNumber: string;
  businessDate: string;
  status: TRetailSaleStatus;
  paymentStatus: TRetailPaymentStatus;
  customerId?: Types.ObjectId;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  lines: IRetailSaleLine[];
  discounts: IRetailSaleDiscount[];
  subtotalMinor: number;
  discountTotalMinor: number;
  netTotalMinor: number;
  taxTotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  changeMinor?: number;
  taxLines: TTaxLine[];
  payments: IRetailSalePayment[];
  shiftId?: Types.ObjectId;
  cashierId: Types.ObjectId;
  clientRef?: string;
  notes?: string;
  loyaltyEarnedPoints?: number;
  loyaltyRedeemedPoints?: number;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRetailReturnLine {
  _id?: Types.ObjectId;
  saleLineId?: Types.ObjectId;
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  stockItemId: Types.ObjectId;
  name: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  refundAmountMinor: number;
  restock: boolean;
  condition?: 'RESELLABLE' | 'DAMAGED' | 'DEFECTIVE';
  reason: string;
}

export interface IRetailReturn {
  _id?: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  returnNumber: string;
  saleId: Types.ObjectId;
  saleReceiptNumber: string;
  lines: IRetailReturnLine[];
  refundAmountMinor: number;
  refundMethod: TPaymentMethod;
  reason: string;
  notes?: string;
  shiftId?: Types.ObjectId;
  processedBy: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  loyaltyPointsDeducted?: number;
  createdAt: Date;
  updatedAt: Date;
}
