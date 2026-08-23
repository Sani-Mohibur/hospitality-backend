import { Document, Schema, model, Query } from 'mongoose';
import bcrypt from 'bcryptjs';
import config from '../../config';
import { IUser } from './user.interface';
import { USER_ROLE } from './user.constant';

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { 
      type: String, 
      required: true, 
      unique: true,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
    },
    password: { type: String, required: true, select: 0 },
    role: {
      type: String,
      enum: Object.values(USER_ROLE),
      default: USER_ROLE.STAFF, // updated default to staff instead of non-existent USER
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
    },
    profileImage: {
      url: { type: String },
      publicId: { type: String },
    },
    otp: { type: String, default: null, select: 0 },
    otpExpires: { type: Date, default: null, select: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

// Password Hashing Middleware
userSchema.pre('save', async function (this: IUser & Document) {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(
      this.password,
      Number(config.bcrypt_salt_rounds),
    );
  }
});

userSchema.pre('find', function (this: any, next: any) {
  this.find({ isDeleted: { $ne: true } });
  next();
});

userSchema.pre('findOne', function (this: any, next: any) {
  this.find({ isDeleted: { $ne: true } });
  next();
});

// Hide password in responses
userSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    delete ret.password;
    delete ret.otp;
    delete ret.otpExpires;
    delete ret.__v;
    return ret;
  },
});

export const User = model<IUser>('User', userSchema);
