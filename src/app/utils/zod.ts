import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const minor = z.number().int('Amounts are integers in minor units (e.g. cents)');
export const positiveMinor = minor.min(0);
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const body = <T extends z.ZodRawShape>(shape: T) => z.object({ body: z.object(shape) });
