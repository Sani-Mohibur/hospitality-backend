import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { RetailCategoryService } from './retailCategory.service';

const createCategory = catchAsync(async (req, res) => {
  const result = await RetailCategoryService.createCategory(req.body);
  ok(res, 'Retail category created successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const getAllCategories = catchAsync(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.locationId) {
    filter.$or = [{ locationId: req.locationId }, { locationId: null }];
  } else if (req.scopedLocationIds) {
    filter.$or = [{ locationId: { $in: req.scopedLocationIds } }, { locationId: null }];
  }
  if (req.query.locationId) {
    filter.locationId = req.query.locationId;
  }
  const result = await RetailCategoryService.getAllCategories(filter, req.query);
  ok(res, 'Retail categories retrieved successfully', result);
});

const getCategoryById = catchAsync(async (req, res) => {
  const result = await RetailCategoryService.getCategoryById(req.params.id as string);
  ok(res, 'Retail category retrieved successfully', result);
});

const updateCategory = catchAsync(async (req, res) => {
  const result = await RetailCategoryService.updateCategory(req.params.id as string, req.body);
  ok(res, 'Retail category updated successfully', result);
});

const deleteCategory = catchAsync(async (req, res) => {
  const result = await RetailCategoryService.deleteCategory(req.params.id as string);
  ok(res, 'Retail category deleted successfully', result);
});

export const RetailCategoryController = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
