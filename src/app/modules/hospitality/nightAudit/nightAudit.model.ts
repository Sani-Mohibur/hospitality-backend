import { Schema, Types, model } from 'mongoose';

// One row per closed business date per location; the daily manager report is kept here.
export interface INightAuditRun {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  businessDate: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  auto: boolean;
  startedBy?: Types.ObjectId;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  warnings: string[];
  steps: { name: string; count: number }[];
  report?: Record<string, unknown>;
}

const nightAuditRunSchema = new Schema<INightAuditRun>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    businessDate: { type: String, required: true },
    status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },
    auto: { type: Boolean, default: false },
    startedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    error: { type: String },
    warnings: [{ type: String }],
    steps: [new Schema({ name: String, count: Number }, { _id: false })],
    report: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// Only one audit per location and date can run or complete.
nightAuditRunSchema.index(
  { tenantId: 1, locationId: 1, businessDate: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['RUNNING', 'COMPLETED'] } } },
);

export const NightAuditRun = model<INightAuditRun>('NightAuditRun', nightAuditRunSchema);
