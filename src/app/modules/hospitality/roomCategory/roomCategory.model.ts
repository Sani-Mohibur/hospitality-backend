import { Schema, model } from 'mongoose';
import { IRoomCategory } from './roomCategory.interface';

const roomCategorySchema = new Schema<IRoomCategory>(
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
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    baseRateMinor: { type: Number, required: true, min: 0 },
    baseOccupancy: { type: Number, default: 2, min: 1 },
    capacity: { type: Number, required: true, min: 1 },
    maxAdults: { type: Number, default: 2, min: 1 },
    maxChildren: { type: Number, default: 0, min: 0 },
    extraAdultMinor: { type: Number, default: 0, min: 0 },
    extraChildMinor: { type: Number, default: 0, min: 0 },
    amenities: [{ type: String }],
    images: [{ type: String }],
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

roomCategorySchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const RoomCategory = model<IRoomCategory>('RoomCategory', roomCategorySchema);
