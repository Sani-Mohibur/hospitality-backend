import { z } from 'zod';

const createGuestValidationSchema = z.object({
  body: z.object({
    firstName: z.string({ message: 'First name is required' }),
    lastName: z.string({ message: 'Last name is required' }),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    idType: z.string().optional(),
    idNumber: z.string().optional(),
    tenantId: z.string({ message: 'Tenant ID is required' }),
  }),
});

const updateGuestValidationSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    idType: z.string().optional(),
    idNumber: z.string().optional(),
    tenantId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const GuestValidation = {
  createGuestValidationSchema,
  updateGuestValidationSchema,
};
