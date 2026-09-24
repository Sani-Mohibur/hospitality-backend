import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { APPROVAL_ACTION } from './approval.model';
import { ApprovalService } from './approval.service';
import { body, objectId } from '../../utils/zod';

const router = Router();
const action = z.enum(Object.values(APPROVAL_ACTION) as [string, ...string[]]);

router.use(tenantUser());

// Manager types their PIN on the requester's device; returns a one-use token for
// the X-Approval-Token header of the protected request.
router.post(
  '/pin',
  locationScope({ required: false }),
  validateRequest(body({ managerId: objectId, pin: z.string().regex(/^\d{4,6}$/), action })),
  catchAsync(async (req, res) => ok(res, 'Approved', await ApprovalService.grantWithPin(req, req.body))),
);

// Remote approval: pushed to managers on duty.
router.post(
  '/requests',
  locationScope(),
  validateRequest(body({ action, summary: z.string().min(3), context: z.record(z.string(), z.unknown()).optional() })),
  catchAsync(async (req, res) => ok(res, 'Approval requested', await ApprovalService.requestRemote(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.get(
  '/requests',
  authorize(PERMISSION.APPROVALS_GRANT),
  locationScope({ required: false }),
  catchAsync(async (req, res) => ok(res, 'Pending approvals', await ApprovalService.listPending(req.locationId))),
);

router.post(
  '/requests/:id/decide',
  authorize(PERMISSION.APPROVALS_GRANT),
  validateRequest(body({ decision: z.enum(['APPROVED', 'DENIED']) })),
  catchAsync(async (req, res) => ok(res, 'Decision recorded', await ApprovalService.decide(req, req.params.id as string, req.body.decision))),
);

// Requester polls (or listens for approval_decided) and collects the token.
router.get('/requests/:id/token', catchAsync(async (req, res) => ok(res, 'Approval status', await ApprovalService.collect(req, req.params.id as string))));

export const ApprovalRoutes = router;
