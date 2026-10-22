import { Router } from 'express';
import { LocationControllers } from './location.controller';
import validateRequest from '../../middlewares/validateRequest';
import { LocationValidation } from './location.validation';
import auth, { tenantUser } from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';

const router = Router();

// Only TENANT_OWNER (and platform SUPER_ADMIN) can create, update, and delete locations
router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER),
  validateRequest(LocationValidation.createLocationValidationSchema),
  LocationControllers.createLocation,
);

router.get('/', tenantUser(), LocationControllers.getAllLocations);

router.get('/:id', tenantUser(), LocationControllers.getLocationById);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER),
  validateRequest(LocationValidation.updateLocationValidationSchema),
  LocationControllers.updateLocation,
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER),
  LocationControllers.deleteLocation,
);

export const LocationRoutes = router;
