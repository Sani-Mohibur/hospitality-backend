import { Router } from 'express';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';
import validateRequest from '../../middlewares/validateRequest';
import { SubscriptionValidations } from './subscription.validation';
import { SubscriptionControllers } from './subscription.controller';

const router = Router();

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN),
  SubscriptionControllers.getAllSubscriptions
);

router.get(
  '/my-subscription',
  auth(USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  SubscriptionControllers.getMySubscription
);

router.patch(
  '/:id/status',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(SubscriptionValidations.updateSubscriptionStatusValidationSchema),
  SubscriptionControllers.updateSubscriptionStatus
);

router.patch(
  '/:id/apply-credit',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(SubscriptionValidations.applyCreditDiscountValidationSchema),
  SubscriptionControllers.applyCreditDiscount
);

export const SubscriptionRoutes = router;
