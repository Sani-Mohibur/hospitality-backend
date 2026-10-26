import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import { requireLocationId } from '../../../middlewares/locationScope';
import { RetailPurchaseOrderService } from './retailPurchaseOrder.service';

const createPurchaseOrder = catchAsync(async (req, res) => {
  const locationId = req.body.locationId || requireLocationId(req);
  const result = await RetailPurchaseOrderService.createPurchaseOrder(req, locationId, req.body);
  ok(res, 'Purchase order created successfully', result, {
    statusCode: httpStatus.CREATED,
  });
});

const getAllPurchaseOrders = catchAsync(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.locationId) {
    filter.locationId = req.locationId;
  } else if (req.scopedLocationIds) {
    filter.locationId = { $in: req.scopedLocationIds };
  }

  const result = await RetailPurchaseOrderService.getAllPurchaseOrders(filter, req.query);
  ok(res, 'Purchase orders retrieved successfully', result.data, {
    meta: result.meta,
  });
});

const getPurchaseOrderById = catchAsync(async (req, res) => {
  const result = await RetailPurchaseOrderService.getPurchaseOrderById(req, req.params.id as string);
  ok(res, 'Purchase order retrieved successfully', result);
});

const updatePurchaseOrder = catchAsync(async (req, res) => {
  const result = await RetailPurchaseOrderService.updatePurchaseOrder(
    req,
    req.params.id as string,
    req.body,
  );
  ok(res, 'Purchase order updated successfully', result);
});

const sendPurchaseOrder = catchAsync(async (req, res) => {
  const result = await RetailPurchaseOrderService.sendPurchaseOrder(req, req.params.id as string);
  ok(res, 'Purchase order sent successfully', result);
});

const receiveGoods = catchAsync(async (req, res) => {
  const result = await RetailPurchaseOrderService.receiveGoods(
    req,
    req.params.id as string,
    req.body,
  );
  ok(res, 'Goods received successfully', result);
});

const cancelPurchaseOrder = catchAsync(async (req, res) => {
  const result = await RetailPurchaseOrderService.cancelPurchaseOrder(
    req,
    req.params.id as string,
    req.body?.reason,
  );
  ok(res, 'Purchase order cancelled successfully', result);
});

export const RetailPurchaseOrderController = {
  createPurchaseOrder,
  getAllPurchaseOrders,
  getPurchaseOrderById,
  updatePurchaseOrder,
  sendPurchaseOrder,
  receiveGoods,
  cancelPurchaseOrder,
};
