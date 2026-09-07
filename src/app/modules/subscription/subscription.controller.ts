import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { SubscriptionServices } from './subscription.service';

const getAllSubscriptions = catchAsync(async (req: Request, res: Response) => {
  const result = await SubscriptionServices.getAllSubscriptionsFromDB();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscriptions retrieved successfully',
    data: result,
  });
});

const getMySubscription = catchAsync(async (req: Request, res: Response) => {
  // Extract tenantId from req.user (assuming the user is tied to a tenant)
  const { tenantId } = req.user;
  const result = await SubscriptionServices.getSubscriptionByTenantId(tenantId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription retrieved successfully',
    data: result,
  });
});

const updateSubscriptionStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SubscriptionServices.updateSubscriptionStatusInDB(id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Subscription status updated successfully',
    data: result,
  });
});

const applyCreditDiscount = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SubscriptionServices.applyCreditDiscountInDB(id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Credits/Discounts applied successfully',
    data: result,
  });
});

export const SubscriptionControllers = {
  getAllSubscriptions,
  getMySubscription,
  updateSubscriptionStatus,
  applyCreditDiscount,
};
