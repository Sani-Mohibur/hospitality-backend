import { Router } from 'express';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';
import validateRequest from '../../middlewares/validateRequest';
import { PlatformModuleValidations } from './platformModule.validation';
import { PlatformModuleControllers } from './platformModule.controller';

const router = Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(PlatformModuleValidations.createPlatformModuleValidationSchema),
  PlatformModuleControllers.createPlatformModule
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  PlatformModuleControllers.getAllPlatformModules
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(PlatformModuleValidations.updatePlatformModuleValidationSchema),
  PlatformModuleControllers.updatePlatformModule
);

export const PlatformModuleRoutes = router;
