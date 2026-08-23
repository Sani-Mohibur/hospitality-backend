import { Schema, model } from 'mongoose';
import { ITenant } from './tenant.interface';
import { FEATURE_MODULES } from '../user/user.constant';

const tenantSchema = new Schema<ITenant>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    modules: [
      {
        type: String,
        enum: Object.values(FEATURE_MODULES),
      },
    ],
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

tenantSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const Tenant = model<ITenant>('Tenant', tenantSchema);
