import { Schema, model } from 'mongoose';
import { ILocation } from './location.interface';

const locationSchema = new Schema<ILocation>(
  {
    name: {
      type: String,
      required: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    address: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

locationSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const Location = model<ILocation>('Location', locationSchema);
