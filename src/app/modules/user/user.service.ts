import QueryBuilder from '../../builder/QueryBuilder';
import AppError from '../../errors/AppError';
import { fileDeleter } from '../../utils/deleteFile';
import { fileUploader } from '../../utils/fileUploader';
import { IUser } from './user.interface';
import { User } from './user.model';
import httpStatus from 'http-status';

const getProfile = async (userId: string) => {
  const result = await User.findById(userId);

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User profile not found');
  }
  return result;
};

const updateProfile = async (
  userId: string,
  payload: Partial<IUser>,
  file?: any,
) => {
  const isUserExist = await User.findById(userId);
  if (!isUserExist) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  if (file) {
    const uploadResult = await fileUploader.uploadToCloudinary(file);

    payload.profileImage = {
      url: uploadResult.url,
      publicId: uploadResult.public_id,
    };
  }

  const result = await User.findByIdAndUpdate(userId, payload, {
    returnDocument: 'after',
    runValidators: true,
  });

  if (file && isUserExist.profileImage?.publicId)
    await fileDeleter.deleteFromCloudinary(isUserExist.profileImage.publicId);

  return result;
};

const getAllUsers = async (query: Record<string, unknown>) => {
  const userSearchableFields = ['name', 'email', 'role'];

  const userQuery = new QueryBuilder(User.find(), query)
    .search(userSearchableFields)
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await userQuery.modelQuery;
  const meta = await userQuery.countTotal();

  return {
    meta,
    result,
  };
};

const getSingleUser = async (id: string) => {
  const result = await User.findById(id);

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  return result;
};

const deleteUser = async (id: string) => {
  const result = await User.findByIdAndUpdate(id, { isDeleted: true }, { new: true });

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  return result;
};

export const UserServices = {
  getProfile,
  updateProfile,
  getAllUsers,
  getSingleUser,
  deleteUser,
};
