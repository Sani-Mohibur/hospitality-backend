import { Router } from 'express';
import { z } from 'zod';
import auth, { authorize, tenantUser } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { PERMISSION, USER_ROLE } from '../user/user.constant';
import { SubscriptionControllers } from './subscription.controller';
import { body } from '../../utils/zod';

const router = Router();

// ----- Tenant: own subscription and invoices -----
router.get(
  '/my-subscription',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE, PERMISSION.TENANT_SETTINGS),
  SubscriptionControllers.getMySubscription,
);

router.post(
  '/subscribe',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE, PERMISSION.TENANT_SETTINGS),
  validateRequest(
    body({
      packageId: z.enum(['hotel', 'restaurant', 'suite']).optional(),
      tierId: z.enum(['essentials', 'professional', 'enterprise']).optional(),
      billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
      modules: z.array(z.string()).min(1),
      planName: z.string().optional(),
      mockPaymentSuccess: z.boolean(),
      paymentRef: z.string().optional(),
    }),
  ),
  SubscriptionControllers.subscribeTenant,
);

// Price preview before enabling modules or adding rooms/outlets.
router.get(
  '/quote',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  SubscriptionControllers.previewQuote,
);

router.patch(
  '/my-subscription/billing-cycle',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  validateRequest(body({ billingCycle: z.enum(['MONTHLY', 'YEARLY']) })),
  SubscriptionControllers.changeBillingCycle,
);

router.post(
  '/my-subscription/cancel',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  validateRequest(body({ cancel: z.boolean() })),
  SubscriptionControllers.setCancelAtPeriodEnd,
);

router.get(
  '/my-invoices',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  SubscriptionControllers.listMyInvoices,
);

router.post(
  '/my-invoices/:id/pay',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  SubscriptionControllers.payPlatformInvoice,
);

// ----- Super admin -----
router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN),
  SubscriptionControllers.getAllSubscriptions,
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN),
  SubscriptionControllers.updateSubscription,
);

router.patch(
  '/:id/status',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(body({ status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED']) })),
  SubscriptionControllers.updateSubscriptionStatus,
);

router.patch(
  '/:id/apply-credit',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(
    body({
      creditMinor: z.number().int().min(0).optional(),
      discountBps: z.number().int().min(0).max(10000).optional(),
    }),
  ),
  SubscriptionControllers.applyCreditDiscount,
);

router.get(
  '/invoices/all',
  auth(USER_ROLE.SUPER_ADMIN),
  SubscriptionControllers.listAllInvoices,
);

router.post(
  '/invoices/:id/mark-paid',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(body({ paymentRef: z.string().optional() })),
  SubscriptionControllers.markInvoicePaid,
);

router.post(
  '/invoices/:id/void',
  auth(USER_ROLE.SUPER_ADMIN),
  SubscriptionControllers.voidInvoice,
);

router.post(
  '/run-billing',
  auth(USER_ROLE.SUPER_ADMIN),
  SubscriptionControllers.runBillingCycle,
);

export const SubscriptionRoutes = router;
