import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { USER_ROLE } from '../user/user.constant';
import { Partner, SuperAdminServices } from './superAdmin.service';
import { jobStatus, runJobNow } from '../../utils/scheduler';
import { found } from '../../utils/query';
import { body } from '../../utils/zod';

const router = Router();

router.use(auth(USER_ROLE.SUPER_ADMIN));

router.get('/stats', catchAsync(async (_req, res) => ok(res, 'Platform stats retrieved successfully', await SuperAdminServices.getPlatformStats())));
router.get('/tenants/health', catchAsync(async (_req, res) => ok(res, 'Tenant health', await SuperAdminServices.tenantHealth())));
router.get('/impersonations', catchAsync(async (_req, res) => ok(res, 'Impersonation log', await SuperAdminServices.impersonationLog())));

// Background jobs: status and manual runs (e.g. billing after a fix).
router.get('/jobs', catchAsync(async (_req, res) => ok(res, 'Jobs', await jobStatus())));
router.post(
  '/jobs/:name/run',
  catchAsync(async (req, res) => {
    await runJobNow(req.params.name as string);
    ok(res, 'Job finished', { name: req.params.name });
  }),
);

// Reseller / referral partners
const partnerBody = { name: z.string().min(1), email: z.string().email().optional(), commissionBps: z.number().int().min(0).max(10000).optional(), isActive: z.boolean().optional() };

router.get('/partners', catchAsync(async (_req, res) => ok(res, 'Partners', await Partner.find().sort({ name: 1 }).lean())));
router.post('/partners', validateRequest(body(partnerBody)), catchAsync(async (req, res) => ok(res, 'Partner created', await Partner.create(req.body), { statusCode: httpStatus.CREATED })));
router.patch(
  '/partners/:id',
  validateRequest(z.object({ body: z.object(partnerBody).partial() })),
  catchAsync(async (req, res) => ok(res, 'Partner updated', found(await Partner.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }), 'Partner'))),
);
router.get(
  '/partners/:id/commissions',
  catchAsync(async (req, res) =>
    ok(res, 'Partner commissions', await SuperAdminServices.partnerCommissions(req.params.id as string, new Date(String(req.query.from || '2000-01-01')), new Date(String(req.query.to || new Date().toISOString())))),
  ),
);

router.get('/settings', catchAsync(async (_req, res) => ok(res, 'Platform settings retrieved', await SuperAdminServices.getPlatformSettings())));
router.patch('/settings', catchAsync(async (req, res) => ok(res, 'Platform settings updated', await SuperAdminServices.updatePlatformSettings(req.body))));

export const SuperAdminRoutes = router;
