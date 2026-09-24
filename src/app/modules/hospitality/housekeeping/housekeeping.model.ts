import { Schema, Types, model } from 'mongoose';

export const HK_TASK_TYPE = {
  DEPARTURE: 'DEPARTURE',
  STAYOVER: 'STAYOVER',
  INSPECTION: 'INSPECTION',
  TURNDOWN: 'TURNDOWN',
  MAINTENANCE: 'MAINTENANCE',
  REQUEST: 'REQUEST',
} as const;

export const HK_TASK_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  INSPECTED: 'INSPECTED',
  SKIPPED: 'SKIPPED',
} as const;

export interface IHousekeepingTask {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  roomId: Types.ObjectId;
  businessDate: string;
  type: keyof typeof HK_TASK_TYPE;
  status: keyof typeof HK_TASK_STATUS;
  // Higher first: rooms with a guest arriving today are cleaned first
  priority: number;
  assignedTo?: Types.ObjectId;
  notes?: string;
  requestSource?: 'STAFF' | 'GUEST_QR';
  startedAt?: Date;
  finishedAt?: Date;
  inspectedAt?: Date;
  inspectedBy?: Types.ObjectId;
  inspectionPassed?: boolean;
  createdBy?: Types.ObjectId;
}

const housekeepingTaskSchema = new Schema<IHousekeepingTask>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    businessDate: { type: String, required: true },
    type: { type: String, enum: Object.values(HK_TASK_TYPE), required: true },
    status: { type: String, enum: Object.values(HK_TASK_STATUS), default: HK_TASK_STATUS.PENDING },
    priority: { type: Number, default: 0 },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
    requestSource: { type: String, enum: ['STAFF', 'GUEST_QR'] },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    inspectedAt: { type: Date },
    inspectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    inspectionPassed: { type: Boolean },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

housekeepingTaskSchema.index({ tenantId: 1, locationId: 1, businessDate: 1, status: 1 });
housekeepingTaskSchema.index({ tenantId: 1, assignedTo: 1, businessDate: 1 });

export const HousekeepingTask = model<IHousekeepingTask>('HousekeepingTask', housekeepingTaskSchema);

export interface ILostFoundItem {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  roomId?: Types.ObjectId;
  description: string;
  foundAt: Date;
  foundBy?: Types.ObjectId;
  storageLocation?: string;
  guestId?: Types.ObjectId;
  status: 'STORED' | 'RETURNED' | 'DISPOSED';
  resolvedAt?: Date;
  resolvedNote?: string;
}

const lostFoundSchema = new Schema<ILostFoundItem>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
    description: { type: String, required: true },
    foundAt: { type: Date, default: Date.now },
    foundBy: { type: Schema.Types.ObjectId, ref: 'User' },
    storageLocation: { type: String },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest' },
    status: { type: String, enum: ['STORED', 'RETURNED', 'DISPOSED'], default: 'STORED' },
    resolvedAt: { type: Date },
    resolvedNote: { type: String },
  },
  { timestamps: true },
);

export const LostFoundItem = model<ILostFoundItem>('LostFoundItem', lostFoundSchema);
