import { Schema, Types, model } from 'mongoose';

// A cashier's working session with a cash drawer. Cash payments require an open shift;
// closing it produces the Z report and the counted-vs-expected variance.
export interface IShift {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  outletId?: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId?: Types.ObjectId;
  drawerName?: string;
  businessDate: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: Date;
  openingFloatMinor: number;
  closedAt?: Date;
  closedBy?: Types.ObjectId;
  // Blind close: the cashier counts without seeing the expected amount
  countedCashMinor?: number;
  expectedCashMinor?: number;
  varianceMinor?: number;
  notes?: string;
  report?: Record<string, unknown>;
}

const shiftSchema = new Schema<IShift>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    drawerName: { type: String },
    businessDate: { type: String, required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    openedAt: { type: Date, default: Date.now },
    openingFloatMinor: { type: Number, default: 0, min: 0 },
    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    countedCashMinor: { type: Number },
    expectedCashMinor: { type: Number },
    varianceMinor: { type: Number },
    notes: { type: String },
    report: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// One open shift per user at a time.
shiftSchema.index({ tenantId: 1, userId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
shiftSchema.index({ tenantId: 1, locationId: 1, businessDate: 1 });

export const Shift = model<IShift>('Shift', shiftSchema);

export const CASH_MOVEMENT_TYPE = {
  OPENING_FLOAT: 'OPENING_FLOAT',
  SALE: 'SALE',
  REFUND: 'REFUND',
  DROP: 'DROP',
  PAYOUT: 'PAYOUT',
  PAID_IN: 'PAID_IN',
  TIP_OUT: 'TIP_OUT',
} as const;

// Signed: money into the drawer is positive, money out is negative.
export interface ICashMovement {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  shiftId: Types.ObjectId;
  type: keyof typeof CASH_MOVEMENT_TYPE;
  amountMinor: number;
  paymentId?: Types.ObjectId;
  reason?: string;
  createdBy?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  createdAt?: Date;
}

const cashMovementSchema = new Schema<ICashMovement>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', required: true, index: true },
    type: { type: String, enum: Object.values(CASH_MOVEMENT_TYPE), required: true },
    amountMinor: { type: Number, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
    reason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const CashMovement = model<ICashMovement>('CashMovement', cashMovementSchema);
