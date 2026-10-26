import { Schema, model } from 'mongoose';
import { IRetailPOLine, IRetailPurchaseOrder, RETAIL_PO_STATUS } from './retailPurchaseOrder.interface';

const poLineSchema = new Schema<IRetailPOLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'RetailProduct', required: true },
    variantId: { type: Schema.Types.ObjectId },
    stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    receivedQty: { type: Number, default: 0, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const retailPurchaseOrderSchema = new Schema<IRetailPurchaseOrder>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    poNumber: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(RETAIL_PO_STATUS),
      default: RETAIL_PO_STATUS.DRAFT,
      index: true,
    },
    lines: [poLineSchema],
    subtotalMinor: { type: Number, required: true, default: 0 },
    notes: { type: String },
    expectedAt: { type: Date },
    sentAt: { type: Date },
    receivedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

retailPurchaseOrderSchema.index({ tenantId: 1, poNumber: 1 }, { unique: true });
retailPurchaseOrderSchema.index({ tenantId: 1, locationId: 1, status: 1, createdAt: -1 });

export const RetailPurchaseOrder = model<IRetailPurchaseOrder>(
  'RetailPurchaseOrder',
  retailPurchaseOrderSchema,
);
