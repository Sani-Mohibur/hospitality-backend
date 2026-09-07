import { Schema, model } from 'mongoose';
import { ITenant } from './tenant.interface';

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
      },
    ],
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
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

tenantSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const Tenant = model<ITenant>('Tenant', tenantSchema);
