import Stripe from 'stripe';
import config from '../../config';
import { IPayment } from './payment.interface';
import { Payment } from './payment.model';
import AppError from '../../errors/AppError';
import httpStatus from 'http-status';

const stripe = new Stripe(config.stripe.secret_key as string || 'sk_test_mock', {
  apiVersion: '2024-06-20' as any,
});

const createPaymentIntent = async (payload: Partial<IPayment>) => {
  const payment = await Payment.create(payload);

  if (config.stripe.secret_key) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(payment.amount * 100),
        currency: payment.currency || 'usd',
        metadata: {
          paymentId: payment._id.toString(),
          referenceId: payment.referenceId.toString(),
          tenantId: payment.tenant.toString(),
          module: payment.module,
        },
      });

      payment.transactionId = paymentIntent.id;
      await payment.save();

      return {
        clientSecret: paymentIntent.client_secret,
        payment,
      };
    } catch (error: any) {
      throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, `Stripe Error: ${error.message}`);
    }
  } else {
    // Mock
    payment.transactionId = `mock_tx_${Date.now()}`;
    await payment.save();
    return {
      clientSecret: 'mock_client_secret',
      payment,
    };
  }
};

const completePayment = async (paymentId: string, transactionId: string) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, 'Payment not found');

  payment.status = 'COMPLETED';
  if (transactionId) payment.transactionId = transactionId;
  
  await payment.save();
  return payment;
};

export const PaymentService = {
  createPaymentIntent,
  completePayment,
};
