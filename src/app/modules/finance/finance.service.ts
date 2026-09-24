import { Types } from 'mongoose';
import { ChargeCode, IChargeCode, SYSTEM_CHARGE_CODES, TaxRule } from './finance.model';
import { Tenant } from '../tenant/tenant.model';
import { calculateTax, TTaxResult } from '../../utils/money';
import { requestContext } from '../../utils/requestContext';

const ensuredTenants = new Set<string>();

export const ensureSystemChargeCodes = async () => {
  const tenantId = requestContext.get()?.tenantId;
  if (!tenantId || ensuredTenants.has(tenantId)) return;
  for (const code of SYSTEM_CHARGE_CODES) {
    await ChargeCode.updateOne(
      { tenantId, code: code.code },
      { $setOnInsert: { ...code, tenantId, isActive: true } },
      { upsert: true },
    );
  }
  ensuredTenants.add(tenantId);
};

export const chargeCodeByCode = async (code: string): Promise<IChargeCode & { _id: Types.ObjectId }> => {
  await ensureSystemChargeCodes();
  let found = await ChargeCode.findOne({ code: code.toUpperCase() }).lean();
  if (!found) {
    // The first seeding may have been rolled back with its transaction; seed again.
    ensuredTenants.delete(requestContext.get()?.tenantId || '');
    await ensureSystemChargeCodes();
    found = await ChargeCode.findOne({ code: code.toUpperCase() }).lean();
  }
  if (!found) throw new Error(`Charge code ${code} is missing`);
  return found as any;
};

export const taxRulesFor = async (locationId?: unknown) =>
  TaxRule.find({
    isActive: true,
    $or: [{ locationId: { $exists: false } }, { locationId: null }, ...(locationId ? [{ locationId }] : [])],
  }).lean();

export const tenantTaxInclusive = async () => {
  const tenantId = requestContext.get()?.tenantId;
  if (!tenantId) return false;
  const tenant = await requestContext.asSystem(() => Tenant.findById(tenantId).select('settings.taxInclusive').lean());
  return Boolean(tenant?.settings?.taxInclusive);
};

// Tax for one priced amount at a location, honouring the tenant's inclusive setting.
export const taxFor = async (amountMinor: number, taxCategory: string, locationId?: unknown): Promise<TTaxResult> => {
  const [rules, inclusive] = await Promise.all([taxRulesFor(locationId), tenantTaxInclusive()]);
  return calculateTax(amountMinor, taxCategory, rules, inclusive);
};

export const FinanceServices = { ensureSystemChargeCodes, chargeCodeByCode, taxRulesFor, tenantTaxInclusive, taxFor };
