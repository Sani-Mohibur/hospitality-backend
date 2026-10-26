import { z } from 'zod';
import { objectId, positiveMinor } from '../../../utils/zod';

const poLineInputZodSchema = z.object({
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  unitCost: positiveMinor.optional(),
});

const createPurchaseOrderZodSchema = z.object({
  body: z.object({
    supplierId: objectId,
    locationId: objectId.optional(),
    lines: z.array(poLineInputZodSchema).min(1, 'At least one line item is required'),
    expectedAt: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    notes: z.string().optional(),
  }),
});

const updatePurchaseOrderZodSchema = z.object({
  body: z.object({
    supplierId: objectId.optional(),
    lines: z.array(poLineInputZodSchema).min(1).optional(),
    expectedAt: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()).nullable(),
    notes: z.string().optional(),
  }),
});

const receiveGoodsZodSchema = z.object({
  body: z.object({
    lines: z
      .array(
        z.object({
          stockItemId: objectId,
          receivedQuantity: z.number().positive('Received quantity must be positive'),
          unitCost: positiveMinor.optional(),
        }),
      )
      .min(1, 'At least one received item is required'),
    notes: z.string().optional(),
  }),
});

export const RetailPurchaseOrderValidations = {
  createPurchaseOrderZodSchema,
  updatePurchaseOrderZodSchema,
  receiveGoodsZodSchema,
};
