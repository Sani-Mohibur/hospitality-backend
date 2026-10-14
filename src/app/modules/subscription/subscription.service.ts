import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../config';
import AppError from '../../errors/AppError';
import { Subscription, PlatformInvoice } from './subscription.model';
import { ISubscriptionItem, SUBSCRIPTION_STATUS } from './subscription.interface';
import { DEFAULT_PLATFORM_MODULES, PlatformModule } from '../platformModule/platformModule.model';
import { IPlatformModule } from '../platformModule/platformModule.interface';
import { Tenant } from '../tenant/tenant.model';
import { TENANT_STATUS } from '../tenant/tenant.interface';
import { Room } from '../hospitality/room/room.model';
import { Outlet, Station } from '../outlet/outlet.model';
import { Location } from '../location/location.model';
import { User } from '../user/user.model';
import { nextSequence } from '../system/counter.model';
import { requestContext } from '../../utils/requestContext';
import { runInTransaction } from '../../utils/transaction';
import { invalidateTenantCache } from '../../middlewares/auth';
import { percentOf } from '../../utils/money';
import { sendEmail } from '../../utils/sendEmail';
import logger from '../../utils/logger';
import { found } from '../../utils/query';

const DAY = 24 * 3600 * 1000;

const addMonths = (date: Date, months: number) => {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

export const ensurePlatformModules = async () => {
  for (const mod of DEFAULT_PLATFORM_MODULES) {
    await PlatformModule.updateOne({ code: mod.code }, { $setOnInsert: mod }, { upsert: true });
  }
};

const catalog = async () => {
  const rows = await PlatformModule.find({ isActive: true }).lean();
  const byCode = new Map<string, IPlatformModule>(rows.map((r) => [r.code, r]));
  for (const mod of DEFAULT_PLATFORM_MODULES) if (!byCode.has(mod.code)) byCode.set(mod.code, mod);
  return byCode;
};

// Usage-based price for a tenant: rooms, outlets and locations are counted live.
const quote = async (tenantId: string, modules: string[]) =>
  requestContext.asTenant(tenantId, async () => {
    const [rooms, outlets, locations, mods] = await Promise.all([
      Room.countDocuments({ isActive: true }),
      Outlet.countDocuments({ isActive: true }),
      Location.countDocuments({ isActive: true }),
      catalog(),
    ]);
    const hasHotel = modules.includes('HOSPITALITY');
    const items: ISubscriptionItem[] = [];

    for (const code of modules) {
      const mod = mods.get(code);
      if (!mod) continue;
      const bundled = code === 'RESTAURANT' && hasHotel && mod.bundleUnitPriceMinor !== undefined;
      const unit = bundled ? mod.bundleUnitPriceMinor! : mod.unitPriceMinor;
      const quantity =
        mod.pricingModel === 'PER_ROOM'
          ? rooms
          : mod.pricingModel === 'PER_OUTLET'
            ? Math.max(outlets, 1)
            : mod.pricingModel === 'PER_LOCATION'
              ? Math.max(locations, 1)
              : 1;
      const amount = unit * quantity;
      items.push({
        moduleCode: code,
        description: `${mod.name}${bundled ? ' (Suite price)' : ''} × ${quantity}`,
        quantity,
        unitPriceMinor: unit,
        amountMinor: amount,
      });
      const minimum = bundled ? 0 : mod.minimumMinor;
      if (minimum && amount < minimum && !(code === 'HOSPITALITY' && modules.includes('RESTAURANT'))) {
        items.push({
          moduleCode: code,
          description: `${mod.name} plan minimum`,
          quantity: 1,
          unitPriceMinor: minimum - amount,
          amountMinor: minimum - amount,
        });
      }
    }

    // Hotel + F&B Suite minimum applies to the two core modules together.
    const restaurant = mods.get('RESTAURANT');
    if (hasHotel && modules.includes('RESTAURANT') && restaurant?.bundleMinimumMinor) {
      const core = items
        .filter((i) => i.moduleCode === 'HOSPITALITY' || i.moduleCode === 'RESTAURANT')
        .reduce((s, i) => s + i.amountMinor, 0);
      if (core < restaurant.bundleMinimumMinor) {
        items.push({
          moduleCode: 'SUITE',
          description: 'Hotel + F&B Suite minimum',
          quantity: 1,
          unitPriceMinor: restaurant.bundleMinimumMinor - core,
          amountMinor: restaurant.bundleMinimumMinor - core,
        });
      }
    }

    const monthlyMinor = items.reduce((s, i) => s + i.amountMinor, 0);
    const planName = hasHotel && modules.includes('RESTAURANT') ? 'Hotel + F&B Suite' : hasHotel ? 'Hotel' : 'Restaurant';
    return { items, monthlyMinor, planName, usage: { rooms, outlets, locations } };
  });

const cycleAmount = (monthlyMinor: number, cycle: 'MONTHLY' | 'YEARLY', discountBps: number) => {
  const gross = cycle === 'YEARLY' ? monthlyMinor * 10 : monthlyMinor;
  return gross - percentOf(gross, discountBps);
};

const startTrial = async (tenantId: string, modules: string[]) => {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + config.billing.trial_days * DAY);
  const q = await quote(tenantId, modules);
  const [subscription] = await requestContext.asSystem(() =>
    Subscription.create([
      {
        tenantId,
        planName: q.planName,
        status: SUBSCRIPTION_STATUS.TRIALING,
        items: q.items,
        monthlyMinor: q.monthlyMinor,
        cycleAmountMinor: q.monthlyMinor,
        features: modules,
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        nextBillingDate: trialEndsAt,
        lastRecalculatedAt: now,
      },
    ]),
  );
  return subscription!;
};

