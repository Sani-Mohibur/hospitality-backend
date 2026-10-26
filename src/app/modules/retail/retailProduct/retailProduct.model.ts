import { Schema, model } from 'mongoose';
import { IRetailProduct, IRetailProductVariant } from './retailProduct.interface';
import { TAX_CATEGORY } from '../../../utils/money';

const variantSchema = new Schema<IRetailProductVariant>(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    barcode: { type: String, trim: true },
    priceMinor: { type: Number, required: true, min: 0 },
    costPriceMinor: { type: Number, default: 0, min: 0 },
    attributes: [
      new Schema(
        {
          name: { type: String, required: true, trim: true },
          value: { type: String, required: true, trim: true },
        },
        { _id: false },
      ),
    ],
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const retailProductSchema = new Schema<IRetailProduct>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'RetailCategory',
      required: true,
      index: true,
    },
    sku: { type: String, required: true, uppercase: true, trim: true },
    barcode: { type: String, trim: true },
    priceMinor: { type: Number, required: true, min: 0 },
    costPriceMinor: { type: Number, default: 0, min: 0 },
    taxCategory: {
      type: String,
      enum: Object.values(TAX_CATEGORY),
      default: TAX_CATEGORY.RETAIL,
    },
    unitOfMeasure: { type: String, default: 'UNIT', trim: true },
    imageUrl: { type: String },
    tags: [{ type: String, trim: true }],
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
    },
    hasVariants: { type: Boolean, default: false },
    variants: [variantSchema],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

retailProductSchema.index({ tenantId: 1, locationId: 1, categoryId: 1 });
retailProductSchema.index(
  { tenantId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
retailProductSchema.index(
  { tenantId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string', $gt: '' }, isDeleted: false } },
);
retailProductSchema.index({ tenantId: 1, 'variants.sku': 1 });
retailProductSchema.index({ tenantId: 1, 'variants.barcode': 1 });

retailProductSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const RetailProduct = model<IRetailProduct>('RetailProduct', retailProductSchema);
