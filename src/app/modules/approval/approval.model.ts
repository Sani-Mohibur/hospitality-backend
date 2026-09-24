import { Schema, Types, model } from 'mongoose';

export const APPROVAL_ACTION = {
  DISCOUNT: 'DISCOUNT',
  VOID_ITEM: 'VOID_ITEM',
  VOID_ORDER: 'VOID_ORDER',
  COMP: 'COMP',
  REFUND: 'REFUND',
  FOLIO_ADJUST: 'FOLIO_ADJUST',
  CASH_PAYOUT: 'CASH_PAYOUT',
  REOPEN_ORDER: 'REOPEN_ORDER',
  OVERRIDE_CREDIT_LIMIT: 'OVERRIDE_CREDIT_LIMIT',
  NO_SHOW_WAIVE: 'NO_SHOW_WAIVE',
} as const;

export type TApprovalAction = keyof typeof APPROVAL_ACTION;

// A staff member asks a manager to approve an action remotely (push to phone).
export interface IApprovalRequest {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  action: TApprovalAction;
  summary: string;
  context?: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  expiresAt: Date;
}

const approvalRequestSchema = new Schema<IApprovalRequest>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: Object.values(APPROVAL_ACTION), required: true },
    summary: { type: String, required: true },
    context: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'DENIED', 'EXPIRED'], default: 'PENDING' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

approvalRequestSchema.index({ tenantId: 1, locationId: 1, status: 1 });

export const ApprovalRequest = model<IApprovalRequest>('ApprovalRequest', approvalRequestSchema);

// Approval tokens are single use.
const approvalUseSchema = new Schema({
  jti: { type: String, required: true, unique: true },
  usedAt: { type: Date, default: Date.now, expires: 3600 },
});

export const ApprovalUse = model('ApprovalUse', approvalUseSchema);
