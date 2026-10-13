import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import { AuthServices } from './auth.service';
import config from '../../config';
import sendResponse from '../../utils/sendResponse';
import httpStatus from 'http-status';

const REFRESH_COOKIE = 'refreshToken';

const isProduction = config.env === 'production' || process.env.NODE_ENV === 'production';

const clientMeta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

const setRefreshCookie = (res: Response, token?: string) => {
  if (!token) return;
  res.cookie(REFRESH_COOKIE, token, {
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

// Refresh tokens live only in the httpOnly cookie, never in the JSON body.
const withoutRefresh = <T extends { refreshToken?: string }>(result: T) => {
  const { refreshToken: _refreshToken, ...rest } = result;
  return rest;
};

const signup = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.signup(req.body, clientMeta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Account created. Your trial has started.',
    data: withoutRefresh(result),
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const result: any = await AuthServices.loginUser(req.body, clientMeta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.mfaRequired ? 'Enter your authentication code' : 'User logged in successfully',
    data: withoutRefresh(result),
  });
});

const verifyMfa = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.verifyMfaLogin(req.body, clientMeta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'User logged in successfully', data: withoutRefresh(result) });
});

const setupMfa = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.setupMfa(req.user.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Scan the code with your authenticator app', data: result });
});

const enableMfa = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.enableMfa(req.user.id, req.body.code);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'MFA enabled. Store the recovery codes safely.', data: result });
});

const disableMfa = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.disableMfa(req.user.id, req.body.password, req.body.code);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'MFA disabled', data: result });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.refreshToken(req.cookies[REFRESH_COOKIE], clientMeta(req));
  setRefreshCookie(res, result.refreshToken);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Access token retrieved successfully',
    data: { accessToken: result.accessToken },
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const { email } = req.body;
  const result = await AuthServices.forgotPassword(email);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: null,
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
  setRefreshCookie(res, result.refreshToken);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password reset successfully!',
    data: {
      accessToken: result.accessToken,
    },
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;

  const result = await AuthServices.changePassword(req.user.id, oldPassword, newPassword, req.user.sessionId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password changed successfully!',
    data: result,
  });
});

const logoutUser = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.logout(req.cookies[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, {
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/v1/auth',
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User logged out successfully!',
    data: null,
  });
});

const listSessions = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.listSessions(req.user.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Active sessions', data: result });
});

const revokeSession = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.revokeSession(req.params.id as string, req.user.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Session revoked', data: null });
});

const logoutAll = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.revokeAllSessions(req.user.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Signed out on all devices', data: null });
});

const deviceStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.deviceStaff(req.headers['x-device-token'] as string | undefined);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Staff for this device', data: result });
});

const pinLogin = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.pinLogin(req.headers['x-device-token'] as string | undefined, req.body, clientMeta(req));
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Signed in', data: result });
});

const googleLogin = catchAsync(async (req: Request, res: Response) => {
  const result: any = await AuthServices.googleLogin(req.body.idToken, clientMeta(req));
  setRefreshCookie(res, result.refreshToken);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Signed in with Google', data: withoutRefresh(result) });
});

const impersonateTenant = catchAsync(async (req: Request, res: Response) => {
  const { tenantId, reason } = req.body;
  const result = await AuthServices.impersonateTenant(req.user.id, tenantId, reason, clientMeta(req));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Impersonated tenant successfully',
    data: result,
  });
});

export const AuthControllers = {
  signup,
  loginUser,
  verifyMfa,
  setupMfa,
  enableMfa,
  disableMfa,
  refreshToken,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  logoutUser,
  listSessions,
  revokeSession,
  logoutAll,
  deviceStaff,
  pinLogin,
  googleLogin,
  impersonateTenant,
};
