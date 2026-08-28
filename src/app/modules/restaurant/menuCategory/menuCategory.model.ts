import { Schema, model } from 'mongoose';
import { IMenuCategory } from './menuCategory.interface';

const menuCategorySchema = new Schema<IMenuCategory>(
  {
    name: { type: String, required: true },
    description: { type: String },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

menuCategorySchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const MenuCategory = model<IMenuCategory>('MenuCategory', menuCategorySchema);
