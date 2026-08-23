import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { UserServices } from './user.service';
import httpStatus from 'http-status';
import pick from '../../utils/pick';
import AppError from '../../errors/AppError';

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;

  const result = await UserServices.getProfile(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User profile retrieved successfully',
    data: result,
  });
});

const updateProfile = catchAsync(async (req, res) => {
  const userId = req.user.id;
  let userData = { ...req.body };
  if (req.body.data) {
    try {
      userData = JSON.parse(req.body.data);
    } catch (err) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid JSON format in data field');
    }
  }

  const result = await UserServices.updateProfile(userId, userData, req.file);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Profile updated successfully',
    data: result,
  });
});

const getAllUsers = catchAsync(async (req, res) => {
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

const getSingleUser = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await UserServices.getSingleUser(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User retrieved successfully',
    data: result,
  });
});

const deleteUser = catchAsync(async (req, res) => {
  const { id } = req.params;
  await UserServices.deleteUser(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User deleted successfully',
    data: null,
  });
});

export const UserControllers = {
  getProfile,
  updateProfile,
  getAllUsers,
  getSingleUser,
  deleteUser,
};
