import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { RetailSupplierService } from './retailSupplier.service';

const createSupplier = catchAsync(async (req, res) => {
  const result = await RetailSupplierService.createSupplier(req.body);
  ok(res, 'Supplier created successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const getAllSuppliers = catchAsync(async (req, res) => {
  const result = await RetailSupplierService.getAllSuppliers(req.query);
  ok(res, 'Suppliers retrieved successfully', result.data, {
    meta: result.meta,
  });
});

const getSupplierById = catchAsync(async (req, res) => {
  const result = await RetailSupplierService.getSupplierById(req.params.id as string);
  ok(res, 'Supplier retrieved successfully', result);
});

const updateSupplier = catchAsync(async (req, res) => {
  const result = await RetailSupplierService.updateSupplier(req.params.id as string, req.body);
  ok(res, 'Supplier updated successfully', result);
});

const deleteSupplier = catchAsync(async (req, res) => {
  const result = await RetailSupplierService.deleteSupplier(req.params.id as string);
  ok(res, 'Supplier deleted successfully', result);
});

export const RetailSupplierController = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
};
