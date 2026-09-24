import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import httpStatus from 'http-status';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PublicServices } from './public.service';
import { itemInput } from '../restaurant/order/order.route';
import { body, businessDate, objectId, positiveMinor } from '../../utils/zod';

// Endpoints for guests (no login): booking engine, online check-in and Guest QR.
const router = Router();

const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.use(publicLimiter);

// ----- Booking engine -----
router.get('/booking/:slug', catchAsync(async (req, res) => ok(res, 'Booking page', await PublicServices.bookingPage(req.params.slug as string))));

router.get(
  '/booking/:slug/availability',
  catchAsync(async (req, res) => {
    const q = z
      .object({ arrivalDate: businessDate, departureDate: businessDate, adults: z.coerce.number().int().min(1).max(10), children: z.coerce.number().int().min(0).max(10).default(0) })
      .parse(req.query);
    ok(res, 'Available rooms', await PublicServices.bookingAvailability(req.params.slug as string, q));
  }),
);

router.post(
  '/booking/:slug/reservations',
  writeLimiter,
  validateRequest(
    body({
      guest: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(), phone: z.string().optional() }),
      roomTypeId: objectId,
      ratePlanId: objectId,
      arrivalDate: businessDate,
      departureDate: businessDate,
      adults: z.number().int().min(1).max(10),
      children: z.number().int().min(0).max(10).optional(),
      rooms: z.number().int().min(1).max(10).optional(),
      specialRequests: z.string().max(1000).optional(),
      marketingConsent: z.boolean().optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Booking received', await PublicServices.bookingCreate(req.params.slug as string, req.body), { statusCode: httpStatus.CREATED })),
);

// ----- Online check-in -----
router.get('/check-in/:token', catchAsync(async (req, res) => ok(res, 'Online check-in', await PublicServices.preArrivalView(req.params.token as string))));

router.post(
  '/check-in/:token',
  writeLimiter,
  validateRequest(
    body({
      guest: z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        nationality: z.string().optional(),
        dateOfBirth: z.string().optional(),
        idType: z.string().optional(),
        idNumber: z.string().optional(),
      }),
      eta: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      signatureUrl: z.string().max(200000).optional(),
      acceptTerms: z.boolean(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Thank you, you are checked in online', await PublicServices.preArrivalSubmit(req.params.token as string, req.body, req.ip))),
);

// ----- Guest QR (room or table) -----
router.get('/qr/:token', catchAsync(async (req, res) => ok(res, 'Welcome', await PublicServices.qrContext(req.params.token as string))));
router.get('/qr/:token/menu', catchAsync(async (req, res) => ok(res, 'Menu', await PublicServices.qrMenu(req.params.token as string, req.query.outletId as string | undefined))));

router.post(
  '/qr/:token/orders',
  writeLimiter,
  validateRequest(body({ items: z.array(itemInput).min(1).max(30), outletId: objectId.optional(), lastName: z.string().optional(), notes: z.string().max(300).optional() })),
  catchAsync(async (req, res) => ok(res, 'Order sent', await PublicServices.qrOrder(req.params.token as string, req.body), { statusCode: httpStatus.CREATED })),
);

router.post(
  '/qr/:token/requests',
  writeLimiter,
  validateRequest(body({ notes: z.string().min(2).max(300), lastName: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Request sent', await PublicServices.qrRequest(req.params.token as string, req.body), { statusCode: httpStatus.CREATED })),
);

router.get('/qr/:token/bill', catchAsync(async (req, res) => ok(res, 'Your bill', await PublicServices.qrBill(req.params.token as string, req.query.lastName as string | undefined))));

router.post(
  '/qr/:token/pay',
  writeLimiter,
  validateRequest(body({ amountMinor: positiveMinor.min(1), tipMinor: positiveMinor.optional(), lastName: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Complete the payment', await PublicServices.qrPay(req.params.token as string, req.body))),
);

export const PublicRoutes = router;
