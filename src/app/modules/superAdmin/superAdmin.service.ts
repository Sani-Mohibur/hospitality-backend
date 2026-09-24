import { Schema, Types, model } from 'mongoose';
import { Tenant } from '../tenant/tenant.model';
import { Subscription, PlatformInvoice } from '../subscription/subscription.model';
import { User } from '../user/user.model';
import { Room } from '../hospitality/room/room.model';
import { Outlet } from '../outlet/outlet.model';
import { Order } from '../restaurant/order/order.model';
import { Reservation } from '../hospitality/reservation/reservation.model';
import { ActivityEvent } from '../auditLog/auditLog.model';
import { requestContext } from '../../utils/requestContext';

// Reseller / referral partner that brings tenants and earns a share of their billing.
export interface IPartner {
  name: string;
  email?: string;
  commissionBps: number;
  isActive: boolean;
}

const partnerSchema = new Schema<IPartner>(
  {
    name: { type: String, required: true },
    email: { type: String },
    commissionBps: { type: Number, default: 2000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Partner = model<IPartner>('Partner', partnerSchema);

const getPlatformStats = async () =>
  requestContext.asSystem(async () => {
    const [totalTenants, byStatus, subs, totalUsers, openInvoices] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Subscription.find({ status: { $in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] } }).lean(),
      User.countDocuments(),
      PlatformInvoice.aggregate([{ $match: { status: 'OPEN' } }, { $group: { _id: null, count: { $sum: 1 }, amountMinor: { $sum: '$totalMinor' } } }]),
    ]);
    const paying = subs.filter((s) => s.status !== 'TRIALING');
    // MRR normalises yearly plans to a month.
    const mrr = paying.reduce((acc, s) => acc + (s.billingCycle === 'YEARLY' ? Math.round(s.cycleAmountMinor / 12) : s.cycleAmountMinor), 0);
    return {
      tenants: { total: totalTenants, byStatus },
      subscriptions: {
        paying: paying.length,
        trialing: subs.filter((s) => s.status === 'TRIALING').length,
        pastDue: subs.filter((s) => s.status === 'PAST_DUE').length,
      },
      users: { total: totalUsers },
      financials: { mrrMinor: mrr, arrMinor: mrr * 12, openInvoices: openInvoices[0] || { count: 0, amountMinor: 0 } },
    };
  });

// One row per tenant: usage, activity and billing health (for support and churn risk).
const tenantHealth = async () =>
  requestContext.asSystem(async () => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const tenants = await Tenant.find().select('name slug status modules lastActivityAt trialEndsAt createdAt').lean();
    const [rooms, outlets, orders, reservations, subs, overdue] = await Promise.all([
      Room.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
      Outlet.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
      Reservation.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
      Subscription.find().select('tenantId monthlyMinor status').lean(),
      PlatformInvoice.aggregate([{ $match: { status: 'OPEN', dueDate: { $lt: new Date() } } }, { $group: { _id: '$tenantId', amountMinor: { $sum: '$totalMinor' } } }]),
    ]);
    const by = (rows: { _id: unknown; n?: number; amountMinor?: number }[]) => new Map(rows.map((r) => [String(r._id), r]));
    const [r, o, ord, res, od] = [by(rooms), by(outlets), by(orders), by(reservations), by(overdue)];
    return tenants.map((t) => {
      const id = String(t._id);
      const sub = subs.find((s) => String(s.tenantId) === id);
      const idleDays = t.lastActivityAt ? Math.floor((Date.now() - new Date(t.lastActivityAt).getTime()) / 86400000) : null;
      const activity7d = (ord.get(id)?.n || 0) + (res.get(id)?.n || 0);
      return {
        tenantId: t._id,
        name: t.name,
        status: t.status,
        modules: t.modules,
        rooms: r.get(id)?.n || 0,
        outlets: o.get(id)?.n || 0,
        ordersLast7d: ord.get(id)?.n || 0,
        reservationsLast7d: res.get(id)?.n || 0,
        mrrMinor: sub?.monthlyMinor || 0,
        overdueMinor: od.get(id)?.amountMinor || 0,
        lastActivityAt: t.lastActivityAt,
        trialEndsAt: t.trialEndsAt,
        churnRisk: t.status === 'PAST_DUE' || (idleDays !== null && idleDays > 14) || (activity7d === 0 && t.status === 'ACTIVE') ? 'HIGH' : idleDays !== null && idleDays > 5 ? 'MEDIUM' : 'LOW',
      };
    });
  });

const impersonationLog = async () =>
  requestContext.asSystem(() => ActivityEvent.find({ action: 'IMPERSONATION_STARTED' }).sort({ createdAt: -1 }).limit(200).populate('actorId', 'name email').populate('tenantId', 'name').lean());

// Commission owed to a partner from paid invoices of the tenants it referred.
const partnerCommissions = async (partnerId: string, from: Date, to: Date) =>
  requestContext.asSystem(async () => {
    const partner = await Partner.findById(partnerId).lean();
    if (!partner) return null;
    const tenants = await Tenant.find({ partnerId: new Types.ObjectId(partnerId) }).select('_id name').lean();
    const invoices = await PlatformInvoice.find({ tenantId: { $in: tenants.map((t) => t._id) }, status: 'PAID', paidAt: { $gte: from, $lte: to } }).lean();
    const revenue = invoices.reduce((s, i) => s + i.totalMinor, 0);
    return { partner: partner.name, tenants: tenants.length, paidInvoices: invoices.length, revenueMinor: revenue, commissionMinor: Math.round((revenue * partner.commissionBps) / 10000) };
  });

export const SuperAdminServices = { getPlatformStats, tenantHealth, impersonationLog, partnerCommissions };
