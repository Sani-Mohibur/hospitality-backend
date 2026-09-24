import { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { Schema, model } from 'mongoose';
import catchAsync from '../utils/catchAsync';
import AppError from '../errors/AppError';
import { sha256 } from '../utils/crypto';
import { requestContext } from '../utils/requestContext';

const idempotencySchema = new Schema(
  {
    scope: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: { type: String, enum: ['IN_PROGRESS', 'DONE'], default: 'IN_PROGRESS' },
    statusCode: { type: Number },
    body: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, expires: 24 * 3600 },
  },
  { versionKey: false },
);
idempotencySchema.index({ scope: 1, key: 1 }, { unique: true });

const IdempotencyKey = model('IdempotencyKey', idempotencySchema);

// Makes a money-moving endpoint safe to retry: the same Idempotency-Key returns the
// first response instead of charging twice. Offline devices retry their outbox
// with the same key after reconnecting.
const idempotency = (options: { required?: boolean } = { required: true }) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim()) {
      if (options.required) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Idempotency-Key header is required for this request');
      }
      return next();
    }
    if (key.length > 128) throw new AppError(httpStatus.BAD_REQUEST, 'Idempotency-Key is too long');

    const scope = `${req.user?.tenantId || 'public'}:${req.method}:${req.baseUrl}${req.route?.path || req.path}`;
    const requestHash = sha256(JSON.stringify({ params: req.params, body: req.body }));

    const existing = await requestContext.asSystem(() => IdempotencyKey.findOne({ scope, key }).lean());
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(httpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key was already used with a different request');
      }
      if (existing.state === 'IN_PROGRESS') {
        throw new AppError(httpStatus.CONFLICT, 'A request with this Idempotency-Key is still being processed');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      return res.status(existing.statusCode || 200).json(existing.body);
    }

    try {
      await requestContext.asSystem(() => IdempotencyKey.create({ scope, key, requestHash }));
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new AppError(httpStatus.CONFLICT, 'A request with this Idempotency-Key is still being processed');
      }
      throw err;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      const done =
        res.statusCode < 500
          ? IdempotencyKey.updateOne({ scope, key }, { state: 'DONE', statusCode: res.statusCode, body })
          : IdempotencyKey.deleteOne({ scope, key });
      requestContext.asSystem(() => done).catch(() => undefined);
      return originalJson(body);
    };
    next();
  });
};

export default idempotency;
