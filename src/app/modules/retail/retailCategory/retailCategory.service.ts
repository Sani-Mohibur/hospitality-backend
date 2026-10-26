import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { found } from '../../../utils/query';
import { IRetailCategory } from './retailCategory.interface';
import { RetailCategory } from './retailCategory.model';
import { RetailProduct } from '../retailProduct/retailProduct.model';

const createCategory = async (payload: Partial<IRetailCategory>) => {
  if (payload.code) {
    const codeUpper = payload.code.trim().toUpperCase();
    const exists = await RetailCategory.exists({
      code: codeUpper,
      isDeleted: { $ne: true },
    });
    if (exists) {
      throw new AppError(httpStatus.CONFLICT, `Category code '${codeUpper}' is already in use`);
    }
    payload.code = codeUpper;
  }

  const category = await RetailCategory.create(payload);
  return category;
};

const getAllCategories = async (
  locationFilterObj: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const filter: Record<string, unknown> = { ...locationFilterObj };

  if (query.searchTerm && typeof query.searchTerm === 'string') {
    const term = query.searchTerm.trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { code: { $regex: term, $options: 'i' } },
      { description: { $regex: term, $options: 'i' } },
    ];
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true';
  }

  if (query.master === 'true') {
    filter.locationId = null;
  }

  const sortOrder = (query.sort as string) || 'sortOrder name';
  const categories = await RetailCategory.find(filter).sort(sortOrder).lean();
  return categories;
};

const getCategoryById = async (id: string) => {
  return found(await RetailCategory.findById(id).lean(), 'Retail category');
};

const updateCategory = async (id: string, payload: Partial<IRetailCategory>) => {
  const category = found(await RetailCategory.findById(id), 'Retail category');

  if (payload.code) {
    const codeUpper = payload.code.trim().toUpperCase();
    const exists = await RetailCategory.exists({
      _id: { $ne: id },
      code: codeUpper,
      isDeleted: { $ne: true },
    });
    if (exists) {
      throw new AppError(httpStatus.CONFLICT, `Category code '${codeUpper}' is already in use`);
    }
    payload.code = codeUpper;
  }

  Object.assign(category, payload);
  await category.save();
  return category;
};

const deleteCategory = async (id: string) => {
  const category = found(await RetailCategory.findById(id), 'Retail category');

  // Prevent deletion if products exist in this category
  const productCount = await RetailProduct.countDocuments({
    categoryId: new Types.ObjectId(id),
    isDeleted: { $ne: true },
  });

  if (productCount > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot delete category with ${productCount} active product(s). Please reassign or delete them first.`,
    );
  }

  category.isDeleted = true;
  category.isActive = false;
  await category.save();
  return category;
};

export const RetailCategoryService = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
