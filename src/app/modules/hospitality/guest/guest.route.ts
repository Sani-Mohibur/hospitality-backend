import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { requireLocationId } from '../../../middlewares/locationScope';
import validateRequest from '../../../middlewares/validateRequest';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import AppError from '../../../errors/AppError';
import { PERMISSION } from '../../user/user.constant';
import { GuestServices } from './guest.service';
import { fileUploader } from '../../../utils/fileUploader';
import { body, objectId } from '../../../utils/zod';

const router = Router();
const P = PERMISSION;

const fields = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  nationality: z.string().optional(),
  dateOfBirth: z.string().optional(),
  address: z.string().optional(),
  idType: z.string().optional(),
  idNumber: z.string().optional(),
  idExpiry: z.string().optional(),
  preferences: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  dietary: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  companyAccountId: objectId.optional(),
  consent: z.object({ marketing: z.boolean().optional(), dataProcessing: z.boolean().optional(), source: z.string().optional() }).optional(),
});

// Guests are shared by the hotel and every outlet, so no module gate here.
router.use(tenantUser());

router.get(
  '/',
  authorize(P.GUESTS_VIEW),
  catchAsync(async (req, res) => {
    const result = await GuestServices.searchGuests(req.query);
    ok(res, 'Guests retrieved successfully', result.data, { meta: result.meta });
  }),
);

// POS lookup: in-house guests by room number or name (charge to room, allergies).
router.get(
  '/in-house',
  authorize(P.GUESTS_VIEW),
  locationScope(),
  catchAsync(async (req, res) =>
    ok(res, 'In-house guests', await GuestServices.inHouse(requireLocationId(req), req.query as { roomNumber?: string; searchTerm?: string })),
  ),
);

router.post(
  '/duplicates',
  authorize(P.GUESTS_VIEW),
  catchAsync(async (req, res) => ok(res, 'Possible duplicates', await GuestServices.findDuplicates(req.body))),
);

router.post(
  '/',
  authorize(P.GUESTS_MANAGE),
  validateRequest(z.object({ body: fields.extend({ allowDuplicate: z.boolean().optional() }) })),
  catchAsync(async (req, res) => {
    const { allowDuplicate, ...payload } = req.body;
    if (payload.idNumber && !req.user.permissions.includes(P.GUESTS_PII)) throw new AppError(httpStatus.FORBIDDEN, 'Missing permission to store ID numbers');
    ok(res, 'Guest created successfully', await GuestServices.createGuest(payload, { allowDuplicate }), { statusCode: httpStatus.CREATED });
  }),
);

router.get(
  '/:id',
  authorize(P.GUESTS_VIEW),
  catchAsync(async (req, res) =>
    ok(res, 'Guest retrieved successfully', await GuestServices.getGuest(req.params.id as string, req.user.permissions.includes(P.GUESTS_PII))),
  ),
);

router.patch(
  '/:id',
  authorize(P.GUESTS_MANAGE),
  validateRequest(z.object({ body: fields.partial() })),
  catchAsync(async (req, res) => {
    if (req.body.idNumber !== undefined && !req.user.permissions.includes(P.GUESTS_PII)) {
      throw new AppError(httpStatus.FORBIDDEN, 'Missing permission to change ID numbers');
    }
    ok(res, 'Guest updated successfully', await GuestServices.updateGuest(req.params.id as string, req.body));
  }),
);

router.post(
  '/:id/merge',
  authorize(P.GUESTS_MERGE),
  validateRequest(body({ mergeGuestId: objectId })),
  catchAsync(async (req, res) => ok(res, 'Guests merged', await GuestServices.mergeGuests(req.params.id as string, req.body.mergeGuestId))),
);

router.post(
  '/:id/documents',
  authorize(P.GUESTS_PII),
  fileUploader.upload.single('file'),
  catchAsync(async (req, res) => {
    if (!req.file) throw new AppError(httpStatus.BAD_REQUEST, 'Attach the document as "file"');
    ok(res, 'Document stored', await GuestServices.addDocument(req.params.id as string, String(req.body.type || 'ID'), req.file), { statusCode: httpStatus.CREATED });
  }),
);

router.get(
  '/:id/export',
  authorize(P.GUESTS_PII),
  catchAsync(async (req, res) => ok(res, 'Guest data export', await GuestServices.exportGuest(req.params.id as string))),
);

router.post(
  '/:id/anonymize',
  authorize(P.GUESTS_MERGE),
  catchAsync(async (req, res) => ok(res, 'Guest anonymized', await GuestServices.anonymizeGuest(req.params.id as string))),
);

export const GuestRoutes = router;
