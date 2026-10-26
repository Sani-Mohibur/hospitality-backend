import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits');

const createStaffValidationSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
    phone: z.string().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(['TENANT_MANAGER', 'STAFF']).default('STAFF'),
    roleId: objectId.optional(),
    locationIds: z.array(objectId).optional(),
    allLocations: z.boolean().optional(),
    pin: pin.optional(),
    sendInvite: z.boolean().optional(),
  }),
});

const updateStaffValidationSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    role: z.enum(['TENANT_MANAGER', 'STAFF']).optional(),
    roleId: objectId.optional(),
    locationIds: z.array(objectId).optional(),
    allLocations: z.boolean().optional(),
    isActive: z.boolean().optional(),
    pin: pin.optional(),
  }),
});

const setPinValidationSchema = z.object({ body: z.object({ pin }) });

const updateProfileValidationSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    workspaceName: z.string().min(1).optional(),
  }),
});

export const UserValidation = {
  createStaffValidationSchema,
  updateStaffValidationSchema,
  setPinValidationSchema,
  updateProfileValidationSchema,
};
