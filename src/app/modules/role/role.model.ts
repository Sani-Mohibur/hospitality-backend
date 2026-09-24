import { Schema, Types, model } from 'mongoose';
import { ALL_PERMISSIONS } from '../user/user.constant';

export interface IRole {
  tenantId: Types.ObjectId;
  name: string;
  key?: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  isDeleted: boolean;
}

const roleSchema = new Schema<IRole>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String },
    description: { type: String },
    permissions: [{ type: String, enum: ALL_PERMISSIONS }],
    isSystem: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

roleSchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

roleSchema.pre(['find', 'findOne'], function (this: any) {
  this.where({ isDeleted: { $ne: true } });
});

export const Role = model<IRole>('Role', roleSchema);
