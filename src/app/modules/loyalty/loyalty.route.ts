import { Router } from 'express';
import { z } from 'zod';
import { authorize, tenantUser } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { LoyaltyService } from './loyalty.service';
import { body } from '../../utils/zod';

const router = Router();

router.use(tenantUser());

router.get('/guests/:guestId', authorize(PERMISSION.GUESTS_VIEW), catchAsync(async (req, res) => ok(res, 'Loyalty wallet', await LoyaltyService.wallet(req.params.guestId as string))));

router.post(
  '/guests/:guestId/adjust',
  authorize(PERMISSION.LOYALTY_MANAGE),
  validateRequest(body({ points: z.number().int().refine((v) => v !== 0, 'Points cannot be 0'), note: z.string().min(2) })),
  catchAsync(async (req, res) => ok(res, 'Points adjusted', await LoyaltyService.adjust(req.params.guestId as string, req.body.points, req.body.note))),
);

export const LoyaltyRoutes = router;
