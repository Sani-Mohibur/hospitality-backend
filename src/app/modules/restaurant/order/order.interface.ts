import { Types } from 'mongoose';

export const ORDER_TYPE = {
  DINE_IN: 'DINE_IN',
  TAKEAWAY: 'TAKEAWAY',
  DELIVERY: 'DELIVERY',
} as const;

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SERVED: 'SERVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export const PAYMENT_STATUS = {
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
} as const;

export interface IOrderItemModifier {
  name: string;
  price: number;
}

export interface IOrderItem {
  menuItemId: Types.ObjectId;
  quantity: number;
  price: number;
  specialInstructions?: string;
  modifiers?: IOrderItemModifier[];
}

export interface IOrder {
  orderNumber: string;
  tableId?: Types.ObjectId;
  type: typeof ORDER_TYPE[keyof typeof ORDER_TYPE];
  status: typeof ORDER_STATUS[keyof typeof ORDER_STATUS];
  paymentStatus: typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];
  totalAmount: number;
  items: IOrderItem[];
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}
