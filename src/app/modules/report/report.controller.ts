import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { ReportService } from './report.service';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';

const getHospitalityStats = catchAsync(async (req: Request, res: Response) => {
  // @ts-ignore
  const tenantId = req.user?.tenant;
  if (!tenantId) throw new AppError(httpStatus.BAD_REQUEST, 'Tenant ID is required for reporting');

  const result = await ReportService.getHospitalityStats(tenantId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hospitality stats retrieved successfully',
    data: result,
  });
});

const getRestaurantStats = catchAsync(async (req: Request, res: Response) => {
  // @ts-ignore
  const tenantId = req.user?.tenant;
  if (!tenantId) throw new AppError(httpStatus.BAD_REQUEST, 'Tenant ID is required for reporting');

  const result = await ReportService.getRestaurantStats(tenantId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Restaurant stats retrieved successfully',
    data: result,
  });
});

export const ReportController = {
  getHospitalityStats,
  getRestaurantStats,
};
