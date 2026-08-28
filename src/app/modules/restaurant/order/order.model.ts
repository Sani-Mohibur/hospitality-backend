import { Schema, model } from 'mongoose';
import { IOrder, ORDER_STATUS, ORDER_TYPE, PAYMENT_STATUS } from './order.interface';

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table' },
    type: {
      type: String,
      enum: Object.values(ORDER_TYPE),
      default: ORDER_TYPE.DINE_IN,
    },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
    },
    totalAmount: { type: Number, required: true },
    items: [
      {
        menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        specialInstructions: { type: String },
        modifiers: [
          {
            name: { type: String, required: true },
            price: { type: Number, required: true },
          },
        ],
      },
    ],
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const Order = model<IOrder>('Order', orderSchema);
