import { Router } from 'express';
import { TenantControllers } from './tenant.controller';
import validateRequest from '../../middlewares/validateRequest';
import { TenantValidation } from './tenant.validation';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';

const router = Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(TenantValidation.createTenantValidationSchema),
  TenantControllers.createTenant,
);

router.get('/', auth(USER_ROLE.SUPER_ADMIN), TenantControllers.getAllTenants);

router.get('/:id', auth(USER_ROLE.SUPER_ADMIN), TenantControllers.getTenantById);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(TenantValidation.updateTenantValidationSchema),
  TenantControllers.updateTenant,
);

router.delete('/:id', auth(USER_ROLE.SUPER_ADMIN), TenantControllers.deleteTenant);

export const TenantRoutes = router;
