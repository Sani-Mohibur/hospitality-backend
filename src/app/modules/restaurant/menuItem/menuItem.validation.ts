import { z } from 'zod';

const modifierSchema = z.object({
  name: z.string({ message: 'Modifier name is required' }),
  price: z.number({ message: 'Modifier price is required' }),
});

const createMenuItemValidationSchema = z.object({
  body: z.object({
    name: z.string({ message: 'Name is required' }),
    description: z.string().optional(),
    price: z.number({ message: 'Price is required' }),
    categoryId: z.string({ message: 'Category ID is required' }),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    locationId: z.string({ message: 'Location ID is required' }),
    modifiers: z.array(modifierSchema).optional(),
  }),
});

const updateMenuItemValidationSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    price: z.number().optional(),
    categoryId: z.string().optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    modifiers: z.array(modifierSchema).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const MenuItemValidation = {
  createMenuItemValidationSchema,
  updateMenuItemValidationSchema,
};
