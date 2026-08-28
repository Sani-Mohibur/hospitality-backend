import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { TableServices } from './table.service';

const createTable = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await TableServices.createTable(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Table created successfully',
    data: result,
  });
});

const getAllTables = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await TableServices.getAllTables(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Tables retrieved successfully',
    data: result,
  });
});

const getTableById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await TableServices.getTableById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Table retrieved successfully',
    data: result,
  });
});

const updateTable = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await TableServices.updateTable(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Table updated successfully',
    data: result,
  });
});

const deleteTable = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await TableServices.deleteTable(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Table deleted successfully',
    data: result,
  });
});

export const TableControllers = {
  createTable,
  getAllTables,
  getTableById,
  updateTable,
  deleteTable,
};
