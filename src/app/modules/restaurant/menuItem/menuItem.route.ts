import express from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { PERMISSION } from '../../user/user.constant';
import { MenuItem, ModifierGroup } from './menuItem.model';
import { MenuCategory } from '../menuCategory/menuCategory.model';
import { MenuServices } from './menu.service';
import { activity } from '../../auditLog/auditLog.service';
import { publish, rooms as socketRooms } from '../../../utils/realtime';
import { found } from '../../../utils/query';
import { TAX_CATEGORY } from '../../../utils/money';
import { body, objectId, positiveMinor } from '../../../utils/zod';

const router = express.Router();
const P = PERMISSION;

const itemFields = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sku: z.string().optional(),
  priceMinor: positiveMinor,
  categoryId: objectId,
  // Omit for a master-menu item shared by all locations
  locationId: objectId.optional(),
  outletIds: z.array(objectId).optional(),
  taxCategory: z.enum(Object.values(TAX_CATEGORY) as [string, ...string[]]).optional(),
  stationId: objectId.optional(),
  defaultCourse: z.number().int().min(1).max(9).optional(),
  modifierGroupIds: z.array(objectId).optional(),
  imageUrl: z.string().url().optional(),
  allergens: z.array(z.string()).optional(),
  availableQty: z.number().int().min(0).nullable().optional(),
  prepMinutes: z.number().int().min(0).optional(),
  locationOverrides: z.array(z.object({ locationId: objectId, priceMinor: positiveMinor.optional(), isAvailable: z.boolean().optional() })).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const groupFields = z.object({
  name: z.string().min(1),
  locationId: objectId.optional(),
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  maxPerOption: z.number().int().min(1).optional(),
  options: z.array(z.object({ name: z.string().min(1), priceMinor: z.number().int(), isDefault: z.boolean().optional(), isAvailable: z.boolean().optional() })).min(1),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('RESTAURANT'));

// POS view of an outlet's current menu
router.get(
  '/outlet/:outletId',
  catchAsync(async (req, res) => ok(res, 'Outlet menu', await MenuServices.outletMenu(req.params.outletId as string))),
);

router.get(
  '/',
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.locationId) filter.$or = [{ locationId: req.locationId }, { locationId: null }];
    else if (req.scopedLocationIds) filter.$or = [{ locationId: { $in: req.scopedLocationIds } }, { locationId: null }];
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    if (req.query.master === 'true') filter.locationId = null;
    ok(res, 'Menu items retrieved successfully', await MenuItem.find(filter).populate('categoryId', 'name').sort({ sortOrder: 1, name: 1 }).lean());
  }),
);

router.post(
  '/',
  authorize(P.MENU_MANAGE),
  validateRequest(z.object({ body: itemFields })),
  catchAsync(async (req, res) => {
    const category = found(await MenuCategory.findById(req.body.categoryId).lean(), 'Menu category');
    if (req.body.locationId && category.locationId && String(category.locationId) !== req.body.locationId) {
      return ok(res, 'Category belongs to another location', null, { statusCode: httpStatus.BAD_REQUEST });
    }
    const item = await MenuItem.create(req.body);
    await activity.record({ action: 'MENU_ITEM_CREATED', entity: 'MenuItem', entityId: item._id, message: `Added ${item.name} at ${item.priceMinor}` });
    ok(res, 'Menu item created successfully', item, { statusCode: httpStatus.CREATED });
  }),
);

// ----- Modifier groups -----
router.get(
  '/modifier-groups',
  catchAsync(async (_req, res) => ok(res, 'Modifier groups', await ModifierGroup.find().sort({ name: 1 }).lean())),
);

router.post(
  '/modifier-groups',
  authorize(P.MENU_MANAGE),
  validateRequest(z.object({ body: groupFields })),
  catchAsync(async (req, res) => {
    if (req.body.minSelect > req.body.maxSelect) return ok(res, 'minSelect cannot exceed maxSelect', null, { statusCode: httpStatus.BAD_REQUEST });
    ok(res, 'Modifier group created', await ModifierGroup.create(req.body), { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/modifier-groups/:id',
  authorize(P.MENU_MANAGE),
  validateRequest(z.object({ body: groupFields.partial() })),
  catchAsync(async (req, res) => {
    const group = found(await ModifierGroup.findById(req.params.id), 'Modifier group');
    Object.assign(group, req.body);
    await group.save();
    ok(res, 'Modifier group updated', group);
  }),
);

router.delete(
  '/modifier-groups/:id',
  authorize(P.MENU_MANAGE),
  catchAsync(async (req, res) => {
    await MenuItem.updateMany({ modifierGroupIds: req.params.id } as any, { $pull: { modifierGroupIds: req.params.id } } as any);
    ok(res, 'Modifier group deleted', found(await ModifierGroup.findByIdAndUpdate(req.params.id, { isDeleted: true }, { returnDocument: 'after' }), 'Modifier group'));
  }),
);

router.get(
  '/:id',
  catchAsync(async (req, res) => ok(res, 'Menu item retrieved successfully', found(await MenuItem.findById(req.params.id).populate('categoryId modifierGroupIds').lean(), 'Menu item'))),
);

router.patch(
  '/:id',
  authorize(P.MENU_MANAGE),
  validateRequest(z.object({ body: itemFields.partial() })),
  catchAsync(async (req, res) => {
    const item = found(await MenuItem.findById(req.params.id), 'Menu item');
    const before = item.toObject();
    Object.assign(item, req.body);
    if (req.body.availableQty === null) item.availableQty = undefined;
    await item.save();
    await activity.record({ action: 'MENU_ITEM_UPDATED', entity: 'MenuItem', entityId: item._id, message: `Updated ${item.name}`, before, after: item.toObject() });
    ok(res, 'Menu item updated successfully', item);
  }),
);

// "86" an item (sold out) or bring it back; every POS updates live.
router.post(
  '/:id/availability',
  authorize(P.MENU_MANAGE, P.KDS_UPDATE),
  validateRequest(body({ soldOut: z.boolean(), availableQty: z.number().int().min(0).nullable().optional() })),
  catchAsync(async (req, res) => {
    const item = found(await MenuItem.findById(req.params.id), 'Menu item');
    item.isSoldOut = req.body.soldOut;
    if (req.body.availableQty !== undefined) item.availableQty = req.body.availableQty ?? undefined;
    await item.save();
    await activity.record({ action: 'ITEM_86', entity: 'MenuItem', entityId: item._id, message: `${item.name} ${item.isSoldOut ? 'sold out' : 'available again'}` });
    const roomsToNotify = item.locationId ? [socketRooms.location(item.locationId)] : [socketRooms.tenant(req.user.tenantId)];
    void publish({ tenantId: req.user.tenantId, locationId: item.locationId, rooms: roomsToNotify, event: 'menu_item_availability', data: { itemId: item._id, soldOut: item.isSoldOut, availableQty: item.availableQty } });
    ok(res, 'Availability updated', item);
  }),
);

router.delete(
  '/:id',
  authorize(P.MENU_MANAGE),
  catchAsync(async (req, res) =>
    ok(res, 'Menu item deleted successfully', found(await MenuItem.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false }, { returnDocument: 'after' }), 'Menu item')),
  ),
);

export const MenuItemRoutes = router;
