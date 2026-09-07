import { z } from 'zod';

const createPlatformModuleValidationSchema = z.object({
  body: z.object({
    name: z.string({
      message: 'Name is required',
    }),
    code: z.string({
      message: 'Code is required',
    }),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    basePrice: z.number().min(0).optional(),
  }),
});

const updatePlatformModuleValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    code: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    basePrice: z.number().min(0).optional(),
  }),
});

export const PlatformModuleValidations = {
  createPlatformModuleValidationSchema,
  updatePlatformModuleValidationSchema,
};
