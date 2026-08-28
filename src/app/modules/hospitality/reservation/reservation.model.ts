import { Schema, model } from 'mongoose';
import { IReservation, RESERVATION_STATUS } from './reservation.interface';

const reservationSchema = new Schema<IReservation>(
  {
    guestId: {
      type: Schema.Types.ObjectId,
      ref: 'Guest',
      required: true,
    },
    roomId: {
      type: Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(RESERVATION_STATUS),
      default: RESERVATION_STATUS.PENDING,
    },
    totalAmount: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reservationSchema.pre(['find', 'findOne'], function () {
  this.find({ isDeleted: { $ne: true } });
});

export const Reservation = model<IReservation>('Reservation', reservationSchema);
