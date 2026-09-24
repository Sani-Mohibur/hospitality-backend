import { Router } from 'express';
import { LocationControllers } from './location.controller';
import validateRequest from '../../middlewares/validateRequest';
import { LocationValidation } from './location.validation';
import { authorize, tenantUser } from '../../middlewares/auth';
import { PERMISSION } from '../user/user.constant';

const router = Router();

router.post(
  '/',
  tenantUser(),
  authorize(PERMISSION.LOCATIONS_MANAGE),
  validateRequest(LocationValidation.createLocationValidationSchema),
  LocationControllers.createLocation,
);

router.get('/', tenantUser(), LocationControllers.getAllLocations);

router.get('/:id', tenantUser(), LocationControllers.getLocationById);

router.patch(
  '/:id',
  tenantUser(),
  authorize(PERMISSION.LOCATIONS_MANAGE),
  validateRequest(LocationValidation.updateLocationValidationSchema),
  LocationControllers.updateLocation,
);

router.delete('/:id', tenantUser(), authorize(PERMISSION.LOCATIONS_MANAGE), LocationControllers.deleteLocation);

export const LocationRoutes = router;
