import { z } from 'zod';
import { ORDER_STATUS, ORDER_TYPE, PAYMENT_STATUS } from './order.interface';

const orderItemModifierSchema = z.object({
  name: z.string({ message: 'Modifier name is required' }),
  price: z.number({ message: 'Modifier price is required' }),
});

const orderItemSchema = z.object({
  menuItemId: z.string({ message: 'Menu Item ID is required' }),
  quantity: z.number({ message: 'Quantity is required' }).min(1),
  price: z.number({ message: 'Price is required' }),
  specialInstructions: z.string().optional(),
  modifiers: z.array(orderItemModifierSchema).optional(),
});

const createOrderValidationSchema = z.object({
  body: z.object({
    orderNumber: z.string({ message: 'Order number is required' }),
    tableId: z.string().optional(),
    type: z.enum([...Object.values(ORDER_TYPE)] as [string, ...string[]]).optional(),
    status: z.enum([...Object.values(ORDER_STATUS)] as [string, ...string[]]).optional(),
    paymentStatus: z.enum([...Object.values(PAYMENT_STATUS)] as [string, ...string[]]).optional(),
    totalAmount: z.number({ message: 'Total amount is required' }),
    items: z.array(orderItemSchema).nonempty({ message: 'At least one item is required' }),
    tenantId: z.string({ message: 'Tenant ID is required' }),
    locationId: z.string({ message: 'Location ID is required' }),
  }),
});

const updateOrderValidationSchema = z.object({
  body: z.object({
    tableId: z.string().optional(),
    type: z.enum([...Object.values(ORDER_TYPE)] as [string, ...string[]]).optional(),
    status: z.enum([...Object.values(ORDER_STATUS)] as [string, ...string[]]).optional(),
    paymentStatus: z.enum([...Object.values(PAYMENT_STATUS)] as [string, ...string[]]).optional(),
    totalAmount: z.number().optional(),
    items: z.array(orderItemSchema).optional(),
    tenantId: z.string().optional(),
    locationId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const OrderValidation = {
  createOrderValidationSchema,
  updateOrderValidationSchema,
};
