import { IOrder } from './order.interface';
import { Order } from './order.model';

const createOrder = async (payload: IOrder) => {
  const result = await Order.create(payload);
  return result;
};

const getAllOrders = async (tenantId: string) => {
  const result = await Order.find({ tenantId })
    .populate('tableId')
    .populate('items.menuItemId')
    .populate('locationId');
  return result;
};

const getOrderById = async (id: string, tenantId: string) => {
  const result = await Order.findOne({ _id: id, tenantId })
    .populate('tableId')
    .populate('items.menuItemId')
    .populate('locationId');
  return result;
};

const updateOrder = async (id: string, tenantId: string, payload: Partial<IOrder>) => {
  const result = await Order.findOneAndUpdate({ _id: id, tenantId }, payload, {
    new: true,
  });
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
  getOrderById,
  updateOrder,
  deleteOrder,
};
