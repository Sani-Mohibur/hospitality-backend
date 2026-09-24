import { Schema, Types, model } from 'mongoose';

export const DEVICE_TYPE = {
  POS: 'POS',
  KDS: 'KDS',
  FRONT_DESK: 'FRONT_DESK',
  HOUSEKEEPING: 'HOUSEKEEPING',
  BRIDGE: 'BRIDGE',
} as const;

// A paired shared terminal. Staff sign in on it with a PIN; offline order numbers
// use its `orderPrefix` so numbers from different devices never clash.
export interface IDevice {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  outletId?: Types.ObjectId;
  stationId?: Types.ObjectId;
  name: string;
  type: keyof typeof DEVICE_TYPE;
  orderPrefix: string;
  pairingCodeHash?: string;
  pairingExpiresAt?: Date;
  tokenHash?: string;
  pairedAt?: Date;
  lastSeenAt?: Date;
  lastSyncAt?: Date;
  appVersion?: string;
  isActive: boolean;
  revokedAt?: Date;
}

const deviceSchema = new Schema<IDevice>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet' },
    stationId: { type: Schema.Types.ObjectId, ref: 'Station' },
    name: { type: String, required: true },
    type: { type: String, enum: Object.values(DEVICE_TYPE), required: true },
    orderPrefix: { type: String, required: true },
    pairingCodeHash: { type: String, select: 0 },
    pairingExpiresAt: { type: Date },
    tokenHash: { type: String, select: 0, index: true, sparse: true },
    pairedAt: { type: Date },
    lastSeenAt: { type: Date },
    lastSyncAt: { type: Date },
    appVersion: { type: String },
    isActive: { type: Boolean, default: true },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

deviceSchema.index({ tenantId: 1, locationId: 1, orderPrefix: 1 }, { unique: true });

export const Device = model<IDevice>('Device', deviceSchema);
