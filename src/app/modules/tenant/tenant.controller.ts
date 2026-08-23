import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import { TenantServices } from './tenant.service';

const createTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.createTenant(req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Tenant created successfully',
    data: result,
  });
});

const getAllTenants = catchAsync(async (req, res) => {
  const result = await TenantServices.getAllTenants();
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Tenants retrieved successfully',
    data: result,
  });
});

const getTenantById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await TenantServices.getTenantById(id as string);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Tenant retrieved successfully',
    data: result,
  });
});

const updateTenant = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await TenantServices.updateTenant(id as string, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Tenant updated successfully',
    data: result,
  });
});

const deleteTenant = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await TenantServices.deleteTenant(id as string);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Tenant deleted successfully',
    data: result,
  });
});

export const TenantControllers = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
};
