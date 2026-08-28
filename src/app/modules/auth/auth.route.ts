import express from 'express';
import { AuthControllers } from './auth.controller';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';
import { fileUploader } from '../../utils/fileUploader';
import rateLimit from 'express-rate-limit';
import validateRequest from '../../middlewares/validateRequest';
import { UserValidation } from '../user/user.validation';

const router = express.Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many attempts, please try again later.',
});

router.post(
  '/register',
  fileUploader.upload.single('file'),
  validateRequest(UserValidation.createUserValidationSchema),
  AuthControllers.registerUser,
);
router.post('/login', AuthControllers.loginUser);
router.post('/refresh-token', AuthControllers.refreshToken);
router.post('/logout', AuthControllers.logoutUser);
router.post('/forgot-password', authRateLimiter, AuthControllers.forgotPassword);
router.post('/verify-otp', authRateLimiter, AuthControllers.verifyOtp);
router.post('/reset-password', AuthControllers.resetPassword);
router.post(
  '/change-password',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  AuthControllers.changePassword,
);

export const AuthRoutes = router;