// Re-prices after rooms, outlets, locations or modules change.
const recalculate = async (tenantId: string) =>
  requestContext.asSystem(async () => {
    const [tenant, subscription] = await Promise.all([
      Tenant.findById(tenantId).lean(),
      Subscription.findOne({ tenantId }),
    ]);
    if (!tenant || !subscription) return undefined;
    const q = await quote(tenantId, tenant.modules);
    subscription.items = q.items;
    subscription.planName = q.planName;
    subscription.monthlyMinor = q.monthlyMinor;
    subscription.cycleAmountMinor = cycleAmount(q.monthlyMinor, subscription.billingCycle, subscription.discountBps);
    subscription.features = tenant.modules;
    subscription.lastRecalculatedAt = new Date();
    await subscription.save();
    return subscription;
  });

const getAllSubscriptionsFromDB = async (query: Record<string, unknown> = {}) => {
  const filter: Record<string, unknown> = {};
  if (query.status && query.status !== 'ALL') filter.status = query.status;
  if (query.billingCycle && query.billingCycle !== 'ALL') filter.billingCycle = query.billingCycle;
  return Subscription.find(filter).populate('tenantId', 'name slug status currency').sort({ createdAt: -1 }).lean();
};

const updateSubscriptionInDB = async (
  id: string,
  payload: {
    planName?: string;
    billingCycle?: 'MONTHLY' | 'YEARLY';
    appliedCredits?: number;
    price?: number;
    creditMinor?: number;
    discountBps?: number;
  },
) => {
  const subscription = found(await Subscription.findById(id), 'Subscription');
  if (payload.planName) subscription.planName = payload.planName;
  if (payload.billingCycle) subscription.billingCycle = payload.billingCycle;
  if (payload.price !== undefined) {
    subscription.monthlyMinor = Math.round(payload.price * 100);
  }
  if (payload.appliedCredits !== undefined) {
    subscription.creditBalanceMinor = Math.round(payload.appliedCredits * 100);
  }
  if (payload.creditMinor !== undefined) {
    subscription.creditBalanceMinor = payload.creditMinor;
  }
  if (payload.discountBps !== undefined) {
    subscription.discountBps = payload.discountBps;
  }
  subscription.cycleAmountMinor = cycleAmount(subscription.monthlyMinor, subscription.billingCycle, subscription.discountBps);
  await subscription.save();
  return subscription;
};

const getSubscriptionByTenantId = async (tenantId: string) => {
  const result = await requestContext.asSystem(() => Subscription.findOne({ tenantId }).lean());
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Subscription not found for this tenant');
  }
  const q = await quote(tenantId, result.features);
  const openInvoices = await requestContext.asSystem(() =>
    PlatformInvoice.find({ tenantId, status: 'OPEN' }).sort({ dueDate: 1 }).lean(),
  );
  return { ...result, usage: q.usage, openInvoices };
};

const previewQuote = async (tenantId: string, modules: string[]) => quote(tenantId, modules);

