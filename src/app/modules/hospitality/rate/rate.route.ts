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
import { MEAL_PLAN, PENALTY_TYPE, RatePlan } from './rate.model';
import { RateServices } from './rate.service';
import { Allotment } from '../inventory/hotelInventory.model';
import { HotelInventory } from '../inventory/hotelInventory.service';
import { found } from '../../../utils/query';
import { RateSuggestionService } from './rateSuggestion.service';
import { body, businessDate, objectId, positiveMinor } from '../../../utils/zod';

const router = Router();
const P = PERMISSION;

const penalty = z.object({ type: z.enum(Object.values(PENALTY_TYPE) as [string, ...string[]]), value: z.number().min(0) });
const priceRow = z.object({ roomTypeId: objectId, amountMinor: positiveMinor });

const planFields = z.object({
  name: z.string().min(1),
  code: z.string().min(2).max(12),
  description: z.string().optional(),
  roomTypeIds: z.array(objectId).optional(),
  mealPlan: z.enum(Object.values(MEAL_PLAN) as [string, ...string[]]).optional(),
  pricingMode: z.enum(['BASE', 'DERIVED']).optional(),
  parentRatePlanId: objectId.optional(),
  adjustBps: z.number().int().min(-10000).max(10000).optional(),
  adjustMinor: z.number().int().optional(),
  rates: z.array(priceRow).optional(),
  weekendRates: z.array(priceRow).optional(),
  weekendDays: z.array(z.number().int().min(0).max(6)).optional(),
  packages: z
    .array(z.object({ chargeCode: z.string(), label: z.string(), amountMinor: positiveMinor, per: z.enum(['PERSON', 'ROOM']).optional() }))
    .optional(),
  cancellation: z.object({ freeUntilHours: z.number().min(0), penalty }).optional(),
  noShow: z.object({ penalty }).optional(),
  deposit: z
    .object({ type: z.enum(['NONE', 'PERCENT', 'NIGHTS', 'FIXED']), value: z.number().min(0), dueDaysBeforeArrival: z.number().int().min(0) })
    .optional(),
  guaranteeRequired: z.boolean().optional(),
  isRefundable: z.boolean().optional(),
  minLos: z.number().int().min(1).optional(),
  maxLos: z.number().int().min(1).optional(),
  isPublic: z.boolean().optional(),
  channelCode: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('HOSPITALITY'));

router.get(
  '/plans',
  authorize(P.RESERVATIONS_VIEW, P.RATES_MANAGE),
  locationScope({ required: false }),
  catchAsync(async (req, res) => ok(res, 'Rate plans', await RatePlan.find(locationFilter(req)).sort({ code: 1 }).lean())),
);

router.get(
  '/plans/:id',
  authorize(P.RESERVATIONS_VIEW, P.RATES_MANAGE),
  catchAsync(async (req, res) => ok(res, 'Rate plan', found(await RatePlan.findById(req.params.id).lean(), 'Rate plan'))),
);

router.post(
  '/plans',
  authorize(P.RATES_MANAGE),
  locationScope(),
  validateRequest(z.object({ body: planFields })),
  catchAsync(async (req, res) =>
    ok(res, 'Rate plan created', await RateServices.createRatePlan(requireLocationId(req), req.body), { statusCode: httpStatus.CREATED }),
  ),
);

router.patch(
  '/plans/:id',
  authorize(P.RATES_MANAGE),
  validateRequest(z.object({ body: planFields.partial() })),
  catchAsync(async (req, res) => ok(res, 'Rate plan updated', await RateServices.updateRatePlan(req.params.id as string, req.body))),
);

router.delete(
  '/plans/:id',
  authorize(P.RATES_MANAGE),
  catchAsync(async (req, res) =>
    ok(res, 'Rate plan archived', found(await RatePlan.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false }, { returnDocument: 'after' }), 'Rate plan')),
  ),
);

// Rate calendar
router.get(
  '/calendar',
  authorize(P.RESERVATIONS_VIEW, P.RATES_MANAGE),
  catchAsync(async (req, res) => ok(res, 'Rate calendar', await RateServices.rateCalendar(req.query as any))),
);

router.put(
  '/calendar',
  authorize(P.RATES_MANAGE),
  validateRequest(
    body({
      ratePlanId: objectId,
      roomTypeIds: z.array(objectId).min(1),
      from: businessDate,
      to: businessDate,
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
      amountMinor: positiveMinor.nullable().optional(),
      closed: z.boolean().optional(),
      closedToArrival: z.boolean().optional(),
      closedToDeparture: z.boolean().optional(),
      minLos: z.number().int().min(1).nullable().optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Rates updated', await RateServices.setDailyRates(req.body))),
);

// Allotments (rooms held for a company or group)
router.get(
  '/allotments',
  authorize(P.RESERVATIONS_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => ok(res, 'Allotments', await Allotment.find(locationFilter(req)).sort({ from: 1 }).lean())),
);

router.post(
  '/allotments',
  authorize(P.RATES_MANAGE),
  locationScope(),
  validateRequest(
    body({
      name: z.string().min(1),
      roomTypeId: objectId,
      companyAccountId: objectId.optional(),
      ratePlanId: objectId.optional(),
      from: businessDate,
      to: businessDate,
      roomsPerNight: z.number().int().min(1),
      releaseDays: z.number().int().min(0).optional(),
    }),
  ),
  catchAsync(async (req, res) =>
    ok(res, 'Allotment created', await HotelInventory.createAllotment({ ...req.body, locationId: requireLocationId(req) }), { statusCode: httpStatus.CREATED }),
  ),
);

router.post(
  '/allotments/:id/release',
  authorize(P.RATES_MANAGE),
  catchAsync(async (req, res) =>
    ok(res, 'Unpicked rooms released', { released: await HotelInventory.releaseAllotmentNights(req.params.id as string, '9999-12-31', true) }),
  ),
);

// Pricing suggestions from occupancy and booking pace
router.get(
  '/suggestions',
  authorize(P.RATES_MANAGE),
  locationScope(),
  catchAsync(async (req, res) =>
    ok(
      res,
      'Rate suggestions',
      await RateSuggestionService.suggest(requireLocationId(req), {
        ratePlanId: String(req.query.ratePlanId),
        days: req.query.days ? Number(req.query.days) : undefined,
        maxChangePct: req.query.maxChangePct ? Number(req.query.maxChangePct) : undefined,
      }),
    ),
  ),
);

router.post(
  '/suggestions/apply',
  authorize(P.RATES_MANAGE),
  validateRequest(body({ ratePlanId: objectId, items: z.array(z.object({ roomTypeId: objectId, date: businessDate, amountMinor: positiveMinor })).min(1).max(500) })),
  catchAsync(async (req, res) => ok(res, 'Suggestions applied', await RateSuggestionService.apply(req.body.ratePlanId, req.body.items))),
);

export const RateRoutes = router;
