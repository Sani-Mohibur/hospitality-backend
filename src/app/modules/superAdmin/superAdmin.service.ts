import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { User } from '../user/user.model';

const getPlatformStats = async () => {
  const totalTenants = await Tenant.countDocuments();
  const activeTenants = await Tenant.countDocuments({ isActive: true });
  
  const totalSubscriptions = await Subscription.countDocuments();
  const activeSubscriptions = await Subscription.countDocuments({ status: 'ACTIVE' });
  const overdueSubscriptions = await Subscription.countDocuments({ status: 'OVERDUE' });

  const totalUsers = await User.countDocuments();

  // Basic revenue stats (can be expanded later)
  const subscriptions = await Subscription.find({ status: { $in: ['ACTIVE', 'OVERDUE'] } });
  const mrr = subscriptions.reduce((acc, sub) => acc + (sub.price || 0), 0);

  return {
    tenants: {
      total: totalTenants,
      active: activeTenants,
    },
    subscriptions: {
      total: totalSubscriptions,
      active: activeSubscriptions,
      overdue: overdueSubscriptions,
    },
    users: {
      total: totalUsers,
    },
    financials: {
      mrr,
    },
  };
};

export const SuperAdminServices = {
  getPlatformStats,
};
