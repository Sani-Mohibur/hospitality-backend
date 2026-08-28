import { Schema, model } from 'mongoose';
import { IGuest } from './guest.interface';

const guestSchema = new Schema<IGuest>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    idType: { type: String },
    idNumber: { type: String },
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

guestSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const Guest = model<IGuest>('Guest', guestSchema);
