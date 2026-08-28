import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { GuestServices } from './guest.service';

const createGuest = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await GuestServices.createGuest(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Guest created successfully',
    data: result,
  });
});

const getAllGuests = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await GuestServices.getAllGuests(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Guests retrieved successfully',
    data: result,
  });
});

const getGuestById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await GuestServices.getGuestById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Guest retrieved successfully',
    data: result,
  });
});

const updateGuest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await GuestServices.updateGuest(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Guest updated successfully',
    data: result,
  });
});

const deleteGuest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await GuestServices.deleteGuest(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Guest deleted successfully',
    data: result,
  });
});

export const GuestControllers = {
  createGuest,
  getAllGuests,
  getGuestById,
  updateGuest,
  deleteGuest,
};
