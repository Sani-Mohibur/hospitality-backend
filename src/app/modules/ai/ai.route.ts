import { Router } from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import requireModule from '../../middlewares/requireModule';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import { PERMISSION } from '../user/user.constant';
import { Tenant } from '../tenant/tenant.model';
import { requestContext } from '../../utils/requestContext';
import { AiService } from './ai.service';
import { body } from '../../utils/zod';

const router = Router();

// Each question can run several model calls; keep per-user volume sensible.
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, keyGenerator: (req) => (req as any).user?.id || ipKeyGenerator(req.ip || '') });

router.post(
  '/ask',
  tenantUser(),
  authorize(PERMISSION.REPORTS_VIEW),
  requireModule('AI_ASSISTANT'),
  aiLimiter,
  validateRequest(body({ question: z.string().min(3).max(1000) })),
  catchAsync(async (req, res) => {
    const tenant = await requestContext.asSystem(() => Tenant.findById(req.user.tenantId).select('currency').lean());
    try {
      const result = await AiService.ask(req.body.question, { allLocations: req.user.allLocations, locationIds: req.user.locationIds }, tenant?.currency || 'USD');
      ok(res, 'Answer', result);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AppError(httpStatus.TOO_MANY_REQUESTS, 'The assistant is busy; try again shortly');
      if (err instanceof Anthropic.APIError) throw new AppError(httpStatus.BAD_GATEWAY, `Assistant error (${err.status})`);
      throw err;
    }
  }),
);

export const AiRoutes = router;
