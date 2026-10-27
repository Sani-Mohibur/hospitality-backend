import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import sendResponse from '../../../utils/sendResponse';
import { RetailReportService } from './retailReport.service';

const getZReport = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailReportService.getZReport(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Z-Report generated successfully',
    data: result,
  });
});

const getSalesSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailReportService.getSalesSummary(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Sales summary report retrieved successfully',
    data: result,
  });
});

const getTopProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailReportService.getTopProducts(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Top-selling products retrieved successfully',
    data: result,
  });
});

const getCategoryBreakdown = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailReportService.getCategoryBreakdown(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Category breakdown retrieved successfully',
    data: result,
  });
});

export const RetailReportController = {
  getZReport,
  getSalesSummary,
  getTopProducts,
  getCategoryBreakdown,
};
