import Stripe from 'stripe';
import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import config from '../../config';
import AppError from '../../errors/AppError';
import { IPayment, PAYMENT_METHOD, PAYMENT_STATUS, TPaymentMethod, TPaymentTarget } from './payment.interface';
import { Payment } from './payment.model';
import { Tenant } from '../tenant/tenant.model';
import { Shift, CashMovement } from '../shift/shift.model';
import { Folio } from '../hospitality/folio/folio.model';
import { FolioLedger } from '../hospitality/folio/folio.ledger';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE, FOLIO_STATUS } from '../hospitality/folio/folio.interface';
import { FolioLine } from '../hospitality/folio/folio.model';
import { RoomStay } from '../hospitality/reservation/reservation.model';
import { STAY_STATUS } from '../hospitality/reservation/reservation.interface';
import { Room } from '../hospitality/room/room.model';
import { Guest } from '../hospitality/guest/guest.model';
import { ApprovalService } from '../approval/approval.service';
import { activity } from '../auditLog/auditLog.service';
import { runInTransaction } from '../../utils/transaction';
import { requestContext } from '../../utils/requestContext';
import { emitDomainEvent } from '../../utils/domainEvents';
import { percentOf } from '../../utils/money';
import { found, metaOf, paginationOf } from '../../utils/query';
import logger from '../../utils/logger';

export const stripe = config.stripe.secret_key
  ? new Stripe(config.stripe.secret_key, { apiVersion: '2024-06-20' as any })
  : undefined;

type TPaymentDoc = IPayment & { _id: Types.ObjectId };

// What each payable thing (an order, a folio) must provide. POS registers ORDER.
export type TPaymentTargetHandler = {
  // Amount still owed and where the money belongs
  due: (targetId: Types.ObjectId, checkNo?: number) => Promise<{ locationId: Types.ObjectId; outletId?: Types.ObjectId; balanceMinor: number; currency: string; label: string }>;
  // Runs inside the payment transaction once the money is secured
  onCompleted: (payment: TPaymentDoc) => Promise<Types.ObjectId[] | void>;
  onRefunded?: (payment: TPaymentDoc, amountMinor: number, reason: string) => Promise<void>;
};

const targets: Partial<Record<TPaymentTarget, TPaymentTargetHandler>> = {};

export const registerPaymentTarget = (kind: TPaymentTarget, handler: TPaymentTargetHandler) => {
  targets[kind] = handler;
};

const handlerFor = (kind: TPaymentTarget) => {
  const handler = targets[kind];
  if (!handler) throw new AppError(httpStatus.BAD_REQUEST, `Payments for ${kind} are not available`);
  return handler;
};

// ---------- Folio target (hotel bills, deposits, city ledger) ----------
registerPaymentTarget('FOLIO', {
  due: async (folioId) => {
    const folio = found(await Folio.findById(folioId).lean(), 'Folio');
    if (folio.status !== FOLIO_STATUS.OPEN) throw new AppError(httpStatus.CONFLICT, 'Folio is closed');
    // Deposits may be taken before any charge exists, so the due amount can be 0.
    return { locationId: folio.locationId, balanceMinor: Math.max(folio.balanceMinor, 0), currency: folio.currency, label: `Folio ${folio.number}` };
  },
  onCompleted: async (payment) => {
    const line = await FolioLedger.postLine({
      folioId: payment.target.id,
      type: FOLIO_LINE_TYPE.PAYMENT,
      code: 'PAY',
      description: `Payment (${payment.method.replace(/_/g, ' ').toLowerCase()})${payment.reference ? ` ref ${payment.reference}` : ''}`,
      unitAmountMinor: payment.amountMinor,
      source: { kind: FOLIO_SOURCE.PAYMENT, refId: payment._id },
      postingKey: `PAY:${payment._id}`,
      paymentId: payment._id,
    });
    const { ReservationServices } = await import('../hospitality/reservation/reservation.service');
    await ReservationServices.onFolioPayment(payment.target.id, payment.amountMinor);
    return [line._id as Types.ObjectId];
  },
  onRefunded: async (payment, amountMinor, reason) => {
    const original = payment.folioLineIds[0];
    await FolioLedger.postLine({
      folioId: payment.target.id,
      type: FOLIO_LINE_TYPE.PAYMENT,
      code: 'PAY',
      description: `Refund: ${reason}`,
      unitAmountMinor: amountMinor,
      source: { kind: FOLIO_SOURCE.PAYMENT, refId: payment._id },
      reversalOfId: original,
      paymentId: payment._id,
      skipCreditLimit: true,
    });
  },
});

