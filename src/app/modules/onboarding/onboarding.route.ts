import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import multer from 'multer';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope, { requireLocationId } from '../../middlewares/locationScope';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import { PERMISSION } from '../user/user.constant';
import { OnboardingServices } from './onboarding.service';

const router = Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(tenantUser(), locationScope());

router.get('/status', catchAsync(async (req, res) => ok(res, 'Setup progress', await OnboardingServices.status(requireLocationId(req)))));

router.post(
  '/demo-data',
  authorize(PERMISSION.TENANT_SETTINGS),
  catchAsync(async (req, res) => ok(res, 'Demo data added', await OnboardingServices.seedDemo(req, requireLocationId(req)), { statusCode: httpStatus.CREATED })),
);

// Upload a CSV file ("file") or send its text as { csv }.
router.post(
  '/import/:kind',
  authorize(PERMISSION.TENANT_SETTINGS),
  csvUpload.single('file'),
  catchAsync(async (req, res) => {
    const kind = z.enum(['guests', 'rooms', 'menu', 'reservations']).parse(req.params.kind);
    const csv = req.file ? req.file.buffer.toString('utf8') : typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csv) throw new AppError(httpStatus.BAD_REQUEST, 'Attach a CSV file or send { csv }');
    ok(res, 'Import finished', await OnboardingServices.importCsv(req, requireLocationId(req), kind, csv));
  }),
);

export const OnboardingRoutes = router;
