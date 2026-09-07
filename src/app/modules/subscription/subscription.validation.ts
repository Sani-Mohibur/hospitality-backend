import { z } from 'zod';

const updateSubscriptionStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(['ACTIVE', 'OVERDUE', 'CANCELLED']),
  }),
});

const applyCreditDiscountValidationSchema = z.object({
  body: z.object({
    appliedCredits: z.number().min(0).optional(),
    appliedDiscounts: z.number().min(0).optional(),
  }),
});

export const SubscriptionValidations = {
  updateSubscriptionStatusValidationSchema,
  applyCreditDiscountValidationSchema,
};
