import { z } from 'zod';

const createMenuCategoryValidationSchema = z.object({
  body: z.object({
    name: z.string({ message: 'Name is required' }),
    description: z.string().optional(),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    locationId: z.string({ message: 'Location ID is required' }),
  }),
});

const updateMenuCategoryValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const MenuCategoryValidation = {
  createMenuCategoryValidationSchema,
  updateMenuCategoryValidationSchema,
};
