import { z } from 'zod';
import { FEATURE_MODULES } from '../user/user.constant';

const createTenantValidationSchema = z.object({
  body: z.object({
    name: z.string({
      message: 'Name is required',
    }),
    modules: z
      .array(z.enum([...Object.values(FEATURE_MODULES)] as [string, ...string[]]))
      .optional(),
  }),
});

const updateTenantValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    modules: z
      .array(z.enum([...Object.values(FEATURE_MODULES)] as [string, ...string[]]))
      .optional(),
    isActive: z.boolean().optional(),
  }),
});

export const TenantValidation = {
  createTenantValidationSchema,
  updateTenantValidationSchema,
};
