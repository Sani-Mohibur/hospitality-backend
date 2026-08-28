import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { OrderServices } from './order.service';

const createOrder = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await OrderServices.createOrder(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Order created successfully',
    data: result,
  });
});

const getAllOrders = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await OrderServices.getAllOrders(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Orders retrieved successfully',
    data: result,
  });
});

const getOrderById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await OrderServices.getOrderById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Order retrieved successfully',
    data: result,
  });
});

const updateOrder = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await OrderServices.updateOrder(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Order updated successfully',
    data: result,
  });
});

const deleteOrder = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await OrderServices.deleteOrder(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Order deleted successfully',
    data: result,
  });
});

export const OrderControllers = {
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
};
