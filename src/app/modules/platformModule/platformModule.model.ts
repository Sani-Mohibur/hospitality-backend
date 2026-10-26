import { Schema, model } from 'mongoose';
import { IPlatformModule, PRICING_MODEL } from './platformModule.interface';

const platformModuleSchema = new Schema<IPlatformModule>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    description: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isAddOn: { type: Boolean, default: false },
    pricingModel: { type: String, enum: Object.values(PRICING_MODEL), default: PRICING_MODEL.FLAT },
    unitPriceMinor: { type: Number, default: 0, min: 0 },
    minimumMinor: { type: Number, default: 0, min: 0 },
    bundleUnitPriceMinor: { type: Number, min: 0 },
    bundleMinimumMinor: { type: Number, min: 0 },
    requires: [{ type: String, uppercase: true }],
  },
  {
    timestamps: true,
  }
);

export const PlatformModule = model<IPlatformModule>('PlatformModule', platformModuleSchema);

// Default catalog from the business plan (section 5.3), created on first boot.
export const DEFAULT_PLATFORM_MODULES: IPlatformModule[] = [
  {
    code: 'HOSPITALITY',
    name: 'Hotel',
    description: 'PMS, housekeeping, night audit, folios and reports',
    isActive: true,
    isAddOn: false,
    pricingModel: 'PER_ROOM',
    unitPriceMinor: 400,
    minimumMinor: 5900,
  },
  {
    code: 'RESTAURANT',
    name: 'Restaurant / F&B outlets',
    description: 'POS, KDS, menu, shifts. $29 per outlet when bundled with Hotel (Suite, minimum $99)',
    isActive: true,
    isAddOn: false,
    pricingModel: 'PER_OUTLET',
    unitPriceMinor: 4900,
    minimumMinor: 4900,
    bundleUnitPriceMinor: 2900,
    bundleMinimumMinor: 9900,
  },
  {
    code: 'RETAIL',
    name: 'Retail / Merchandise shop',
    description: 'Product catalogue, retail inventory, retail POS, barcodes, sales & returns',
    isActive: true,
    isAddOn: false,
    pricingModel: 'PER_LOCATION',
    unitPriceMinor: 3900,
    minimumMinor: 3900,
  },
  {
    code: 'DISTRIBUTION',
    name: 'Booking engine + channel manager',
    isActive: true,
    isAddOn: true,
    pricingModel: 'PER_LOCATION',
    unitPriceMinor: 3900,
    minimumMinor: 0,
    requires: ['HOSPITALITY'],
  },
  {
    code: 'INVENTORY',
    name: 'Recipe inventory',
    isActive: true,
    isAddOn: true,
    pricingModel: 'PER_LOCATION',
    unitPriceMinor: 2900,
    minimumMinor: 0,
  },
  {
    code: 'AI_ASSISTANT',
    name: 'AI ops assistant',
    isActive: true,
    isAddOn: true,
    pricingModel: 'PER_LOCATION',
    unitPriceMinor: 1900,
    minimumMinor: 0,
  },
];
