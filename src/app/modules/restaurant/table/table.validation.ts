import { z } from 'zod';
import { TABLE_STATUS } from './table.interface';

const createTableValidationSchema = z.object({
  body: z.object({
    tableNumber: z.string({ message: 'Table number is required' }),
    capacity: z.number({ message: 'Capacity is required' }),
    status: z.enum([...Object.values(TABLE_STATUS)] as [string, ...string[]]).optional(),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    locationId: z.string({ message: 'Location ID is required' }),
  }),
});

const updateTableValidationSchema = z.object({
  body: z.object({
    tableNumber: z.string().optional(),
    capacity: z.number().optional(),
    status: z.enum([...Object.values(TABLE_STATUS)] as [string, ...string[]]).optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const TableValidation = {
  createTableValidationSchema,
  updateTableValidationSchema,
};
