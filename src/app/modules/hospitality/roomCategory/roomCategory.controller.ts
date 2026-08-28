import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { RoomCategoryServices } from './roomCategory.service';

const createRoomCategory = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await RoomCategoryServices.createRoomCategory(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Room Category created successfully',
    data: result,
  });
});

const getAllRoomCategories = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomCategoryServices.getAllRoomCategories(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Room Categories retrieved successfully',
    data: result,
  });
});

const getRoomCategoryById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomCategoryServices.getRoomCategoryById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Room Category retrieved successfully',
    data: result,
  });
});

const updateRoomCategory = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomCategoryServices.updateRoomCategory(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Room Category updated successfully',
    data: result,
  });
});

const deleteRoomCategory = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomCategoryServices.deleteRoomCategory(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Room Category deleted successfully',
    data: result,
  });
});

export const RoomCategoryControllers = {
  createRoomCategory,
  getAllRoomCategories,
  getRoomCategoryById,
  updateRoomCategory,
  deleteRoomCategory,
};