// ---------- Helpers ----------
const openShiftOf = async (userId: string) => Shift.findOne({ userId, status: 'OPEN' }).lean();

const tenantStripe = async () => {
  const tenantId = requestContext.get()?.tenantId;
  const tenant = found(await requestContext.asSystem(() => Tenant.findById(tenantId).lean()), 'Tenant');
  return { tenant, accountId: tenant.stripe?.accountId, ready: Boolean(tenant.stripe?.accountId && tenant.stripe?.chargesEnabled) };
};

// Verifies an in-house guest for charge-to-room: room number + last name must match.
export const resolveRoomCharge = async (locationId: TId, input: { roomNumber?: string; roomStayId?: string; guestLastName?: string }) => {
  let stay;
  if (input.roomStayId) {
    stay = await RoomStay.findOne({ _id: input.roomStayId, locationId, status: STAY_STATUS.CHECKED_IN }).lean();
  } else if (input.roomNumber) {
    const room = await Room.findOne({ locationId, roomNumber: input.roomNumber }).lean();
    stay = room ? await RoomStay.findOne({ roomId: room._id, status: STAY_STATUS.CHECKED_IN }).lean() : null;
  }
  if (!stay) throw new AppError(httpStatus.NOT_FOUND, 'No checked-in guest in that room');
  const guests = await Guest.find({ _id: { $in: stay.guestIds } }).lean();
  if (input.guestLastName) {
    const match = guests.some((g) => g.lastName.trim().toLowerCase() === input.guestLastName!.trim().toLowerCase());
    if (!match) throw new AppError(httpStatus.FORBIDDEN, 'Guest name does not match the room');
  }
  const folio = stay.folioId ? await Folio.findById(stay.folioId).lean() : null;
  if (!folio || folio.status !== FOLIO_STATUS.OPEN) throw new AppError(httpStatus.CONFLICT, 'The room has no open bill');
  if (folio.noPost) throw new AppError(httpStatus.FORBIDDEN, 'This guest asked for no charges to the room');
  const room = stay.roomId ? await Room.findById(stay.roomId).lean() : null;
  return { stay, folio, roomNumber: room?.roomNumber, guest: guests[0] };
};

type TId = Types.ObjectId | string;

export type TTakePayment = {
  target: { kind: TPaymentTarget; id: string; checkNo?: number };
  method: TPaymentMethod;
  amountMinor: number;
  tipMinor?: number;
  tenderedMinor?: number;
  reference?: string;
  note?: string;
  clientRef?: string;
  offline?: boolean;
  roomCharge?: { roomNumber?: string; roomStayId?: string; guestLastName?: string; signatureUrl?: string };
  companyAccountId?: string;
  guestId?: string;
};

const IMMEDIATE_METHODS: TPaymentMethod[] = [
  PAYMENT_METHOD.CASH,
  PAYMENT_METHOD.CARD_EXTERNAL,
  PAYMENT_METHOD.BANK_TRANSFER,
  PAYMENT_METHOD.CHARGE_TO_ROOM,
  PAYMENT_METHOD.CITY_LEDGER,
  PAYMENT_METHOD.VOUCHER,
  PAYMENT_METHOD.LOYALTY,
];

