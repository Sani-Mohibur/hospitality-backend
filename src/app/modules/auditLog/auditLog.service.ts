import { Types } from 'mongoose';
import { IAuditLog } from './auditLog.interface';
import { ActivityEvent, AuditLog } from './auditLog.model';
import { requestContext } from '../../utils/requestContext';
import { diff, redact } from '../../utils/redact';
import { User } from '../user/user.model';
import { escapeRegex } from '../../utils/query';

const createAuditLog = async (payload: Partial<IAuditLog>) => {
  const result = await requestContext.asSystem(() => AuditLog.create(payload));
  return result;
};

type TRecordInput = {
  action: string;
  entity: string;
  entityId?: unknown;
  message: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
  meta?: Record<string, unknown>;
  locationId?: unknown;
  approvedBy?: unknown;
  actorId?: string;
};

const actorNames = new Map<string, string>();

// Written inside the caller's transaction, so the event exists only if the change does.
const record = async (input: TRecordInput) => {
  const ctx = requestContext.get();
  if (!ctx?.tenantId) return undefined;
  const actorId = input.actorId || ctx.userId;
  let actorName: string | undefined;
  if (actorId) {
    actorName = actorNames.get(actorId);
    if (!actorName) {
      const actor = await requestContext.asSystem(() => User.findById(actorId).select('name').lean());
      actorName = actor?.name;
      if (actorName) actorNames.set(actorId, actorName);
    }
  }
  const [event] = await ActivityEvent.create([
    ({
      tenantId: ctx.tenantId,
      locationId: input.locationId || ctx.locationId,
      actorId,
      actorName,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      message: input.message,
      changes: input.before || input.after ? diff(input.before, input.after) : undefined,
      meta: input.meta ? (redact(input.meta) as Record<string, unknown>) : undefined,
      approvedBy: input.approvedBy,
    }) as any,
  ]);
  return event;
};

const getAuditLogs = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};
  if (query.tenantId) filter.tenantId = query.tenantId;
  if (query.user) filter.user = query.user;
  if (query.entity && query.entity !== 'ALL') {
    filter.entity = { $regex: new RegExp(`^${escapeRegex(String(query.entity))}$`, 'i') };
  }
  if (query.action && query.action !== 'ALL') {
    filter.action = { $regex: new RegExp(`^${escapeRegex(String(query.action))}$`, 'i') };
  }
  if (query.search) {
    const term = escapeRegex(String(query.search));
    filter.$or = [
      { action: { $regex: term, $options: 'i' } },
      { entity: { $regex: term, $options: 'i' } },
      { ipAddress: { $regex: term, $options: 'i' } },
      { 'details.url': { $regex: term, $options: 'i' } },
    ];
  }

  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const [data, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('user', 'name email role')
      .populate('tenantId', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};

const getActivity = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};
  if (query.locationId) filter.locationId = new Types.ObjectId(String(query.locationId));
  if (query.entity) filter.entity = query.entity;
  if (query.entityId) filter.entityId = new Types.ObjectId(String(query.entityId));
  if (query.action) filter.action = query.action;
  if (query.actorId) filter.actorId = new Types.ObjectId(String(query.actorId));
  if (query.searchTerm) filter.message = { $regex: escapeRegex(String(query.searchTerm)), $options: 'i' };
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: new Date(String(query.from)) } : {}),
      ...(query.to ? { $lte: new Date(String(query.to)) } : {}),
    };
  }
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const [data, total] = await Promise.all([
    ActivityEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ActivityEvent.countDocuments(filter),
  ]);
  return { data, meta: { page, limit, total, totalPage: Math.ceil(total / limit) } };
};

export const AuditLogService = {
  createAuditLog,
  getAuditLogs,
  getActivity,
  record,
};

export const activity = { record };
