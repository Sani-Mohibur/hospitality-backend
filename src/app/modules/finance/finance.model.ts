import { Schema, Types, model } from 'mongoose';
import { TAX_CATEGORY } from '../../utils/money';

// Tax rules apply to tax categories (ROOM, FOOD, ALCOHOL...). A rule without a
// locationId applies to every location of the tenant.
export interface ITaxRule {
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId;
  name: string;
  rateBps: number;
  categories: string[];
  isActive: boolean;
}

const taxRuleSchema = new Schema<ITaxRule>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    name: { type: String, required: true },
    rateBps: { type: Number, required: true, min: 0, max: 10000 },
    categories: [{ type: String, enum: Object.values(TAX_CATEGORY) }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const TaxRule = model<ITaxRule>('TaxRule', taxRuleSchema);

export const CHARGE_GROUP = {
  ROOM: 'ROOM',
  FOOD: 'FOOD',
  BEVERAGE: 'BEVERAGE',
  MINIBAR: 'MINIBAR',
  LAUNDRY: 'LAUNDRY',
  SPA: 'SPA',
  SERVICE_CHARGE: 'SERVICE_CHARGE',
  TIP: 'TIP',
  TAX: 'TAX',
  FEE: 'FEE',
  PAYMENT: 'PAYMENT',
  TRANSFER: 'TRANSFER',
  RETAIL: 'RETAIL',
  OTHER: 'OTHER',
} as const;

// What a folio line is for. Replaces the hard-coded charge category enum so every
// property can sell its own services, each mapped to a tax category and GL account.
export interface IChargeCode {
  tenantId: Types.ObjectId;
  code: string;
  name: string;
  group: keyof typeof CHARGE_GROUP;
  taxCategory: string;
  glCode?: string;
  defaultPriceMinor?: number;
  isSystem: boolean;
  isActive: boolean;
}

const chargeCodeSchema = new Schema<IChargeCode>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    group: { type: String, enum: Object.values(CHARGE_GROUP), required: true },
    taxCategory: { type: String, enum: Object.values(TAX_CATEGORY), default: TAX_CATEGORY.OTHER },
    glCode: { type: String },
    defaultPriceMinor: { type: Number, min: 0 },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

chargeCodeSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export const ChargeCode = model<IChargeCode>('ChargeCode', chargeCodeSchema);

// Codes the system posts to automatically; created per tenant on first use.
export const SYSTEM_CHARGE_CODES: Omit<IChargeCode, 'tenantId' | 'isActive'>[] = [
  { code: 'ROOM', name: 'Room charge', group: 'ROOM', taxCategory: 'ROOM', glCode: '4000', isSystem: true },
  { code: 'FOOD', name: 'Food', group: 'FOOD', taxCategory: 'FOOD', glCode: '4100', isSystem: true },
  { code: 'BEV', name: 'Beverage', group: 'BEVERAGE', taxCategory: 'BEVERAGE', glCode: '4200', isSystem: true },
  { code: 'ALC', name: 'Alcoholic beverage', group: 'BEVERAGE', taxCategory: 'ALCOHOL', glCode: '4210', isSystem: true },
  { code: 'BRKF', name: 'Breakfast (package)', group: 'FOOD', taxCategory: 'FOOD', glCode: '4110', isSystem: true },
  { code: 'MINI', name: 'Minibar', group: 'MINIBAR', taxCategory: 'MINIBAR', glCode: '4300', isSystem: true },
  { code: 'LNDRY', name: 'Laundry', group: 'LAUNDRY', taxCategory: 'LAUNDRY', glCode: '4400', isSystem: true },
  { code: 'SPA', name: 'Spa', group: 'SPA', taxCategory: 'SPA', glCode: '4500', isSystem: true },
  { code: 'SVC', name: 'Service charge', group: 'SERVICE_CHARGE', taxCategory: 'SERVICE', glCode: '4600', isSystem: true },
  { code: 'TIP', name: 'Gratuity', group: 'TIP', taxCategory: 'NONE', glCode: '2300', isSystem: true },
  { code: 'CXL', name: 'Cancellation / no-show fee', group: 'FEE', taxCategory: 'ROOM', glCode: '4050', isSystem: true },
  { code: 'MISC', name: 'Miscellaneous', group: 'OTHER', taxCategory: 'OTHER', glCode: '4900', isSystem: true },
  { code: 'RETAIL', name: 'Retail merchandise', group: 'RETAIL', taxCategory: 'RETAIL', glCode: '4700', isSystem: true },
  { code: 'PAY', name: 'Payment', group: 'PAYMENT', taxCategory: 'NONE', glCode: '1100', isSystem: true },
  { code: 'XFER', name: 'Transfer', group: 'TRANSFER', taxCategory: 'NONE', glCode: '1200', isSystem: true },
];
