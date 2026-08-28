import { z } from 'zod';
import { RESERVATION_STATUS } from './reservation.interface';

const createReservationValidationSchema = z.object({
  body: z.object({
    guestId: z.string({ message: 'Guest ID is required' }),
    roomId: z.string({ message: 'Room ID is required' }),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    locationId: z.string({ message: 'Location ID is required' }),
    checkInDate: z.string().datetime({ message: 'Valid check-in date is required' }),
    checkOutDate: z.string().datetime({ message: 'Valid check-out date is required' }),
    status: z.enum([...Object.values(RESERVATION_STATUS)] as [string, ...string[]]).optional(),
    totalAmount: z.number({ message: 'Total amount is required' }).min(0),
    paidAmount: z.number().min(0).optional(),
  }).refine((data) => new Date(data.checkInDate) < new Date(data.checkOutDate), {
    message: 'Check-in date must be before check-out date',
    path: ['checkOutDate'],
  }),
});

const updateReservationValidationSchema = z.object({
  body: z.object({
    guestId: z.string().optional(),
    roomId: z.string().optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    checkInDate: z.string().datetime().optional(),
    checkOutDate: z.string().datetime().optional(),
    status: z.enum([...Object.values(RESERVATION_STATUS)] as [string, ...string[]]).optional(),
    totalAmount: z.number().min(0).optional(),
    paidAmount: z.number().min(0).optional(),
    isActive: z.boolean().optional(),
  }).refine((data) => {
    if (data.checkInDate && data.checkOutDate) {
      return new Date(data.checkInDate) < new Date(data.checkOutDate);
    }
    return true;
  }, {
    message: 'Check-in date must be before check-out date',
    path: ['checkOutDate'],
  }),
});

export const ReservationValidation = {
  createReservationValidationSchema,
  updateReservationValidationSchema,
};
