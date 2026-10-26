import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { RetailProductService } from './retailProduct.service';

const createProduct = catchAsync(async (req, res) => {
  const result = await RetailProductService.createProduct(req.body);
  ok(res, 'Retail product created successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const getAllProducts = catchAsync(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.locationId) {
    filter.$or = [{ locationId: req.locationId }, { locationId: null }];
  } else if (req.scopedLocationIds) {
    filter.$or = [{ locationId: { $in: req.scopedLocationIds } }, { locationId: null }];
  }
  if (req.query.locationId) {
    filter.locationId = req.query.locationId === 'null' ? null : req.query.locationId;
  }

  const result = await RetailProductService.getAllProducts(filter, req.query);
  ok(res, 'Retail products retrieved successfully', result.data, {
    meta: result.meta,
  });
});

const getProductById = catchAsync(async (req, res) => {
  const result = await RetailProductService.getProductById(req.params.id as string);
  ok(res, 'Retail product retrieved successfully', result);
});

const getProductByBarcode = catchAsync(async (req, res) => {
  const result = await RetailProductService.getProductByBarcode(req.params.barcode as string);
  ok(res, 'Retail product retrieved successfully', result);
});

const getProductBySku = catchAsync(async (req, res) => {
  const result = await RetailProductService.getProductBySku(req.params.sku as string);
  ok(res, 'Retail product retrieved successfully', result);
});

const updateProduct = catchAsync(async (req, res) => {
  const result = await RetailProductService.updateProduct(req.params.id as string, req.body);
  ok(res, 'Retail product updated successfully', result);
});

const deleteProduct = catchAsync(async (req, res) => {
  const result = await RetailProductService.deleteProduct(req.params.id as string);
  ok(res, 'Retail product deleted successfully', result);
});

const getProductInventoryStatus = catchAsync(async (req, res) => {
  const locationId = (req.query.locationId as string) || req.locationId;
  const result = await RetailProductService.getProductInventoryStatus(
    req.params.id as string,
    locationId,
  );
  ok(res, 'Product inventory status retrieved successfully', result);
});

export const RetailProductController = {
  createProduct,
  getAllProducts,
  getProductById,
  getProductByBarcode,
  getProductBySku,
  updateProduct,
  deleteProduct,
  getProductInventoryStatus,
};
