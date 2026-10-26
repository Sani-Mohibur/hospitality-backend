import { z } from 'zod';
import { objectId } from '../../../utils/zod';

const startStocktakeZodSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Stocktake name is required').trim(),
    locationId: objectId.optional(),
    categoryId: objectId.optional(),
    notes: z.string().optional(),
  }),
});

const recordCountsZodSchema = z.object({
  body: z.object({
    lines: z
      .array(
        z.object({
          stockItemId: objectId,
          countedQty: z.number().min(0, 'Counted quantity cannot be negative'),
        }),
      )
      .min(1, 'At least one counted line is required'),
    notes: z.string().optional(),
  }),
});

const postStocktakeZodSchema = z.object({
  body: z.object({
    notes: z.string().optional(),
  }),
});

export const RetailStocktakeValidations = {
  startStocktakeZodSchema,
  recordCountsZodSchema,
  postStocktakeZodSchema,
};
