import { Request } from 'express';
import httpStatus from 'http-status';
import bcrypt from 'bcryptjs';
import { Secret } from 'jsonwebtoken';
import { Types } from 'mongoose';
import config from '../../config';
import AppError from '../../errors/AppError';
import { jwtHelpers } from '../../helpers/jwtHelpers';
import { randomToken } from '../../utils/crypto';
import { publish, rooms } from '../../utils/realtime';
import { User } from '../user/user.model';
import { PERMISSION } from '../user/user.constant';
import { resolvePermissions } from '../../middlewares/auth';
import { ApprovalRequest, ApprovalUse, TApprovalAction } from './approval.model';
import { found } from '../../utils/query';

const TOKEN_TTL = '5m';

const issueToken = (tenantId: string, approverId: string, action: TApprovalAction, requesterId?: string) =>
  jwtHelpers.createToken(
    { typ: 'approval', tid: tenantId, mgr: approverId, act: action, req: requesterId, jti: randomToken(12) },
    config.jwt.access_secret as Secret,
    TOKEN_TTL,
  );

const assertApprover = async (tenantId: string, managerId: string, locationId?: string) => {
  const manager = await User.findOne({ _id: managerId, tenantId }).lean();
  if (!manager || !manager.isActive) throw new AppError(httpStatus.FORBIDDEN, 'Approver not found');
  const permissions = await resolvePermissions(manager);
  if (!permissions.includes(PERMISSION.APPROVALS_GRANT)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user cannot approve overrides');
  }
  if (locationId && !manager.allLocations && manager.role !== 'TENANT_OWNER') {
    if (!manager.locationIds.map(String).includes(locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'Approver has no access to this location');
    }
  }
  return manager;
};

// Manager enters their PIN on the same device.
const grantWithPin = async (
  req: Request,
  payload: { managerId: string; pin: string; action: TApprovalAction },
) => {
  const tenantId = req.user.tenantId!;
  await assertApprover(tenantId, payload.managerId, req.locationId);
  const withPin = await User.findById(payload.managerId).select('+pinHash').lean();
  if (!withPin?.pinHash || !(await bcrypt.compare(String(payload.pin), withPin.pinHash))) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid manager PIN');
  }
  return { approvalToken: issueToken(tenantId, payload.managerId, payload.action, req.user.id), expiresIn: TOKEN_TTL };
};

// Staff asks for approval; managers on shift get a push notification.
const requestRemote = async (
  req: Request,
  payload: { action: TApprovalAction; summary: string; context?: Record<string, unknown> },
) => {
  const request = await ApprovalRequest.create({
    locationId: req.locationId,
    requestedBy: req.user.id,
    action: payload.action,
    summary: payload.summary,
    context: payload.context,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  void publish({
    tenantId: req.user.tenantId,
    locationId: req.locationId,
    rooms: [rooms.managers(req.locationId)],
    event: 'approval_requested',
    data: { id: request._id, action: request.action, summary: request.summary, requestedBy: req.user.name },
  });
  return request;
};

const decide = async (req: Request, id: string, decision: 'APPROVED' | 'DENIED') => {
  const request = found(await ApprovalRequest.findById(id), 'Approval request');
  if (request.status !== 'PENDING') throw new AppError(httpStatus.CONFLICT, `Request is already ${request.status}`);
  if (request.expiresAt < new Date()) {
    request.status = 'EXPIRED';
    await request.save();
    throw new AppError(httpStatus.GONE, 'Approval request expired');
  }
  if (String(request.requestedBy) === req.user.id) {
    throw new AppError(httpStatus.FORBIDDEN, 'You cannot approve your own request');
  }
  await assertApprover(req.user.tenantId!, req.user.id, String(request.locationId));
  request.status = decision;
  request.decidedBy = new Types.ObjectId(req.user.id);
  request.decidedAt = new Date();
  await request.save();
  void publish({
    tenantId: req.user.tenantId,
    locationId: request.locationId,
    rooms: [rooms.user(request.requestedBy)],
    event: 'approval_decided',
    data: { id: request._id, status: request.status },
  });
  return request;
};

// The requester collects the token once a manager approved.
const collect = async (req: Request, id: string) => {
  const request = found(await ApprovalRequest.findById(id), 'Approval request');
  if (String(request.requestedBy) !== req.user.id) throw new AppError(httpStatus.FORBIDDEN, 'Not your request');
  if (request.status !== 'APPROVED') return { status: request.status };
  return {
    status: request.status,
    approvalToken: issueToken(req.user.tenantId!, String(request.decidedBy), request.action, req.user.id),
  };
};

const listPending = async (locationId?: string) =>
  ApprovalRequest.find({
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
    ...(locationId ? { locationId } : {}),
  })
    .populate('requestedBy', 'name')
    .sort({ createdAt: -1 })
    .lean();

// Called by services before a sensitive action. Returns the approver id, or the
// actor's own id when the actor may approve. Throws 403 with a clear code otherwise.
const requireApproval = async (req: Request, action: TApprovalAction, needed = true): Promise<string | undefined> => {
  if (!needed) return undefined;
  if (req.user.permissions.includes(PERMISSION.APPROVALS_GRANT)) return req.user.id;
  const token = req.headers['x-approval-token'];
  if (typeof token !== 'string') {
    throw new AppError(httpStatus.FORBIDDEN, `MANAGER_APPROVAL_REQUIRED:${action}`);
  }
  let decoded: any;
  try {
    decoded = jwtHelpers.verifyToken(token, config.jwt.access_secret as Secret);
  } catch {
    throw new AppError(httpStatus.FORBIDDEN, 'Approval token is invalid or expired');
  }
  if (decoded.typ !== 'approval' || decoded.tid !== req.user.tenantId || decoded.act !== action) {
    throw new AppError(httpStatus.FORBIDDEN, 'Approval token does not cover this action');
  }
  if (decoded.req && decoded.req !== req.user.id) {
    throw new AppError(httpStatus.FORBIDDEN, 'Approval token was issued to another user');
  }
  try {
    await ApprovalUse.create({ jti: decoded.jti });
  } catch {
    throw new AppError(httpStatus.FORBIDDEN, 'Approval token was already used');
  }
  return decoded.mgr as string;
};

export const ApprovalService = { grantWithPin, requestRemote, decide, collect, listPending, requireApproval };
