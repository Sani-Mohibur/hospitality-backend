import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { NotificationService } from './notification.service';
import httpStatus from 'http-status';

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
  // @ts-ignore
  const userId = req.user?._id || req.user?.id;
  // @ts-ignore
  const tenantId = req.user?.tenant;

  const result = await NotificationService.getMyNotifications(userId, tenantId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Notifications retrieved successfully',
    data: result,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  // @ts-ignore
  const userId = req.user?._id || req.user?.id;

  const result = await NotificationService.markAsRead(id as string, userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Notification marked as read successfully',
    data: result,
  });
});

export const NotificationController = {
  getMyNotifications,
  markAsRead,
};
