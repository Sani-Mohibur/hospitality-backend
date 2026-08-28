import { z } from 'zod';

const createRoomCategoryValidationSchema = z.object({
  body: z.object({
    name: z.string({ message: 'Name is required' }),
    description: z.string().optional(),
    basePrice: z.number({ message: 'Base price is required' }).min(0),
    capacity: z.number({ message: 'Capacity is required' }).min(1),
    tenantId: z.string({ message: 'Tenant ID is required' }),
  }),
});

const updateRoomCategoryValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    basePrice: z.number().min(0).optional(),
    capacity: z.number().min(1).optional(),
    tenantId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const RoomCategoryValidation = {
  createRoomCategoryValidationSchema,
  updateRoomCategoryValidationSchema,
};
