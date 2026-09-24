import { Schema, Types, model } from 'mongoose';

// Every real-time event is stored with a per-location sequence number so a device
// that reconnects can ask for everything it missed (GET /sync/events?since=<seq>).
export interface IEventLog {
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId;
  seq: number;
  event: string;
  rooms: string[];
  data: unknown;
  createdAt?: Date;
}

const eventLogSchema = new Schema<IEventLog>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    seq: { type: Number, required: true },
    event: { type: String, required: true },
    rooms: [{ type: String }],
    data: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

eventLogSchema.index({ locationId: 1, seq: 1 });
eventLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });

export const EventLog = model<IEventLog>('EventLog', eventLogSchema);
