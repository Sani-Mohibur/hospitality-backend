import { IMenuItem } from './menuItem.interface';
import { MenuItem } from './menuItem.model';

const createMenuItem = async (payload: IMenuItem) => {
  const result = await MenuItem.create(payload);
  return result;
};

const getAllMenuItems = async (tenantId: string) => {
  const result = await MenuItem.find({ tenantId }).populate('categoryId').populate('locationId');
  return result;
};

const getMenuItemById = async (id: string, tenantId: string) => {
  const result = await MenuItem.findOne({ _id: id, tenantId }).populate('categoryId').populate('locationId');
  return result;
};

const updateMenuItem = async (id: string, tenantId: string, payload: Partial<IMenuItem>) => {
  const result = await MenuItem.findOneAndUpdate({ _id: id, tenantId }, payload, {
    new: true,
  });
  return result;
};

const deleteMenuItem = async (id: string, tenantId: string) => {
  const result = await MenuItem.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true },
  );
  return result;
};

export const MenuItemServices = {
  createMenuItem,
  getAllMenuItems,
  getMenuItemById,
  updateMenuItem,
  deleteMenuItem,
};
