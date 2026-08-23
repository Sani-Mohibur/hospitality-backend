import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import { LocationServices } from './location.service';

const createLocation = catchAsync(async (req, res) => {
  // If user is not SUPER_ADMIN, enforce their own tenantId
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await LocationServices.createLocation(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Location created successfully',
    data: result,
  });
});

const getAllLocations = catchAsync(async (req, res) => {
  // Enforce tenant scoping unless it's a super admin querying all (could extend to support this)
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await LocationServices.getAllLocations(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Locations retrieved successfully',
    data: result,
  });
});

const getLocationById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await LocationServices.getLocationById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Location retrieved successfully',
    data: result,
  });
});

const updateLocation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await LocationServices.updateLocation(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Location updated successfully',
    data: result,
  });
});

const deleteLocation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await LocationServices.deleteLocation(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Location deleted successfully',
    data: result,
  });
});

export const LocationControllers = {
  createLocation,
  getAllLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
};
