import express from 'express';
import { PaymentController } from './payment.controller';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';

const router = express.Router();

router.post(
  '/create-intent',
  auth(USER_ROLE.STAFF, USER_ROLE.TENANT_MANAGER, USER_ROLE.TENANT_OWNER),
  PaymentController.createPaymentIntent
);

router.post(
  '/:id/complete',
  auth(USER_ROLE.STAFF, USER_ROLE.TENANT_MANAGER, USER_ROLE.TENANT_OWNER),
  PaymentController.completePayment
);

export const PaymentRoutes = router;