// Takes a payment. Immediate methods complete in one transaction; Stripe methods
// return a client secret and complete only when the signed webhook arrives.
const takePayment = async (req: Request, input: TTakePayment) => {
  if (input.clientRef) {
    const existing = await Payment.findOne({ clientRef: input.clientRef }).lean();
    if (existing) return { payment: existing, replayed: true };
  }
  const handler = handlerFor(input.target.kind);
  const targetId = new Types.ObjectId(input.target.id);
  const due = await handler.due(targetId, input.target.checkNo);
  if (req.locationId && String(due.locationId) !== req.locationId) {
    throw new AppError(httpStatus.FORBIDDEN, 'This bill belongs to another location');
  }
  const tip = input.tipMinor || 0;
  if (input.amountMinor <= 0) throw new AppError(httpStatus.BAD_REQUEST, 'Amount must be greater than zero');
  if (input.target.kind === 'ORDER' && input.amountMinor > due.balanceMinor) {
    throw new AppError(httpStatus.BAD_REQUEST, `Amount is more than the ${due.balanceMinor} still due`);
  }
  if (input.method === PAYMENT_METHOD.CHARGE_TO_ROOM && input.target.kind !== 'ORDER') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Charge to room is for outlet bills');
  }
  if (input.method === PAYMENT_METHOD.BANK_TRANSFER && !input.reference) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Bank transfers need a reference');
  }

  // ----- Stripe card payments -----
  if (input.method === PAYMENT_METHOD.CARD_ONLINE || input.method === PAYMENT_METHOD.CARD_TERMINAL) {
    return createCardIntent(req, { ...input, target: { ...input.target, id: targetId } } as any, due);
  }
  if (!IMMEDIATE_METHODS.includes(input.method)) throw new AppError(httpStatus.BAD_REQUEST, 'Unsupported payment method');

  let shiftId: Types.ObjectId | undefined;
  let change = 0;
  if (input.method === PAYMENT_METHOD.CASH) {
    const shift = await openShiftOf(req.user.id);
    if (!shift) throw new AppError(httpStatus.CONFLICT, 'Open a shift (cash drawer) before taking cash');
    shiftId = shift._id as Types.ObjectId;
    const tendered = input.tenderedMinor ?? input.amountMinor + tip;
    if (tendered < input.amountMinor + tip) throw new AppError(httpStatus.BAD_REQUEST, 'Tendered cash is less than the amount');
    change = tendered - input.amountMinor - tip;
  }

  let folioPosting: IPayment['folioPosting'];
  if (input.method === PAYMENT_METHOD.CHARGE_TO_ROOM) {
    if (!input.roomCharge) throw new AppError(httpStatus.BAD_REQUEST, 'Give the room number and guest name');
    const { OfflineLimits } = await import('./offlineLimits');
    const resolved = await resolveRoomCharge(due.locationId, input.roomCharge);
    if (input.offline) await OfflineLimits.checkRoomCharge(resolved.folio._id, input.amountMinor + tip, resolved.roomNumber);
    folioPosting = {
      roomStayId: resolved.stay._id as Types.ObjectId,
      folioId: resolved.folio._id as Types.ObjectId,
      roomNumber: resolved.roomNumber,
      guestName: resolved.guest ? `${resolved.guest.firstName} ${resolved.guest.lastName}` : undefined,
      signatureUrl: input.roomCharge.signatureUrl,
    };
  }
  if (input.method === PAYMENT_METHOD.CITY_LEDGER) {
    if (!input.companyAccountId) throw new AppError(httpStatus.BAD_REQUEST, 'Choose the company account');
    const { ReservationServices } = await import('../hospitality/reservation/reservation.service');
    const folioId = await ReservationServices.companyFolioFor(input.companyAccountId, due.locationId);
    folioPosting = { folioId };
  }

  const payment = await runInTransaction(async () => {
    const [created] = await Payment.create([
      {
        locationId: due.locationId,
        outletId: due.outletId,
        target: { kind: input.target.kind, id: targetId, checkNo: input.target.checkNo },
        method: input.method,
        amountMinor: input.amountMinor,
        tipMinor: tip,
        tenderedMinor: input.method === PAYMENT_METHOD.CASH ? input.tenderedMinor ?? input.amountMinor + tip : undefined,
        changeMinor: input.method === PAYMENT_METHOD.CASH ? change : undefined,
        currency: due.currency,
        status: PAYMENT_STATUS.COMPLETED,
        completedAt: new Date(),
        reference: input.reference,
        note: input.note,
        clientRef: input.clientRef,
        offline: input.offline,
        guestId: input.guestId,
        shiftId,
        deviceId: req.user.deviceId,
        createdBy: req.user.id,
        folioPosting,
      },
    ]);
    const doc = created! as unknown as TPaymentDoc;
    if (input.method === PAYMENT_METHOD.LOYALTY) {
      const { LoyaltyService } = await import('../loyalty/loyalty.service');
      await LoyaltyService.redeemForPayment(input.guestId, doc);
    }
    const lines = await handler.onCompleted(doc);
    if (lines?.length) {
      created!.folioLineIds = lines;
      await created!.save();
    }
    if (shiftId) {
      await CashMovement.create([
        { locationId: due.locationId, shiftId, type: 'SALE', amountMinor: input.amountMinor + tip, paymentId: created!._id, createdBy: req.user.id },
      ]);
    }
    await activity.record({
      action: 'PAYMENT_TAKEN',
      entity: 'Payment',
      entityId: created!._id,
      message: `${due.label}: ${input.method.replace(/_/g, ' ').toLowerCase()} ${input.amountMinor}${tip ? ` + tip ${tip}` : ''}`,
    });
    return created!;
  });
  emitDomainEvent('payment.completed', { tenantId: req.user.tenantId!, paymentId: String(payment._id) });
  return { payment, changeMinor: change };
};

