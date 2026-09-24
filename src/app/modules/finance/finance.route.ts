import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import { PERMISSION } from '../user/user.constant';
import { CHARGE_GROUP, ChargeCode, TaxRule } from './finance.model';
import { ensureSystemChargeCodes } from './finance.service';
import { TAX_CATEGORY, calculateTax } from '../../utils/money';
import { activity } from '../auditLog/auditLog.service';
import { found } from '../../utils/query';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const taxCategories = z.array(z.enum(Object.values(TAX_CATEGORY) as [string, ...string[]])).min(1);

const taxBody = z.object({
  name: z.string().min(1),
  rateBps: z.number().int().min(0).max(10000),
  categories: taxCategories,
  locationId: objectId.optional(),
  isActive: z.boolean().optional(),
});

const chargeBody = z.object({
  code: z.string().min(2).max(12),
  name: z.string().min(1),
  group: z.enum(Object.values(CHARGE_GROUP) as [string, ...string[]]),
  taxCategory: z.enum(Object.values(TAX_CATEGORY) as [string, ...string[]]).optional(),
  glCode: z.string().optional(),
  defaultPriceMinor: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser());

router.get(
  '/tax-rules',
  catchAsync(async (_req, res) => ok(res, 'Tax rules retrieved', await TaxRule.find().sort({ name: 1 }).lean())),
);

router.post(
  '/tax-rules',
  authorize(PERMISSION.TENANT_SETTINGS),
  validateRequest(z.object({ body: taxBody })),
  catchAsync(async (req, res) => {
    const rule = await TaxRule.create(req.body);
    await activity.record({ action: 'TAX_RULE_CREATED', entity: 'TaxRule', entityId: rule._id, message: `Added tax ${rule.name} at ${rule.rateBps / 100}%` });
    ok(res, 'Tax rule created', rule, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/tax-rules/:id',
  authorize(PERMISSION.TENANT_SETTINGS),
  validateRequest(z.object({ body: taxBody.partial() })),
  catchAsync(async (req, res) => {
    const rule = found(await TaxRule.findById(req.params.id), 'Tax rule');
    const before = rule.toObject();
    Object.assign(rule, req.body);
    await rule.save();
    await activity.record({ action: 'TAX_RULE_UPDATED', entity: 'TaxRule', entityId: rule._id, message: `Updated tax ${rule.name}`, before, after: rule.toObject() });
    ok(res, 'Tax rule updated', rule);
  }),
);

// Preview how an amount is taxed with the current rules.
router.post(
  '/tax-rules/preview',
  validateRequest(z.object({ body: z.object({ amountMinor: z.number().int(), taxCategory: z.string(), inclusive: z.boolean().optional(), locationId: objectId.optional() }) })),
  catchAsync(async (req, res) => {
    const rules = await TaxRule.find({ isActive: true }).lean();
    const scoped = rules.filter((r) => !r.locationId || String(r.locationId) === req.body.locationId);
    ok(res, 'Tax preview', calculateTax(req.body.amountMinor, req.body.taxCategory, scoped, Boolean(req.body.inclusive)));
  }),
);

router.get(
  '/charge-codes',
  catchAsync(async (_req, res) => {
    await ensureSystemChargeCodes();
    ok(res, 'Charge codes retrieved', await ChargeCode.find().sort({ group: 1, code: 1 }).lean());
  }),
);

router.post(
  '/charge-codes',
  authorize(PERMISSION.TENANT_SETTINGS),
  validateRequest(z.object({ body: chargeBody })),
  catchAsync(async (req, res) => {
    const code = await ChargeCode.create({ ...req.body, isSystem: false });
    ok(res, 'Charge code created', code, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/charge-codes/:id',
  authorize(PERMISSION.TENANT_SETTINGS),
  validateRequest(z.object({ body: chargeBody.partial() })),
  catchAsync(async (req, res) => {
    const code = found(await ChargeCode.findById(req.params.id), 'Charge code');
    if (code.isSystem && (req.body.code || req.body.group)) {
      throw new AppError(httpStatus.BAD_REQUEST, 'System charge codes keep their code and group');
    }
    Object.assign(code, req.body);
    await code.save();
    ok(res, 'Charge code updated', code);
  }),
);

export const FinanceRoutes = router;
