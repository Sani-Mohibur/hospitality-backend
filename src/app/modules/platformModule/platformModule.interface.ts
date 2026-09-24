export const PRICING_MODEL = {
  FLAT: 'FLAT',
  PER_ROOM: 'PER_ROOM',
  PER_OUTLET: 'PER_OUTLET',
  PER_LOCATION: 'PER_LOCATION',
} as const;

export type TPricingModel = keyof typeof PRICING_MODEL;

export interface IPlatformModule {
  name: string;
  code: string; // e.g., 'RESTAURANT', 'HOSPITALITY'
  description?: string;
  isActive: boolean;
  isAddOn: boolean;
  pricingModel: TPricingModel;
  // Monthly price per unit in minor units (USD cents)
  unitPriceMinor: number;
  minimumMinor: number;
  // Price and plan minimum when sold together with HOSPITALITY (Hotel + F&B Suite)
  bundleUnitPriceMinor?: number;
  bundleMinimumMinor?: number;
  // Modules that must be enabled before this add-on can be enabled
  requires?: string[];
}
