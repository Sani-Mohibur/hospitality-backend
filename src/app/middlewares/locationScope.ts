import { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import catchAsync from '../utils/catchAsync';
import AppError from '../errors/AppError';
import { Location } from '../modules/location/location.model';
import { requestContext } from '../utils/requestContext';

const readLocationId = (req: Request): string | undefined => {
  const header = req.headers['x-location-id'];
  const candidate =
    (typeof header === 'string' && header) ||
    (typeof req.query.locationId === 'string' && req.query.locationId) ||
    (req.body && typeof req.body.locationId === 'string' && req.body.locationId) ||
    undefined;
  return candidate || undefined;
};

export const canAccessLocation = (req: Request, locationId?: Types.ObjectId | string | null) => {
  if (!locationId || !Types.ObjectId.isValid(locationId)) return false;
  return Boolean(req.user.allLocations || req.user.locationIds.includes(String(locationId)));
};

// Resolves the working location from the X-Location-Id header (or locationId in
// query/body), checks it belongs to the tenant and that the user is granted it.
// The client can suggest a location; only the server decides whether it is allowed.
const locationScope = (options: { required?: boolean } = { required: true }) => {
  return catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.tenantId) throw new AppError(httpStatus.FORBIDDEN, 'No tenant selected');
    const locationId = readLocationId(req) || req.user.deviceLocationId;

    const isSyntheticAll =
      locationId === 'ALL' ||
      locationId === 'all' ||
      locationId === 'ALL_HOSPITALITY' ||
      locationId === 'ALL_RESTAURANT' ||
      locationId === 'ALL_RETAIL';

    if (!locationId || isSyntheticAll) {
      if (options.required) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Select a location (X-Location-Id header)');
      }
      if (isSyntheticAll && !req.user.allLocations) {
        throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to all locations');
      }

      if (locationId === 'ALL_HOSPITALITY' || locationId === 'ALL_RESTAURANT' || locationId === 'ALL_RETAIL') {
        const query: Record<string, unknown> = { tenantId: req.user.tenantId, isDeleted: { $ne: true } };
        if (locationId === 'ALL_HOSPITALITY') {
          query.$or = [{ branchType: 'HOSPITALITY' }, { hasRooms: true }];
        } else if (locationId === 'ALL_RETAIL') {
          query.branchType = 'RETAIL';
        } else {
          query.$or = [{ branchType: 'RESTAURANT' }, { branchType: { $exists: false }, hasRooms: false }];
        }
        if (!req.user.allLocations && req.user.locationIds?.length) {
          query._id = { $in: req.user.locationIds };
        }
        const locs = await Location.find(query).select('_id').lean();
        req.scopedLocationIds = locs.map((l) => l._id as Types.ObjectId);
      }

      return next();
    }
    if (!Types.ObjectId.isValid(locationId)) throw new AppError(httpStatus.BAD_REQUEST, 'Invalid location id');
    if (req.user.deviceLocationId && req.user.deviceLocationId !== locationId) {
      throw new AppError(httpStatus.FORBIDDEN, 'This device is paired to another location');
    }
    if (!canAccessLocation(req, locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
    }
    const exists = await Location.exists({ _id: locationId, tenantId: req.user.tenantId });
    if (!exists) throw new AppError(httpStatus.NOT_FOUND, 'Location not found');

    req.locationId = locationId;
    if (req.body && typeof req.body === 'object') req.body.locationId = locationId;
    requestContext.set({ locationId });
    next();
  });
};

// Filter for list endpoints: the chosen location, or every location the user may see.
export const locationFilter = (req: Request): Record<string, unknown> => {
  if (req.locationId) return { locationId: new Types.ObjectId(req.locationId) };
  if (req.scopedLocationIds && req.scopedLocationIds.length >= 0) {
    return { locationId: { $in: req.scopedLocationIds } };
  }
  if (req.user.allLocations) return {};
  return { locationId: { $in: req.user.locationIds.map((id) => new Types.ObjectId(id)) } };
};

export const requireLocationId = (req: Request): string => {
  if (!req.locationId) throw new AppError(httpStatus.BAD_REQUEST, 'Select a location (X-Location-Id header)');
  return req.locationId;
};

export const requireTenantId = (req: Request): string => {
  if (!req.user?.tenantId) throw new AppError(httpStatus.FORBIDDEN, 'No tenant selected');
  return req.user.tenantId;
};

export default locationScope;
