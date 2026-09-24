import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { API_SCOPES, ApiKey, WEBHOOK_EVENTS, WebhookDelivery, WebhookSubscription } from './integration.model';
import { apiKeyAuth, IntegrationServices } from './integration.service';
import { found } from '../../utils/query';
import { body, businessDate, objectId, positiveMinor } from '../../utils/zod';

const router = Router();

// ----- Partner-facing endpoints (X-Api-Key) -----
router.get(
  '/channel/ari',
  apiKeyAuth('channel:read'),
  catchAsync(async (req, res) => ok(res, 'Availability, rates and restrictions', await IntegrationServices.ari(String(req.query.locationId), String(req.query.from), String(req.query.to)))),
);

router.post(
  '/channel/reservations',
  apiKeyAuth('channel:write'),
  validateRequest(
    body({
      locationId: objectId,
      channelName: z.string().min(1),
      externalRef: z.string().min(1),
      action: z.enum(['NEW', 'MODIFY', 'CANCEL']),
      guest: z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional() }),
      stays: z
        .array(
          z.object({
            roomTypeId: objectId.optional(),
            roomTypeCode: z.string().optional(),
            ratePlanId: objectId.optional(),
            ratePlanCode: z.string().optional(),
            arrivalDate: businessDate,
            departureDate: businessDate,
            adults: z.number().int().min(1),
            children: z.number().int().min(0).optional(),
            nightly: z.array(z.object({ date: businessDate, amountMinor: positiveMinor })).optional(),
          }),
        )
        .optional(),
      notes: z.string().optional(),
      prepaid: z.boolean().optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Reservation synced', await IntegrationServices.channelBooking(req, req.body), { statusCode: httpStatus.CREATED })),
);

router.post(
  '/aggregator/orders',
  apiKeyAuth('orders:write'),
  validateRequest(
    body({
      locationId: objectId,
      outletId: objectId,
      aggregator: z.string().min(1),
      externalId: z.string().min(1),
      customer: z.object({ name: z.string().optional(), phone: z.string().optional(), address: z.string().optional() }),
      items: z
        .array(
          z.object({
            menuItemId: objectId.optional(),
            sku: z.string().optional(),
            quantity: z.number().int().min(1),
            specialInstructions: z.string().optional(),
            modifiers: z.array(z.object({ groupId: objectId, optionId: objectId })).optional(),
          }),
        )
        .min(1),
      notes: z.string().optional(),
      paid: z.boolean(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Order received', await IntegrationServices.aggregatorOrder(req, req.body), { statusCode: httpStatus.CREATED })),
);

// ----- Tenant admin: keys and webhooks -----
router.get('/api-keys', tenantUser(), authorize(PERMISSION.INTEGRATIONS_MANAGE), catchAsync(async (_req, res) => ok(res, 'API keys', await ApiKey.find().sort({ createdAt: -1 }).lean())));

router.post(
  '/api-keys',
  tenantUser(),
  authorize(PERMISSION.INTEGRATIONS_MANAGE),
  validateRequest(body({ name: z.string().min(1), scopes: z.array(z.enum(API_SCOPES)).min(1), locationIds: z.array(objectId).optional() })),
  catchAsync(async (req, res) => ok(res, 'API key created', await IntegrationServices.createApiKey(req.body, req.user.id), { statusCode: httpStatus.CREATED })),
);

router.delete(
  '/api-keys/:id',
  tenantUser(),
  authorize(PERMISSION.INTEGRATIONS_MANAGE),
  catchAsync(async (req, res) => ok(res, 'API key revoked', found(await ApiKey.findByIdAndUpdate(req.params.id, { revokedAt: new Date() }, { returnDocument: 'after' }), 'API key'))),
);

router.get('/webhooks', tenantUser(), authorize(PERMISSION.INTEGRATIONS_MANAGE), catchAsync(async (_req, res) => ok(res, 'Webhook subscriptions', await WebhookSubscription.find().lean())));

router.post(
  '/webhooks',
  tenantUser(),
  authorize(PERMISSION.INTEGRATIONS_MANAGE),
  validateRequest(body({ url: z.string().url().startsWith('https://', 'Webhooks must use https'), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1), description: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Webhook created', await IntegrationServices.createSubscription(req.body), { statusCode: httpStatus.CREATED })),
);

router.patch(
  '/webhooks/:id',
  tenantUser(),
  authorize(PERMISSION.INTEGRATIONS_MANAGE),
  validateRequest(body({ isActive: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).optional() })),
  catchAsync(async (req, res) => ok(res, 'Webhook updated', found(await WebhookSubscription.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }), 'Webhook'))),
);

router.get(
  '/webhooks/:id/deliveries',
  tenantUser(),
  authorize(PERMISSION.INTEGRATIONS_MANAGE),
  catchAsync(async (req, res) => ok(res, 'Recent deliveries', await WebhookDelivery.find({ subscriptionId: req.params.id }).sort({ createdAt: -1 }).limit(100).lean())),
);

export const IntegrationRoutes = router;