// ---------- Stripe ----------
const createCardIntent = async (
  req: Request,
  input: TTakePayment & { target: { kind: TPaymentTarget; id: Types.ObjectId; checkNo?: number } },
  due: { locationId: Types.ObjectId; outletId?: Types.ObjectId; currency: string; label: string },
) => {
  const { tenant, accountId, ready } = await tenantStripe();
  const tip = input.tipMinor || 0;
  const total = input.amountMinor + tip;
  const feeBps = tenant.stripe?.platformFeeBps ?? config.billing.platform_fee_bps;
  const fee = percentOf(total, feeBps);

  const [payment] = await Payment.create([
    {
      locationId: due.locationId,
      outletId: due.outletId,
      target: input.target,
      method: input.method,
      amountMinor: input.amountMinor,
      tipMinor: tip,
      currency: due.currency,
      status: PAYMENT_STATUS.PENDING,
      clientRef: input.clientRef,
      deviceId: req.user.deviceId,
      createdBy: req.user.id,
      stripe: { accountId, applicationFeeMinor: fee },
    },
  ]);

  if (!stripe) {
    if (config.env === 'production') throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Card payments are not configured');
    // Development without Stripe keys: complete through POST /payment/:id/simulate
    payment!.stripe = { ...payment!.stripe, paymentIntentId: `pi_mock_${payment!._id}` };
    await payment!.save();
    return { payment: payment!, clientSecret: 'mock_client_secret', mock: true };
  }
  if (!ready) throw new AppError(httpStatus.CONFLICT, 'Finish Stripe onboarding (Settings → Payments) before taking cards');

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: total,
        currency: due.currency.toLowerCase(),
        application_fee_amount: fee,
        payment_method_types: input.method === PAYMENT_METHOD.CARD_TERMINAL ? ['card_present'] : undefined,
        automatic_payment_methods: input.method === PAYMENT_METHOD.CARD_ONLINE ? { enabled: true } : undefined,
        capture_method: 'automatic',
        description: due.label,
        metadata: { paymentId: String(payment!._id), tenantId: String(tenant._id), target: input.target.kind },
      },
      { stripeAccount: accountId, idempotencyKey: `pi_${payment!._id}` },
    );
    payment!.stripe = { ...payment!.stripe, paymentIntentId: intent.id };
    await payment!.save();
    return { payment: payment!, clientSecret: intent.client_secret, stripeAccount: accountId, publishableKey: config.stripe.publishable_key };
  } catch (error: any) {
    payment!.status = PAYMENT_STATUS.FAILED;
    payment!.failureReason = error.message;
    await payment!.save();
    throw new AppError(httpStatus.BAD_GATEWAY, `Stripe error: ${error.message}`);
  }
};

