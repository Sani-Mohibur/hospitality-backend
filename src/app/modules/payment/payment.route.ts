import express from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope, { locationFilter } from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import idempotency from '../../middlewares/idempotency';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { PaymentService } from './payment.service';
import { Payment } from './payment.model';
import { PAYMENT_METHOD } from './payment.interface';
import { found } from '../../utils/query';
import { body, objectId, positiveMinor } from '../../utils/zod';

const router = express.Router();
const P = PERMISSION;

export const takePaymentBody = {
  target: z.object({ kind: z.enum(['ORDER', 'FOLIO']), id: objectId, checkNo: z.number().int().min(1).optional() }),
  method: z.enum(Object.values(PAYMENT_METHOD) as [string, ...string[]]),
  amountMinor: positiveMinor,
  tipMinor: positiveMinor.optional(),
  tenderedMinor: positiveMinor.optional(),
  reference: z.string().optional(),
  note: z.string().optional(),
  clientRef: z.string().max(64).optional(),
  offline: z.boolean().optional(),
  roomCharge: z
    .object({ roomNumber: z.string().optional(), roomStayId: objectId.optional(), guestLastName: z.string().optional(), signatureUrl: z.string().optional() })
    .optional(),
  companyAccountId: objectId.optional(),
  guestId: objectId.optional(),
};

router.use(tenantUser());

router.post(
  '/',
  authorize(P.POS_PAY, P.FOLIO_PAYMENT),
  locationScope(),
  idempotency(),
  validateRequest(body(takePaymentBody)),
  catchAsync(async (req, res) => {
    const needed = req.body.target.kind === 'FOLIO' ? P.FOLIO_PAYMENT : P.POS_PAY;
    if (!req.user.permissions.includes(needed)) {
      return ok(res, `Missing permission: ${needed}`, null, { statusCode: httpStatus.FORBIDDEN });
    }
    ok(res, 'Payment recorded', await PaymentService.takePayment(req, req.body), { statusCode: httpStatus.CREATED });
  }),
);

router.get(
  '/',
  authorize(P.REPORTS_VIEW, P.CASH_MANAGE, P.FOLIO_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const result = await PaymentService.listPayments(locationFilter(req), req.query);
    ok(res, 'Payments', result.data, { meta: result.meta });
  }),
);

// Stripe Connect onboarding for the tenant (money goes to the tenant, not the platform)
router.post(
  '/connect/onboarding',
  authorize(P.BILLING_MANAGE),
  validateRequest(body({ returnUrl: z.string().url(), refreshUrl: z.string().url() })),
  catchAsync(async (req, res) => ok(res, 'Continue onboarding on Stripe', await PaymentService.connectOnboarding(req.body.returnUrl, req.body.refreshUrl))),
);

router.get(
  '/connect/status',
  authorize(P.BILLING_MANAGE, P.TENANT_SETTINGS),
  catchAsync(async (_req, res) => ok(res, 'Stripe account status', await PaymentService.connectStatus())),
);

router.post(
  '/terminal/connection-token',
  authorize(P.POS_PAY, P.FOLIO_PAYMENT),
  catchAsync(async (_req, res) => ok(res, 'Terminal connection token', await PaymentService.terminalConnectionToken())),
);

router.get(
  '/:id',
  authorize(P.POS_PAY, P.FOLIO_VIEW, P.REPORTS_VIEW),
  catchAsync(async (req, res) => ok(res, 'Payment', found(await Payment.findById(req.params.id).lean(), 'Payment'))),
);

router.post(
  '/:id/refund',
  authorize(P.POS_REFUND, P.FOLIO_ADJUST),
  idempotency(),
  validateRequest(body({ amountMinor: positiveMinor.optional(), reason: z.string().min(2) })),
  catchAsync(async (req, res) => ok(res, 'Payment refunded', await PaymentService.refundPayment(req, req.params.id as string, req.body))),
);

// Development only: completes a mock card payment as if Stripe's webhook arrived.
router.post(
  '/:id/simulate-success',
  authorize(P.POS_PAY, P.FOLIO_PAYMENT),
  catchAsync(async (req, res) => ok(res, 'Mock payment completed', await PaymentService.simulateSuccess(req.params.id as string))),
);

export const PaymentRoutes = router;

// Mounted with the raw body so the Stripe signature can be verified.
export const stripeWebhookHandler = catchAsync(async (req, res) => {
  const result = await PaymentService.handleWebhook(req.rawBody, req.headers['stripe-signature'] as string | undefined);
  res.status(200).json(result);
});
