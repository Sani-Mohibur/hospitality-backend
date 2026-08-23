import { Router } from 'express';
import { LocationControllers } from './location.controller';
import validateRequest from '../../middlewares/validateRequest';
import { LocationValidation } from './location.validation';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';

const router = Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(LocationValidation.createLocationValidationSchema),
  LocationControllers.createLocation,
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  LocationControllers.getAllLocations
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  LocationControllers.getLocationById
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(LocationValidation.updateLocationValidationSchema),
  LocationControllers.updateLocation,
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  LocationControllers.deleteLocation
);

export const LocationRoutes = router;
