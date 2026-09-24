import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { TenantServices } from './tenant.service';

const createTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.createTenant(req.body);
  ok(res, 'Tenant created successfully', result, { statusCode: httpStatus.CREATED });
});

const getAllTenants = catchAsync(async (req, res) => {
  const result = await TenantServices.getAllTenants(req.query);
  ok(res, 'Tenants retrieved successfully', result);
});

const getTenantById = catchAsync(async (req, res) => {
  const result = await TenantServices.getTenantById(req.params.id as string);
  ok(res, 'Tenant retrieved successfully', result);
});

const updateTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.updateTenant(req.params.id as string, req.body);
  ok(res, 'Tenant updated successfully', result);
});

const deleteTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.deleteTenant(req.params.id as string);
  ok(res, 'Tenant deleted successfully', result);
});

const suspendTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.suspendTenant(req.params.id as string);
  ok(res, 'Tenant suspended successfully', result);
});

const reactivateTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.reactivateTenant(req.params.id as string);
  ok(res, 'Tenant reactivated successfully', result);
});

const updateTenantFeatures = catchAsync(async (req, res) => {
  const result = await TenantServices.updateTenantFeatures(req.params.id as string, req.body.modules);
  ok(res, 'Tenant features updated successfully', result);
});

const setFeatureFlag = catchAsync(async (req, res) => {
  const result = await TenantServices.setFeatureFlag(req.params.id as string, req.body.flag, req.body.enabled);
  ok(res, 'Feature flag updated', result);
});

const getMyTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.getMyTenant(req.user.tenantId!);
  ok(res, 'Business settings retrieved', result);
});

const updateMyTenant = catchAsync(async (req, res) => {
  const result = await TenantServices.updateMyTenant(req.user.tenantId!, req.body);
  ok(res, 'Business settings updated', result);
});

export const TenantControllers = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
  suspendTenant,
  reactivateTenant,
  updateTenantFeatures,
  setFeatureFlag,
  getMyTenant,
  updateMyTenant,
};
