import { Router } from 'express';
import { z } from 'zod';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope, { locationFilter } from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { AlertService } from './alert.service';
import { ALERT_TYPE } from './alert.model';
import { body } from '../../utils/zod';

const router = Router();

router.use(tenantUser());

router.get(
  '/',
  authorize(PERMISSION.ALERTS_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const result = await AlertService.list(locationFilter(req), req.query);
    ok(res, 'Alerts', result.data, { meta: result.meta });
  }),
);

router.post('/:id/acknowledge', authorize(PERMISSION.ALERTS_VIEW), catchAsync(async (req, res) => ok(res, 'Alert acknowledged', await AlertService.acknowledge(req.params.id as string, req.user.id))));
router.post('/:id/resolve', authorize(PERMISSION.ALERTS_VIEW), catchAsync(async (req, res) => ok(res, 'Alert resolved', await AlertService.resolve(req.params.id as string, req.user.id))));

router.get('/rules', authorize(PERMISSION.ALERTS_MANAGE), catchAsync(async (_req, res) => ok(res, 'Alert rules', await AlertService.listRules())));

router.put(
  '/rules/:type',
  authorize(PERMISSION.ALERTS_MANAGE),
  validateRequest(
    body({
      enabled: z.boolean().optional(),
      threshold: z.number().min(0).optional(),
      notifyRoles: z.array(z.enum(['TENANT_OWNER', 'TENANT_MANAGER', 'STAFF'])).optional(),
      channels: z.array(z.enum(['PUSH', 'EMAIL', 'SMS'])).optional(),
    }),
  ),
  catchAsync(async (req, res) => {
    const type = req.params.type as keyof typeof ALERT_TYPE;
    if (!ALERT_TYPE[type]) return ok(res, 'Unknown alert type', null, { statusCode: 400 });
    ok(res, 'Alert rule saved', await AlertService.upsertRule(type, req.body));
  }),
);

export const AlertRoutes = router;
