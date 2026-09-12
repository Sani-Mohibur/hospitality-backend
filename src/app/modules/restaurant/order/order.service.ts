import { IOrder, ORDER_STATUS } from './order.interface';
import { Order } from './order.model';
import AppError from '../../../errors/AppError';
import httpStatus from 'http-status';
import { socketManager } from '../../../utils/socket';

const createOrder = async (payload: IOrder, userId: string) => {
  payload.statusHistory = [
    {
      status: payload.status || ORDER_STATUS.PENDING,
      changedAt: new Date(),
      changedBy: userId as any,
    },
  ];
  const result = await Order.create(payload);

  // Emit event to the tenant's room
  socketManager.emitToRoom(payload.tenantId.toString(), 'new_order', result);

  return result;
};

const getAllOrders = async (tenantId: string) => {
  const result = await Order.find({ tenantId })
    .populate('tableId')
    .populate('items.menuItemId')
    .populate('locationId');
  return result;
};

const getKitchenQueue = async (tenantId: string) => {
  const result = await Order.find({
    tenantId,
    status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.IN_PROGRESS] },
  })
    .populate('tableId')
    .populate('items.menuItemId')
    .populate('locationId')
    .sort({ createdAt: 1 }); // Oldest first
  return result;
};

const getOrderById = async (id: string, tenantId: string) => {
  const result = await Order.findOne({ _id: id, tenantId })
    .populate('tableId')
    .populate('items.menuItemId')
    .populate('locationId');
  return result;
};

const updateOrder = async (id: string, tenantId: string, payload: Partial<IOrder>, userId: string) => {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, 'Order not found');
  }

  if (payload.status && payload.status !== order.status) {
    if (!order.statusHistory) {
      order.statusHistory = [];
    }
    order.statusHistory.push({
      status: payload.status,
      changedAt: new Date(),
      changedBy: userId as any,
    });
  }

  Object.assign(order, payload);
  const result = await order.save();

  // Emit event if status was updated (or generally when order is updated)
  socketManager.emitToRoom(tenantId, 'order_updated', result);

  return result;
};

const deleteOrder = async (id: string, tenantId: string) => {
  const result = await Order.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true },
  );
  return result;
};

export const OrderServices = {
  createOrder,
  getAllOrders,
  getKitchenQueue,
  getOrderById,
  updateOrder,
  deleteOrder,
};
