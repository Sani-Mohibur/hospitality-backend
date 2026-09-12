import httpStatus from 'http-status';
import { IInventoryItem } from './inventory.interface';
import { InventoryItem } from './inventory.model';
import AppError from '../../errors/AppError';

const createItem = async (payload: IInventoryItem) => {
  const result = await InventoryItem.create(payload);
  return result;
};

const getAllItems = async (tenantId: string, query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = { tenantId };
  if (query.locationId) filter.locationId = query.locationId;
  if (query.category) filter.category = query.category;

  const result = await InventoryItem.find(filter).populate('locationId');
  return result;
};

const getItemById = async (id: string, tenantId: string) => {
  const result = await InventoryItem.findOne({ _id: id, tenantId }).populate('locationId');
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Inventory item not found');
  }
  return result;
};

const updateItem = async (id: string, tenantId: string, payload: Partial<IInventoryItem>) => {
  const result = await InventoryItem.findOneAndUpdate(
    { _id: id, tenantId },
    payload,
    { new: true, runValidators: true },
  );
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Inventory item not found');
  }
  return result;
};

const adjustStock = async (id: string, tenantId: string, quantityChange: number, type: 'ADD' | 'SUBTRACT') => {
  const item = await InventoryItem.findOne({ _id: id, tenantId });
  if (!item) {
    throw new AppError(httpStatus.NOT_FOUND, 'Inventory item not found');
  }

  const change = type === 'ADD' ? quantityChange : -quantityChange;
  const newQuantity = item.quantity + change;

  if (newQuantity < 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Insufficient stock');
  }

  item.quantity = newQuantity;
  const result = await item.save();
  return result;
};

const deleteItem = async (id: string, tenantId: string) => {
  const result = await InventoryItem.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true },
  );
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Inventory item not found');
  }
  return result;
};

export const InventoryServices = {
  createItem,
  getAllItems,
  getItemById,
  updateItem,
  adjustStock,
  deleteItem,
};
