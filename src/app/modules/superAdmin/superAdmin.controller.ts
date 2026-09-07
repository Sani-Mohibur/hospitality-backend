import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { SuperAdminServices } from './superAdmin.service';

const getPlatformStats = catchAsync(async (req: Request, res: Response) => {
  const result = await SuperAdminServices.getPlatformStats();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Platform stats retrieved successfully',
    data: result,
  });
});

export const SuperAdminControllers = {
  getPlatformStats,
};
