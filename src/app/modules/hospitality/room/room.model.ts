import { Schema, model } from 'mongoose';
import { HOUSEKEEPING_STATUS, IRoom, IRoomBlock, OCCUPANCY_STATUS, ROOM_BLOCK_TYPE } from './room.interface';

const roomSchema = new Schema<IRoom>(
  {
    roomNumber: { type: String, required: true, trim: true },
    roomCategoryId: {
      type: Schema.Types.ObjectId,
      ref: 'RoomCategory',
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
    floor: { type: String },
    features: [{ type: String }],
    housekeepingStatus: {
      type: String,
      enum: Object.values(HOUSEKEEPING_STATUS),
      default: HOUSEKEEPING_STATUS.CLEAN,
    },
    occupancyStatus: {
      type: String,
      enum: Object.values(OCCUPANCY_STATUS),
      default: OCCUPANCY_STATUS.VACANT,
    },
    currentStayId: { type: Schema.Types.ObjectId, ref: 'RoomStay' },
    qrToken: { type: String },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

roomSchema.index(
  { tenantId: 1, locationId: 1, roomNumber: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
roomSchema.index({ qrToken: 1 }, { unique: true, partialFilterExpression: { qrToken: { $type: 'string' } } });

roomSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const Room = model<IRoom>('Room', roomSchema);

const roomBlockSchema = new Schema<IRoomBlock>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    type: { type: String, enum: Object.values(ROOM_BLOCK_TYPE), required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    reason: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    releasedAt: { type: Date },
    releasedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

roomBlockSchema.index({ locationId: 1, roomId: 1, from: 1, to: 1 });

export const RoomBlock = model<IRoomBlock>('RoomBlock', roomBlockSchema);
