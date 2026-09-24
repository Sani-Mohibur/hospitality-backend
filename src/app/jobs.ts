import { registerJob } from './utils/scheduler';
import { NightAuditServices } from './modules/hospitality/nightAudit/nightAudit.service';
import { AlertService } from './modules/alert/alert.service';
import { SubscriptionServices } from './modules/subscription/subscription.service';
import { IntegrationServices } from './modules/integration/integration.service';
import { GuestServices } from './modules/hospitality/guest/guest.service';
import { ReportService } from './modules/report/report.service';
import { Tenant } from './modules/tenant/tenant.model';
import { requestContext } from './utils/requestContext';

const MINUTE = 60 * 1000;

// Runs a function once per active tenant, inside that tenant's scope.
const forEachTenant = async (fn: () => Promise<unknown>) => {
  const tenants = await Tenant.find({ isActive: true }).select('_id').lean();
  for (const t of tenants) await requestContext.asTenant(String(t._id), fn);
};

export const registerJobs = () => {
  registerJob({ name: 'night-audit-auto', everyMs: 5 * MINUTE, run: () => NightAuditServices.runScheduled() });
  registerJob({ name: 'alert-checks', everyMs: 5 * MINUTE, run: () => AlertService.runChecks() });
  registerJob({ name: 'webhook-deliveries', everyMs: MINUTE, run: async () => void (await IntegrationServices.deliverPending()) });
  registerJob({ name: 'platform-billing', everyMs: 60 * MINUTE, run: async () => void (await SubscriptionServices.runBillingCycle()) });
  registerJob({ name: 'id-document-retention', everyMs: 24 * 60 * MINUTE, run: () => forEachTenant(() => GuestServices.purgeExpiredDocuments()) });
  registerJob({ name: 'staff-anomalies', everyMs: 24 * 60 * MINUTE, run: () => ReportService.runAnomalyChecks() });
};
