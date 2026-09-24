import { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync';
import AppError from '../errors/AppError';
import { TFeatureModule } from '../modules/tenant/tenant.interface';
import { loadTenantState } from './auth';

const requireModule = (requiredModule: TFeatureModule) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { role, tenantId } = req.user;

    // Super admin has access to everything by default
    if (role === 'SUPER_ADMIN' && !tenantId) {
      return next();
    }

    if (!tenantId) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not belong to any tenant');
    }

    const tenant = await loadTenantState(tenantId);
    if (!tenant) {
      throw new AppError(httpStatus.NOT_FOUND, 'Tenant not found');
    }

    if (!tenant.isActive) {
      throw new AppError(httpStatus.FORBIDDEN, 'Your tenant account is inactive');
    }

    if (!tenant.modules.includes(requiredModule)) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        `Your tenant does not have the '${requiredModule}' module enabled`
      );
    }

    next();
  });
};

export default requireModule;
