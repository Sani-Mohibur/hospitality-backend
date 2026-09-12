import { z } from 'zod';

const createInventoryValidationSchema = z.object({
  body: z.object({
    name: z.string({ message: 'Name is required' }),
    sku: z.string().optional(),
    category: z.string().optional(),
    unitOfMeasure: z.string({ message: 'Unit of measure is required' }),
    quantity: z.number().min(0, 'Quantity cannot be negative').default(0),
    unitCost: z.number().min(0, 'Unit cost cannot be negative').default(0),
    locationId: z.string({ message: 'Location ID is required' }),
  }),
});

const updateInventoryValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    sku: z.string().optional(),
    category: z.string().optional(),
    unitOfMeasure: z.string().optional(),
    quantity: z.number().min(0, 'Quantity cannot be negative').optional(),
    unitCost: z.number().min(0, 'Unit cost cannot be negative').optional(),
    locationId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

const adjustStockValidationSchema = z.object({
  body: z.object({
    quantityChange: z.number().positive('Change amount must be a positive number'),
    type: z.enum(['ADD', 'SUBTRACT'], { message: 'Type must be ADD or SUBTRACT' }),
  }),
});

export const InventoryValidation = {
  createInventoryValidationSchema,
  updateInventoryValidationSchema,
  adjustStockValidationSchema,
};
