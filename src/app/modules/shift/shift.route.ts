import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope, { locationFilter } from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { ShiftServices } from './shift.service';
import { body, businessDate, objectId, positiveMinor } from '../../utils/zod';

const router = Router();
const P = PERMISSION;

router.use(tenantUser());

router.get('/current', authorize(P.SHIFT_OWN), catchAsync(async (req, res) => ok(res, 'Current shift', await ShiftServices.currentShift(req.user.id))));

router.post(
  '/open',
  authorize(P.SHIFT_OWN),
  locationScope(),
  validateRequest(body({ outletId: objectId.optional(), openingFloatMinor: positiveMinor, drawerName: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Shift opened', await ShiftServices.openShift(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.get(
  '/',
  authorize(P.CASH_MANAGE, P.REPORTS_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => ok(res, 'Shifts', await ShiftServices.listShifts(locationFilter(req), req.query))),
);

router.post(
  '/tip-pool',
  authorize(P.CASH_MANAGE),
  validateRequest(body({ outletId: objectId, businessDate, shares: z.array(z.object({ userId: objectId, points: z.number().min(0) })).min(1) })),
  catchAsync(async (req, res) => ok(res, 'Tip pool', await ShiftServices.tipPool(req.body.outletId, req.body.businessDate, req.body.shares))),
);

router.get('/:id/report', authorize(P.SHIFT_OWN, P.CASH_MANAGE), catchAsync(async (req, res) => ok(res, 'Z report', await ShiftServices.shiftReport(req.params.id as string))));

router.post(
  '/:id/cash',
  authorize(P.SHIFT_OWN, P.CASH_MANAGE),
  validateRequest(body({ type: z.enum(['DROP', 'PAYOUT', 'PAID_IN']), amountMinor: positiveMinor.min(1), reason: z.string().min(2) })),
  catchAsync(async (req, res) => ok(res, 'Cash movement recorded', await ShiftServices.cashMovement(req, req.params.id as string, req.body), { statusCode: httpStatus.CREATED })),
);

router.post(
  '/:id/close',
  authorize(P.SHIFT_OWN, P.CASH_MANAGE),
  validateRequest(body({ countedCashMinor: positiveMinor, notes: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Shift closed', await ShiftServices.closeShift(req, req.params.id as string, req.body))),
);

export const ShiftRoutes = router;
