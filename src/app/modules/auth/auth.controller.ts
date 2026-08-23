import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import { AuthServices } from './auth.service';
import config from '../../config';
import sendResponse from '../../utils/sendResponse';
import httpStatus from 'http-status';
import { userResponse } from '../../utils/userResponse';
import { fileUploader } from '../../utils/fileUploader';

const registerUser = catchAsync(async (req: Request, res: Response) => {
  if (req.file) {
    const uploadResult = await fileUploader.uploadToCloudinary(req.file);

    req.body.profileImage = {
      url: uploadResult.url,
      publicId: uploadResult.public_id,
    };
  }
  const result = await AuthServices.registerUser(req.body);
  const { refreshToken, accessToken, user } = result;

  // Set refresh token in cookie
  res.cookie('refreshToken', refreshToken, {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 90 * 24 * 60 * 60 * 1000,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User registered successfully',
    data: {
      accessToken,
      user: userResponse(user),
    },
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.loginUser(req.body);
  const { refreshToken, accessToken, user } = result;

  res.cookie('refreshToken', refreshToken, {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 90 * 24 * 60 * 60 * 1000,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User logged in successfully',
    data: {
      accessToken,
      user: userResponse(user),
    },
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.cookies;
  const result = await AuthServices.refreshToken(refreshToken);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Access token retrieved successfully',
    data: result,
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await AuthServices.forgotPassword(email);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'OTP sent to your email successfully!',
    data: result,
  });
});

const verifyOtp = catchAsync(async (req: Request, res: Response) => {
  const { email, otp } = req.body;
  const result = await AuthServices.verifyOtp(email, otp);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'OTP verified successfully!',
    data: result,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const { email, newPassword, resetToken } = req.body;
  const result = await AuthServices.resetPassword(email, newPassword, resetToken);
  const { refreshToken, accessToken } = result;

  res.cookie('refreshToken', refreshToken, {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 90 * 24 * 60 * 60 * 1000,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password reset successfully!',
    data: {
      accessToken,
    },
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const { id: userId } = req.user;
  const { oldPassword, newPassword } = req.body;

  const result = await AuthServices.changePassword(
    userId,
    oldPassword,
    newPassword,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password changed successfully!',
    data: result,
  });
});

const logoutUser = catchAsync(async (req: Request, res: Response) => {
  res.clearCookie('refreshToken', {
    secure: config.env === 'production',
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User logged out successfully!',
    data: null,
  });
});

export const AuthControllers = {
  registerUser,
  loginUser,
  refreshToken,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  logoutUser,
};
