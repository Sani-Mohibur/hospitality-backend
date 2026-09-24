import { Schema, Types, model } from 'mongoose';

// One row per refresh token. Rotation replaces the row; reusing a replaced token
// revokes the whole family (stolen-token detection).
export interface ISession {
  userId: Types.ObjectId;
  familyId: string;
  refreshHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  replacedBy?: Types.ObjectId;
  userAgent?: string;
  ip?: string;
  deviceId?: Types.ObjectId;
  impersonatedBy?: Types.ObjectId;
  lastUsedAt?: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    refreshHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: Schema.Types.ObjectId, ref: 'Session' },
    userAgent: { type: String },
    ip: { type: String },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    impersonatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<ISession>('Session', sessionSchema);
