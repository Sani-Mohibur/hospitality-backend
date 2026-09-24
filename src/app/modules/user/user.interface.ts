import { Types } from 'mongoose';
import { USER_ROLE } from './user.constant';

export type TUserRole = keyof typeof USER_ROLE;

export interface IUser {
  _id?: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  password?: string | undefined;
  role: TUserRole;
  tenantId?: Types.ObjectId;
  // Custom or system Role that grants STAFF permissions
  roleId?: Types.ObjectId;
  // Locations this user may work in; owners default to all locations
  locationIds: Types.ObjectId[];
  allLocations: boolean;
  profileImage?: {
    url: string;
    publicId: string;
  };
  pinHash?: string;
  otpHash?: string | undefined;
  otpExpires?: Date | undefined;
  otpAttempts?: number;
  failedLoginCount: number;
  lockedUntil?: Date;
  mfa?: {
    enabled: boolean;
    secretEnc?: string;
    pendingSecretEnc?: string;
    recoveryCodeHashes?: string[];
  };
  googleSub?: string;
  // Incremented to revoke every token the user holds
  tokenVersion: number;
  lastLoginAt?: Date;
  isActive: boolean;
  isDeleted?: boolean;
}
