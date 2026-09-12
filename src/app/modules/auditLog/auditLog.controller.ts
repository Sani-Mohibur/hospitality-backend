import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { AuditLogService } from './auditLog.service';
import httpStatus from 'http-status';

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const query = { ...req.query };
  // @ts-ignore
  if (req.user?.role !== 'super_admin' && req.user?.tenant) {
    // @ts-ignore
    query.tenant = req.user.tenant;
  }

  const result = await AuditLogService.getAuditLogs(query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Audit logs retrieved successfully',
    data: result,
  });
});

export const AuditLogController = {
  getAuditLogs,
};