const updateSubscriptionStatusInDB = async (
  id: string,
  payload: { status: keyof typeof SUBSCRIPTION_STATUS },
) => {
  const result = await Subscription.findByIdAndUpdate(
    id,
    { status: payload.status },
    { returnDocument: 'after', runValidators: true }
  );
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Subscription not found');
  }
  const tenantStatus =
    payload.status === 'CANCELLED' ? TENANT_STATUS.CANCELLED : payload.status === 'PAST_DUE' ? TENANT_STATUS.PAST_DUE : TENANT_STATUS.ACTIVE;
  await Tenant.updateOne({ _id: result.tenantId }, { status: tenantStatus });
  invalidateTenantCache(String(result.tenantId));
  return result;
};

// Credits are money owed to the tenant and are consumed by the next invoices.
const applyCreditDiscountInDB = async (
  id: string,
  payload: { creditMinor?: number; discountBps?: number }
) => {
  const subscription = found(await Subscription.findById(id), 'Subscription');
  if (payload.creditMinor) subscription.creditBalanceMinor += payload.creditMinor;
  if (payload.discountBps !== undefined) subscription.discountBps = payload.discountBps;
  subscription.cycleAmountMinor = cycleAmount(subscription.monthlyMinor, subscription.billingCycle, subscription.discountBps);
  await subscription.save();
  return subscription;
};

const changeBillingCycle = async (tenantId: string, billingCycle: 'MONTHLY' | 'YEARLY') =>
  requestContext.asSystem(async () => {
    const subscription = found(await Subscription.findOne({ tenantId }), 'Subscription');
    subscription.billingCycle = billingCycle;
    subscription.cycleAmountMinor = cycleAmount(subscription.monthlyMinor, billingCycle, subscription.discountBps);
    await subscription.save();
    return subscription;
  });

const setCancelAtPeriodEnd = async (tenantId: string, cancel: boolean) =>
  requestContext.asSystem(async () => {
    const subscription = found(await Subscription.findOne({ tenantId }), 'Subscription');
    subscription.cancelAtPeriodEnd = cancel;
    await subscription.save();
    return subscription;
  });

const listInvoices = async (tenantId?: string, status?: string) =>
  requestContext.asSystem(() =>
    PlatformInvoice.find({ ...(tenantId ? { tenantId } : {}), ...(status ? { status } : {}) } as any)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  );

const markInvoicePaid = async (invoiceId: string, paymentRef?: string) =>
  requestContext.asSystem(async () => {
    const invoice = found(await PlatformInvoice.findById(invoiceId), 'Invoice');
    if (invoice.status === 'PAID') return invoice;
    if (invoice.status !== 'OPEN') throw new AppError(httpStatus.CONFLICT, `Invoice is ${invoice.status}`);
    invoice.status = 'PAID';
    invoice.paidAt = new Date();
    invoice.paymentRef = paymentRef;
    await invoice.save();
    const stillOpenOverdue = await PlatformInvoice.exists({
      tenantId: invoice.tenantId,
      status: 'OPEN',
      dueDate: { $lt: new Date() },
    });
    if (!stillOpenOverdue) {
      await Subscription.updateOne({ tenantId: invoice.tenantId, status: 'PAST_DUE' }, { status: 'ACTIVE' });
      await Tenant.updateOne(
        { _id: invoice.tenantId, status: { $in: [TENANT_STATUS.PAST_DUE, TENANT_STATUS.SUSPENDED] } },
        { status: TENANT_STATUS.ACTIVE },
      );
      invalidateTenantCache(String(invoice.tenantId));
    }
    return invoice;
  });

const voidInvoice = async (invoiceId: string) =>
  requestContext.asSystem(async () => {
    const invoice = found(await PlatformInvoice.findById(invoiceId), 'Invoice');
    if (invoice.status !== 'OPEN') throw new AppError(httpStatus.CONFLICT, `Invoice is ${invoice.status}`);
    invoice.status = 'VOID';
    await invoice.save();
    return invoice;
  });

const ownerEmail = async (tenantId: unknown) => {
  const owner = await User.findOne({ tenantId: tenantId as any, role: 'TENANT_OWNER' }).select('email').lean();
  return owner?.email;
};

