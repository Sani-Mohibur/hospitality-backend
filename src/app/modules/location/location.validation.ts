import { z } from 'zod';

const createLocationValidationSchema = z.object({
  body: z.object({
    name: z.string({
      message: 'Name is required',
    }),
    tenantId: z.string({
      message: 'Tenant ID is required',
    }),
    address: z.string().optional(),
  }),
});

const updateLocationValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    tenantId: z.string().optional(),
    address: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const LocationValidation = {
  createLocationValidationSchema,
  updateLocationValidationSchema,
};
