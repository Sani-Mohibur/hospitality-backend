import { Schema, Types, model } from 'mongoose';

export const MEAL_PLAN = { RO: 'RO', BB: 'BB', HB: 'HB', FB: 'FB', AI: 'AI' } as const;
export const PENALTY_TYPE = { NONE: 'NONE', NIGHTS: 'NIGHTS', PERCENT: 'PERCENT', FIXED: 'FIXED' } as const;

type TPenalty = { type: keyof typeof PENALTY_TYPE; value: number };

export interface IRatePlanPackage {
  // Charge code the component's revenue is posted to (e.g. BRKF for breakfast)
  chargeCode: string;
  label: string;
  amountMinor: number;
  per: 'PERSON' | 'ROOM';
}

export interface IRatePlan {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  code: string;
  description?: string;
  roomTypeIds: Types.ObjectId[];
  mealPlan: keyof typeof MEAL_PLAN;
  // BASE plans carry their own prices; DERIVED plans follow a parent (e.g. -10% non-refundable)
  pricingMode: 'BASE' | 'DERIVED';
  parentRatePlanId?: Types.ObjectId;
  adjustBps?: number;
  adjustMinor?: number;
  rates: { roomTypeId: Types.ObjectId; amountMinor: number }[];
  weekendRates: { roomTypeId: Types.ObjectId; amountMinor: number }[];
  weekendDays: number[];
  packages: IRatePlanPackage[];
  cancellation: { freeUntilHours: number; penalty: TPenalty };
  noShow: { penalty: TPenalty };
  deposit: { type: 'NONE' | 'PERCENT' | 'NIGHTS' | 'FIXED'; value: number; dueDaysBeforeArrival: number };
  guaranteeRequired: boolean;
  isRefundable: boolean;
  minLos: number;
  maxLos?: number;
  // Offered on the public booking engine / channel manager
  isPublic: boolean;
  channelCode?: string;
  isActive: boolean;
  isDeleted: boolean;
}

const penaltySchema = new Schema(
  {
    type: { type: String, enum: Object.values(PENALTY_TYPE), default: PENALTY_TYPE.NONE },
    value: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const priceRowSchema = new Schema(
  {
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomCategory', required: true },
    amountMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ratePlanSchema = new Schema<IRatePlan>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    name: { type: String, required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String },
    roomTypeIds: [{ type: Schema.Types.ObjectId, ref: 'RoomCategory' }],
    mealPlan: { type: String, enum: Object.values(MEAL_PLAN), default: MEAL_PLAN.RO },
    pricingMode: { type: String, enum: ['BASE', 'DERIVED'], default: 'BASE' },
    parentRatePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan' },
    adjustBps: { type: Number, default: 0 },
    adjustMinor: { type: Number, default: 0 },
    rates: [priceRowSchema],
    weekendRates: [priceRowSchema],
    weekendDays: { type: [Number], default: [5, 6] },
    packages: [
      new Schema(
        {
          chargeCode: { type: String, required: true, uppercase: true },
          label: { type: String, required: true },
          amountMinor: { type: Number, required: true, min: 0 },
          per: { type: String, enum: ['PERSON', 'ROOM'], default: 'PERSON' },
        },
        { _id: false },
      ),
    ],
    cancellation: {
      freeUntilHours: { type: Number, default: 24, min: 0 },
      penalty: { type: penaltySchema, default: () => ({ type: 'NIGHTS', value: 1 }) },
    },
    noShow: {
      penalty: { type: penaltySchema, default: () => ({ type: 'NIGHTS', value: 1 }) },
    },
    deposit: {
      type: { type: String, enum: ['NONE', 'PERCENT', 'NIGHTS', 'FIXED'], default: 'NONE' },
      value: { type: Number, default: 0, min: 0 },
      dueDaysBeforeArrival: { type: Number, default: 0, min: 0 },
    },
    guaranteeRequired: { type: Boolean, default: false },
    isRefundable: { type: Boolean, default: true },
    minLos: { type: Number, default: 1, min: 1 },
    maxLos: { type: Number },
    isPublic: { type: Boolean, default: true },
    channelCode: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ratePlanSchema.index(
  { tenantId: 1, locationId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

ratePlanSchema.pre(['find', 'findOne', 'countDocuments'], function (this: any) {
  this.where({ isDeleted: { $ne: true } });
});

export const RatePlan = model<IRatePlan>('RatePlan', ratePlanSchema);

// Per-date override for one rate plan and room type (price, closures, min stay).
export interface IDailyRate {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  ratePlanId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  date: string;
  amountMinor?: number;
  closed: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minLos?: number;
}

const dailyRateSchema = new Schema<IDailyRate>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomCategory', required: true },
    date: { type: String, required: true },
    amountMinor: { type: Number, min: 0 },
    closed: { type: Boolean, default: false },
    closedToArrival: { type: Boolean, default: false },
    closedToDeparture: { type: Boolean, default: false },
    minLos: { type: Number, min: 1 },
  },
  { timestamps: true },
);

dailyRateSchema.index({ ratePlanId: 1, roomTypeId: 1, date: 1 }, { unique: true });

export const DailyRate = model<IDailyRate>('DailyRate', dailyRateSchema);
