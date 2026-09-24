import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import rateLimit from 'express-rate-limit';
import { tenantUser, authorize } from '../../middlewares/auth';
import locationScope from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import { PERMISSION } from '../user/user.constant';
import { DEVICE_TYPE, Device } from './device.model';
import { Outlet, Station } from '../outlet/outlet.model';
import { randomToken, sha256 } from '../../utils/crypto';
import { requestContext } from '../../utils/requestContext';
import { activity } from '../auditLog/auditLog.service';
import { found } from '../../utils/query';

const router = Router();

const pairLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many pairing attempts' });

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const nextPrefix = async (locationId: string) => {
  const count = await Device.countDocuments({ locationId });
  const letter = String.fromCharCode(65 + (Math.floor(count / 9) % 26));
  return `${letter}${(count % 9) + 1}`;
};

const newPairingCode = () => randomToken(6).replace(/[-_]/g, 'X').slice(0, 8).toUpperCase();

router.get(
  '/',
  tenantUser(),
  authorize(PERMISSION.DEVICES_MANAGE),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const devices = await Device.find(req.locationId ? { locationId: req.locationId } : {}).sort({ createdAt: -1 }).lean();
    ok(res, 'Devices retrieved', devices);
  }),
);

// Manager registers a terminal; the returned code is typed on the device once.
router.post(
  '/',
  tenantUser(),
  authorize(PERMISSION.DEVICES_MANAGE),
  locationScope(),
  validateRequest(
    z.object({
      body: z.object({
        name: z.string().min(1),
        type: z.enum(Object.values(DEVICE_TYPE) as [string, ...string[]]),
        outletId: objectId.optional(),
        stationId: objectId.optional(),
      }),
    }),
  ),
  catchAsync(async (req, res) => {
    if (req.body.outletId) found(await Outlet.findOne({ _id: req.body.outletId, locationId: req.locationId }), 'Outlet');
    if (req.body.stationId) found(await Station.findOne({ _id: req.body.stationId, locationId: req.locationId }), 'Station');
    const code = newPairingCode();
    const device = await Device.create({
      ...req.body,
      locationId: req.locationId,
      orderPrefix: await nextPrefix(req.locationId!),
      pairingCodeHash: sha256(code),
      pairingExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await activity.record({ action: 'DEVICE_CREATED', entity: 'Device', entityId: device._id, message: `Registered device ${device.name}` });
    ok(res, 'Device created. Enter the pairing code on the device within 15 minutes.', { device, pairingCode: code }, { statusCode: httpStatus.CREATED });
  }),
);

router.post(
  '/:id/pairing-code',
  tenantUser(),
  authorize(PERMISSION.DEVICES_MANAGE),
  catchAsync(async (req, res) => {
    const device = found(await Device.findById(req.params.id), 'Device');
    const code = newPairingCode();
    device.pairingCodeHash = sha256(code);
    device.pairingExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    device.tokenHash = undefined;
    device.revokedAt = undefined;
    device.isActive = true;
    await device.save();
    ok(res, 'New pairing code issued; the device must pair again', { pairingCode: code });
  }),
);

// Called by the terminal itself (no user session). Returns the device token once.
router.post(
  '/pair',
  pairLimiter,
  validateRequest(z.object({ body: z.object({ code: z.string().min(6), appVersion: z.string().optional() }) })),
  catchAsync(async (req, res) => {
    const result = await requestContext.asSystem(async () => {
      const device = await Device.findOne({
        pairingCodeHash: sha256(String(req.body.code).toUpperCase()),
        pairingExpiresAt: { $gt: new Date() },
      }).select('+pairingCodeHash');
      if (!device) throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid or expired pairing code');
      const token = randomToken(32);
      device.tokenHash = sha256(token);
      device.pairingCodeHash = undefined;
      device.pairingExpiresAt = undefined;
      device.pairedAt = new Date();
      device.lastSeenAt = new Date();
      device.appVersion = req.body.appVersion;
      await device.save();
      return {
        deviceToken: token,
        device: {
          _id: device._id,
          tenantId: device.tenantId,
          locationId: device.locationId,
          outletId: device.outletId,
          stationId: device.stationId,
          type: device.type,
          name: device.name,
          orderPrefix: device.orderPrefix,
        },
      };
    });
    ok(res, 'Device paired. Store the device token securely.', result);
  }),
);

router.post(
  '/heartbeat',
  catchAsync(async (req, res) => {
    const token = req.headers['x-device-token'];
    if (typeof token !== 'string') throw new AppError(httpStatus.UNAUTHORIZED, 'Device token is required');
    const device = await requestContext.asSystem(() =>
      Device.findOneAndUpdate(
        { tokenHash: sha256(token), isActive: true, revokedAt: null },
        { lastSeenAt: new Date(), appVersion: req.body?.appVersion },
        { returnDocument: 'after' },
      ),
    );
    if (!device) throw new AppError(httpStatus.UNAUTHORIZED, 'Device is not paired');
    ok(res, 'Heartbeat recorded', { serverTime: new Date(), deviceId: device._id });
  }),
);

router.patch(
  '/:id',
  tenantUser(),
  authorize(PERMISSION.DEVICES_MANAGE),
  validateRequest(
    z.object({ body: z.object({ name: z.string().optional(), outletId: objectId.optional(), stationId: objectId.optional() }) }),
  ),
  catchAsync(async (req, res) => {
    const device = found(await Device.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after' }), 'Device');
    ok(res, 'Device updated', device);
  }),
);

router.delete(
  '/:id',
  tenantUser(),
  authorize(PERMISSION.DEVICES_MANAGE),
  catchAsync(async (req, res) => {
    const device = found(
      await Device.findByIdAndUpdate(req.params.id, { isActive: false, revokedAt: new Date(), tokenHash: null }, { returnDocument: 'after' }),
      'Device',
    );
    await activity.record({ action: 'DEVICE_REVOKED', entity: 'Device', entityId: device._id, message: `Revoked device ${device.name}` });
    ok(res, 'Device revoked; its sessions stop working immediately', device);
  }),
);

export const DeviceRoutes = router;
