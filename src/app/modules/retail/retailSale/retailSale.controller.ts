import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../../utils/catchAsync';
import sendResponse from '../../../utils/sendResponse';
import { RetailSaleService } from './retailSale.service';

const posProductSearch = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.posProductSearch(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Products retrieved successfully for POS',
    meta: result.meta,
    data: result.data,
  });
});

const posPriceCheck = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.posPriceCheck(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Price check completed successfully',
    data: result,
  });
});

const searchCustomers = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.searchCustomers(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Customers retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const getCustomerLoyalty = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.getCustomerLoyalty(String(req.params.guestId));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Customer loyalty information retrieved',
    data: result,
  });
});

const calculateCart = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.calculateCart(req, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Cart calculated successfully',
    data: result,
  });
});

const checkout = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.checkout(req, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Sale checkout completed successfully',
    data: result,
  });
});

const getSaleReceipt = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.formatReceipt(String(req.params.id));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Sale receipt generated successfully',
    data: result,
  });
});

const getAllSales = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.getAllSales(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Sales retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const getSaleById = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.getSaleById(req, String(req.params.id));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Sale retrieved successfully',
    data: result,
  });
});

const processReturn = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.processReturn(req, String(req.params.id), req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Return processed successfully',
    data: result,
  });
});

const getAllReturns = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.getAllReturns(req, req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Returns retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const getReturnById = catchAsync(async (req: Request, res: Response) => {
  const result = await RetailSaleService.getReturnById(req, String(req.params.id));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Return retrieved successfully',
    data: result,
  });
});

export const RetailSaleController = {
  posProductSearch,
  posPriceCheck,
  searchCustomers,
  getCustomerLoyalty,
  calculateCart,
  checkout,
  getSaleReceipt,
  getAllSales,
  getSaleById,
  processReturn,
  getAllReturns,
  getReturnById,
};
