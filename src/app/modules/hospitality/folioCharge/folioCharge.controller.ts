import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import { FolioChargeServices } from './folioCharge.service';

const createFolioCharge = catchAsync(async (req, res) => {
  const tenantId = req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.user.tenantId;
  const payload = { ...req.body, tenantId };

  const result = await FolioChargeServices.createFolioCharge(payload);
  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Folio charge created successfully',
    data: result,
  });
});

const getChargesByFolio = catchAsync(async (req, res) => {
  const { folioId } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioChargeServices.getChargesByFolio(folioId as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folio charges retrieved successfully',
    data: result,
  });
});

const getFolioChargeById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioChargeServices.getFolioChargeById(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folio charge retrieved successfully',
    data: result,
  });
});

const updateFolioCharge = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioChargeServices.updateFolioCharge(id as string, tenantId, req.body);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folio charge updated successfully',
    data: result,
  });
});

const deleteFolioCharge = catchAsync(async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.role === 'SUPER_ADMIN' && req.query.tenantId ? req.query.tenantId as string : req.user.tenantId;

  const result = await FolioChargeServices.deleteFolioCharge(id as string, tenantId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Folio charge deleted successfully',
    data: result,
  });
});

export const FolioChargeControllers = {
  createFolioCharge,
  getChargesByFolio,
  getFolioChargeById,
  updateFolioCharge,
  deleteFolioCharge,
};
