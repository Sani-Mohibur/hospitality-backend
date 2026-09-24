import { Schema, Types } from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../errors/AppError';
import { requestContext } from '../utils/requestContext';

// MongoDB equivalent of row-level security: any model with a `tenantId` path is
// automatically filtered to the tenant in the request context, and new documents
// are stamped with it. A document or filter naming a different tenant is rejected.
const QUERY_HOOKS = [
  'find',
  'findOne',
  'countDocuments',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'replaceOne',
  'distinct',
] as const;

const activeTenant = (): string | undefined => {
  const ctx = requestContext.get();
  if (!ctx || ctx.bypassTenantScope || !ctx.tenantId) return undefined;
  return ctx.tenantId;
};

const isPlainId = (value: unknown) =>
  typeof value === 'string' || value instanceof Types.ObjectId;

export const tenantScopePlugin = (schema: Schema) => {
  if (!schema.path('tenantId')) return;

  (schema as any).pre(QUERY_HOOKS as unknown as string[], function (this: any) {
    const tenantId = activeTenant();
    if (!tenantId) return;
    const filter = this.getFilter();
    if (filter.tenantId && isPlainId(filter.tenantId) && String(filter.tenantId) !== tenantId) {
      throw new AppError(httpStatus.FORBIDDEN, 'Cross-tenant access denied');
    }
    this.where({ tenantId: new Types.ObjectId(tenantId) });
  });

  schema.pre('aggregate', function (this: any) {
    const tenantId = activeTenant();
    if (!tenantId) return;
    this.pipeline().unshift({ $match: { tenantId: new Types.ObjectId(tenantId) } });
  });

  schema.pre('validate', function (this: any) {
    const tenantId = activeTenant();
    if (!tenantId) return;
    if (!this.tenantId) {
      this.tenantId = new Types.ObjectId(tenantId);
    } else if (String(this.tenantId) !== tenantId) {
      throw new AppError(httpStatus.FORBIDDEN, 'Cross-tenant write denied');
    }
  });

  schema.pre('insertMany', function (this: any, docs: any[]) {
    const tenantId = activeTenant();
    if (!tenantId || !Array.isArray(docs)) return;
    for (const doc of docs) {
      if (!doc.tenantId) doc.tenantId = new Types.ObjectId(tenantId);
      else if (String(doc.tenantId) !== tenantId) {
        throw new AppError(httpStatus.FORBIDDEN, 'Cross-tenant write denied');
      }
    }
  });
};