// Called only from the verified webhook (or the dev simulator). Idempotent.
const completeFromProvider = async (paymentIntentId: string, chargeId?: string) => {
  const found_ = await requestContext.asSystem(() => Payment.findOne({ 'stripe.paymentIntentId': paymentIntentId }).lean());
  if (!found_) return undefined;
  return requestContext.asTenant(String(found_.tenantId), async () => {
    const payment = await runInTransaction(async () => {
      const doc = await Payment.findOne({ _id: found_._id, status: PAYMENT_STATUS.PENDING });
      if (!doc) return undefined;
      doc.status = PAYMENT_STATUS.COMPLETED;
      doc.completedAt = new Date();
      if (chargeId) doc.stripe = { ...doc.stripe, chargeId };
      const lines = await handlerFor(doc.target.kind).onCompleted(doc as unknown as TPaymentDoc);
      if (lines?.length) doc.folioLineIds = lines;
      await doc.save();
      await activity.record({
        action: 'PAYMENT_CONFIRMED',
        entity: 'Payment',
        entityId: doc._id,
        actorId: doc.createdBy ? String(doc.createdBy) : undefined,
        message: `Card payment ${doc.amountMinor + doc.tipMinor} confirmed by Stripe`,
      });
      return doc;
    });
    if (payment) emitDomainEvent('payment.completed', { tenantId: String(found_.tenantId), paymentId: String(payment._id) });
    return payment;
  });
};

const failFromProvider = async (paymentIntentId: string, reason: string, status: 'FAILED' | 'CANCELLED' = 'FAILED') =>
  requestContext.asSystem(() =>
    Payment.updateOne({ 'stripe.paymentIntentId': paymentIntentId, status: PAYMENT_STATUS.PENDING }, { status, failureReason: reason }),
  );

const simulateSuccess = async (paymentId: string) => {
  if (config.env === 'production') throw new AppError(httpStatus.NOT_FOUND, 'Not available');
  const payment = found(await Payment.findById(paymentId).lean(), 'Payment');
  if (!payment.stripe?.paymentIntentId) throw new AppError(httpStatus.BAD_REQUEST, 'Not a card payment');
  return completeFromProvider(payment.stripe.paymentIntentId, `ch_mock_${payment._id}`);
};

