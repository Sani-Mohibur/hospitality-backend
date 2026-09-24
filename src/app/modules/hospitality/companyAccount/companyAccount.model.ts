import { Schema, Types, model } from 'mongoose';

// Corporate / travel agent account billed on credit (city ledger).
export interface ICompanyAccount {
  tenantId: Types.ObjectId;
  name: string;
  code?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  billingAddress?: string;
  taxId?: string;
  creditLimitMinor: number;
  paymentTermsDays: number;
  // Folio in each location that collects this company's charges
  folios: { locationId: Types.ObjectId; folioId: Types.ObjectId }[];
  notes?: string;
  isActive: boolean;
  isDeleted: boolean;
}

const companyAccountSchema = new Schema<ICompanyAccount>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, uppercase: true, trim: true },
    contactName: { type: String },
    email: { type: String, lowercase: true },
    phone: { type: String },
    billingAddress: { type: String },
    taxId: { type: String },
    creditLimitMinor: { type: Number, default: 0, min: 0 },
    paymentTermsDays: { type: Number, default: 30, min: 0 },
    folios: [
      new Schema(
        {
          locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
          folioId: { type: Schema.Types.ObjectId, ref: 'Folio', required: true },
        },
        { _id: false },
      ),
    ],
    notes: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

companyAccountSchema.pre(['find', 'findOne', 'countDocuments'], function (this: any) {
  this.where({ isDeleted: { $ne: true } });
});

export const CompanyAccount = model<ICompanyAccount>('CompanyAccount', companyAccountSchema);
