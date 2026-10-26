import { z } from 'zod';
import { objectId } from '../../../utils/zod';

const transferLineInputZodSchema = z.object({
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.number().int().positive('Quantity must be at least 1'),
});

const createTransferZodSchema = z.object({
  body: z.object({
    fromLocationId: objectId.optional(),
    toLocationId: objectId,
    lines: z.array(transferLineInputZodSchema).min(1, 'At least one line item is required'),
    notes: z.string().optional(),
    autoDispatch: z.boolean().optional(),
  }),
});

const directTransferZodSchema = z.object({
  body: z.object({
    fromLocationId: objectId.optional(),
    toLocationId: objectId,
    lines: z.array(transferLineInputZodSchema).min(1, 'At least one line item is required'),
    notes: z.string().optional(),
  }),
});

const cancelTransferZodSchema = z.object({
  body: z.object({
    reason: z.string().min(3, 'Cancellation reason is required').trim(),
  }),
});

export const RetailTransferValidations = {
  createTransferZodSchema,
  directTransferZodSchema,
  cancelTransferZodSchema,
};
