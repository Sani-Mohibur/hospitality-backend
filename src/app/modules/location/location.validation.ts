import { z } from 'zod';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const validTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

const fields = {
  name: z.string().min(1),
  code: z.string().max(8).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  timezone: validTimezone.optional(),
  currency: z.string().length(3).optional(),
  checkInTime: timeOfDay.optional(),
  checkOutTime: timeOfDay.optional(),
  branchType: z.enum(['HOSPITALITY', 'RESTAURANT']).optional(),
  hasRooms: z.boolean().optional(),
  invoicePrefix: z.string().max(10).optional(),
  nightAudit: z.object({ autoRun: z.boolean().optional(), runAt: timeOfDay.optional() }).optional(),
  publicBooking: z
    .object({ enabled: z.boolean().optional(), slug: z.string().regex(/^[a-z0-9-]{3,60}$/).optional() })
    .optional(),
  coordinates: z
    .object({
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    })
    .optional(),
  mapUrl: z.string().url().optional().or(z.literal('')),
};

const createLocationValidationSchema = z.object({
  body: z.object(fields),
});

const updateLocationValidationSchema = z.object({
  body: z.object({ ...fields, name: fields.name.optional(), isActive: z.boolean().optional() }),
});

export const LocationValidation = {
  createLocationValidationSchema,
  updateLocationValidationSchema,
};
