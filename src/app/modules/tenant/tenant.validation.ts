import { z } from 'zod';

const moduleCode = z.string().min(2).toUpperCase();

const createTenantValidationSchema = z.object({
  body: z.object({
    businessName: z.string().min(2, 'Business name is required'),
    ownerName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8).optional(),
    phone: z.string().optional(),
    currency: z.string().length(3).optional(),
    timezone: z.string().optional(),
    locationName: z.string().optional(),
    address: z.string().optional(),
    modules: z.array(moduleCode).optional(),
  }),
});

const updateTenantValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    isActive: z.boolean().optional(),
    status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
    modules: z.array(moduleCode).optional(),
    ownerName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    partnerId: z.string().optional(),
    'stripe.platformFeeBps': z.number().int().min(0).max(1000).optional(),
  }),
});

const featuresValidationSchema = z.object({
  body: z.object({ modules: z.array(moduleCode) }),
});

const featureFlagValidationSchema = z.object({
  body: z.object({ flag: z.string().min(1), enabled: z.boolean() }),
});

const updateMyTenantValidationSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    workspaceName: z.string().min(1).optional(),
    currency: z.string().length(3).optional(),
    branding: z
      .object({
        displayName: z.string().optional(),
        logoUrl: z.string().url().optional(),
        primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        customDomain: z.string().optional(),
      })
      .optional(),
    loyalty: z
      .object({
        enabled: z.boolean().optional(),
        pointsPerMajorUnit: z.number().int().min(0).optional(),
        pointValueMinor: z.number().int().min(0).optional(),
      })
      .optional(),
    settings: z
      .object({
        taxInclusive: z.boolean().optional(),
        locale: z.string().optional(),
        defaultTimezone: z.string().optional(),
        offlineRoomChargeLimitMinor: z.number().int().min(0).optional(),
        approval: z
          .object({
            discountOverBps: z.number().int().min(0).max(10000).optional(),
            discountOverMinor: z.number().int().min(0).optional(),
            voidAfterFire: z.boolean().optional(),
            refunds: z.boolean().optional(),
            folioAdjustOverMinor: z.number().int().min(0).optional(),
            cashPayoutOverMinor: z.number().int().min(0).optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export const TenantValidation = {
  createTenantValidationSchema,
  updateTenantValidationSchema,
  featuresValidationSchema,
  featureFlagValidationSchema,
  updateMyTenantValidationSchema,
};
