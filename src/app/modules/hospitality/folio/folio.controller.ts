import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { FolioServices } from './folio.service';

const createFolio = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await FolioServices.createFolio(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Folio created successfully',
    data: result,
  });
});

const getAllFolios = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioServices.getAllFolios(tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folios retrieved successfully',
    data: result,
  });
});

const getFolioById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioServices.getFolioById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folio retrieved successfully',
    data: result,
  });
});

const updateFolio = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioServices.updateFolio(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folio updated successfully',
    data: result,
  });
});

const deleteFolio = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioServices.deleteFolio(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folio deleted successfully',
    data: result,
  });
});

export const FolioControllers = {
  createFolio,
  getAllFolios,
  getFolioById,
  updateFolio,
  deleteFolio,
};
