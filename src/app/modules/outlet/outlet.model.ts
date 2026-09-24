import { Schema, Types, model } from 'mongoose';

export const OUTLET_TYPE = {
  RESTAURANT: 'RESTAURANT',
  BAR: 'BAR',
  CAFE: 'CAFE',
  ROOM_SERVICE: 'ROOM_SERVICE',
  POOL_BAR: 'POOL_BAR',
  OTHER: 'OTHER',
} as const;

export const STATION_TYPE = {
  KITCHEN: 'KITCHEN',
  GRILL: 'GRILL',
  COLD: 'COLD',
  PASTRY: 'PASTRY',
  BAR: 'BAR',
  EXPO: 'EXPO',
} as const;

// A point of sale inside a location (restaurant, bar, room service...).
export interface IOutlet {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  type: keyof typeof OUTLET_TYPE;
  serviceChargeBps: number;
  allowChargeToRoom: boolean;
  ticketTargetMinutes: number;
  defaultStationId?: Types.ObjectId;
  // Revenue accounts used by the accounting export
  glCodes?: { food?: string; beverage?: string; other?: string };
  isActive: boolean;
  isDeleted: boolean;
}

const outletSchema = new Schema<IOutlet>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: Object.values(OUTLET_TYPE), default: OUTLET_TYPE.RESTAURANT },
    serviceChargeBps: { type: Number, default: 0, min: 0 },
    allowChargeToRoom: { type: Boolean, default: true },
    ticketTargetMinutes: { type: Number, default: 15, min: 1 },
    defaultStationId: { type: Schema.Types.ObjectId, ref: 'Station' },
    glCodes: {
      food: { type: String },
      beverage: { type: String },
      other: { type: String },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

outletSchema.pre(['find', 'findOne', 'countDocuments'], function (this: any) {
  this.where({ isDeleted: { $ne: true } });
});

export const Outlet = model<IOutlet>('Outlet', outletSchema);

// A kitchen/bar screen that receives the items routed to it.
export interface IStation {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  outletId: Types.ObjectId;
  name: string;
  type: keyof typeof STATION_TYPE;
  targetMinutes: number;
  printerName?: string;
  isActive: boolean;
  isDeleted: boolean;
}

const stationSchema = new Schema<IStation>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: Object.values(STATION_TYPE), default: STATION_TYPE.KITCHEN },
    targetMinutes: { type: Number, default: 12, min: 1 },
    printerName: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

stationSchema.pre(['find', 'findOne', 'countDocuments'], function (this: any) {
  this.where({ isDeleted: { $ne: true } });
});

export const Station = model<IStation>('Station', stationSchema);
