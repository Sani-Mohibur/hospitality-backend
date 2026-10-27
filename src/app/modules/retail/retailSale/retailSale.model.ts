import { Schema, model } from 'mongoose';
import { PAYMENT_METHOD } from '../../payment/payment.interface';
import { TAX_CATEGORY } from '../../../utils/money';
import {
  IRetailReturn,
  IRetailReturnLine,
  IRetailSale,
  IRetailSaleDiscount,
  IRetailSaleLine,
  IRetailSaleLineDiscount,
  IRetailSalePayment,
  RETAIL_PAYMENT_STATUS,
  RETAIL_SALE_STATUS,
} from './retailSale.interface';

const taxLineSchema = new Schema(
  {
    name: { type: String, required: true },
    rateBps: { type: Number, required: true },
    amountMinor: { type: Number, required: true },
    taxRuleId: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

const saleLineDiscountSchema = new Schema<IRetailSaleLineDiscount>(
  {
    type: { type: String, enum: ['PERCENT', 'AMOUNT', 'COMP'], required: true },
    value: { type: Number, required: true, min: 0 },
    amountMinor: { type: Number, required: true, min: 0 },
    reason: { type: String },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const saleLineSchema = new Schema<IRetailSaleLine>({
  productId: { type: Schema.Types.ObjectId, ref: 'RetailProduct', required: true },
  variantId: { type: Schema.Types.ObjectId },
  stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  name: { type: String, required: true, trim: true },
  sku: { type: String, required: true, uppercase: true, trim: true },
  barcode: { type: String, trim: true },
  categoryName: { type: String, default: 'Retail' },
  taxCategory: { type: String, enum: Object.values(TAX_CATEGORY), default: TAX_CATEGORY.RETAIL },
  quantity: { type: Number, required: true, min: 1 },
  unitPriceMinor: { type: Number, required: true, min: 0 },
  costPriceMinor: { type: Number, required: true, min: 0 },
  discount: saleLineDiscountSchema,
  grossMinor: { type: Number, required: true, min: 0 },
  discountMinor: { type: Number, default: 0, min: 0 },
  netMinor: { type: Number, required: true, min: 0 },
  taxMinor: { type: Number, default: 0, min: 0 },
  totalMinor: { type: Number, required: true, min: 0 },
  taxLines: [taxLineSchema],
  returnedQuantity: { type: Number, default: 0, min: 0 },
});

const saleDiscountSchema = new Schema<IRetailSaleDiscount>(
  {
    type: { type: String, enum: ['PERCENT', 'AMOUNT', 'COMP'], required: true },
    value: { type: Number, required: true, min: 0 },
    amountMinor: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const salePaymentSchema = new Schema<IRetailSalePayment>(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
    method: { type: String, enum: Object.values(PAYMENT_METHOD), required: true },
    amountMinor: { type: Number, required: true, min: 0 },
    tenderedMinor: { type: Number, min: 0 },
    changeMinor: { type: Number, min: 0 },
    reference: { type: String, trim: true },
    note: { type: String, trim: true },
    status: { type: String, default: 'COMPLETED' },
    roomCharge: {
      roomNumber: { type: String },
      roomStayId: { type: Schema.Types.ObjectId, ref: 'RoomStay' },
      folioId: { type: Schema.Types.ObjectId, ref: 'Folio' },
      guestName: { type: String },
    },
    companyAccountId: { type: Schema.Types.ObjectId, ref: 'CompanyAccount' },
    completedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const retailSaleSchema = new Schema<IRetailSale>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    receiptNumber: { type: String, required: true, trim: true },
    invoiceNumber: { type: String, required: true, trim: true },
    businessDate: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(RETAIL_SALE_STATUS),
      default: RETAIL_SALE_STATUS.COMPLETED,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(RETAIL_PAYMENT_STATUS),
      default: RETAIL_PAYMENT_STATUS.PAID,
      index: true,
    },
    customerId: { type: Schema.Types.ObjectId, ref: 'Guest' },
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    customerEmail: { type: String, trim: true },
    lines: [saleLineSchema],
    discounts: [saleDiscountSchema],
    subtotalMinor: { type: Number, required: true, min: 0 },
    discountTotalMinor: { type: Number, default: 0, min: 0 },
    netTotalMinor: { type: Number, required: true, min: 0 },
    taxTotalMinor: { type: Number, default: 0, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    paidMinor: { type: Number, required: true, min: 0 },
    refundedMinor: { type: Number, default: 0, min: 0 },
    changeMinor: { type: Number, default: 0, min: 0 },
    taxLines: [taxLineSchema],
    payments: [salePaymentSchema],
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientRef: { type: String, trim: true },
    notes: { type: String },
    loyaltyEarnedPoints: { type: Number, default: 0 },
    loyaltyRedeemedPoints: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

retailSaleSchema.index({ tenantId: 1, receiptNumber: 1 }, { unique: true });
retailSaleSchema.index({ tenantId: 1, invoiceNumber: 1 });
retailSaleSchema.index({ tenantId: 1, locationId: 1, createdAt: -1 });
retailSaleSchema.index({ tenantId: 1, clientRef: 1 }, { sparse: true });
retailSaleSchema.index({ tenantId: 1, cashierId: 1, createdAt: -1 });

export const RetailSale = model<IRetailSale>('RetailSale', retailSaleSchema);

const returnLineSchema = new Schema<IRetailReturnLine>({
  saleLineId: { type: Schema.Types.ObjectId },
  productId: { type: Schema.Types.ObjectId, ref: 'RetailProduct', required: true },
  variantId: { type: Schema.Types.ObjectId },
  stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  name: { type: String, required: true, trim: true },
  sku: { type: String, required: true, uppercase: true, trim: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPriceMinor: { type: Number, required: true, min: 0 },
  refundAmountMinor: { type: Number, required: true, min: 0 },
  restock: { type: Boolean, required: true, default: true },
  condition: { type: String, enum: ['RESELLABLE', 'DAMAGED', 'DEFECTIVE'], default: 'RESELLABLE' },
  reason: { type: String, required: true },
});

const retailReturnSchema = new Schema<IRetailReturn>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    returnNumber: { type: String, required: true, trim: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'RetailSale', required: true, index: true },
    saleReceiptNumber: { type: String, required: true },
    lines: [returnLineSchema],
    refundAmountMinor: { type: Number, required: true, min: 0 },
    refundMethod: { type: String, enum: Object.values(PAYMENT_METHOD), required: true },
    reason: { type: String, required: true },
    notes: { type: String },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    loyaltyPointsDeducted: { type: Number, default: 0 },
  },
  { timestamps: true },
);

retailReturnSchema.index({ tenantId: 1, returnNumber: 1 }, { unique: true });
retailReturnSchema.index({ tenantId: 1, saleId: 1 });
retailReturnSchema.index({ tenantId: 1, locationId: 1, createdAt: -1 });

export const RetailReturn = model<IRetailReturn>('RetailReturn', retailReturnSchema);
