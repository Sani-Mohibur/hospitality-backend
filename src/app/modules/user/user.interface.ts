import { Types } from 'mongoose';
import { USER_ROLE } from './user.constant';

export type TUserRole = keyof typeof USER_ROLE;

export interface IUser {
  name: string;
  email: string;
  password?: string | undefined;
  role: TUserRole;
  tenantId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  profileImage?: {
    url: string;
    publicId: string;
  };
  otp?: string | undefined;
  otpExpires?: Date | undefined;
  isDeleted?: boolean;
}
