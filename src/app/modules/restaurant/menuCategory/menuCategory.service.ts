import { IMenuCategory } from './menuCategory.interface';
import { MenuCategory } from './menuCategory.model';

const createMenuCategory = async (payload: IMenuCategory) => {
  const result = await MenuCategory.create(payload);
  return result;
};

const getAllMenuCategories = async (tenantId: string) => {
  const result = await MenuCategory.find({ tenantId }).populate('locationId');
  return result;
};

const getMenuCategoryById = async (id: string, tenantId: string) => {
  const result = await MenuCategory.findOne({ _id: id, tenantId }).populate('locationId');
  return result;
};

const updateMenuCategory = async (id: string, tenantId: string, payload: Partial<IMenuCategory>) => {
  const result = await MenuCategory.findOneAndUpdate({ _id: id, tenantId }, payload, {
    new: true,
  });
  return result;
};

const deleteMenuCategory = async (id: string, tenantId: string) => {
  const result = await MenuCategory.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true },
  );
  return result;
};

export const MenuCategoryServices = {
  createMenuCategory,
  getAllMenuCategories,
  getMenuCategoryById,
  updateMenuCategory,
  deleteMenuCategory,
};
