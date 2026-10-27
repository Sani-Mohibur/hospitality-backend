import { z } from 'zod';
import { businessDate, objectId } from '../../../utils/zod';

const zReportZodSchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    shiftId: objectId.optional(),
    date: businessDate.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});

const salesSummaryZodSchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
  }),
});

const topProductsZodSchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.string().optional(),
    sortBy: z.enum(['quantity', 'revenue']).default('quantity'),
  }),
});

const categoryBreakdownZodSchema = z.object({
  query: z.object({
    locationId: objectId.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
});

export const RetailReportValidations = {
  zReportZodSchema,
  salesSummaryZodSchema,
  topProductsZodSchema,
  categoryBreakdownZodSchema,
};
