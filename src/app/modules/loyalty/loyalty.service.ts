import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../errors/AppError';
import { LoyaltyAccount, LoyaltyTransaction } from './loyalty.model';
import { Tenant } from '../tenant/tenant.model';
import { Guest } from '../hospitality/guest/guest.model';
import { Folio } from '../hospitality/folio/folio.model';
import { RoomStay } from '../hospitality/reservation/reservation.model';
import { Order } from '../restaurant/order/order.model';
import { requestContext } from '../../utils/requestContext';
import { onDomainEvent } from '../../utils/domainEvents';
import { found } from '../../utils/query';
import { runInTransaction } from '../../utils/transaction';

type TId = Types.ObjectId | string;

const TIERS: { tier: 'MEMBER' | 'SILVER' | 'GOLD'; from: number }[] = [
  { tier: 'GOLD', from: 20000 },
  { tier: 'SILVER', from: 5000 },
  { tier: 'MEMBER', from: 0 },
];

const settings = async () => {
  const tenantId = requestContext.get()?.tenantId;
  const tenant = await requestContext.asSystem(() => Tenant.findById(tenantId).select('loyalty').lean());
  return tenant?.loyalty || { enabled: false, pointsPerMajorUnit: 1, pointValueMinor: 1 };
};

const accountFor = async (guestId: TId) =>
  (await LoyaltyAccount.findOne({ guestId })) || (await LoyaltyAccount.create({ guestId }));

const post = async (guestId: TId, type: 'EARN' | 'REDEEM' | 'ADJUST' | 'REVERSE', points: number, source?: { kind: string; id: TId }, note?: string) => {
  const account = await accountFor(guestId);
  if (account.pointsBalance + points < 0) throw new AppError(httpStatus.PAYMENT_REQUIRED, `Only ${account.pointsBalance} points available`);
  account.pointsBalance += points;
  if (points > 0 && type === 'EARN') account.lifetimePoints += points;
  account.tier = TIERS.find((t) => account.lifetimePoints >= t.from)!.tier;
  await account.save();
  await LoyaltyTransaction.create([
    { accountId: account._id, type, points, balanceAfter: account.pointsBalance, source: source && { kind: source.kind, id: source.id }, note, createdBy: requestContext.get()?.userId },
  ]);
  return account;
};

// Points for spend: pointsPerMajorUnit per 100 minor units (e.g. 1 point per dollar).
const earn = async (guestId: TId, spendMinor: number, source: { kind: string; id: TId }) => {
  const cfg = await settings();
  if (!cfg.enabled || spendMinor <= 0) return undefined;
  const points = Math.floor((spendMinor / 100) * cfg.pointsPerMajorUnit);
  if (!points) return undefined;
  const already = await LoyaltyTransaction.exists({ type: 'EARN', 'source.kind': source.kind, 'source.id': source.id });
  if (already) return undefined;
  try {
    // The unique index is the last guard; the transaction undoes the balance change if it fires.
    return await runInTransaction(() => post(guestId, 'EARN', points, source, `Earned on ${source.kind.toLowerCase()}`));
  } catch (err: any) {
    if (err?.code === 11000) return undefined; // already earned for this stay/order
    throw err;
  }
};

// LOYALTY payment method: turns points into money on a bill.
const redeemForPayment = async (guestId: string | undefined, payment: { _id: Types.ObjectId; amountMinor: number }) => {
  if (!guestId) throw new AppError(httpStatus.BAD_REQUEST, 'Choose the guest whose points pay the bill');
  const cfg = await settings();
  if (!cfg.enabled) throw new AppError(httpStatus.BAD_REQUEST, 'Loyalty is not enabled');
  const points = Math.ceil(payment.amountMinor / Math.max(cfg.pointValueMinor, 1));
  await post(guestId, 'REDEEM', -points, { kind: 'Payment', id: payment._id }, `Redeemed ${points} points`);
};

// Refunded LOYALTY payments give the points back.
const restoreForRefund = async (guestId: TId, amountMinor: number, paymentId: TId) => {
  const cfg = await settings();
  const points = Math.ceil(amountMinor / Math.max(cfg.pointValueMinor, 1));
  await post(guestId, 'REVERSE', points, { kind: 'Payment', id: paymentId }, 'Refund of points payment');
};

const adjust = async (guestId: string, points: number, note: string) => post(guestId, 'ADJUST', points, undefined, note);

const wallet = async (guestId: string) => {
  found(await Guest.findById(guestId).select('_id').lean(), 'Guest');
  const account = await LoyaltyAccount.findOne({ guestId }).lean();
  const cfg = await settings();
  const history = account ? await LoyaltyTransaction.find({ accountId: account._id }).sort({ createdAt: -1 }).limit(50).lean() : [];
  return {
    pointsBalance: account?.pointsBalance || 0,
    lifetimePoints: account?.lifetimePoints || 0,
    tier: account?.tier || 'MEMBER',
    valueMinor: (account?.pointsBalance || 0) * cfg.pointValueMinor,
    history,
  };
};

// Stays earn on everything charged to the guest's folios; meals earn on the order total.
onDomainEvent('stay.checkedOut', async ({ stayId }) => {
  const stay = await RoomStay.findById(stayId).lean();
  if (!stay?.guestIds?.length) return;
  const folios = await Folio.find({ roomStayId: stay._id }).lean();
  const spend = folios.filter((f) => f.type === 'GUEST').reduce((s, f) => s + f.chargesMinor, 0);
  await earn(stay.guestIds[0]!, spend, { kind: 'RoomStay', id: stay._id });
});

onDomainEvent('order.closed', async ({ orderId }) => {
  const order = await Order.findById(orderId).lean();
  if (!order?.guestId || order.roomStayId) return; // room charges earn at check-out
  await earn(order.guestId, order.totals.totalMinor, { kind: 'Order', id: order._id });
  await Guest.updateOne({ _id: order.guestId }, { $inc: { 'stats.visits': 1, 'stats.totalSpendMinor': order.totals.totalMinor }, $set: { 'stats.lastVisitAt': new Date() } });
});

export const LoyaltyService = { earn, redeemForPayment, restoreForRefund, adjust, wallet };
