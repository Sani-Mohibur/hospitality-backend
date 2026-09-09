import { Schema, model } from 'mongoose';
import { IFolioCharge, CHARGE_CATEGORY } from './folioCharge.interface';

const folioChargeSchema = new Schema<IFolioCharge>(
  {
    folioId: {
      type: Schema.Types.ObjectId,
      ref: 'Folio',
      required: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    chargeCategory: {
      type: String,
      enum: Object.values(CHARGE_CATEGORY),
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    transactionDate: {
      type: Date,
      default: Date.now,
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

folioChargeSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const FolioCharge = model<IFolioCharge>('FolioCharge', folioChargeSchema);
