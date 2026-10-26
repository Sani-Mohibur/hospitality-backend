import { z } from 'zod';

const createSupplierZodSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Supplier name is required').trim(),
    code: z.string().max(30).optional(),
    contactName: z.string().optional(),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().optional(),
    address: z.string().optional(),
    taxNumber: z.string().optional(),
    leadTimeDays: z.number().int().min(0).default(2),
    notes: z.string().optional(),
    isActive: z.boolean().default(true),
  }),
});

const updateSupplierZodSchema = z.object({
  body: z.object({
    name: z.string().min(1).trim().optional(),
    code: z.string().max(30).optional(),
    contactName: z.string().optional(),
    email: z.string().email('Invalid email address').optional().or(z.literal('')).nullable(),
    phone: z.string().optional(),
    address: z.string().optional(),
    taxNumber: z.string().optional(),
    leadTimeDays: z.number().int().min(0).optional(),
    notes: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const RetailSupplierValidations = {
  createSupplierZodSchema,
  updateSupplierZodSchema,
};
