import httpStatus from 'http-status';
import AppError from '../../../errors/AppError';
import { IReservation, RESERVATION_STATUS } from './reservation.interface';
import { Reservation } from './reservation.model';

const checkAvailability = async (roomId: string, checkInDate: Date, checkOutDate: Date, excludeReservationId?: string) => {
  const overlappingReservationQuery: any = {
    roomId,
    status: { $ne: RESERVATION_STATUS.CANCELLED },
    $or: [
      {
        checkInDate: { $lt: checkOutDate },
        checkOutDate: { $gt: checkInDate }
      }
    ]
  };

  if (excludeReservationId) {
    overlappingReservationQuery._id = { $ne: excludeReservationId };
  }

  const existingReservation = await Reservation.findOne(overlappingReservationQuery);
  return !existingReservation;
};

const createReservation = async (payload: IReservation) => {
  const isAvailable = await checkAvailability(
    payload.roomId.toString(),
    new Date(payload.checkInDate),
    new Date(payload.checkOutDate)
  );

  if (!isAvailable) {
    throw new AppError(httpStatus.CONFLICT, 'Room is not available for the requested dates');
  }

  const result = await Reservation.create(payload);
  return result;
};

const getAllReservations = async (tenantId: string) => {
  const result = await Reservation.find({ tenantId }).populate('guestId roomId locationId');
  return result;
};

const getReservationById = async (id: string, tenantId: string) => {
  const result = await Reservation.findOne({ _id: id, tenantId }).populate('guestId roomId locationId');
  return result;
};

const updateReservation = async (id: string, tenantId: string, payload: Partial<IReservation>) => {
  const reservation = await Reservation.findOne({ _id: id, tenantId });
  if (!reservation) {
    throw new AppError(httpStatus.NOT_FOUND, 'Reservation not found');
  }

  // If dates or room are changing, check availability again
  if (payload.checkInDate || payload.checkOutDate || payload.roomId) {
    const checkIn = payload.checkInDate ? new Date(payload.checkInDate) : reservation.checkInDate;
    const checkOut = payload.checkOutDate ? new Date(payload.checkOutDate) : reservation.checkOutDate;
    const roomId = payload.roomId ? payload.roomId.toString() : reservation.roomId.toString();

    const isAvailable = await checkAvailability(roomId, checkIn, checkOut, id);
    if (!isAvailable) {
      throw new AppError(httpStatus.CONFLICT, 'Room is not available for the requested dates');
    }
  }

  const result = await Reservation.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });
  return result;
};

const deleteReservation = async (id: string, tenantId: string) => {
  const result = await Reservation.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const ReservationServices = {
  createReservation,
  getAllReservations,
  getReservationById,
  updateReservation,
  deleteReservation,
};
