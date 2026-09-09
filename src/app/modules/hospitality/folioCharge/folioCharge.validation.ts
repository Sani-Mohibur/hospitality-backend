import { z } from 'zod';
import { CHARGE_CATEGORY } from './folioCharge.interface';

const createFolioChargeValidationSchema = z.object({
  body: z.object({
    folioId: z.string({ message: 'Folio ID is required' }),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    amount: z.number({ message: 'Amount is required' }),
    chargeCategory: z.enum([...Object.values(CHARGE_CATEGORY)] as [string, ...string[]]),
    description: z.string({ message: 'Description is required' }),
    transactionDate: z.string().datetime().optional(),
  }),
});

const updateFolioChargeValidationSchema = z.object({
  body: z.object({
    folioId: z.string().optional(),
    tenantId: z.string().optional(),
    amount: z.number().optional(),
    chargeCategory: z.enum([...Object.values(CHARGE_CATEGORY)] as [string, ...string[]]).optional(),
    description: z.string().optional(),
    transactionDate: z.string().datetime().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const FolioChargeValidation = {
  createFolioChargeValidationSchema,
  updateFolioChargeValidationSchema,
};
