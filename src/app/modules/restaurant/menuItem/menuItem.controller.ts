import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { MenuItemServices } from './menuItem.service';

const createMenuItem = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await MenuItemServices.createMenuItem(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Menu Item created successfully',
    data: result,
  });
});

const getAllMenuItems = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuItemServices.getAllMenuItems(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Items retrieved successfully',
    data: result,
  });
});

const getMenuItemById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuItemServices.getMenuItemById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Item retrieved successfully',
    data: result,
  });
});

const updateMenuItem = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuItemServices.updateMenuItem(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Item updated successfully',
    data: result,
  });
});

const deleteMenuItem = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuItemServices.deleteMenuItem(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Item deleted successfully',
    data: result,
  });
});

export const MenuItemControllers = {
  createMenuItem,
  getAllMenuItems,
  getMenuItemById,
  updateMenuItem,
  deleteMenuItem,
};
