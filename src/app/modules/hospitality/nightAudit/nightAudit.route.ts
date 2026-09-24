import { Router } from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { requireLocationId } from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { PERMISSION } from '../../user/user.constant';
import { NightAuditServices } from './nightAudit.service';

const router = Router();

router.use(tenantUser(), requireModule('HOSPITALITY'), locationScope());

router.get(
  '/preview',
  authorize(PERMISSION.NIGHT_AUDIT_RUN, PERMISSION.FRONT_DESK),
  catchAsync(async (req, res) => ok(res, 'Night audit checklist', await NightAuditServices.preview(requireLocationId(req)))),
);

router.post(
  '/run',
  authorize(PERMISSION.NIGHT_AUDIT_RUN),
  catchAsync(async (req, res) => ok(res, 'Night audit completed', await NightAuditServices.run(requireLocationId(req), { userId: req.user.id }))),
);

router.get(
  '/history',
  authorize(PERMISSION.NIGHT_AUDIT_RUN, PERMISSION.REPORTS_VIEW),
  catchAsync(async (req, res) => ok(res, 'Night audit history', await NightAuditServices.history(requireLocationId(req)))),
);

// Daily manager report of a closed business date
router.get(
  '/report/:businessDate',
  authorize(PERMISSION.REPORTS_VIEW),
  catchAsync(async (req, res) => ok(res, 'Daily report', await NightAuditServices.getRun(requireLocationId(req), req.params.businessDate as string))),
);

export const NightAuditRoutes = router;
