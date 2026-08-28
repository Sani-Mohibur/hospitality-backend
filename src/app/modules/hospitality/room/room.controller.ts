import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { RoomServices } from './room.service';

const createRoom = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await RoomServices.createRoom(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Room created successfully',
    data: result,
  });
});

const getAllRooms = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomServices.getAllRooms(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Rooms retrieved successfully',
    data: result,
  });
});

const getRoomById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomServices.getRoomById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Room retrieved successfully',
    data: result,
  });
});

const updateRoom = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomServices.updateRoom(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Room updated successfully',
    data: result,
  });
});

const deleteRoom = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await RoomServices.deleteRoom(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Room deleted successfully',
    data: result,
  });
});

export const RoomControllers = {
  createRoom,
  getAllRooms,
  getRoomById,
  updateRoom,
  deleteRoom,
};
