import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { requireLocationId } from '../../../middlewares/locationScope';
import { RetailInventoryService } from './retailInventory.service';

const initializeStock = catchAsync(async (req, res) => {
  const locationId = req.body.locationId || req.locationId;
  const result = await RetailInventoryService.initializeStock({
    ...req.body,
    locationId,
  });
  ok(res, 'Stock initialized successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const getAllStockItems = catchAsync(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.locationId) {
    filter.locationId = req.locationId;
  } else if (req.scopedLocationIds) {
    filter.locationId = { $in: req.scopedLocationIds };
  }

  const result = await RetailInventoryService.getAllStockItems(filter, req.query);
  ok(res, 'Retail stock items retrieved successfully', result.data, {
    meta: result.meta,
  });
});

const getStockItemById = catchAsync(async (req, res) => {
  const result = await RetailInventoryService.getStockItemById(req, req.params.id as string);
  ok(res, 'Retail stock item retrieved successfully', result);
});

const updateStockLevels = catchAsync(async (req, res) => {
  const result = await RetailInventoryService.updateStockLevels(
    req,
    req.params.id as string,
    req.body,
  );
  ok(res, 'Stock levels updated successfully', result);
});

const adjustStock = catchAsync(async (req, res) => {
  const result = await RetailInventoryService.adjustStock(req, req.body);
  ok(res, 'Stock adjusted successfully', result);
});

const logWaste = catchAsync(async (req, res) => {
  const result = await RetailInventoryService.logWaste(req, req.body);
  ok(res, 'Stock waste logged successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const getLowStockItems = catchAsync(async (req, res) => {
  const locationId = requireLocationId(req);
  const result = await RetailInventoryService.getLowStockItems(locationId);
  ok(res, 'Low stock items retrieved successfully', result);
});

const getStockMovements = catchAsync(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.locationId) {
    filter.locationId = req.locationId;
  } else if (req.scopedLocationIds) {
    filter.locationId = { $in: req.scopedLocationIds };
  }

  const result = await RetailInventoryService.getStockMovements(filter, req.query);
  ok(res, 'Stock movements retrieved successfully', result.data, {
    meta: result.meta,
  });
});

export const RetailInventoryController = {
  initializeStock,
  getAllStockItems,
  getStockItemById,
  updateStockLevels,
  adjustStock,
  logWaste,
  getLowStockItems,
  getStockMovements,
};
