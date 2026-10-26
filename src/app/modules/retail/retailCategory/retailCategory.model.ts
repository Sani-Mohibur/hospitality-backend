import { Schema, model } from 'mongoose';
import { IRetailCategory } from './retailCategory.interface';

const retailCategorySchema = new Schema<IRetailCategory>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, uppercase: true, trim: true },
    description: { type: String },
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
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

retailCategorySchema.index({ tenantId: 1, locationId: 1, sortOrder: 1, name: 1 });
retailCategorySchema.index(
  { tenantId: 1, code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: 'string', $gt: '' }, isDeleted: false } },
);

retailCategorySchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const RetailCategory = model<IRetailCategory>('RetailCategory', retailCategorySchema);
