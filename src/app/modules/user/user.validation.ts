import { z } from 'zod';
import { USER_ROLE } from './user.constant';

const createUserValidationSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    email: z
      .string()
      .min(1, 'Email is required')
      .email('Invalid email address'),
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters'),
    role: z.enum([...Object.values(USER_ROLE)] as [string, ...string[]]).optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    profileImage: z.string().optional(),
  }),
});

export const UserValidation = {
  createUserValidationSchema,
};
