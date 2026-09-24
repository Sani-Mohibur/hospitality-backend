import { Schema, model } from 'mongoose';
import { IMenuItem, IModifierGroup } from './menuItem.interface';
import { TAX_CATEGORY } from '../../../utils/money';

const modifierGroupSchema = new Schema<IModifierGroup>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    name: { type: String, required: true },
    minSelect: { type: Number, default: 0, min: 0 },
    maxSelect: { type: Number, default: 1, min: 1 },
    maxPerOption: { type: Number, default: 1, min: 1 },
    options: [
      new Schema({
        name: { type: String, required: true },
        priceMinor: { type: Number, default: 0 },
        isDefault: { type: Boolean, default: false },
        isAvailable: { type: Boolean, default: true },
      }),
    ],
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

modifierGroupSchema.pre(['find', 'findOne'], function (this: any) {
  this.where({ isDeleted: { $ne: true } });
});

export const ModifierGroup = model<IModifierGroup>('ModifierGroup', modifierGroupSchema);

const menuItemSchema = new Schema<IMenuItem>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    sku: { type: String },
    priceMinor: { type: Number, required: true, min: 0 },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'MenuCategory',
      required: true,
    },
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
    taxCategory: { type: String, enum: Object.values(TAX_CATEGORY), default: TAX_CATEGORY.FOOD },
    stationId: { type: Schema.Types.ObjectId, ref: 'Station' },
    defaultCourse: { type: Number, default: 1, min: 1 },
    modifierGroupIds: [{ type: Schema.Types.ObjectId, ref: 'ModifierGroup' }],
    imageUrl: { type: String },
    allergens: [{ type: String }],
    isSoldOut: { type: Boolean, default: false },
    availableQty: { type: Number, min: 0 },
    prepMinutes: { type: Number, min: 0 },
    locationOverrides: [
      new Schema(
        {
          locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
          priceMinor: { type: Number, min: 0 },
          isAvailable: { type: Boolean },
        },
        { _id: false },
      ),
    ],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

menuItemSchema.index({ tenantId: 1, locationId: 1, categoryId: 1 });

menuItemSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const MenuItem = model<IMenuItem>('MenuItem', menuItemSchema);
