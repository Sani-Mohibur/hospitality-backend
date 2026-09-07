import { z } from 'zod';

const createTenantValidationSchema = z.object({
  body: z.object({
    name: z.string({
      message: 'Name is required',
    }),
    modules: z.array(z.string()).optional(),
    subscriptionId: z.string().optional(),
  }),
});

const updateTenantValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    modules: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
    subscriptionId: z.string().optional(),
  }),
});

export const TenantValidation = {
  createTenantValidationSchema,
  updateTenantValidationSchema,
};
