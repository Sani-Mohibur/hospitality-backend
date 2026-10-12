import { Router } from 'express';
import { z } from 'zod';
import auth, { authorize, tenantUser } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION, USER_ROLE } from '../user/user.constant';
import { SubscriptionServices } from './subscription.service';
import { PaymentService } from '../payment/payment.service';
import { body } from '../../utils/zod';

const router = Router();

// ----- Tenant: own subscription and invoices -----
router.get(
  '/my-subscription',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE, PERMISSION.TENANT_SETTINGS),
  catchAsync(async (req, res) => ok(res, 'Subscription retrieved successfully', await SubscriptionServices.getSubscriptionByTenantId(req.user.tenantId!))),
);

// Price preview before enabling modules or adding rooms/outlets.
router.get(
  '/quote',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  catchAsync(async (req, res) => {
    const modules = String(req.query.modules || '').split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);
    ok(res, 'Price quote', await SubscriptionServices.previewQuote(req.user.tenantId!, modules));
  }),
);

router.patch(
  '/my-subscription/billing-cycle',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  validateRequest(body({ billingCycle: z.enum(['MONTHLY', 'YEARLY']) })),
  catchAsync(async (req, res) => ok(res, 'Billing cycle changed', await SubscriptionServices.changeBillingCycle(req.user.tenantId!, req.body.billingCycle))),
);

router.post(
  '/my-subscription/cancel',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  validateRequest(body({ cancel: z.boolean() })),
  catchAsync(async (req, res) => ok(res, req.body.cancel ? 'Subscription ends at period end' : 'Cancellation withdrawn', await SubscriptionServices.setCancelAtPeriodEnd(req.user.tenantId!, req.body.cancel))),
);

router.get(
  '/my-invoices',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  catchAsync(async (req, res) => ok(res, 'Invoices', await SubscriptionServices.listInvoices(req.user.tenantId!, req.query.status as string | undefined))),
);

router.post(
  '/my-invoices/:id/pay',
  tenantUser(),
  authorize(PERMISSION.BILLING_MANAGE),
  catchAsync(async (req, res) => ok(res, 'Complete the payment', await PaymentService.payPlatformInvoice(req.params.id as string))),
);

// ----- Super admin -----
router.get('/', auth(USER_ROLE.SUPER_ADMIN), catchAsync(async (req, res) => ok(res, 'Subscriptions retrieved successfully', await SubscriptionServices.getAllSubscriptionsFromDB(req.query))));

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN),
  catchAsync(async (req, res) => ok(res, 'Subscription updated successfully', await SubscriptionServices.updateSubscriptionInDB(req.params.id as string, req.body))),
);

router.patch(
  '/:id/status',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(body({ status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED']) })),
  catchAsync(async (req, res) => ok(res, 'Subscription status updated successfully', await SubscriptionServices.updateSubscriptionStatusInDB(req.params.id as string, req.body))),
);

router.patch(
  '/:id/apply-credit',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(body({ creditMinor: z.number().int().min(0).optional(), discountBps: z.number().int().min(0).max(10000).optional() })),
  catchAsync(async (req, res) => ok(res, 'Credits/Discounts applied successfully', await SubscriptionServices.applyCreditDiscountInDB(req.params.id as string, req.body))),
);

router.get('/invoices/all', auth(USER_ROLE.SUPER_ADMIN), catchAsync(async (req, res) => ok(res, 'Invoices', await SubscriptionServices.listInvoices(req.query.tenantId as string | undefined, req.query.status as string | undefined))));

router.post(
  '/invoices/:id/mark-paid',
  auth(USER_ROLE.SUPER_ADMIN),
  validateRequest(body({ paymentRef: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Invoice marked paid', await SubscriptionServices.markInvoicePaid(req.params.id as string, req.body.paymentRef))),
);

router.post('/invoices/:id/void', auth(USER_ROLE.SUPER_ADMIN), catchAsync(async (req, res) => ok(res, 'Invoice voided', await SubscriptionServices.voidInvoice(req.params.id as string))));

router.post('/run-billing', auth(USER_ROLE.SUPER_ADMIN), catchAsync(async (_req, res) => ok(res, 'Billing cycle run', await SubscriptionServices.runBillingCycle())));

export const SubscriptionRoutes = router;
