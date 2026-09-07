import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { PlatformModuleServices } from './platformModule.service';

const createPlatformModule = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformModuleServices.createPlatformModuleIntoDB(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Platform module created successfully',
    data: result,
  });
});

const getAllPlatformModules = catchAsync(async (req: Request, res: Response) => {
  const result = await PlatformModuleServices.getAllPlatformModulesFromDB();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Platform modules retrieved successfully',
    data: result,
  });
});

const updatePlatformModule = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await PlatformModuleServices.updatePlatformModuleIntoDB(id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Platform module updated successfully',
    data: result,
  });
});

export const PlatformModuleControllers = {
  createPlatformModule,
  getAllPlatformModules,
  updatePlatformModule,
};
