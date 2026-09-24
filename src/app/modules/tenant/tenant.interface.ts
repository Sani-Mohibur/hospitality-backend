import { Types } from 'mongoose';

export type TFeatureModule = string;

export const TENANT_STATUS = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  SUSPENDED: 'SUSPENDED',
  CANCELLED: 'CANCELLED',
} as const;

export type TTenantStatus = keyof typeof TENANT_STATUS;

export interface ITenantSettings {
  // Menu and room prices already include tax (common outside the US)
  taxInclusive: boolean;
  locale: string;
  defaultTimezone: string;
  // Manager approval thresholds for POS and folio adjustments
  approval: {
    discountOverBps: number;
    discountOverMinor: number;
    voidAfterFire: boolean;
    refunds: boolean;
    folioAdjustOverMinor: number;
    cashPayoutOverMinor: number;
  };
  // Charge-to-room allowed while the POS is offline, per guest, before sync
  offlineRoomChargeLimitMinor: number;
}

export interface ITenant {
  name: string;
  slug: string;
  modules: TFeatureModule[];
  status: TTenantStatus;
  trialEndsAt?: Date;
  currency: string;
  settings: ITenantSettings;
  branding?: {
    displayName?: string;
    logoUrl?: string;
    primaryColor?: string;
    customDomain?: string;
  };
  stripe?: {
    accountId?: string;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    platformFeeBps?: number;
  };
  loyalty?: {
    enabled: boolean;
    pointsPerMajorUnit: number;
    pointValueMinor: number;
  };
  featureFlags?: Map<string, boolean>;
  partnerId?: Types.ObjectId;
  subscriptionId?: Types.ObjectId;
  lastActivityAt?: Date;
  isActive: boolean;
  isDeleted: boolean;
}
