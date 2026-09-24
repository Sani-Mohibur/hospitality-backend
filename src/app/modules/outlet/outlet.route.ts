import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope, { locationFilter } from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import requireModule from '../../middlewares/requireModule';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { OUTLET_TYPE, Outlet, STATION_TYPE, Station } from './outlet.model';
import { SubscriptionServices } from '../subscription/subscription.service';
import { activity } from '../auditLog/auditLog.service';
import { found } from '../../utils/query';

const router = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const outletBody = z.object({
  name: z.string().min(1),
  type: z.enum(Object.values(OUTLET_TYPE) as [string, ...string[]]).optional(),
  serviceChargeBps: z.number().int().min(0).max(3000).optional(),
  allowChargeToRoom: z.boolean().optional(),
  ticketTargetMinutes: z.number().int().min(1).max(240).optional(),
  defaultStationId: objectId.optional(),
  glCodes: z.object({ food: z.string().optional(), beverage: z.string().optional(), other: z.string().optional() }).optional(),
  isActive: z.boolean().optional(),
});

const stationBody = z.object({
  outletId: objectId,
  name: z.string().min(1),
  type: z.enum(Object.values(STATION_TYPE) as [string, ...string[]]).optional(),
  targetMinutes: z.number().int().min(1).max(240).optional(),
  printerName: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('RESTAURANT'));

router.get(
  '/',
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const outlets = await Outlet.find(locationFilter(req)).sort({ name: 1 }).lean();
    ok(res, 'Outlets retrieved', outlets);
  }),
);

router.post(
  '/',
  authorize(PERMISSION.LOCATIONS_MANAGE, PERMISSION.MENU_MANAGE),
  locationScope(),
  validateRequest(z.object({ body: outletBody })),
  catchAsync(async (req, res) => {
    const outlet = await Outlet.create({ ...req.body, locationId: req.locationId });
    await activity.record({ action: 'OUTLET_CREATED', entity: 'Outlet', entityId: outlet._id, message: `Added outlet ${outlet.name}` });
    await SubscriptionServices.recalculate(req.user.tenantId!);
    ok(res, 'Outlet created', outlet, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/:id',
  authorize(PERMISSION.LOCATIONS_MANAGE, PERMISSION.MENU_MANAGE),
  validateRequest(z.object({ body: outletBody.partial() })),
  catchAsync(async (req, res) => {
    const outlet = found(await Outlet.findById(req.params.id), 'Outlet');
    const before = outlet.toObject();
    Object.assign(outlet, req.body);
    await outlet.save();
    await activity.record({ action: 'OUTLET_UPDATED', entity: 'Outlet', entityId: outlet._id, message: `Updated outlet ${outlet.name}`, before, after: outlet.toObject() });
    if (req.body.isActive !== undefined) await SubscriptionServices.recalculate(req.user.tenantId!);
    ok(res, 'Outlet updated', outlet);
  }),
);

router.delete(
  '/:id',
  authorize(PERMISSION.LOCATIONS_MANAGE),
  catchAsync(async (req, res) => {
    const outlet = found(await Outlet.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false }, { returnDocument: 'after' }), 'Outlet');
    await SubscriptionServices.recalculate(req.user.tenantId!);
    ok(res, 'Outlet deleted', outlet);
  }),
);

router.get(
  '/stations',
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const filter: Record<string, unknown> = { ...locationFilter(req) };
    if (req.query.outletId) filter.outletId = req.query.outletId;
    ok(res, 'Stations retrieved', await Station.find(filter).sort({ name: 1 }).lean());
  }),
);

router.post(
  '/stations',
  authorize(PERMISSION.MENU_MANAGE),
  validateRequest(z.object({ body: stationBody })),
  catchAsync(async (req, res) => {
    const outlet = found(await Outlet.findById(req.body.outletId), 'Outlet');
    const station = await Station.create({ ...req.body, locationId: outlet.locationId });
    ok(res, 'Station created', station, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/stations/:id',
  authorize(PERMISSION.MENU_MANAGE),
  validateRequest(z.object({ body: stationBody.omit({ outletId: true }).partial() })),
  catchAsync(async (req, res) => {
    const station = found(await Station.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true }), 'Station');
    ok(res, 'Station updated', station);
  }),
);

router.delete(
  '/stations/:id',
  authorize(PERMISSION.MENU_MANAGE),
  catchAsync(async (req, res) => {
    const station = found(await Station.findByIdAndUpdate(req.params.id, { isDeleted: true }, { returnDocument: 'after' }), 'Station');
    ok(res, 'Station deleted', station);
  }),
);

export const OutletRoutes = router;
