import httpStatus from 'http-status';
import { InventoryServices } from './inventory.service';
import catchAsync from '../../utils/catchAsync';

const createItem = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await InventoryServices.createItem(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Inventory item created successfully',
    data: result,
  });
});

const getAllItems = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await InventoryServices.getAllItems(tenantId, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Inventory items retrieved successfully',
    data: result,
  });
});

const getItemById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await InventoryServices.getItemById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Inventory item retrieved successfully',
    data: result,
  });
});

const updateItem = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await InventoryServices.updateItem(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Inventory item updated successfully',
    data: result,
  });
});

const adjustStock = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;
  const { quantityChange, type } = req.body;

  const result = await InventoryServices.adjustStock(id as string, tenantId, quantityChange, type);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Stock adjusted successfully',
    data: result,
  });
});

const deleteItem = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await InventoryServices.deleteItem(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Inventory item deleted successfully',
    data: result,
  });
});

export const InventoryControllers = {
  createItem,
  getAllItems,
  getItemById,
  updateItem,
  adjustStock,
  deleteItem,
};
