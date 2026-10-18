import express from 'express';
import auth, { authorize, tenantUser } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { PERMISSION, USER_ROLE } from './user.constant';
import { UserControllers } from './user.controller';
import { UserValidation } from './user.validation';
import { fileUploader } from '../../utils/fileUploader';

const router = express.Router();

router.get('/me', tenantUser(), UserControllers.getProfile);
router.patch(
  '/update-profile',
  tenantUser(),
  fileUploader.upload.single('file'),
  UserControllers.updateProfile,
);
router.patch('/me/pin', tenantUser(), validateRequest(UserValidation.setPinValidationSchema), UserControllers.setMyPin);

router.get('/check-email', tenantUser(), UserControllers.checkEmail);

// Tenant staff management
router.get('/staff', tenantUser(), authorize(PERMISSION.STAFF_MANAGE), UserControllers.listStaff);
router.post(
  '/staff',
  tenantUser(),
  authorize(PERMISSION.STAFF_MANAGE),
  validateRequest(UserValidation.createStaffValidationSchema),
  UserControllers.createStaff,
);
router.get('/staff/:id', tenantUser(), authorize(PERMISSION.STAFF_MANAGE), UserControllers.getStaff);
router.patch(
  '/staff/:id',
  tenantUser(),
  authorize(PERMISSION.STAFF_MANAGE),
  validateRequest(UserValidation.updateStaffValidationSchema),
  UserControllers.updateStaff,
);
router.patch(
  '/staff/:id/pin',
  tenantUser(),
  authorize(PERMISSION.STAFF_MANAGE),
  validateRequest(UserValidation.setPinValidationSchema),
  UserControllers.setPin,
);
router.post('/staff/:id/invite', tenantUser(), authorize(PERMISSION.STAFF_MANAGE), UserControllers.resendInvite);
router.delete('/staff/:id', tenantUser(), authorize(PERMISSION.STAFF_MANAGE), UserControllers.removeStaff);

// Platform-wide user administration
router.get('/', auth(USER_ROLE.SUPER_ADMIN), UserControllers.getAllUsers);
router.get('/:id', auth(USER_ROLE.SUPER_ADMIN), UserControllers.getSingleUser);
router.delete('/:id', auth(USER_ROLE.SUPER_ADMIN), UserControllers.deleteUser);

export const UserRoutes = router;
