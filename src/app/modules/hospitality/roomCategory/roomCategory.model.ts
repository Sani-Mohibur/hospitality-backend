import { Schema, model } from 'mongoose';
import { IRoomCategory } from './roomCategory.interface';

const roomCategorySchema = new Schema<IRoomCategory>(
  {
    name: { type: String, required: true },
    description: { type: String },
    basePrice: { type: Number, required: true },
    capacity: { type: Number, required: true },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

roomCategorySchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const RoomCategory = model<IRoomCategory>('RoomCategory', roomCategorySchema);
