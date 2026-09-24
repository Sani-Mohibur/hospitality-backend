import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { NotificationService } from './notification.service';
import httpStatus from 'http-status';

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.getMyNotifications(req.user.id, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Notifications retrieved successfully',
    data: result,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.markAsRead(req.params.id as string, req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Notification marked as read successfully',
    data: result,
  });
});

const markAllRead = catchAsync(async (req: Request, res: Response) => {
  await NotificationService.markAllRead(req.user.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'All notifications marked as read', data: null });
});

export const NotificationController = {
  getMyNotifications,
  markAsRead,
  markAllRead,
};
