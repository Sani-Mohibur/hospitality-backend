import express from 'express';
import { z } from 'zod';
import { AuthControllers } from './auth.controller';
import auth, { tenantUser } from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';
import rateLimit from 'express-rate-limit';
import validateRequest from '../../middlewares/validateRequest';
import config from '../../config';

// Automated tests sign up many tenants; limits apply everywhere else.
const skipInTests = () => config.env === 'test';

const router = express.Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: skipInTests,
  message: 'Too many attempts, please try again later.',
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: skipInTests,
  message: 'Too many login attempts, please try again later.',
});

const password = z.string().min(8, 'Password must be at least 8 characters');

// Public self-serve signup creates a tenant with its owner. The old /register let
// anyone choose any role, including SUPER_ADMIN; staff are now created by owners.
router.post(
  '/signup',
  authRateLimiter,
  validateRequest(
    z.object({
      body: z.object({
        businessName: z.string().min(2),
        ownerName: z.string().min(1),
        email: z.string().email(),
        password,
        phone: z.string().optional(),
        currency: z.string().length(3).optional(),
        timezone: z.string().optional(),
        locationName: z.string().optional(),
        address: z.string().optional(),
        modules: z.array(z.enum(['HOSPITALITY', 'RESTAURANT', 'INVENTORY', 'DISTRIBUTION', 'AI_ASSISTANT'])).optional(),
      }),
    }),
  ),
  AuthControllers.signup,
);

router.post(
  '/login',
  loginRateLimiter,
  validateRequest(z.object({ body: z.object({ email: z.string().email(), password: z.string().min(1) }) })),
  AuthControllers.loginUser,
);
router.post(
  '/mfa/verify',
  loginRateLimiter,
  validateRequest(z.object({ body: z.object({ mfaToken: z.string(), code: z.string().min(6) }) })),
  AuthControllers.verifyMfa,
);
router.post('/mfa/setup', tenantUser(), AuthControllers.setupMfa);
router.post(
  '/mfa/enable',
  tenantUser(),
  validateRequest(z.object({ body: z.object({ code: z.string().length(6) }) })),
  AuthControllers.enableMfa,
);
router.post(
  '/mfa/disable',
  tenantUser(),
  validateRequest(z.object({ body: z.object({ password: z.string(), code: z.string().length(6) }) })),
  AuthControllers.disableMfa,
);

router.post('/refresh-token', AuthControllers.refreshToken);
router.post('/logout', AuthControllers.logoutUser);
router.get('/sessions', tenantUser(), AuthControllers.listSessions);
router.delete('/sessions/:id', tenantUser(), AuthControllers.revokeSession);
router.post('/logout-all', tenantUser(), AuthControllers.logoutAll);

router.post('/forgot-password', authRateLimiter, AuthControllers.forgotPassword);
router.post('/verify-otp', authRateLimiter, AuthControllers.verifyOtp);
router.post(
  '/reset-password',
  authRateLimiter,
  validateRequest(z.object({ body: z.object({ email: z.string().email(), newPassword: password, resetToken: z.string() }) })),
  AuthControllers.resetPassword,
);
router.post(
  '/change-password',
  tenantUser(),
  validateRequest(z.object({ body: z.object({ oldPassword: z.string(), newPassword: password }) })),
  AuthControllers.changePassword,
);

// Shared devices (X-Device-Token header from pairing)
router.get('/device/staff', AuthControllers.deviceStaff);
router.post(
  '/pin-login',
  loginRateLimiter,
  validateRequest(z.object({ body: z.object({ userId: z.string(), pin: z.string().regex(/^\d{4,6}$/) }) })),
  AuthControllers.pinLogin,
);

router.post(
  '/google',
  loginRateLimiter,
  validateRequest(z.object({ body: z.object({ idToken: z.string().min(10) }) })),
  AuthControllers.googleLogin,
);

router.post(
  '/impersonate',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(z.object({ body: z.object({ tenantId: z.string(), reason: z.string().min(5) }) })),
  AuthControllers.impersonateTenant
);

export const AuthRoutes = router;