// ---------- Refunds ----------
const refundPayment = async (req: Request, paymentId: string, payload: { amountMinor?: number; reason: string }) => {
  const payment = found(await Payment.findById(paymentId), 'Payment');
  if (![PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.PARTIALLY_REFUNDED].includes(payment.status as any)) {
    throw new AppError(httpStatus.CONFLICT, `Payment is ${payment.status}`);
  }
  const refundable = payment.amountMinor + payment.tipMinor - payment.refundedMinor;
  const amount = payload.amountMinor ?? refundable;
  if (amount <= 0 || amount > refundable) throw new AppError(httpStatus.BAD_REQUEST, `At most ${refundable} can be refunded`);
  const { tenant } = await tenantStripe();
  const approvedBy = await ApprovalService.requireApproval(req, 'REFUND', tenant.settings?.approval?.refunds !== false);

  let providerRef: string | undefined;
  if ((payment.method === PAYMENT_METHOD.CARD_ONLINE || payment.method === PAYMENT_METHOD.CARD_TERMINAL) && stripe && payment.stripe?.paymentIntentId && !payment.stripe.paymentIntentId.startsWith('pi_mock')) {
    const refund = await stripe.refunds.create(
      { payment_intent: payment.stripe.paymentIntentId, amount, refund_application_fee: true, metadata: { paymentId: String(payment._id) } },
      { stripeAccount: payment.stripe.accountId, idempotencyKey: `rf_${payment._id}_${payment.refunds.length}` },
    );
    providerRef = refund.id;
  }

  let shiftId: Types.ObjectId | undefined;
  if (payment.method === PAYMENT_METHOD.CASH) {
    const shift = await openShiftOf(req.user.id);
    if (!shift) throw new AppError(httpStatus.CONFLICT, 'Open a shift to pay cash back');
    shiftId = shift._id as Types.ObjectId;
  }

  await runInTransaction(async () => {
    payment.refunds.push({ amountMinor: amount, reason: payload.reason, at: new Date(), by: new Types.ObjectId(req.user.id), approvedBy: approvedBy ? new Types.ObjectId(approvedBy) : undefined, providerRef, status: 'SUCCEEDED' });
    payment.refundedMinor += amount;
    payment.status = payment.refundedMinor >= payment.amountMinor + payment.tipMinor ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
    await payment.save();
    const handler = handlerFor(payment.target.kind);
    await handler.onRefunded?.(payment as unknown as TPaymentDoc, amount, payload.reason);
    if (payment.method === PAYMENT_METHOD.LOYALTY && payment.guestId) {
      const { LoyaltyService } = await import('../loyalty/loyalty.service');
      await LoyaltyService.restoreForRefund(payment.guestId, amount, payment._id);
    }
    if (shiftId) {
      await CashMovement.create([{ locationId: payment.locationId, shiftId, type: 'REFUND', amountMinor: -amount, paymentId: payment._id, createdBy: req.user.id, approvedBy }]);
    }
    await activity.record({ action: 'PAYMENT_REFUNDED', entity: 'Payment', entityId: payment._id, approvedBy, message: `Refunded ${amount}: ${payload.reason}` });
  });
  emitDomainEvent('payment.refunded', { tenantId: req.user.tenantId!, paymentId, amountMinor: amount });
  return payment;
};

// Folio payments from the front desk (deposit, settlement).
const payFolio = async (req: Request, folioId: string, payload: Omit<TTakePayment, 'target'>) =>
  takePayment(req, { ...payload, target: { kind: 'FOLIO', id: folioId } });

// ---------- Stripe Connect onboarding ----------
const connectOnboarding = async (returnUrl: string, refreshUrl: string) => {
  if (!stripe) throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Stripe is not configured');
  const tenantId = requestContext.get()!.tenantId!;
  const tenant = found(await requestContext.asSystem(() => Tenant.findById(tenantId)), 'Tenant');
  if (!tenant.stripe?.accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      business_profile: { name: tenant.name },
      metadata: { tenantId },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    tenant.stripe = { ...(tenant.stripe || {}), accountId: account.id, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };
    await requestContext.asSystem(() => tenant.save());
  }
  const link = await stripe.accountLinks.create({ account: tenant.stripe!.accountId!, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding' });
  return { url: link.url, accountId: tenant.stripe!.accountId };
};

const syncConnectAccount = async (account: Stripe.Account) =>
  requestContext.asSystem(() =>
    Tenant.updateOne(
      { 'stripe.accountId': account.id },
      { 'stripe.chargesEnabled': account.charges_enabled, 'stripe.payoutsEnabled': account.payouts_enabled, 'stripe.detailsSubmitted': account.details_submitted },
    ),
  );

const connectStatus = async () => {
  const { tenant } = await tenantStripe();
  if (stripe && tenant.stripe?.accountId) {
    const account = await stripe.accounts.retrieve(tenant.stripe.accountId);
    await syncConnectAccount(account);
    return { accountId: account.id, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, detailsSubmitted: account.details_submitted };
  }
  return { accountId: tenant.stripe?.accountId, chargesEnabled: Boolean(tenant.stripe?.chargesEnabled), payoutsEnabled: Boolean(tenant.stripe?.payoutsEnabled), stripeConfigured: Boolean(stripe) };
};

const terminalConnectionToken = async () => {
  if (!stripe) throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Stripe is not configured');
  const { accountId, ready } = await tenantStripe();
  if (!ready) throw new AppError(httpStatus.CONFLICT, 'Finish Stripe onboarding first');
  const token = await stripe.terminal.connectionTokens.create({}, { stripeAccount: accountId });
  return { secret: token.secret };
};

// Platform subscription invoice paid by card on the platform account (no Connect).
const payPlatformInvoice = async (invoiceId: string) => {
  const { PlatformInvoice } = await import('../subscription/subscription.model');
  const tenantId = requestContext.get()!.tenantId!;
  const invoice = found(await requestContext.asSystem(() => PlatformInvoice.findOne({ _id: invoiceId, tenantId }).lean()), 'Invoice');
  if (invoice.status !== 'OPEN') throw new AppError(httpStatus.CONFLICT, `Invoice is ${invoice.status}`);
  if (!stripe) throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Stripe is not configured');
  const intent = await stripe.paymentIntents.create(
    {
      amount: invoice.totalMinor,
      currency: invoice.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `HPOS invoice ${invoice.number}`,
      metadata: { kind: 'platform_invoice', invoiceId: String(invoice._id), tenantId },
    },
    { idempotencyKey: `inv_${invoice._id}` },
  );
  return { clientSecret: intent.client_secret, publishableKey: config.stripe.publishable_key };
};

// ---------- Webhook ----------
const constructEvent = (raw: Buffer, signature: string) => {
  if (!stripe) throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Stripe is not configured');
  const secrets = [config.stripe.webhook_secret, config.stripe.connect_webhook_secret].filter(Boolean) as string[];
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(raw, signature, secret);
    } catch {
      // try the next secret
    }
  }
  throw new AppError(httpStatus.BAD_REQUEST, 'Invalid Stripe signature');
};

