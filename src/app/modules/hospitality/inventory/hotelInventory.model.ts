import { Schema, Types, model } from 'mongoose';

// One row per assigned room per night. The unique index on (roomId, date) makes a
// double booking of a physical room impossible, even under concurrent requests.
export interface IRoomNight {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  roomId: Types.ObjectId;
  roomStayId: Types.ObjectId;
  date: string;
}

const roomNightSchema = new Schema<IRoomNight>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    roomStayId: { type: Schema.Types.ObjectId, ref: 'RoomStay', required: true },
    date: { type: String, required: true },
  },
  { versionKey: false },
);

roomNightSchema.index({ roomId: 1, date: 1 }, { unique: true });
roomNightSchema.index({ roomStayId: 1 });

export const RoomNight = model<IRoomNight>('RoomNight', roomNightSchema);

// Sold and held counts per room type per night. Bookings take a unit with a
// conditional increment (sold + held < capacity), so a room type cannot be oversold
// even when no specific room has been assigned yet.
export interface ITypeNight {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  date: string;
  sold: number;
  held: number;
}

const typeNightSchema = new Schema<ITypeNight>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomCategory', required: true },
    date: { type: String, required: true },
    sold: { type: Number, default: 0, min: 0 },
    held: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false },
);

typeNightSchema.index({ roomTypeId: 1, date: 1 }, { unique: true });
typeNightSchema.index({ locationId: 1, date: 1 });

export const TypeNight = model<ITypeNight>('TypeNight', typeNightSchema);

// Rooms held for a company or group, released automatically `releaseDays` before arrival.
export interface IAllotment {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  companyAccountId?: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  ratePlanId?: Types.ObjectId;
  from: string;
  to: string;
  releaseDays: number;
  nights: { date: string; allotted: number; picked: number; released: boolean }[];
  status: 'ACTIVE' | 'RELEASED' | 'CANCELLED';
}

const allotmentSchema = new Schema<IAllotment>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    name: { type: String, required: true },
    companyAccountId: { type: Schema.Types.ObjectId, ref: 'CompanyAccount' },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomCategory', required: true },
    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan' },
    from: { type: String, required: true },
    to: { type: String, required: true },
    releaseDays: { type: Number, default: 7, min: 0 },
    nights: [
      new Schema(
        {
          date: { type: String, required: true },
          allotted: { type: Number, required: true, min: 0 },
          picked: { type: Number, default: 0, min: 0 },
          released: { type: Boolean, default: false },
        },
        { _id: false },
      ),
    ],
    status: { type: String, enum: ['ACTIVE', 'RELEASED', 'CANCELLED'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

export const Allotment = model<IAllotment>('Allotment', allotmentSchema);
