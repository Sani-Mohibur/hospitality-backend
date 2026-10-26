import { Schema, model } from 'mongoose';
import { IRetailStocktake, IRetailStocktakeLine, RETAIL_STOCKTAKE_STATUS } from './retailStocktake.interface';

const stocktakeLineSchema = new Schema<IRetailStocktakeLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'RetailProduct', required: true },
    variantId: { type: Schema.Types.ObjectId },
    stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    productName: { type: String, required: true, trim: true },
    categoryName: { type: String, default: 'Retail' },
    systemQty: { type: Number, required: true, default: 0 },
    countedQty: { type: Number },
    varianceQty: { type: Number, default: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    varianceCostMinor: { type: Number, default: 0 },
  },
  { _id: false },
);

const retailStocktakeSchema = new Schema<IRetailStocktake>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    stocktakeNumber: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'RetailCategory' },
    status: {
      type: String,
      enum: Object.values(RETAIL_STOCKTAKE_STATUS),
      default: RETAIL_STOCKTAKE_STATUS.IN_PROGRESS,
      index: true,
    },
    lines: [stocktakeLineSchema],
    totalSystemQty: { type: Number, default: 0 },
    totalCountedQty: { type: Number, default: 0 },
    totalVarianceQty: { type: Number, default: 0 },
    totalVarianceCostMinor: { type: Number, default: 0 },
    notes: { type: String },
    startedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    startedAt: { type: Date, default: Date.now },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

retailStocktakeSchema.index({ tenantId: 1, stocktakeNumber: 1 }, { unique: true });
retailStocktakeSchema.index({ tenantId: 1, locationId: 1, status: 1 });

export const RetailStocktake = model<IRetailStocktake>('RetailStocktake', retailStocktakeSchema);
