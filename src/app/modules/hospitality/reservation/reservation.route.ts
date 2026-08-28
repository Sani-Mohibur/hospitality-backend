import { Router } from 'express';
import { ReservationControllers } from './reservation.controller';
import validateRequest from '../../../middlewares/validateRequest';
import { ReservationValidation } from './reservation.validation';
import auth from '../../../middlewares/auth';
import { USER_ROLE } from '../../user/user.constant';

const router = Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  validateRequest(ReservationValidation.createReservationValidationSchema),
  ReservationControllers.createReservation,
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  ReservationControllers.getAllReservations
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  ReservationControllers.getReservationById
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  validateRequest(ReservationValidation.updateReservationValidationSchema),
  ReservationControllers.updateReservation,
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  ReservationControllers.deleteReservation
);

export const ReservationRoutes = router;