// Daily job: bill ended periods, then dunning (past due → suspended after grace).
const runBillingCycle = async (now = new Date()) =>
  requestContext.asSystem(async () => {
    const due = await Subscription.find({
      currentPeriodEnd: { $lte: now },
      status: { $ne: SUBSCRIPTION_STATUS.CANCELLED },
    });
    for (const sub of due) {
      try {
        await runInTransaction(async () => {
          if (sub.cancelAtPeriodEnd) {
            sub.status = SUBSCRIPTION_STATUS.CANCELLED;
            await sub.save();
            await Tenant.updateOne({ _id: sub.tenantId }, { status: TENANT_STATUS.CANCELLED });
            return;
          }
          const tenant = await Tenant.findById(sub.tenantId).lean();
          const q = await quote(String(sub.tenantId), tenant?.modules || sub.features);
          const gross = sub.billingCycle === 'YEARLY' ? q.monthlyMinor * 10 : q.monthlyMinor;
          const discount = percentOf(gross, sub.discountBps);
          const credit = Math.min(sub.creditBalanceMinor, gross - discount);
          const total = gross - discount - credit;
          const periodStart = sub.currentPeriodEnd;
          const periodEnd = addMonths(periodStart, sub.billingCycle === 'YEARLY' ? 12 : 1);
          const seq = await nextSequence('platform-invoice');
          await PlatformInvoice.create([
            {
              tenantId: sub.tenantId,
              subscriptionId: sub._id,
              number: `HPOS-${periodStart.getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
              periodStart,
              periodEnd,
              lines: q.items,
              subtotalMinor: gross,
              discountMinor: discount,
              creditAppliedMinor: credit,
              totalMinor: total,
              status: total === 0 ? 'PAID' : 'OPEN',
              paidAt: total === 0 ? now : undefined,
              dueDate: new Date(now.getTime() + 7 * DAY),
            },
          ]);
          sub.items = q.items;
          sub.monthlyMinor = q.monthlyMinor;
          sub.creditBalanceMinor -= credit;
          sub.currentPeriodStart = periodStart;
          sub.currentPeriodEnd = periodEnd;
          sub.nextBillingDate = periodEnd;
          if (sub.status === SUBSCRIPTION_STATUS.TRIALING) sub.status = SUBSCRIPTION_STATUS.ACTIVE;
          await sub.save();
          if (tenant?.status === TENANT_STATUS.TRIALING) {
            await Tenant.updateOne({ _id: sub.tenantId }, { status: TENANT_STATUS.ACTIVE });
          }
        });
      } catch (err) {
        logger.error(err, `Billing failed for subscription ${sub._id}`);
      }
    }

    const overdue = await PlatformInvoice.find({ status: 'OPEN', dueDate: { $lt: now } });
    for (const invoice of overdue) {
      const graceEnds = new Date(invoice.dueDate.getTime() + config.billing.dunning_grace_days * DAY);
      const nextStatus = now > graceEnds ? TENANT_STATUS.SUSPENDED : TENANT_STATUS.PAST_DUE;
      await Subscription.updateOne({ _id: invoice.subscriptionId }, { status: SUBSCRIPTION_STATUS.PAST_DUE });
      await Tenant.updateOne({ _id: invoice.tenantId, status: { $ne: TENANT_STATUS.CANCELLED } }, { status: nextStatus });
      invalidateTenantCache(String(invoice.tenantId));

      const daysLate = Math.floor((now.getTime() - invoice.dueDate.getTime()) / DAY);
      if (daysLate >= invoice.remindersSent * 3) {
        const email = await ownerEmail(invoice.tenantId);
        if (email) {
          await sendEmail(
            email,
            `<p>Invoice ${invoice.number} for ${(invoice.totalMinor / 100).toFixed(2)} ${invoice.currency} is ${daysLate} day(s) overdue.</p>
             <p>Your account will be suspended on ${graceEnds.toISOString().slice(0, 10)} if it stays unpaid.</p>`,
            `Payment overdue: ${invoice.number}`,
          ).catch((err) => logger.warn(err, 'Dunning email failed'));
        }
        invoice.remindersSent += 1;
        await invoice.save();
      }
    }
    return { billed: due.length, overdue: overdue.length };
  });

const subscribeTenant = async (
  tenantId: string,
  payload: {
    packageId?: string;
    tierId?: string;
    billingCycle?: 'MONTHLY' | 'YEARLY';
    modules: string[];
    planName?: string;
    mockPaymentSuccess: boolean;
    paymentRef?: string;
  },
) => {
  if (!payload.mockPaymentSuccess) {
    throw new AppError(httpStatus.PAYMENT_REQUIRED, 'Payment authorization failed. Modules were not activated.');
  }

  const validModules = (payload.modules || []).filter((m) =>
    ['HOSPITALITY', 'RESTAURANT', 'INVENTORY', 'DISTRIBUTION', 'AI_ASSISTANT'].includes(m),
  );
  if (!validModules.length) {
    throw new AppError(httpStatus.BAD_REQUEST, 'At least one valid platform module must be selected.');
  }

  const cycle = payload.billingCycle || 'MONTHLY';
  const planName =
    payload.planName ||
    (validModules.includes('HOSPITALITY') && validModules.includes('RESTAURANT')
      ? 'Hotel + Restaurant Suite'
      : validModules.includes('HOSPITALITY')
        ? 'Hotel Management'
        : 'Restaurant Management');

  return requestContext.asSystem(async () => {
    return runInTransaction(async () => {
      const tenant = found(await Tenant.findById(tenantId), 'Tenant');

      // Update tenant modules and status
      tenant.modules = validModules;
      tenant.status = TENANT_STATUS.ACTIVE;
      if (!tenant.trialEndsAt) {
        tenant.trialEndsAt = new Date(Date.now() + config.billing.trial_days * DAY);
      }

      // Ensure location supports rooms if HOSPITALITY is selected
      if (validModules.includes('HOSPITALITY')) {
        await Location.updateOne({ tenantId, isDeleted: { $ne: true } }, { hasRooms: true });
      }

      // Ensure outlet exists if RESTAURANT is selected
      if (validModules.includes('RESTAURANT')) {
        const outletExists = await Outlet.exists({ tenantId });
        if (!outletExists) {
          const location = await Location.findOne({ tenantId });
          if (location) {
            const [outlet] = await Outlet.create([{ tenantId, locationId: location._id, name: 'Main Restaurant' }]);
            const [station] = await Station.create([
              { tenantId, locationId: location._id, outletId: outlet!._id, name: 'Kitchen', type: 'KITCHEN' },
            ]);
            outlet!.defaultStationId = station!._id;
            await outlet!.save();
          }
        }
      }

      // Calculate quote and subscription details
      const q = await quote(tenantId, validModules);
      const now = new Date();
      const periodEnd = addMonths(now, cycle === 'YEARLY' ? 12 : 1);
      const gross = cycle === 'YEARLY' ? q.monthlyMinor * 10 : q.monthlyMinor;

      let subscription = await Subscription.findOne({ tenantId });
      if (subscription) {
        subscription.planName = planName;
        subscription.billingCycle = cycle;
        subscription.status = SUBSCRIPTION_STATUS.ACTIVE;
        subscription.features = validModules;
        subscription.items = q.items;
        subscription.monthlyMinor = q.monthlyMinor;
        subscription.cycleAmountMinor = gross;
        subscription.currentPeriodStart = now;
        subscription.currentPeriodEnd = periodEnd;
        subscription.nextBillingDate = periodEnd;
        subscription.lastRecalculatedAt = now;
        await subscription.save();
      } else {
        const [newSub] = await Subscription.create([
          {
            tenantId,
            planName,
            billingCycle: cycle,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            features: validModules,
            items: q.items,
            monthlyMinor: q.monthlyMinor,
            cycleAmountMinor: gross,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            lastRecalculatedAt: now,
          },
        ]);
        if (!newSub) {
          throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create subscription record');
        }
        subscription = newSub;
        tenant.subscriptionId = newSub._id;
      }

      if (!subscription) {
        throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Subscription record is missing');
      }

      await tenant.save();
      invalidateTenantCache(tenantId);

      // Create a paid platform invoice for the subscription
      const seq = await nextSequence('platform-invoice');
      await PlatformInvoice.create([
        {
          tenantId,
          subscriptionId: subscription._id,
          number: `HPOS-${now.getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          periodStart: now,
          periodEnd,
          lines: q.items,
          subtotalMinor: gross,
          discountMinor: 0,
          creditAppliedMinor: 0,
          totalMinor: gross,
          status: 'PAID',
          paidAt: now,
          paymentRef: payload.paymentRef || `MOCK_PAY_${Date.now()}`,
          dueDate: now,
        },
      ]);

      return {
        tenant: {
          id: tenant._id,
          name: tenant.name,
          status: tenant.status,
          subscribedModules: tenant.modules,
        },
        subscription,
      };
    });
  });
};

const tenantIdOf = (value: unknown) => new Types.ObjectId(String(value));

export const SubscriptionServices = {
  startTrial,
  subscribeTenant,
  recalculate,
  previewQuote,
  getAllSubscriptionsFromDB,
  getSubscriptionByTenantId,
  updateSubscriptionInDB,
  updateSubscriptionStatusInDB,
  applyCreditDiscountInDB,
  changeBillingCycle,
  setCancelAtPeriodEnd,
  listInvoices,
  markInvoicePaid,
  voidInvoice,
  runBillingCycle,
  tenantIdOf,
};
