import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { MenuCategoryServices } from './menuCategory.service';

const createMenuCategory = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await MenuCategoryServices.createMenuCategory(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Menu Category created successfully',
    data: result,
  });
});

const getAllMenuCategories = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuCategoryServices.getAllMenuCategories(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Categories retrieved successfully',
    data: result,
  });
});

const getMenuCategoryById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuCategoryServices.getMenuCategoryById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Category retrieved successfully',
    data: result,
  });
});

const updateMenuCategory = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuCategoryServices.updateMenuCategory(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Category updated successfully',
    data: result,
  });
});

const deleteMenuCategory = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await MenuCategoryServices.deleteMenuCategory(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Menu Category deleted successfully',
    data: result,
  });
});

export const MenuCategoryControllers = {
  createMenuCategory,
  getAllMenuCategories,
  getMenuCategoryById,
  updateMenuCategory,
  deleteMenuCategory,
};