const handleWebhook = async (raw: Buffer | undefined, signature: string | undefined) => {
  if (!raw || !signature) throw new AppError(httpStatus.BAD_REQUEST, 'Missing Stripe signature');
  const event = constructEvent(raw, signature);
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      if (intent.metadata?.kind === 'platform_invoice') {
        const { SubscriptionServices } = await import('../subscription/subscription.service');
        await SubscriptionServices.markInvoicePaid(intent.metadata.invoiceId!, intent.id);
      } else {
        await completeFromProvider(intent.id, typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id);
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await failFromProvider(intent.id, intent.last_payment_error?.message || 'Payment failed');
      break;
    }
    case 'payment_intent.canceled': {
      const intent = event.data.object as Stripe.PaymentIntent;
      await failFromProvider(intent.id, 'Cancelled', 'CANCELLED');
      break;
    }
    case 'account.updated':
      await syncConnectAccount(event.data.object as Stripe.Account);
      break;
    default:
      logger.debug(`Unhandled Stripe event ${event.type}`);
  }
  return { received: true, type: event.type };
};

// ---------- Queries ----------
const listPayments = async (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 50);
  const where: Record<string, unknown> = { ...filter };
  if (query.method) where.method = query.method;
  if (query.status) where.status = query.status;
  if (query.shiftId) where.shiftId = query.shiftId;
  if (query.targetId) where['target.id'] = new Types.ObjectId(String(query.targetId));
  if (query.from || query.to) {
    where.createdAt = { ...(query.from ? { $gte: new Date(String(query.from)) } : {}), ...(query.to ? { $lte: new Date(String(query.to)) } : {}) };
  }
  const [data, total] = await Promise.all([
    Payment.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payment.countDocuments(where),
  ]);
  return { data, meta: metaOf(page, limit, total) };
};

const folioLinesOf = async (paymentId: string) => FolioLine.find({ paymentId }).lean();

export const PaymentService = {
  takePayment,
  payFolio,
  completeFromProvider,
  simulateSuccess,
  refundPayment,
  connectOnboarding,
  connectStatus,
  terminalConnectionToken,
  payPlatformInvoice,
  handleWebhook,
  listPayments,
  folioLinesOf,
  resolveRoomCharge,
};
