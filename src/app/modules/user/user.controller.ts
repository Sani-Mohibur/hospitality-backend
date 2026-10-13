import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { UserServices } from './user.service';
import httpStatus from 'http-status';
import pick from '../../utils/pick';
import AppError from '../../errors/AppError';

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.getProfile(req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User profile retrieved successfully',
    data: { ...result, permissions: req.user.permissions, impersonatedBy: req.user.impersonatedBy },
  });
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
  let userData = { ...req.body };
  if (req.body.data) {
    try {
      userData = JSON.parse(req.body.data);
    } catch (err) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid JSON format in data field');
    }
  }

  const result = await UserServices.updateProfile(req.user.id, userData, req.file);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Profile updated successfully',
    data: result,
  });
});

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ['searchTerm', 'role', 'name', 'email']);
  const paginationOptions = pick(req.query, [
    'page',
    'limit',
    'sortBy',
    'sortOrder',
    'fields',
  ]);

  const query = { ...filters, ...paginationOptions };

  const result = await UserServices.getAllUsers(query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users retrieved successfully',
    meta: result.meta,
    data: result.result,
  });
});

const getSingleUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await UserServices.getSingleUser(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User retrieved successfully',
    data: result,
  });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await UserServices.deleteUser(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User deleted successfully',
    data: null,
  });
});

const createStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.createStaff(req, req.body);
  sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Staff member created', data: result });
});

const listStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.listStaff(req.query);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Staff retrieved', meta: result.meta, data: result.data });
});

const getStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.getStaff(req.params.id as string);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Staff member retrieved', data: result });
});

const updateStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.updateStaff(req, req.params.id as string, req.body);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Staff member updated', data: result });
});

const setPin = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.setPin(req.params.id as string, req.body.pin);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'PIN updated', data: result });
});

const setMyPin = catchAsync(async (req: Request, res: Response) => {
  const result = await UserServices.setPin(req.user.id, req.body.pin);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'PIN updated', data: result });
});

const removeStaff = catchAsync(async (req: Request, res: Response) => {
  await UserServices.removeStaff(req, req.params.id as string);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Staff member removed', data: null });
});

const resendInvite = catchAsync(async (req: Request, res: Response) => {
  const user = await UserServices.getStaff(req.params.id as string);
  await UserServices.sendInvite(user);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Invite sent', data: null });
});

export const UserControllers = {
  getProfile,
  updateProfile,
  getAllUsers,
  getSingleUser,
  deleteUser,
  createStaff,
  listStaff,
  getStaff,
  updateStaff,
  setPin,
  setMyPin,
  removeStaff,
  resendInvite,
};
