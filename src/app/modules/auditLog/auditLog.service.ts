import { IAuditLog } from './auditLog.interface';
import { AuditLog } from './auditLog.model';

const createAuditLog = async (payload: Partial<IAuditLog>) => {
  const result = await AuditLog.create(payload);
  return result;
};

const getAuditLogs = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};
  if (query.tenant) filter.tenant = query.tenant;
  if (query.user) filter.user = query.user;
  if (query.entity) filter.entity = query.entity;
  if (query.action) filter.action = query.action;

  const result = await AuditLog.find(filter)
    .populate('user', 'name email')
    .populate('tenant', 'name')
    .sort({ createdAt: -1 })
    .limit(100);

  return result;
};

export const AuditLogService = {
  createAuditLog,
  getAuditLogs,
};
