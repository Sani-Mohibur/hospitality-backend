import { Schema, model } from 'mongoose';
import { ITable, TABLE_STATUS } from './table.interface';

const tableSchema = new Schema<ITable>(
  {
    tableNumber: { type: String, required: true, trim: true },
    capacity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: Object.values(TABLE_STATUS),
      default: TABLE_STATUS.OPEN,
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
    outletId: { type: Schema.Types.ObjectId, ref: 'Outlet', required: true },
    zone: { type: String },
    shape: { type: String, enum: ['SQUARE', 'ROUND', 'RECT', 'BAR'], default: 'SQUARE' },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      w: { type: Number, default: 1 },
      h: { type: Number, default: 1 },
      rotation: { type: Number, default: 0 },
    },
    qrToken: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

tableSchema.index({ tenantId: 1, outletId: 1, tableNumber: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
tableSchema.index({ qrToken: 1 }, { unique: true, partialFilterExpression: { qrToken: { $type: 'string' } } });

tableSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const Table = model<ITable>('Table', tableSchema);
