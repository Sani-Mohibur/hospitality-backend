import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { locationFilter, requireLocationId } from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import AppError from '../../../errors/AppError';
import { PERMISSION } from '../../user/user.constant';
import { RoomCategory } from './roomCategory.model';
import { Room } from '../room/room.model';
import { activity } from '../../auditLog/auditLog.service';
import { found } from '../../../utils/query';
import { positiveMinor } from '../../../utils/zod';

const router = Router();

const fields = z.object({
  name: z.string().min(1),
  code: z.string().max(10).optional(),
  description: z.string().optional(),
  baseRateMinor: positiveMinor,
  baseOccupancy: z.number().int().min(1).optional(),
  capacity: z.number().int().min(1),
  maxAdults: z.number().int().min(1).optional(),
  maxChildren: z.number().int().min(0).optional(),
  extraAdultMinor: positiveMinor.optional(),
  extraChildMinor: positiveMinor.optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string().url()).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('HOSPITALITY'));

router.get(
  '/',
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const types = await RoomCategory.find(locationFilter(req)).sort({ sortOrder: 1, name: 1 }).lean();
    const counts = await Room.aggregate([{ $match: { isDeleted: false, isActive: true } }, { $group: { _id: '$roomCategoryId', rooms: { $sum: 1 } } }]);
    const byType = new Map(counts.map((c) => [String(c._id), c.rooms]));
    ok(res, 'Room types retrieved successfully', types.map((t) => ({ ...t, rooms: byType.get(String(t._id)) || 0 })));
  }),
);

router.get(
  '/:id',
  catchAsync(async (req, res) => ok(res, 'Room type retrieved successfully', found(await RoomCategory.findById(req.params.id).lean(), 'Room type'))),
);

router.post(
  '/',
  authorize(PERMISSION.ROOMS_CONFIG),
  locationScope(),
  validateRequest(z.object({ body: fields })),
  catchAsync(async (req, res) => {
    const type = await RoomCategory.create({ ...req.body, locationId: requireLocationId(req) });
    await activity.record({ action: 'ROOM_TYPE_CREATED', entity: 'RoomCategory', entityId: type._id, message: `Added room type ${type.name}` });
    ok(res, 'Room type created successfully', type, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/:id',
  authorize(PERMISSION.ROOMS_CONFIG),
  validateRequest(z.object({ body: fields.partial() })),
  catchAsync(async (req, res) => {
    const type = found(await RoomCategory.findById(req.params.id), 'Room type');
    const before = type.toObject();
    Object.assign(type, req.body);
    await type.save();
    await activity.record({ action: 'ROOM_TYPE_UPDATED', entity: 'RoomCategory', entityId: type._id, message: `Updated room type ${type.name}`, before, after: type.toObject() });
    ok(res, 'Room type updated successfully', type);
  }),
);

router.delete(
  '/:id',
  authorize(PERMISSION.ROOMS_CONFIG),
  catchAsync(async (req, res) => {
    const inUse = await Room.exists({ roomCategoryId: req.params.id });
    if (inUse) throw new AppError(httpStatus.CONFLICT, 'Move or delete the rooms of this type first');
    const type = found(await RoomCategory.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false }, { returnDocument: 'after' }), 'Room type');
    ok(res, 'Room type deleted successfully', type);
  }),
);

export const RoomCategoryRoutes = router;
