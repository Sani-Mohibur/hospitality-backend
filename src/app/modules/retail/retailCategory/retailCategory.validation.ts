import { z } from 'zod';
import { objectId } from '../../../utils/zod';

const createCategoryZodSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Category name is required').trim(),
    code: z.string().max(30).optional(),
    description: z.string().optional(),
    locationId: objectId.nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
});

const updateCategoryZodSchema = z.object({
  body: z.object({
    name: z.string().min(1).trim().optional(),
    code: z.string().max(30).optional(),
    description: z.string().optional(),
    locationId: objectId.nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const RetailCategoryValidations = {
  createCategoryZodSchema,
  updateCategoryZodSchema,
};
