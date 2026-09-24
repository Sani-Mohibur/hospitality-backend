import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { AuditLogService } from './auditLog.service';
import httpStatus from 'http-status';

// Raw request log: super admin sees everything, tenant admins see their tenant only.
const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const query: Record<string, unknown> = { ...req.query };
  if (req.user.role !== 'SUPER_ADMIN') {
    query.tenantId = req.user.tenantId;
  }

  const result = await AuditLogService.getAuditLogs(query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Audit logs retrieved successfully',
    data: result,
  });
});

// Human-readable activity feed for managers.
const getActivity = catchAsync(async (req: Request, res: Response) => {
  const result = await AuditLogService.getActivity({ ...req.query, locationId: req.locationId });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Activity retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

export const AuditLogController = {
  getAuditLogs,
  getActivity,
};
