import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { locationFilter, requireLocationId } from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { PERMISSION } from '../../user/user.constant';
import { Room, RoomBlock } from './room.model';
import { HOUSEKEEPING_STATUS, ROOM_BLOCK_TYPE } from './room.interface';
import { RoomServices } from './room.service';
import { found } from '../../../utils/query';
import { randomToken } from '../../../utils/crypto';
import { body, businessDate, objectId } from '../../../utils/zod';

const router = Router();
const P = PERMISSION;

const roomFields = z.object({
  roomNumber: z.string().min(1),
  roomCategoryId: objectId,
  floor: z.string().optional(),
  features: z.array(z.string()).optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('HOSPITALITY'));

router.get(
  '/board',
  authorize(P.HOUSEKEEPING_VIEW, P.RESERVATIONS_VIEW, P.FRONT_DESK),
  locationScope(),
  catchAsync(async (req, res) => ok(res, 'Room board', await RoomServices.roomBoard(requireLocationId(req)))),
);

router.get(
  '/blocks',
  authorize(P.HOUSEKEEPING_VIEW, P.RESERVATIONS_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const filter: Record<string, unknown> = { ...locationFilter(req), releasedAt: null };
    if (req.query.from) filter.to = { $gt: req.query.from };
    ok(res, 'Room blocks', await RoomBlock.find(filter).populate('roomId', 'roomNumber').sort({ from: 1 }).lean());
  }),
);

router.post(
  '/blocks',
  authorize(P.HOUSEKEEPING_MANAGE, P.ROOMS_CONFIG),
  validateRequest(
    body({
      roomId: objectId,
      type: z.enum(Object.values(ROOM_BLOCK_TYPE) as [string, ...string[]]),
      from: businessDate,
      to: businessDate,
      reason: z.string().min(2),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Room blocked', await RoomServices.createBlock(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.post(
  '/blocks/:id/release',
  authorize(P.HOUSEKEEPING_MANAGE, P.ROOMS_CONFIG),
  catchAsync(async (req, res) => ok(res, 'Room block released', await RoomServices.releaseBlock(req, req.params.id as string))),
);

router.get(
  '/',
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const filter: Record<string, unknown> = { ...locationFilter(req) };
    if (req.query.roomCategoryId) filter.roomCategoryId = req.query.roomCategoryId;
    if (req.query.housekeepingStatus) filter.housekeepingStatus = req.query.housekeepingStatus;
    if (req.query.occupancyStatus) filter.occupancyStatus = req.query.occupancyStatus;
    ok(res, 'Rooms retrieved successfully', await Room.find(filter).populate('roomCategoryId', 'name code').sort({ roomNumber: 1 }).lean());
  }),
);

router.get(
  '/:id',
  catchAsync(async (req, res) =>
    ok(res, 'Room retrieved successfully', found(await Room.findById(req.params.id).populate('roomCategoryId locationId currentStayId').lean(), 'Room')),
  ),
);

router.post(
  '/',
  authorize(P.ROOMS_CONFIG),
  locationScope(),
  validateRequest(z.object({ body: roomFields })),
  catchAsync(async (req, res) =>
    ok(res, 'Room created successfully', await RoomServices.createRoom(req.user.tenantId!, requireLocationId(req), req.body), { statusCode: httpStatus.CREATED }),
  ),
);

router.post(
  '/bulk',
  authorize(P.ROOMS_CONFIG),
  locationScope(),
  validateRequest(body({ roomCategoryId: objectId, from: z.number().int(), to: z.number().int(), prefix: z.string().optional(), floor: z.string().optional() })),
  catchAsync(async (req, res) =>
    ok(res, 'Rooms created', await RoomServices.createRoomRange(req.user.tenantId!, requireLocationId(req), req.body), { statusCode: httpStatus.CREATED }),
  ),
);

router.patch(
  '/:id',
  authorize(P.ROOMS_CONFIG),
  validateRequest(z.object({ body: roomFields.partial() })),
  catchAsync(async (req, res) => ok(res, 'Room updated successfully', await RoomServices.updateRoom(req.params.id as string, req.body))),
);

router.patch(
  '/:id/housekeeping-status',
  authorize(P.HOUSEKEEPING_UPDATE),
  validateRequest(body({ status: z.enum(Object.values(HOUSEKEEPING_STATUS) as [string, ...string[]]) })),
  catchAsync(async (req, res) => ok(res, 'Housekeeping status updated', await RoomServices.setHousekeepingStatus(req, req.params.id as string, req.body.status))),
);

// New QR token invalidates the printed code (e.g. after a guest abused it).
router.post(
  '/:id/rotate-qr',
  authorize(P.ROOMS_CONFIG),
  catchAsync(async (req, res) => {
    const room = found(await Room.findByIdAndUpdate(req.params.id, { qrToken: randomToken(12) }, { returnDocument: 'after' }), 'Room');
    ok(res, 'QR code rotated', { roomId: room._id, qrToken: room.qrToken });
  }),
);

router.delete(
  '/:id',
  authorize(P.ROOMS_CONFIG),
  catchAsync(async (req, res) => ok(res, 'Room deleted successfully', await RoomServices.deleteRoom(req.user.tenantId!, req.params.id as string))),
);

export const RoomRoutes = router;
