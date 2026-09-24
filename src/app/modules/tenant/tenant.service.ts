import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { ITenant } from './tenant.interface';
import { Tenant } from './tenant.model';
import { createTenantWithOwner, TSignupPayload } from '../auth/auth.service';
import { UserServices } from '../user/user.service';
import { SubscriptionServices } from '../subscription/subscription.service';
import { invalidateTenantCache } from '../../middlewares/auth';
import { activity } from '../auditLog/auditLog.service';
import { requestContext } from '../../utils/requestContext';
import { found } from '../../utils/query';
import { PlatformModule } from '../platformModule/platformModule.model';

// Super admin onboarding: same path as self-serve signup, owner gets an invite email.
const createTenant = async (payload: TSignupPayload) => {
  const { owner, tenant } = await createTenantWithOwner(payload);
  if (!payload.password) await UserServices.sendInvite(owner);
  return tenant;
};

const getAllTenants = async (query: Record<string, unknown> = {}) => {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  const result = await Tenant.find(filter).sort({ createdAt: -1 });
  return result;
};

const getTenantById = async (id: string) => {
  const result = found(await Tenant.findById(id), 'Tenant');
  return result;
};

const updateTenant = async (id: string, payload: Partial<ITenant>) => {
  const result = found(
    await Tenant.findByIdAndUpdate(id, payload, {
      returnDocument: 'after',
      runValidators: true,
    }),
    'Tenant',
  );
  invalidateTenantCache(id);
  return result;
};

const deleteTenant = async (id: string) => {
  const result = await Tenant.findByIdAndUpdate(
    id,
    { isDeleted: true, isActive: false, status: 'CANCELLED' },
    { returnDocument: 'after' }
  );
  invalidateTenantCache(id);
  return result;
};

const suspendTenant = async (id: string) => {
  const result = await Tenant.findByIdAndUpdate(
    id,
    { status: 'SUSPENDED' },
    { returnDocument: 'after', runValidators: true }
  );
  invalidateTenantCache(id);
  return result;
};

const reactivateTenant = async (id: string) => {
  const result = await Tenant.findByIdAndUpdate(
    id,
    { status: 'ACTIVE', isActive: true },
    { returnDocument: 'after', runValidators: true }
  );
  invalidateTenantCache(id);
  return result;
};

const assertModulesExist = async (modules: string[]) => {
  const known = await PlatformModule.find({ code: { $in: modules }, isActive: true }).lean();
  const codes = new Set(known.map((k) => k.code));
  const missing = modules.filter((m) => !codes.has(m));
  if (missing.length) throw new AppError(httpStatus.BAD_REQUEST, `Unknown modules: ${missing.join(', ')}`);
  for (const mod of known) {
    const unmet = (mod.requires || []).filter((r) => !modules.includes(r));
    if (unmet.length) throw new AppError(httpStatus.BAD_REQUEST, `${mod.code} requires ${unmet.join(', ')}`);
  }
};

// Changing modules re-prices the subscription immediately.
const updateTenantFeatures = async (id: string, modules: string[]) => {
  await assertModulesExist(modules);
  const result = await Tenant.findByIdAndUpdate(
    id,
    { modules },
    { returnDocument: 'after', runValidators: true }
  );
  invalidateTenantCache(id);
  await SubscriptionServices.recalculate(id);
  return result;
};

const setFeatureFlag = async (id: string, flag: string, enabled: boolean) => {
  const tenant = found(await Tenant.findById(id), 'Tenant');
  tenant.featureFlags = tenant.featureFlags || new Map();
  tenant.featureFlags.set(flag, enabled);
  await tenant.save();
  return tenant;
};

// ---------- Tenant self-service ----------
const getMyTenant = async (tenantId: string) =>
  requestContext.asSystem(async () => {
    const tenant = found(await Tenant.findById(tenantId).lean(), 'Tenant');
    return tenant;
  });

type TSelfUpdate = Partial<Pick<ITenant, 'name' | 'currency' | 'branding' | 'loyalty'>> & {
  settings?: Partial<ITenant['settings']>;
};

const updateMyTenant = async (tenantId: string, payload: TSelfUpdate) =>
  requestContext.asSystem(async () => {
    const tenant = found(await Tenant.findById(tenantId), 'Tenant');
    const before = tenant.toObject();
    if (payload.name) tenant.name = payload.name;
    if (payload.currency) tenant.currency = payload.currency.toUpperCase();
    if (payload.branding) tenant.branding = { ...(before.branding || {}), ...payload.branding };
    if (payload.loyalty) tenant.loyalty = { ...(before.loyalty || { enabled: false, pointsPerMajorUnit: 1, pointValueMinor: 1 }), ...payload.loyalty };
    if (payload.settings) {
      const { approval, ...rest } = payload.settings;
      Object.assign(tenant.settings, rest);
      if (approval) Object.assign(tenant.settings.approval, approval);
    }
    await tenant.save();
    invalidateTenantCache(tenantId);
    await requestContext.asTenant(tenantId, () =>
      activity.record({
        action: 'TENANT_SETTINGS_UPDATED',
        entity: 'Tenant',
        entityId: tenant._id,
        message: 'Updated business settings',
        before,
        after: tenant.toObject(),
      }),
    );
    return tenant;
  });

export const TenantServices = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
  suspendTenant,
  reactivateTenant,
  updateTenantFeatures,
  setFeatureFlag,
  getMyTenant,
  updateMyTenant,
};
