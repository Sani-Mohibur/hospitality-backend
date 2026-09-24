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
import { ReservationServices } from './reservation.service';
import { BOOKING_SOURCE } from './reservation.interface';
import { HotelInventory } from '../inventory/hotelInventory.service';
import { RateServices } from '../rate/rate.service';
import { ApprovalService } from '../../approval/approval.service';
import { body, businessDate, objectId } from '../../../utils/zod';

const router = Router();
const P = PERMISSION;

const guest = z.object({
  id: objectId.optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const stay = z.object({
  roomTypeId: objectId,
  ratePlanId: objectId,
  arrivalDate: businessDate,
  departureDate: businessDate,
  adults: z.number().int().min(1),
  children: z.number().int().min(0).optional(),
  roomId: objectId.optional(),
  guestIds: z.array(objectId).optional(),
  notes: z.string().optional(),
});

const guarantee = z.object({ type: z.enum(['NONE', 'CARD', 'DEPOSIT', 'COMPANY']), reference: z.string().optional() });

router.use(tenantUser(), requireModule('HOSPITALITY'));

// Price check before booking
router.post(
  '/quote',
  authorize(P.RESERVATIONS_VIEW, P.RESERVATIONS_MANAGE),
  locationScope(),
  validateRequest(body({ stays: z.array(stay.omit({ roomId: true, guestIds: true, notes: true })).min(1) })),
  catchAsync(async (req, res) => {
    const quotes = [];
    for (const s of req.body.stays) quotes.push(await RateServices.quoteStay({ ...s, children: s.children || 0 }));
    ok(res, 'Quote', { quotes, totalMinor: quotes.reduce((a, q) => a + q.totalMinor, 0) });
  }),
);

router.get(
  '/availability',
  authorize(P.RESERVATIONS_VIEW),
  locationScope(),
  catchAsync(async (req, res) => {
    const from = String(req.query.from);
    const to = String(req.query.to || req.query.from);
    ok(res, 'Availability', await HotelInventory.availability(requireLocationId(req), from, to));
  }),
);

router.get(
  '/free-rooms',
  authorize(P.RESERVATIONS_VIEW),
  locationScope(),
  catchAsync(async (req, res) => {
    const { roomTypeId, arrivalDate, departureDate } = req.query as Record<string, string>;
    ok(res, 'Free rooms', await HotelInventory.freeRooms(requireLocationId(req), roomTypeId!, arrivalDate!, departureDate!));
  }),
);

router.get(
  '/',
  authorize(P.RESERVATIONS_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const result = await ReservationServices.listReservations(locationFilter(req), req.query);
    ok(res, 'Reservations retrieved successfully', result.data, { meta: result.meta });
  }),
);

router.post(
  '/',
  authorize(P.RESERVATIONS_MANAGE),
  locationScope(),
  validateRequest(
    body({
      guest,
      stays: z.array(stay).min(1).max(50),
      source: z.enum(Object.values(BOOKING_SOURCE) as [string, ...string[]]).optional(),
      companyAccountId: objectId.optional(),
      allotmentId: objectId.optional(),
      groupName: z.string().optional(),
      eta: z.string().optional(),
      notes: z.string().optional(),
      specialRequests: z.string().optional(),
      guarantee: guarantee.optional(),
      confirm: z.boolean().optional(),
      overrideRestrictions: z.boolean().optional(),
    }),
  ),
  catchAsync(async (req, res) => {
    const result = await ReservationServices.createReservation(req, { ...req.body, locationId: requireLocationId(req) });
    ok(res, 'Reservation created successfully', result, { statusCode: httpStatus.CREATED });
  }),
);

router.post(
  '/walk-in',
  authorize(P.FRONT_DESK),
  locationScope(),
  validateRequest(
    body({
      guest,
      stay: stay.omit({ arrivalDate: true }).extend({ roomId: objectId }),
      companyAccountId: objectId.optional(),
      notes: z.string().optional(),
      guarantee: guarantee.optional(),
      allowDirtyRoom: z.boolean().optional(),
    }),
  ),
  catchAsync(async (req, res) => {
    const result = await ReservationServices.walkIn(req, { ...req.body, locationId: requireLocationId(req) });
    ok(res, 'Walk-in checked in', result, { statusCode: httpStatus.CREATED });
  }),
);

router.post(
  '/auto-assign',
  authorize(P.FRONT_DESK),
  locationScope(),
  validateRequest(body({ date: businessDate })),
  catchAsync(async (req, res) => {
    ok(res, 'Rooms assigned', await ReservationServices.autoAssign(requireLocationId(req), req.body.date));
  }),
);

router.get(
  '/:id',
  authorize(P.RESERVATIONS_VIEW),
  catchAsync(async (req, res) => ok(res, 'Reservation retrieved successfully', await ReservationServices.getReservation(req.params.id as string))),
);

router.patch(
  '/:id',
  authorize(P.RESERVATIONS_MANAGE),
  validateRequest(
    body({
      notes: z.string().optional(),
      specialRequests: z.string().optional(),
      eta: z.string().optional(),
      companyAccountId: objectId.nullable().optional(),
      groupName: z.string().optional(),
      guarantee: guarantee.optional(),
      bookerGuestId: objectId.optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Reservation updated successfully', await ReservationServices.updateReservation(req.params.id as string, req.body))),
);

router.post(
  '/:id/confirm',
  authorize(P.RESERVATIONS_MANAGE),
  validateRequest(body({ guarantee: guarantee.optional() })),
  catchAsync(async (req, res) => ok(res, 'Reservation confirmed', await ReservationServices.confirmReservation(req.params.id as string, req.body.guarantee))),
);

router.get(
  '/:id/cancellation-fee',
  authorize(P.RESERVATIONS_VIEW),
  catchAsync(async (req, res) => ok(res, 'Cancellation terms', await ReservationServices.cancelFeePreview(req.params.id as string))),
);

router.post(
  '/:id/cancel',
  authorize(P.RESERVATIONS_MANAGE),
  validateRequest(body({ reason: z.string().min(2), waiveFee: z.boolean().optional(), stayIds: z.array(objectId).optional() })),
  catchAsync(async (req, res) => ok(res, 'Reservation cancelled', await ReservationServices.cancelReservation(req, req.params.id as string, req.body))),
);

router.post(
  '/:id/pre-arrival-link',
  authorize(P.RESERVATIONS_MANAGE),
  catchAsync(async (req, res) => ok(res, 'Online check-in link created', await ReservationServices.createPreArrivalLink(req.params.id as string))),
);

// ----- Room stays -----
router.patch(
  '/stays/:stayId',
  authorize(P.RESERVATIONS_MANAGE),
  validateRequest(
    body({
      arrivalDate: businessDate.optional(),
      departureDate: businessDate.optional(),
      roomTypeId: objectId.optional(),
      ratePlanId: objectId.optional(),
      adults: z.number().int().min(1).optional(),
      children: z.number().int().min(0).optional(),
      keepRates: z.boolean().optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Stay updated', await ReservationServices.modifyStay(req, req.params.stayId as string, req.body))),
);

router.post(
  '/stays/:stayId/assign-room',
  authorize(P.RESERVATIONS_MANAGE, P.FRONT_DESK),
  validateRequest(body({ roomId: objectId })),
  catchAsync(async (req, res) => ok(res, 'Room assigned', await ReservationServices.assignRoom(req.params.stayId as string, req.body.roomId))),
);

router.post(
  '/stays/:stayId/unassign-room',
  authorize(P.RESERVATIONS_MANAGE, P.FRONT_DESK),
  catchAsync(async (req, res) => ok(res, 'Room unassigned', await ReservationServices.unassignRoom(req.params.stayId as string))),
);

router.post(
  '/stays/:stayId/room-move',
  authorize(P.FRONT_DESK),
  validateRequest(body({ roomId: objectId, reason: z.string().min(2), reprice: z.boolean().optional() })),
  catchAsync(async (req, res) => ok(res, 'Guest moved', await ReservationServices.roomMove(req, req.params.stayId as string, req.body))),
);

router.post(
  '/stays/:stayId/check-in',
  authorize(P.FRONT_DESK),
  validateRequest(
    body({
      roomId: objectId.optional(),
      guestIds: z.array(objectId).optional(),
      allowDirtyRoom: z.boolean().optional(),
      registration: z.object({ signatureUrl: z.string().optional(), idVerified: z.boolean().optional() }).optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Guest checked in', await ReservationServices.checkIn(req, req.params.stayId as string, req.body))),
);

router.post(
  '/stays/:stayId/undo-check-in',
  authorize(P.FRONT_DESK),
  catchAsync(async (req, res) => ok(res, 'Check-in undone', await ReservationServices.undoCheckIn(req, req.params.stayId as string))),
);

router.post(
  '/stays/:stayId/check-out',
  authorize(P.FRONT_DESK),
  validateRequest(
    body({
      transferToCompany: z.boolean().optional(),
      billTo: z.object({ name: z.string().optional(), address: z.string().optional(), taxId: z.string().optional() }).optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Guest checked out', await ReservationServices.checkOut(req, req.params.stayId as string, req.body))),
);

router.post(
  '/stays/:stayId/no-show',
  authorize(P.FRONT_DESK),
  validateRequest(body({ waiveFee: z.boolean().optional() })),
  catchAsync(async (req, res) => {
    const approvedBy = req.body.waiveFee ? await ApprovalService.requireApproval(req, 'NO_SHOW_WAIVE') : undefined;
    ok(res, 'Marked as no-show', await ReservationServices.markNoShow(req.params.stayId as string, { waiveFee: req.body.waiveFee, approvedBy }));
  }),
);

export const ReservationRoutes = router;
