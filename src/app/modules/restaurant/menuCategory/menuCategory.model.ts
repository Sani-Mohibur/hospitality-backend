import { Schema, model } from 'mongoose';
import { IMenuCategory, IMenuSchedule } from './menuCategory.interface';

const menuCategorySchema = new Schema<IMenuCategory>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
    },
    outletIds: [{ type: Schema.Types.ObjectId, ref: 'Outlet' }],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

menuCategorySchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const MenuCategory = model<IMenuCategory>('MenuCategory', menuCategorySchema);

const menuScheduleSchema = new Schema<IMenuSchedule>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    name: { type: String, required: true },
    outletIds: [{ type: Schema.Types.ObjectId, ref: 'Outlet' }],
    categoryIds: [{ type: Schema.Types.ObjectId, ref: 'MenuCategory' }],
    windows: [
      new Schema(
        {
          days: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
          from: { type: String, required: true },
          to: { type: String, required: true },
        },
        { _id: false },
      ),
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const MenuSchedule = model<IMenuSchedule>('MenuSchedule', menuScheduleSchema);
