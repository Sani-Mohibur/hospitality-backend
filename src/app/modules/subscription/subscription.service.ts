import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { Subscription } from './subscription.model';
import { ISubscription } from './subscription.interface';

const getAllSubscriptionsFromDB = async () => {
  const result = await Subscription.find().populate('tenantId');
  return result;
};

const getSubscriptionByTenantId = async (tenantId: string) => {
  const result = await Subscription.findOne({ tenantId });
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Subscription not found for this tenant');
  }
  return result;
};

const updateSubscriptionStatusInDB = async (
  id: string,
  payload: { status: ISubscription['status'] }
) => {
  const result = await Subscription.findByIdAndUpdate(
    id,
    { status: payload.status },
    { new: true, runValidators: true }
  );
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Subscription not found');
  }
  return result;
};

const applyCreditDiscountInDB = async (
  id: string,
  payload: { appliedCredits?: number; appliedDiscounts?: number }
) => {
  const result = await Subscription.findByIdAndUpdate(
    id,
    {
      $inc: {
        appliedCredits: payload.appliedCredits || 0,
        appliedDiscounts: payload.appliedDiscounts || 0,
      },
    },
    { new: true, runValidators: true }
  );
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Subscription not found');
  }
  return result;
};

export const SubscriptionServices = {
  getAllSubscriptionsFromDB,
  getSubscriptionByTenantId,
  updateSubscriptionStatusInDB,
  applyCreditDiscountInDB,
};
