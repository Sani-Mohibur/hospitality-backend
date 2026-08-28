import { z } from 'zod';
import { ROOM_STATUS } from './room.interface';

const createRoomValidationSchema = z.object({
  body: z.object({
    roomNumber: z.string({ message: 'Room number is required' }),
    roomCategoryId: z.string({ message: 'Room category ID is required' }),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    locationId: z.string({ message: 'Location ID is required' }),
    status: z.enum([...Object.values(ROOM_STATUS)] as [string, ...string[]]).optional(),
  }),
});

const updateRoomValidationSchema = z.object({
  body: z.object({
    roomNumber: z.string().optional(),
    roomCategoryId: z.string().optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    status: z.enum([...Object.values(ROOM_STATUS)] as [string, ...string[]]).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const RoomValidation = {
  createRoomValidationSchema,
  updateRoomValidationSchema,
};
