import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { requireLocationId } from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { PERMISSION } from '../../user/user.constant';
import { HousekeepingServices } from './housekeeping.service';
import { body, businessDate, objectId, positiveMinor } from '../../../utils/zod';

const router = Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('HOSPITALITY'));

router.get(
  '/board',
  authorize(P.HOUSEKEEPING_VIEW),
  locationScope(),
  catchAsync(async (req, res) => ok(res, 'Housekeeping board', await HousekeepingServices.board(requireLocationId(req), req.query.date as string | undefined))),
);

router.get(
  '/my-tasks',
  authorize(P.HOUSEKEEPING_UPDATE),
  locationScope(),
  catchAsync(async (req, res) => ok(res, 'My rooms today', await HousekeepingServices.myTasks(req.user.id, requireLocationId(req)))),
);

router.post(
  '/generate',
  authorize(P.HOUSEKEEPING_MANAGE),
  locationScope(),
  validateRequest(body({ date: businessDate.optional() })),
  catchAsync(async (req, res) => ok(res, 'Tasks generated', await HousekeepingServices.generateTasks(requireLocationId(req), req.body.date))),
);

router.post(
  '/assign',
  authorize(P.HOUSEKEEPING_MANAGE),
  validateRequest(body({ taskIds: z.array(objectId).min(1), userId: objectId.nullable() })),
  catchAsync(async (req, res) => ok(res, 'Tasks assigned', await HousekeepingServices.assign(req, req.body.taskIds, req.body.userId))),
);

router.post(
  '/tasks/:id/start',
  authorize(P.HOUSEKEEPING_UPDATE),
  catchAsync(async (req, res) => ok(res, 'Cleaning started', await HousekeepingServices.start(req, req.params.id as string))),
);

router.post(
  '/tasks/:id/finish',
  authorize(P.HOUSEKEEPING_UPDATE),
  validateRequest(body({ notes: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Room finished', await HousekeepingServices.finish(req, req.params.id as string, req.body.notes))),
);

router.post(
  '/tasks/:id/inspect',
  authorize(P.HOUSEKEEPING_MANAGE),
  validateRequest(body({ passed: z.boolean(), notes: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Inspection recorded', await HousekeepingServices.inspect(req, req.params.id as string, req.body))),
);

router.post(
  '/issues',
  authorize(P.HOUSEKEEPING_UPDATE),
  validateRequest(
    body({
      roomId: objectId,
      description: z.string().min(3),
      block: z.object({ type: z.enum(['OUT_OF_ORDER', 'OUT_OF_SERVICE']), to: businessDate }).optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Issue reported', await HousekeepingServices.reportIssue(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.post(
  '/requests',
  authorize(P.HOUSEKEEPING_UPDATE, P.FRONT_DESK),
  locationScope(),
  validateRequest(body({ roomId: objectId, notes: z.string().min(2) })),
  catchAsync(async (req, res) =>
    ok(res, 'Request created', await HousekeepingServices.createRequest(requireLocationId(req), req.body.roomId, req.body.notes, 'STAFF', req.user.tenantId!), {
      statusCode: httpStatus.CREATED,
    }),
  ),
);

router.post(
  '/minibar',
  authorize(P.HOUSEKEEPING_UPDATE, P.FOLIO_POST),
  validateRequest(
    body({
      roomId: objectId,
      items: z.array(z.object({ description: z.string(), quantity: z.number().int().min(1), unitAmountMinor: positiveMinor, stockItemId: objectId.optional() })).min(1),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Minibar posted', await HousekeepingServices.postMinibar(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.get(
  '/productivity',
  authorize(P.HOUSEKEEPING_MANAGE, P.REPORTS_VIEW),
  locationScope(),
  catchAsync(async (req, res) =>
    ok(res, 'Housekeeping productivity', await HousekeepingServices.productivity(requireLocationId(req), String(req.query.from), String(req.query.to))),
  ),
);

router.get(
  '/lost-found',
  authorize(P.HOUSEKEEPING_VIEW),
  locationScope(),
  catchAsync(async (req, res) => ok(res, 'Lost and found', await HousekeepingServices.lostFound.list(requireLocationId(req), req.query.status as string | undefined))),
);

router.post(
  '/lost-found',
  authorize(P.HOUSEKEEPING_UPDATE),
  locationScope(),
  validateRequest(body({ roomId: objectId.optional(), description: z.string().min(2), storageLocation: z.string().optional(), guestId: objectId.optional() })),
  catchAsync(async (req, res) => ok(res, 'Item logged', await HousekeepingServices.lostFound.create(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.post(
  '/lost-found/:id/resolve',
  authorize(P.HOUSEKEEPING_MANAGE, P.FRONT_DESK),
  validateRequest(body({ status: z.enum(['RETURNED', 'DISPOSED']), note: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Item resolved', await HousekeepingServices.lostFound.resolve(req.params.id as string, req.body.status, req.body.note))),
);

export const HousekeepingRoutes = router;
