import { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { JwtPayload, Secret } from 'jsonwebtoken';
import { Types } from 'mongoose';
import config from '../config';
import catchAsync from '../utils/catchAsync';
import AppError from '../errors/AppError';
import { jwtHelpers } from '../helpers/jwtHelpers';
import { requestContext } from '../utils/requestContext';
import { User } from '../modules/user/user.model';
import { Role } from '../modules/role/role.model';
import { Tenant } from '../modules/tenant/tenant.model';
import { Session } from '../modules/auth/session.model';
import { Device } from '../modules/device/device.model';
import { ALL_PERMISSIONS, MANAGER_PERMISSIONS, USER_ROLE } from '../modules/user/user.constant';
import { TENANT_STATUS } from '../modules/tenant/tenant.interface';

export type TAuthUser = {
  id: string;
  role: keyof typeof USER_ROLE;
  email?: string;
  name: string;
  tenantId?: string;
  permissions: string[];
  locationIds: string[];
  allLocations: boolean;
  sessionId?: string;
  deviceId?: string;
  deviceLocationId?: string;
  impersonatedBy?: string;
};

// Tenant rows change rarely; a short cache avoids a lookup on every request.
const tenantCache = new Map<string, { at: number; status: string; isActive: boolean; modules: string[] }>();
const TENANT_TTL_MS = 15_000;

export const loadTenantState = async (tenantId: string) => {
  const hit = tenantCache.get(tenantId);
  if (hit && Date.now() - hit.at < TENANT_TTL_MS) return hit;
  const tenant = await requestContext.asSystem(() => Tenant.findById(tenantId).lean());
  if (!tenant) return undefined;
  const state = { at: Date.now(), status: tenant.status, isActive: tenant.isActive, modules: tenant.modules };
  tenantCache.set(tenantId, state);
  return state;
};

export const invalidateTenantCache = (tenantId: string) => tenantCache.delete(tenantId);

// Paths a suspended or past-due tenant can still reach, so they can pay.
const BILLING_PATHS = ['/api/v1/subscription', '/api/v1/billing', '/api/v1/auth', '/api/v1/user/me'];

export const resolvePermissions = async (user: {
  role: string;
  roleId?: Types.ObjectId | null;
}): Promise<string[]> => {
  if (user.role === USER_ROLE.SUPER_ADMIN || user.role === USER_ROLE.TENANT_OWNER) return ALL_PERMISSIONS;
  if (user.role === USER_ROLE.TENANT_MANAGER) return MANAGER_PERMISSIONS;
  if (!user.roleId) return [];
  const role = await requestContext.asSystem(() => Role.findById(user.roleId).lean());
  return role?.permissions || [];
};

export const authenticate = async (req: Request): Promise<TAuthUser> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized!');
  }
  const token = authHeader.split(' ')[1];
  if (!token) throw new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized!');

  let decoded: JwtPayload;
  try {
    decoded = jwtHelpers.verifyToken(token, config.jwt.access_secret as Secret) as JwtPayload;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new AppError(httpStatus.UNAUTHORIZED, 'Token has expired');
    }
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid token');
  }
  if (decoded.typ && decoded.typ !== 'access') {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid token type');
  }

  return requestContext.asSystem(async () => {
    const user = await User.findById(decoded.id).lean();
    if (!user || !user.isActive) throw new AppError(httpStatus.UNAUTHORIZED, 'Account is disabled');
    if ((user.tokenVersion || 0) !== (decoded.tv || 0)) {
      throw new AppError(httpStatus.UNAUTHORIZED, 'Session has been revoked');
    }
    if (decoded.sid) {
      const session = await Session.findById(decoded.sid).select('revokedAt').lean();
      if (!session || session.revokedAt) throw new AppError(httpStatus.UNAUTHORIZED, 'Session has been revoked');
    }

    let deviceLocationId: string | undefined;
    if (decoded.dev) {
      const device = await Device.findById(decoded.dev).lean();
      if (!device || !device.isActive || device.revokedAt) {
        throw new AppError(httpStatus.UNAUTHORIZED, 'Device is no longer paired');
      }
      deviceLocationId = String(device.locationId);
    }

    const permissions = await resolvePermissions(user);
    const tenantId = user.tenantId ? String(user.tenantId) : undefined;

    // Staff on a shared device may only work in that device's location.
    const locationIds = deviceLocationId ? [deviceLocationId] : (user.locationIds || []).map(String);
    const allLocations =
      !deviceLocationId && (user.allLocations || user.role === USER_ROLE.TENANT_OWNER || user.role === USER_ROLE.SUPER_ADMIN);

    return {
      id: String(user._id),
      role: user.role,
      email: user.email,
      name: user.name,
      tenantId,
      permissions,
      locationIds,
      allLocations,
      sessionId: decoded.sid,
      deviceId: decoded.dev,
      deviceLocationId,
      impersonatedBy: decoded.imp,
    } satisfies TAuthUser;
  });
};

const auth = (...requiredRoles: string[]) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const user = await authenticate(req);

    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have permission to access this resource');
    }

    // Super admins act on a tenant only when they name it explicitly.
    let tenantId = user.tenantId;
    if (user.role === USER_ROLE.SUPER_ADMIN) {
      const header = req.headers['x-tenant-id'];
      tenantId = typeof header === 'string' && Types.ObjectId.isValid(header) ? header : undefined;
      user.tenantId = tenantId;
    }

    if (tenantId && user.role !== USER_ROLE.SUPER_ADMIN) {
      const tenant = await loadTenantState(tenantId);
      if (!tenant || !tenant.isActive) throw new AppError(httpStatus.FORBIDDEN, 'Your tenant account is inactive');
      const blocked = tenant.status === TENANT_STATUS.SUSPENDED || tenant.status === TENANT_STATUS.CANCELLED;
      if (blocked && !BILLING_PATHS.some((p) => req.originalUrl.startsWith(p))) {
        throw new AppError(httpStatus.PAYMENT_REQUIRED, 'Subscription suspended. Settle the balance to continue.');
      }
    }

    req.user = user;
    requestContext.set({
      tenantId,
      userId: user.id,
      bypassTenantScope: user.role === USER_ROLE.SUPER_ADMIN && !tenantId,
    });
    next();
  });
};

// Permission gate; use after auth(). Passes when the user holds ANY listed permission.
export const authorize = (...permissions: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized!'));
    if (permissions.length && !permissions.some((p) => req.user.permissions.includes(p))) {
      return next(new AppError(httpStatus.FORBIDDEN, `Missing permission: ${permissions.join(' or ')}`));
    }
    next();
  };
};

// Any signed-in tenant user (or super admin acting on a tenant).
export const tenantUser = () =>
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF);

export default auth;
