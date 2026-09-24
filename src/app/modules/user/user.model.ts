import { Document, Schema, model } from 'mongoose';
import bcrypt from 'bcryptjs';
import config from '../../config';
import { IUser } from './user.interface';
import { USER_ROLE } from './user.constant';

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
    },
    phone: { type: String },
    password: { type: String, select: 0 },
    role: {
      type: String,
      enum: Object.values(USER_ROLE),
      default: USER_ROLE.STAFF,
    },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role' },
    locationIds: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
    allLocations: { type: Boolean, default: false },
    profileImage: {
      url: { type: String },
      publicId: { type: String },
    },
    pinHash: { type: String, select: 0 },
    otpHash: { type: String, select: 0 },
    otpExpires: { type: Date, select: 0 },
    otpAttempts: { type: Number, default: 0, select: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    mfa: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String, select: 0 },
      pendingSecretEnc: { type: String, select: 0 },
      recoveryCodeHashes: { type: [String], select: 0 },
    },
    googleSub: { type: String },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

// Email is optional (PIN-only kitchen staff) but unique when present.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);

userSchema.pre('save', async function (this: IUser & Document) {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, Number(config.bcrypt_salt_rounds));
  }
});

// Mongoose 9 pre hooks take no `next` callback.
userSchema.pre(['find', 'findOne', 'countDocuments'], function (this: any) {
  this.where({ isDeleted: { $ne: true } });
});

userSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    delete ret.password;
    delete ret.pinHash;
    delete ret.otpHash;
    delete ret.otpExpires;
    delete ret.otpAttempts;
    if (ret.mfa) {
      delete ret.mfa.secretEnc;
      delete ret.mfa.pendingSecretEnc;
      delete ret.mfa.recoveryCodeHashes;
    }
    delete ret.__v;
    return ret;
  },
});

export const User = model<IUser>('User', userSchema);
