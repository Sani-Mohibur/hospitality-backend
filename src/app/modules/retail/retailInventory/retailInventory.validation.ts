import { z } from 'zod';
import { objectId } from '../../../utils/zod';

const initializeStockZodSchema = z.object({
  body: z.object({
    productId: objectId,
    variantId: objectId.optional(),
    locationId: objectId.optional(),
    openingQuantity: z.number().min(0).optional(),
    parLevel: z.number().min(0).optional(),
    reorderPoint: z.number().min(0).optional(),
    reorderQty: z.number().min(0).optional(),
    supplierId: objectId.optional(),
  }),
});

const updateStockLevelsZodSchema = z.object({
  body: z.object({
    parLevel: z.number().min(0).optional().nullable(),
    reorderPoint: z.number().min(0).optional().nullable(),
    reorderQty: z.number().min(0).optional().nullable(),
    supplierId: objectId.optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

const adjustStockZodSchema = z.object({
  body: z.object({
    stockItemId: objectId,
    quantityChange: z.number().positive('Quantity change must be positive'),
    type: z.enum(['ADD', 'SUBTRACT']),
    reason: z.string().min(3, 'Reason must be at least 3 characters').trim(),
  }),
});

const logWasteZodSchema = z.object({
  body: z.object({
    stockItemId: objectId,
    quantity: z.number().positive('Quantity must be positive'),
    reason: z.string().min(3, 'Reason must be at least 3 characters').trim(),
  }),
});

export const RetailInventoryValidations = {
  initializeStockZodSchema,
  updateStockLevelsZodSchema,
  adjustStockZodSchema,
  logWasteZodSchema,
};
