import express from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { requireLocationId } from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import AppError from '../../../errors/AppError';
import { PERMISSION } from '../../user/user.constant';
import { MenuCategory, MenuSchedule } from './menuCategory.model';
import { MenuItem } from '../menuItem/menuItem.model';
import { found } from '../../../utils/query';
import { objectId, timeOfDay } from '../../../utils/zod';

const router = express.Router();
const P = PERMISSION;

const fields = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  locationId: objectId.optional(),
  outletIds: z.array(objectId).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const scheduleFields = z.object({
  name: z.string().min(1),
  outletIds: z.array(objectId).optional(),
  categoryIds: z.array(objectId).min(1),
  windows: z.array(z.object({ days: z.array(z.number().int().min(0).max(6)).optional(), from: timeOfDay, to: timeOfDay })).min(1),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('RESTAURANT'));

router.get(
  '/',
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const filter = req.locationId
      ? { $or: [{ locationId: req.locationId }, { locationId: null }] }
      : req.scopedLocationIds
      ? { $or: [{ locationId: { $in: req.scopedLocationIds } }, { locationId: null }] }
      : {};
    ok(res, 'Menu categories retrieved successfully', await MenuCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean());
  }),
);

router.post(
  '/',
  authorize(P.MENU_MANAGE),
  validateRequest(z.object({ body: fields })),
  catchAsync(async (req, res) => ok(res, 'Menu category created successfully', await MenuCategory.create(req.body), { statusCode: httpStatus.CREATED })),
);

// Time-based menus (breakfast, lunch, happy hour)
router.get(
  '/schedules',
  locationScope(),
  catchAsync(async (req, res) => ok(res, 'Menu schedules', await MenuSchedule.find({ locationId: requireLocationId(req) }).lean())),
);

router.post(
  '/schedules',
  authorize(P.MENU_MANAGE),
  locationScope(),
  validateRequest(z.object({ body: scheduleFields })),
  catchAsync(async (req, res) =>
    ok(res, 'Menu schedule created', await MenuSchedule.create({ ...req.body, locationId: requireLocationId(req) }), { statusCode: httpStatus.CREATED }),
  ),
);

router.patch(
  '/schedules/:id',
  authorize(P.MENU_MANAGE),
  validateRequest(z.object({ body: scheduleFields.partial() })),
  catchAsync(async (req, res) =>
    ok(res, 'Menu schedule updated', found(await MenuSchedule.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true }), 'Menu schedule')),
  ),
);

router.delete(
  '/schedules/:id',
  authorize(P.MENU_MANAGE),
  catchAsync(async (req, res) => {
    found(await MenuSchedule.findByIdAndDelete(req.params.id), 'Menu schedule');
    ok(res, 'Menu schedule deleted', null);
  }),
);

router.get(
  '/:id',
  catchAsync(async (req, res) => ok(res, 'Menu category retrieved successfully', found(await MenuCategory.findById(req.params.id).lean(), 'Menu category'))),
);

router.patch(
  '/:id',
  authorize(P.MENU_MANAGE),
  validateRequest(z.object({ body: fields.partial() })),
  catchAsync(async (req, res) =>
    ok(res, 'Menu category updated successfully', found(await MenuCategory.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true }), 'Menu category')),
  ),
);

router.delete(
  '/:id',
  authorize(P.MENU_MANAGE),
  catchAsync(async (req, res) => {
    if (await MenuItem.exists({ categoryId: req.params.id })) throw new AppError(httpStatus.CONFLICT, 'Move or delete the items in this category first');
    ok(res, 'Menu category deleted successfully', found(await MenuCategory.findByIdAndUpdate(req.params.id, { isDeleted: true }, { returnDocument: 'after' }), 'Menu category'));
  }),
);

export const MenuCategoryRoutes = router;
