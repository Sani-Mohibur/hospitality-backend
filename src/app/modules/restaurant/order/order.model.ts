import { Schema, model } from 'mongoose';
import { IOrder, IOrderStatusHistory, ITEM_STATUS, ORDER_SOURCE, ORDER_STATUS, ORDER_TYPE, PAYMENT_STATUS } from './order.interface';
import { TAX_CATEGORY } from '../../../utils/money';

const orderStatusHistorySchema = new Schema<IOrderStatusHistory>(
  {
    status: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    remarks: { type: String },
  },
  { _id: false },
);

const discountSchema = new Schema(
  {
    type: { type: String, enum: ['PERCENT', 'AMOUNT', 'COMP'], required: true },
    value: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: true },
);

const itemSchema = new Schema(
  {
    menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'MenuCategory' },
    stationId: { type: Schema.Types.ObjectId, ref: 'Station' },
    taxCategory: { type: String, enum: Object.values(TAX_CATEGORY), default: TAX_CATEGORY.FOOD },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceMinor: { type: Number, required: true },
    modifiers: [
      new Schema(
        {
          groupId: { type: Schema.Types.ObjectId },
          groupName: { type: String },
          optionId: { type: Schema.Types.ObjectId },
          name: { type: String, required: true },
          priceMinor: { type: Number, required: true },
          quantity: { type: Number, default: 1 },
        },
        { _id: false },
      ),
    ],
    specialInstructions: { type: String },
    course: { type: Number, default: 1 },
    seat: { type: Number },
    checkNo: { type: Number, default: 1 },
    status: { type: String, enum: Object.values(ITEM_STATUS), default: ITEM_STATUS.NEW },
    firedAt: { type: Date },
    startedAt: { type: Date },
    readyAt: { type: Date },
    servedAt: { type: Date },
    discount: discountSchema,
    void: {
      at: { type: Date },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      reason: { type: String },
      approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      afterFire: { type: Boolean },
      waste: { type: Boolean },
    },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    calc: {
      grossMinor: Number,
      discountMinor: Number,
      netMinor: Number,
      serviceMinor: Number,
      taxMinor: Number,
      totalMinor: Number,
      taxLines: [new Schema({ name: String, rateBps: Number, amountMinor: Number }, { _id: false })],
    },
  },
  { _id: true },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true },
    clientOrderId: { type: String },
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet', required: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table' },
    type: {
      type: String,
      enum: Object.values(ORDER_TYPE),
      default: ORDER_TYPE.DINE_IN,
    },
    source: { type: String, enum: Object.values(ORDER_SOURCE), default: ORDER_SOURCE.POS },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.OPEN,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
    },
    businessDate: { type: String, required: true },
    covers: { type: Number, default: 1, min: 0 },
    serverId: { type: Schema.Types.ObjectId, ref: 'User' },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest' },
    roomStayId: { type: Schema.Types.ObjectId, ref: 'RoomStay' },
    pendingAcceptance: { type: Boolean, default: false },
    items: [itemSchema],
    discounts: [discountSchema],
    checks: [
      new Schema({ checkNo: { type: Number, required: true }, label: String, fixedAmountMinor: Number }, { _id: false }),
    ],
    totals: {
      subtotalMinor: { type: Number, default: 0 },
      discountMinor: { type: Number, default: 0 },
      serviceChargeMinor: { type: Number, default: 0 },
      taxMinor: { type: Number, default: 0 },
      totalMinor: { type: Number, default: 0 },
      tipMinor: { type: Number, default: 0 },
      paidMinor: { type: Number, default: 0 },
      refundedMinor: { type: Number, default: 0 },
      balanceMinor: { type: Number, default: 0 },
    },
    taxLines: [new Schema({ name: String, rateBps: Number, amountMinor: Number }, { _id: false })],
    notes: { type: String },
    delivery: {
      address: String,
      phone: String,
      aggregator: String,
      externalId: String,
      driver: String,
    },
    mergedIntoId: { type: Schema.Types.ObjectId, ref: 'Order' },
    closedAt: { type: Date },
    voidReason: { type: String },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    statusHistory: [orderStatusHistorySchema],
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.index({ tenantId: 1, locationId: 1, businessDate: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, clientOrderId: 1 }, { unique: true, partialFilterExpression: { clientOrderId: { $type: 'string' } } });
orderSchema.index({ tenantId: 1, outletId: 1, status: 1 });
orderSchema.index({ tenantId: 1, 'items.stationId': 1, 'items.status': 1 });
orderSchema.index(
  { tenantId: 1, 'delivery.aggregator': 1, 'delivery.externalId': 1 },
  { unique: true, partialFilterExpression: { 'delivery.externalId': { $type: 'string' } } },
);

orderSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const Order = model<IOrder>('Order', orderSchema);
