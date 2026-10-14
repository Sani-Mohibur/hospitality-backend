import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { SubscriptionServices } from './subscription.service';
import { PaymentService } from '../payment/payment.service';

const getMySubscription = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.getSubscriptionByTenantId(req.user.tenantId!);
  ok(res, 'Subscription retrieved successfully', result);
});

const subscribeTenant = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.subscribeTenant(req.user.tenantId!, req.body);
  ok(res, 'Subscription activated successfully', result);
});

const previewQuote = catchAsync(async (req: Request, res: Response) => {
  const modules = String(req.query.modules || '')
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
  const result = await SubscriptionServices.previewQuote(req.user.tenantId!, modules);
  ok(res, 'Price quote', result);
});

const changeBillingCycle = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.changeBillingCycle(req.user.tenantId!, req.body.billingCycle);
  ok(res, 'Billing cycle changed', result);
});

const setCancelAtPeriodEnd = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.setCancelAtPeriodEnd(req.user.tenantId!, req.body.cancel);
  ok(res, req.body.cancel ? 'Subscription ends at period end' : 'Cancellation withdrawn', result);
});

const listMyInvoices = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.listInvoices(req.user.tenantId!, req.query.status as string | undefined);
  ok(res, 'Invoices', result);
});

const payPlatformInvoice = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentService.payPlatformInvoice(req.params.id as string);
  ok(res, 'Complete the payment', result);
});

const getAllSubscriptions = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.getAllSubscriptionsFromDB(req.query);
  ok(res, 'Subscriptions retrieved successfully', result);
});

const updateSubscription = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.updateSubscriptionInDB(req.params.id as string, req.body);
  ok(res, 'Subscription updated successfully', result);
});

const updateSubscriptionStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.updateSubscriptionStatusInDB(req.params.id as string, req.body);
  ok(res, 'Subscription status updated successfully', result);
});

const applyCreditDiscount = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.applyCreditDiscountInDB(req.params.id as string, req.body);
  ok(res, 'Credits/Discounts applied successfully', result);
});

const listAllInvoices = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.listInvoices(
    req.query.tenantId as string | undefined,
    req.query.status as string | undefined,
  );
  ok(res, 'Invoices', result);
});

const markInvoicePaid = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.markInvoicePaid(req.params.id as string, req.body.paymentRef);
  ok(res, 'Invoice marked paid', result);
});

const voidInvoice = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.voidInvoice(req.params.id as string);
  ok(res, 'Invoice voided', result);
});

const runBillingCycle = catchAsync(async (_req: Request, res: Response) => {
  const result = await SubscriptionServices.runBillingCycle();
  ok(res, 'Billing cycle run', result);
});

export const SubscriptionControllers = {
  getMySubscription,
  subscribeTenant,
  previewQuote,
  changeBillingCycle,
  setCancelAtPeriodEnd,
  listMyInvoices,
  payPlatformInvoice,
  getAllSubscriptions,
  updateSubscription,
  updateSubscriptionStatus,
  applyCreditDiscount,
  listAllInvoices,
  markInvoicePaid,
  voidInvoice,
  runBillingCycle,
};
