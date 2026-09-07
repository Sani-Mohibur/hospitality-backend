import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { IPlatformModule } from './platformModule.interface';
import { PlatformModule } from './platformModule.model';

const createPlatformModuleIntoDB = async (payload: IPlatformModule) => {
  const result = await PlatformModule.create(payload);
  return result;
};

const getAllPlatformModulesFromDB = async () => {
  const result = await PlatformModule.find();
  return result;
};

const updatePlatformModuleIntoDB = async (
  id: string,
  payload: Partial<IPlatformModule>
) => {
  const result = await PlatformModule.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'Platform module not found');
  }
  return result;
};

export const PlatformModuleServices = {
  createPlatformModuleIntoDB,
  getAllPlatformModulesFromDB,
  updatePlatformModuleIntoDB,
};
