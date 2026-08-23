import { JwtPayload, Secret } from 'jsonwebtoken';
import config from '../../config';
import AppError from '../../errors/AppError';
import { jwtHelpers } from '../../helpers/jwtHelpers';
import { IUser } from '../user/user.interface';
import { User } from '../user/user.model';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { otpTemplate } from '../../utils/otpTemplate';
import { sendEmail } from '../../utils/sendEmail';

const registerUser = async (payload: Partial<IUser>) => {
  if (!payload.email) throw new AppError(400, 'Email is required');

  const isUserExists = await User.findOne({ email: payload.email });
  if (isUserExists) throw new AppError(400, 'User already exists');

  const newUser = await User.create(payload);

  const jwtPayload = {
    id: newUser._id,
    role: newUser.role,
    email: newUser.email,
  };

  const accessToken = jwtHelpers.createToken(
    jwtPayload,
    config.jwt.access_secret as Secret,
    config.jwt.access_expires_in as string | number,
  );

  const refreshToken = jwtHelpers.createToken(
    jwtPayload,
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string | number,
  );

  const { password, ...userWithoutPassword } = newUser.toObject();

  return {
    accessToken,
    refreshToken,
    user: userWithoutPassword,
  };
};

const loginUser = async (payload: Partial<IUser>) => {
  if (!payload.email) throw new AppError(400, 'Email is required');

  const user = await User.findOne({ email: payload.email }).select('+password');
  if (!user) throw new AppError(401, 'User not found');

  if (!payload.password) throw new AppError(400, 'Password is required');
  const isPasswordMatched = await bcrypt.compare(
    payload.password,
    user.password as string,
  );

  if (!isPasswordMatched) {
    throw new AppError(401, 'Password not matched');
  }

  const jwtPayload = {
    id: user._id,
    role: user.role,
    email: user.email,
  };

  const accessToken = jwtHelpers.createToken(
    jwtPayload,
    config.jwt.access_secret as Secret,
    config.jwt.access_expires_in as string | number,
  );

  const refreshToken = jwtHelpers.createToken(
    jwtPayload,
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string | number,
  );

  const { password, ...userWithoutPassword } = user.toObject();

  return {
    accessToken,
    refreshToken,
    user: userWithoutPassword,
  };
};

const refreshToken = async (token: string) => {
  if (!token) throw new AppError(400, 'Refresh token is required');

  const varifiedToken = jwtHelpers.verifyToken(
    token,
    config.jwt.refresh_secret as Secret,
  ) as JwtPayload;

  const user = await User.findById(varifiedToken.id);
  if (!user) throw new AppError(401, 'User not found');

  const jwtPayload = {
    id: user._id,
    role: user.role,
    email: user.email,
  };

  const accessToken = jwtHelpers.createToken(
    jwtPayload,
    config.jwt.access_secret as Secret,
    config.jwt.access_expires_in as string | number,
  );

  return {
    accessToken,
  };
};

const forgotPassword = async (email: string) => {
  const user = await User.findOne({ email });
  if (!user) throw new AppError(404, 'User not found');

  const otp = crypto.randomInt(100000, 999999).toString();

  user.otp = otp;
  user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);

  await user.save();

  const emailHtml = otpTemplate(otp);
  await sendEmail(user.email, emailHtml, 'Password Reset OTP');

  return {
    message: 'OTP sent to email successfully',
  };
};

const verifyOtp = async (email: string, otp: string) => {
  const user = await User.findOne({ email }).select('+otp +otpExpires');
  if (!user) throw new AppError(404, 'User not found');

  if (!user.otp || user.otp.length !== String(otp).length || !crypto.timingSafeEqual(Buffer.from(user.otp), Buffer.from(String(otp)))) {
    throw new AppError(400, 'Invalid OTP');
  }
  if (user.otpExpires && new Date() > user.otpExpires) {
    throw new AppError(400, 'OTP has expired');
  }

  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();

  const resetToken = jwtHelpers.createToken(
    { id: user._id, email: user.email },
    config.jwt.access_secret as Secret,
    '5m'
  );

  return { resetToken, message: 'OTP verified successfully' };
};

const resetPassword = async (email: string, newPassword: string, resetToken: string) => {
  if (!resetToken) throw new AppError(401, 'Reset token is required');
  try {
     jwtHelpers.verifyToken(resetToken, config.jwt.access_secret as Secret);
  } catch (error) {
     throw new AppError(401, 'Invalid or expired reset token');
  }
  const user = await User.findOne({ email }).select('+password');
  if (!user) throw new AppError(404, 'User not found');

  user.password = newPassword;
  await user.save();

  const jwtPayload = {
    id: user._id,
    role: user.role,
    email: user.email,
  };

  const accessToken = jwtHelpers.createToken(
    jwtPayload,
    config.jwt.access_secret as Secret,
    config.jwt.access_expires_in as string | number,
  );

  const refreshToken = jwtHelpers.createToken(
    jwtPayload,
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string | number,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const changePassword = async (
  userId: string,
  oldPassword: string,
  newPassword: string,
) => {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AppError(404, 'User not found');

  const isPasswordMatched = await bcrypt.compare(
    oldPassword,
    user.password as string,
  );

  if (!isPasswordMatched) throw new AppError(400, 'Password not matched');

  user.password = newPassword;
  await user.save();

  return {
    message: 'Password changed successfully',
  };
};

export const AuthServices = {
  registerUser,
  loginUser,
  refreshToken,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
};
