import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { requireLocationId } from '../../../middlewares/locationScope';
import { RetailTransferService } from './retailTransfer.service';

const createTransfer = catchAsync(async (req, res) => {
  const fromLocationId = req.body.fromLocationId || requireLocationId(req);
  const result = await RetailTransferService.createTransfer(req, fromLocationId, req.body);
  ok(res, 'Stock transfer created successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const dispatchTransfer = catchAsync(async (req, res) => {
  const result = await RetailTransferService.dispatchTransfer(req, req.params.id as string);
  ok(res, 'Stock transfer dispatched successfully', result);
});

const receiveTransfer = catchAsync(async (req, res) => {
  const result = await RetailTransferService.receiveTransfer(req, req.params.id as string);
  ok(res, 'Stock transfer received successfully', result);
});

const cancelTransfer = catchAsync(async (req, res) => {
  const result = await RetailTransferService.cancelTransfer(
    req,
    req.params.id as string,
    req.body.reason,
  );
  ok(res, 'Stock transfer cancelled successfully', result);
});

const directTransfer = catchAsync(async (req, res) => {
  const fromLocationId = req.body.fromLocationId || requireLocationId(req);
  const result = await RetailTransferService.directTransfer(req, fromLocationId, req.body);
  ok(res, 'Direct transfer completed successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const getAllTransfers = catchAsync(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.locationId) {
    filter.locationId = req.locationId;
  } else if (req.scopedLocationIds) {
    filter.locationId = { $in: req.scopedLocationIds };
  }

  const result = await RetailTransferService.getAllTransfers(filter, req.query);
  ok(res, 'Stock transfers retrieved successfully', result.data, {
    meta: result.meta,
  });
});

const getTransferById = catchAsync(async (req, res) => {
  const result = await RetailTransferService.getTransferById(req, req.params.id as string);
  ok(res, 'Stock transfer retrieved successfully', result);
});

export const RetailTransferController = {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  cancelTransfer,
  directTransfer,
  getAllTransfers,
  getTransferById,
};
