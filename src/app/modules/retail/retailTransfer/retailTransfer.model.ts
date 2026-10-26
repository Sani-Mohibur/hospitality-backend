import { Schema, model } from 'mongoose';
import { IRetailTransfer, IRetailTransferLine, RETAIL_TRANSFER_STATUS } from './retailTransfer.interface';

const transferLineSchema = new Schema<IRetailTransferLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'RetailProduct', required: true },
    variantId: { type: Schema.Types.ObjectId },
    stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const retailTransferSchema = new Schema<IRetailTransfer>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    transferNumber: { type: String, required: true, trim: true },
    fromLocationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    toLocationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    status: {
      type: String,
      enum: Object.values(RETAIL_TRANSFER_STATUS),
      default: RETAIL_TRANSFER_STATUS.DRAFT,
      index: true,
    },
    lines: [transferLineSchema],
    notes: { type: String },
    dispatchedAt: { type: Date },
    dispatchedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receivedAt: { type: Date },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

retailTransferSchema.index({ tenantId: 1, transferNumber: 1 }, { unique: true });
retailTransferSchema.index({ tenantId: 1, fromLocationId: 1, toLocationId: 1, status: 1 });

export const RetailTransfer = model<IRetailTransfer>('RetailTransfer', retailTransferSchema);
