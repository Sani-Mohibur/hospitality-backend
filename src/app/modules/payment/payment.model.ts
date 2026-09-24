import { Schema, model } from 'mongoose';
import { IPayment, PAYMENT_METHOD, PAYMENT_STATUS, PAYMENT_TARGET } from './payment.interface';

const paymentSchema = new Schema<IPayment>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet' },
    target: {
      kind: { type: String, enum: Object.values(PAYMENT_TARGET), required: true },
      id: { type: Schema.Types.ObjectId, required: true },
      checkNo: { type: Number },
    },
    method: { type: String, enum: Object.values(PAYMENT_METHOD), required: true },
    amountMinor: { type: Number, required: true, min: 0 },
    tipMinor: { type: Number, default: 0, min: 0 },
    tenderedMinor: { type: Number },
    changeMinor: { type: Number },
    currency: {
      type: String,
      default: 'USD',
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    refundedMinor: { type: Number, default: 0 },
    refunds: [
      new Schema(
        {
          amountMinor: { type: Number, required: true },
          reason: { type: String, required: true },
          at: { type: Date, default: Date.now },
          by: { type: Schema.Types.ObjectId, ref: 'User' },
          approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          providerRef: { type: String },
          status: { type: String, enum: ['PENDING', 'SUCCEEDED', 'FAILED'], default: 'SUCCEEDED' },
        },
        { _id: true },
      ),
    ],
    stripe: {
      accountId: { type: String },
      paymentIntentId: { type: String },
      chargeId: { type: String },
      applicationFeeMinor: { type: Number },
    },
    folioPosting: {
      roomStayId: { type: Schema.Types.ObjectId, ref: 'RoomStay' },
      folioId: { type: Schema.Types.ObjectId, ref: 'Folio' },
      roomNumber: { type: String },
      guestName: { type: String },
      signatureUrl: { type: String },
    },
    folioLineIds: [{ type: Schema.Types.ObjectId, ref: 'FolioLine' }],
    reference: { type: String },
    note: { type: String },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest' },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    clientRef: { type: String },
    offline: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
    failureReason: { type: String },
  },
  {
    timestamps: true,
  },
);

paymentSchema.index({ 'stripe.paymentIntentId': 1 }, { unique: true, partialFilterExpression: { 'stripe.paymentIntentId': { $type: 'string' } } });
paymentSchema.index({ tenantId: 1, clientRef: 1 }, { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } });
paymentSchema.index({ tenantId: 1, 'target.kind': 1, 'target.id': 1 });
paymentSchema.index({ tenantId: 1, locationId: 1, createdAt: -1 });

export const Payment = model<IPayment>('Payment', paymentSchema);
