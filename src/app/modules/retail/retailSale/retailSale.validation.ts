import { z } from 'zod';
import { PAYMENT_METHOD } from '../../payment/payment.interface';
import { objectId, positiveMinor } from '../../../utils/zod';

const cartItemInputZodSchema = z.object({
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  discount: z
    .object({
      type: z.enum(['PERCENT', 'AMOUNT', 'COMP']),
      value: z.number().min(0, 'Discount value cannot be negative'),
      reason: z.string().optional(),
    })
    .optional(),
});

const discountInputZodSchema = z.object({
  type: z.enum(['PERCENT', 'AMOUNT', 'COMP']),
  value: z.number().min(0, 'Discount value cannot be negative'),
  reason: z.string().min(1, 'Discount reason is required'),
});

const paymentInputZodSchema = z.object({
  method: z.nativeEnum(PAYMENT_METHOD),
  amountMinor: positiveMinor.refine((v) => v > 0, 'Payment amount must be greater than zero'),
  tenderedMinor: positiveMinor.optional(),
  reference: z.string().optional(),
  note: z.string().optional(),
  roomCharge: z
    .object({
      roomNumber: z.string().optional(),
      roomStayId: objectId.optional(),
      guestLastName: z.string().optional(),
      signatureUrl: z.string().optional(),
    })
    .optional(),
  companyAccountId: objectId.optional(),
});

const posProductSearchZodSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    sku: z.string().optional(),
    barcode: z.string().optional(),
    categoryId: objectId.optional(),
    locationId: objectId.optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

const posPriceCheckZodSchema = z.object({
  query: z.object({
    barcode: z.string().optional(),
    sku: z.string().optional(),
    productId: objectId.optional(),
    variantId: objectId.optional(),
    locationId: objectId.optional(),
  }),
});

const calculateCartZodSchema = z.object({
  body: z.object({
    locationId: objectId.optional(),
    items: z.array(cartItemInputZodSchema).min(1, 'Cart must have at least one item'),
    discounts: z.array(discountInputZodSchema).optional(),
    customerId: objectId.optional(),
  }),
});

const checkoutZodSchema = z.object({
  body: z.object({
    locationId: objectId.optional(),
    items: z.array(cartItemInputZodSchema).min(1, 'At least one item is required for checkout'),
    discounts: z.array(discountInputZodSchema).optional(),
    payments: z.array(paymentInputZodSchema).min(1, 'At least one payment method is required'),
    customerId: objectId.optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    customerEmail: z.string().email().optional().or(z.literal('')),
    clientRef: z.string().optional(),
    notes: z.string().optional(),
    shiftId: objectId.optional(),
  }),
});

const returnLineInputZodSchema = z.object({
  saleLineId: objectId.optional(),
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.number().int().positive('Return quantity must be at least 1'),
  restock: z.boolean().default(true),
  condition: z.enum(['RESELLABLE', 'DAMAGED', 'DEFECTIVE']).default('RESELLABLE'),
  reason: z.string().min(1, 'Return reason is required for line'),
});

const processReturnZodSchema = z.object({
  body: z.object({
    lines: z.array(returnLineInputZodSchema).min(1, 'At least one line item is required for return'),
    refundMethod: z.nativeEnum(PAYMENT_METHOD),
    reason: z.string().min(1, 'Return reason is required'),
    notes: z.string().optional(),
    shiftId: objectId.optional(),
  }),
});

export const RetailSaleValidations = {
  posProductSearchZodSchema,
  posPriceCheckZodSchema,
  calculateCartZodSchema,
  checkoutZodSchema,
  processReturnZodSchema,
};
