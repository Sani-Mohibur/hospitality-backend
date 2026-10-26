import { z } from 'zod';
import { objectId, positiveMinor } from '../../../utils/zod';
import { TAX_CATEGORY } from '../../../utils/money';

const variantAttributeZodSchema = z.object({
  name: z.string().min(1, 'Attribute name is required').trim(),
  value: z.string().min(1, 'Attribute value is required').trim(),
});

const variantZodSchema = z.object({
  _id: objectId.optional(),
  name: z.string().min(1, 'Variant name is required').trim(),
  sku: z.string().min(1, 'Variant SKU is required').trim(),
  barcode: z.string().trim().optional(),
  priceMinor: positiveMinor,
  costPriceMinor: positiveMinor.optional(),
  attributes: z.array(variantAttributeZodSchema).default([]),
  isActive: z.boolean().optional(),
});

const createProductZodSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Product name is required').trim(),
    description: z.string().optional(),
    categoryId: objectId,
    sku: z.string().min(1, 'Product SKU is required').trim(),
    barcode: z.string().trim().optional(),
    priceMinor: positiveMinor,
    costPriceMinor: positiveMinor.optional(),
    taxCategory: z.enum(Object.values(TAX_CATEGORY) as [string, ...string[]]).optional(),
    unitOfMeasure: z.string().min(1).trim().optional(),
    imageUrl: z.string().url().optional().or(z.literal('')),
    tags: z.array(z.string().trim()).optional(),
    locationId: objectId.nullable().optional(),
    hasVariants: z.boolean().optional(),
    variants: z.array(variantZodSchema).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
});

const updateProductZodSchema = z.object({
  body: z.object({
    name: z.string().min(1).trim().optional(),
    description: z.string().optional(),
    categoryId: objectId.optional(),
    sku: z.string().min(1).trim().optional(),
    barcode: z.string().trim().optional().nullable(),
    priceMinor: positiveMinor.optional(),
    costPriceMinor: positiveMinor.optional(),
    taxCategory: z.enum(Object.values(TAX_CATEGORY) as [string, ...string[]]).optional(),
    unitOfMeasure: z.string().min(1).trim().optional(),
    imageUrl: z.string().url().optional().or(z.literal('')).nullable(),
    tags: z.array(z.string().trim()).optional(),
    locationId: objectId.nullable().optional(),
    hasVariants: z.boolean().optional(),
    variants: z.array(variantZodSchema).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const RetailProductValidations = {
  createProductZodSchema,
  updateProductZodSchema,
};
