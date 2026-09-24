import { Schema, Types, model } from 'mongoose';

// One wallet per guest, shared by the hotel and every outlet.
export interface ILoyaltyAccount {
  tenantId: Types.ObjectId;
  guestId: Types.ObjectId;
  pointsBalance: number;
  lifetimePoints: number;
  tier: 'MEMBER' | 'SILVER' | 'GOLD';
}

const loyaltyAccountSchema = new Schema<ILoyaltyAccount>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    pointsBalance: { type: Number, default: 0, min: 0 },
    lifetimePoints: { type: Number, default: 0 },
    tier: { type: String, enum: ['MEMBER', 'SILVER', 'GOLD'], default: 'MEMBER' },
  },
  { timestamps: true },
);

loyaltyAccountSchema.index({ tenantId: 1, guestId: 1 }, { unique: true });

export const LoyaltyAccount = model<ILoyaltyAccount>('LoyaltyAccount', loyaltyAccountSchema);

export interface ILoyaltyTransaction {
  tenantId: Types.ObjectId;
  accountId: Types.ObjectId;
  type: 'EARN' | 'REDEEM' | 'ADJUST' | 'REVERSE';
  points: number;
  balanceAfter: number;
  source?: { kind: string; id: Types.ObjectId };
  note?: string;
  createdBy?: Types.ObjectId;
}

const loyaltyTransactionSchema = new Schema<ILoyaltyTransaction>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'LoyaltyAccount', required: true, index: true },
    type: { type: String, enum: ['EARN', 'REDEEM', 'ADJUST', 'REVERSE'], required: true },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    source: { kind: String, id: Schema.Types.ObjectId },
    note: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// A stay or an order earns points once.
loyaltyTransactionSchema.index(
  { tenantId: 1, type: 1, 'source.kind': 1, 'source.id': 1 },
  { unique: true, partialFilterExpression: { type: 'EARN' } },
);

export const LoyaltyTransaction = model<ILoyaltyTransaction>('LoyaltyTransaction', loyaltyTransactionSchema);
