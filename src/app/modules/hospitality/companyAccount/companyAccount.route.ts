import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { PERMISSION } from '../../user/user.constant';
import { CompanyAccount } from './companyAccount.model';
import { Folio } from '../folio/folio.model';
import { activity } from '../../auditLog/auditLog.service';
import { escapeRegex, found } from '../../../utils/query';
import { positiveMinor } from '../../../utils/zod';

const router = Router();

const fields = z.object({
  name: z.string().min(1),
  code: z.string().max(12).optional(),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  billingAddress: z.string().optional(),
  taxId: z.string().optional(),
  creditLimitMinor: positiveMinor.optional(),
  paymentTermsDays: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser());

router.get(
  '/',
  authorize(PERMISSION.RESERVATIONS_VIEW, PERMISSION.COMPANY_ACCOUNTS_MANAGE),
  catchAsync(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.searchTerm) filter.name = { $regex: escapeRegex(String(req.query.searchTerm)), $options: 'i' };
    ok(res, 'Company accounts', await CompanyAccount.find(filter).sort({ name: 1 }).lean());
  }),
);

// Account with its city-ledger balance across locations (receivables).
router.get(
  '/:id',
  authorize(PERMISSION.RESERVATIONS_VIEW, PERMISSION.COMPANY_ACCOUNTS_MANAGE),
  catchAsync(async (req, res) => {
    const company = found(await CompanyAccount.findById(req.params.id).lean(), 'Company account');
    const folios = await Folio.find({ companyAccountId: company._id }).select('number locationId status balanceMinor createdAt').lean();
    ok(res, 'Company account', { ...company, folios, balanceMinor: folios.reduce((s, f) => s + f.balanceMinor, 0) });
  }),
);

router.post(
  '/',
  authorize(PERMISSION.COMPANY_ACCOUNTS_MANAGE, PERMISSION.RESERVATIONS_MANAGE),
  validateRequest(z.object({ body: fields })),
  catchAsync(async (req, res) => {
    const company = await CompanyAccount.create(req.body);
    await activity.record({ action: 'COMPANY_CREATED', entity: 'CompanyAccount', entityId: company._id, message: `Added company ${company.name}` });
    ok(res, 'Company account created', company, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/:id',
  authorize(PERMISSION.COMPANY_ACCOUNTS_MANAGE),
  validateRequest(z.object({ body: fields.partial() })),
  catchAsync(async (req, res) => {
    const company = found(await CompanyAccount.findById(req.params.id), 'Company account');
    const before = company.toObject();
    Object.assign(company, req.body);
    await company.save();
    if (req.body.creditLimitMinor !== undefined) {
      await Folio.updateMany({ companyAccountId: company._id, status: 'OPEN' }, { creditLimitMinor: req.body.creditLimitMinor || null });
    }
    await activity.record({ action: 'COMPANY_UPDATED', entity: 'CompanyAccount', entityId: company._id, message: `Updated company ${company.name}`, before, after: company.toObject() });
    ok(res, 'Company account updated', company);
  }),
);

export const CompanyAccountRoutes = router;
