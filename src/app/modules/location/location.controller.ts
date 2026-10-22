import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { LocationServices } from './location.service';
import { canAccessLocation } from '../../middlewares/locationScope';
import AppError from '../../errors/AppError';

const createLocation = catchAsync(async (req, res) => {
  const result = await LocationServices.createLocation(req.user.tenantId!, req.body);
  ok(res, 'Location created successfully', result, { statusCode: httpStatus.CREATED });
});

// Returns only the locations the user is granted.
const getAllLocations = catchAsync(async (req, res) => {
  const all = await LocationServices.getAllLocations(req.user.tenantId, req.query);
  const result = all.filter((l) => canAccessLocation(req, String(l._id)));
  ok(res, 'Locations retrieved successfully', result);
});

const getLocationById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  if (!canAccessLocation(req, id)) throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
  const result = await LocationServices.getLocationById(id, req.user.tenantId);
  ok(res, 'Location retrieved successfully', result);
});

const updateLocation = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  if (!canAccessLocation(req, id)) throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
  const result = await LocationServices.updateLocation(req.user.tenantId!, id, req.body);
  ok(res, 'Location updated successfully', result);
});

const deleteLocation = catchAsync(async (req, res) => {
  const result = await LocationServices.deleteLocation(req.user.tenantId!, req.params.id as string);
  ok(res, 'Location deleted successfully', result);
});

export const LocationControllers = {
  createLocation,
  getAllLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
};
