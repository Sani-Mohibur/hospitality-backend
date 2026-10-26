import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { requireLocationId } from '../../../middlewares/locationScope';
import { RetailStocktakeService } from './retailStocktake.service';

const startStocktake = catchAsync(async (req, res) => {
  const locationId = req.body.locationId || requireLocationId(req);
  const result = await RetailStocktakeService.startStocktake(req, locationId, req.body);
  ok(res, 'Stocktake started successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const recordCounts = catchAsync(async (req, res) => {
  const result = await RetailStocktakeService.recordCounts(
    req,
    req.params.id as string,
    req.body,
  );
  ok(res, 'Physical counts recorded successfully', result);
});

const reconcileAndPost = catchAsync(async (req, res) => {
  const result = await RetailStocktakeService.reconcileAndPost(
    req,
    req.params.id as string,
    req.body?.notes,
  );
  ok(res, 'Stocktake reconciled and posted successfully', result);
});

const cancelStocktake = catchAsync(async (req, res) => {
  const result = await RetailStocktakeService.cancelStocktake(req, req.params.id as string);
  ok(res, 'Stocktake cancelled successfully', result);
});

const getAllStocktakes = catchAsync(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.locationId) {
    filter.locationId = req.locationId;
  } else if (req.scopedLocationIds) {
    filter.locationId = { $in: req.scopedLocationIds };
  }

  const result = await RetailStocktakeService.getAllStocktakes(filter, req.query);
  ok(res, 'Stocktakes retrieved successfully', result.data, {
    meta: result.meta,
  });
});

const getStocktakeById = catchAsync(async (req, res) => {
  const result = await RetailStocktakeService.getStocktakeById(req, req.params.id as string);
  ok(res, 'Stocktake retrieved successfully', result);
});

export const RetailStocktakeController = {
  startStocktake,
  recordCounts,
  reconcileAndPost,
  cancelStocktake,
  getAllStocktakes,
  getStocktakeById,
};
