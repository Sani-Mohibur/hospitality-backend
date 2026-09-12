import { Schema, model } from 'mongoose';
import { IInventoryItem } from './inventory.interface';

const inventoryItemSchema = new Schema<IInventoryItem>(
  {
    name: { type: String, required: true },
    sku: { type: String },
    category: { type: String },
    unitOfMeasure: { type: String, required: true },
    quantity: { type: Number, required: true, default: 0 },
    unitCost: { type: Number, required: true, default: 0 },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

inventoryItemSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const InventoryItem = model<IInventoryItem>('InventoryItem', inventoryItemSchema);
