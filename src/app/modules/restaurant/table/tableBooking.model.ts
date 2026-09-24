import { Schema, Types, model } from 'mongoose';

export const TABLE_BOOKING_STATUS = {
  BOOKED: 'BOOKED',
  CONFIRMED: 'CONFIRMED',
  SEATED: 'SEATED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;

export interface ITableBooking {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  outletId: Types.ObjectId;
  guestId?: Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  partySize: number;
  startAt: Date;
  durationMinutes: number;
  tableIds: Types.ObjectId[];
  status: keyof typeof TABLE_BOOKING_STATUS;
  source: 'PHONE' | 'WALK_IN' | 'ONLINE' | 'IN_HOUSE';
  notes?: string;
  orderId?: Types.ObjectId;
  reminderSentAt?: Date;
  createdBy?: Types.ObjectId;
}

const tableBookingSchema = new Schema<ITableBooking>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet', required: true },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest' },
    name: { type: String, required: true },
    phone: { type: String },
    email: { type: String },
    partySize: { type: Number, required: true, min: 1 },
    startAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 90, min: 15 },
    tableIds: [{ type: Schema.Types.ObjectId, ref: 'Table' }],
    status: { type: String, enum: Object.values(TABLE_BOOKING_STATUS), default: TABLE_BOOKING_STATUS.BOOKED },
    source: { type: String, enum: ['PHONE', 'WALK_IN', 'ONLINE', 'IN_HOUSE'], default: 'PHONE' },
    notes: { type: String },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    reminderSentAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

tableBookingSchema.index({ tenantId: 1, outletId: 1, startAt: 1 });

export const TableBooking = model<ITableBooking>('TableBooking', tableBookingSchema);

export interface IWaitlistEntry {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  outletId: Types.ObjectId;
  name: string;
  phone?: string;
  partySize: number;
  quotedMinutes: number;
  status: 'WAITING' | 'NOTIFIED' | 'SEATED' | 'LEFT';
  notifiedAt?: Date;
  seatedAt?: Date;
  tableId?: Types.ObjectId;
  notes?: string;
  createdAt?: Date;
}

const waitlistSchema = new Schema<IWaitlistEntry>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet', required: true },
    name: { type: String, required: true },
    phone: { type: String },
    partySize: { type: Number, required: true, min: 1 },
    quotedMinutes: { type: Number, default: 15 },
    status: { type: String, enum: ['WAITING', 'NOTIFIED', 'SEATED', 'LEFT'], default: 'WAITING' },
    notifiedAt: { type: Date },
    seatedAt: { type: Date },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table' },
    notes: { type: String },
  },
  { timestamps: true },
);

export const WaitlistEntry = model<IWaitlistEntry>('WaitlistEntry', waitlistSchema);
