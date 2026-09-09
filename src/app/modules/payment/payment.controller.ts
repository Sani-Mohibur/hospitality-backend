import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { PaymentService } from './payment.service';
import httpStatus from 'http-status';

const createPaymentIntent = catchAsync(async (req: Request, res: Response) => {
  // @ts-ignore
  const tenant = req.user?.tenant;
  const payload = { ...req.body, tenant };

  const result = await PaymentService.createPaymentIntent(payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Payment intent created successfully',
    data: result,
  });
});

const completePayment = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { transactionId } = req.body;

  const result = await PaymentService.completePayment(id as string, transactionId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Payment completed successfully',
    data: result,
  });
});

export const PaymentController = {
  createPaymentIntent,
  completePayment,
};
