import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ReservationServices } from './reservation.service';

const createReservation = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await ReservationServices.createReservation(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Reservation created successfully',
    data: result,
  });
});

const getAllReservations = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await ReservationServices.getAllReservations(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Reservations retrieved successfully',
    data: result,
  });
});

const getReservationById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await ReservationServices.getReservationById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Reservation retrieved successfully',
    data: result,
  });
});

const updateReservation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await ReservationServices.updateReservation(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Reservation updated successfully',
    data: result,
  });
});

const deleteReservation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await ReservationServices.deleteReservation(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Reservation deleted successfully',
    data: result,
  });
});

export const ReservationControllers = {
  createReservation,
  getAllReservations,
  getReservationById,
  updateReservation,
  deleteReservation,
};
