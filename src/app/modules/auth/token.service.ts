import { Secret } from 'jsonwebtoken';
import { Types } from 'mongoose';
import httpStatus from 'http-status';
import config from '../../config';
import AppError from '../../errors/AppError';
import { jwtHelpers } from '../../helpers/jwtHelpers';
import { randomToken, sha256 } from '../../utils/crypto';
import { requestContext } from '../../utils/requestContext';
import { Session } from './session.model';
import { User } from '../user/user.model';

const REFRESH_DAYS = 30;

type TTokenUser = { _id: unknown; role: string; email?: string; tenantId?: unknown; tokenVersion?: number };

type TIssueOptions = {
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  impersonatedBy?: string;
  withRefresh?: boolean;
  accessExpiresIn?: string;
};

export const signAccessToken = (user: TTokenUser, extra: Record<string, unknown>, expiresIn?: string) =>
  jwtHelpers.createToken(
    {
      typ: 'access',
      id: String(user._id),
      role: user.role,
      email: user.email,
      tenantId: user.tenantId ? String(user.tenantId) : undefined,
      tv: user.tokenVersion || 0,
      ...extra,
    },
    config.jwt.access_secret as Secret,
    (expiresIn || config.jwt.access_expires_in) as string,
  );

// Creates a session row and returns an access token plus an opaque refresh token
// "<sessionId>.<secret>". Only the hash of the secret is stored.
export const issueTokens = async (user: TTokenUser, options: TIssueOptions = {}) =>
  requestContext.asSystem(async () => {
    const secret = randomToken(32);
    const session = await Session.create({
      userId: user._id as any,
      familyId: randomToken(12),
      refreshHash: sha256(secret),
      expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 3600 * 1000),
      ip: options.ip,
      userAgent: options.userAgent,
      deviceId: options.deviceId,
      impersonatedBy: options.impersonatedBy,
    });
    const accessToken = signAccessToken(
      user,
      {
        sid: String(session._id),
        dev: options.deviceId,
        imp: options.impersonatedBy,
      },
      options.accessExpiresIn,
    );
    return {
      accessToken,
      refreshToken: options.withRefresh === false ? undefined : `${session._id}.${secret}`,
      sessionId: String(session._id),
    };
  });

// Refresh-token rotation with reuse detection: a token that was already rotated
// means it leaked, so the whole session family is revoked.
export const rotateRefreshToken = async (token: string, meta: { ip?: string; userAgent?: string }) =>
  requestContext.asSystem(async () => {
    const [sessionId, secret] = String(token || '').split('.');
    if (!sessionId || !secret || !Types.ObjectId.isValid(sessionId)) {
      throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
    }
    const session = await Session.findById(sessionId);
    if (!session || session.refreshHash !== sha256(secret)) {
      throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid refresh token');
    }
    if (session.revokedAt) {
      if (session.replacedBy) {
        await Session.updateMany({ familyId: session.familyId, revokedAt: null }, { revokedAt: new Date() });
      }
      throw new AppError(httpStatus.UNAUTHORIZED, 'Refresh token has been revoked');
    }
    if (session.expiresAt < new Date()) throw new AppError(httpStatus.UNAUTHORIZED, 'Refresh token expired');

    const user = await User.findById(session.userId).lean();
    if (!user || !user.isActive) throw new AppError(httpStatus.UNAUTHORIZED, 'Account is disabled');

    const nextSecret = randomToken(32);
    const next = await Session.create({
      userId: session.userId,
      familyId: session.familyId,
      refreshHash: sha256(nextSecret),
      expiresAt: session.expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceId: session.deviceId,
      impersonatedBy: session.impersonatedBy,
    });
    session.revokedAt = new Date();
    session.replacedBy = next._id;
    session.lastUsedAt = new Date();
    await session.save();

    const accessToken = signAccessToken(user, {
      sid: String(next._id),
      dev: session.deviceId ? String(session.deviceId) : undefined,
      imp: session.impersonatedBy ? String(session.impersonatedBy) : undefined,
    });
    return { accessToken, refreshToken: `${next._id}.${nextSecret}`, user };
  });

export const revokeSession = async (sessionId: string, userId?: string) =>
  requestContext.asSystem(() =>
    Session.updateOne({ _id: sessionId, ...(userId ? { userId } : {}), revokedAt: null }, { revokedAt: new Date() }),
  );

export const revokeAllSessions = async (userId: string) =>
  requestContext.asSystem(async () => {
    await Session.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
    await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  });

export const signPurposeToken = (payload: Record<string, unknown>, expiresIn: string) =>
  jwtHelpers.createToken(payload, config.jwt.access_secret as Secret, expiresIn);

export const verifyPurposeToken = (token: string, typ: string) => {
  try {
    const decoded = jwtHelpers.verifyToken(token, config.jwt.access_secret as Secret);
    if (decoded.typ !== typ) throw new Error('wrong type');
    return decoded;
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid or expired token');
  }
};
