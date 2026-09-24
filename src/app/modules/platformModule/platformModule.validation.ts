import { z } from 'zod';

const fields = {
  name: z.string({ message: 'Name is required' }),
  code: z.string({ message: 'Code is required' }),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  isAddOn: z.boolean().optional(),
  pricingModel: z.enum(['FLAT', 'PER_ROOM', 'PER_OUTLET', 'PER_LOCATION']).optional(),
  unitPriceMinor: z.number().int().min(0).optional(),
  minimumMinor: z.number().int().min(0).optional(),
  bundleUnitPriceMinor: z.number().int().min(0).optional(),
  bundleMinimumMinor: z.number().int().min(0).optional(),
  requires: z.array(z.string()).optional(),
};

const createPlatformModuleValidationSchema = z.object({
  body: z.object(fields),
});

const updatePlatformModuleValidationSchema = z.object({
  body: z.object(fields).partial(),
});

export const PlatformModuleValidations = {
  createPlatformModuleValidationSchema,
  updatePlatformModuleValidationSchema,
};
