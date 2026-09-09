import { z } from 'zod';
import { FOLIO_STATUS } from './folio.interface';

const createFolioValidationSchema = z.object({
  body: z.object({
    reservationId: z.string({ message: 'Reservation ID is required' }),
    guestId: z.string({ message: 'Guest ID is required' }),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    locationId: z.string({ message: 'Location ID is required' }),
    status: z.enum([...Object.values(FOLIO_STATUS)] as [string, ...string[]]).optional(),
  }),
});

const updateFolioValidationSchema = z.object({
  body: z.object({
    reservationId: z.string().optional(),
    guestId: z.string().optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    status: z.enum([...Object.values(FOLIO_STATUS)] as [string, ...string[]]).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const FolioValidation = {
  createFolioValidationSchema,
  updateFolioValidationSchema,
};
