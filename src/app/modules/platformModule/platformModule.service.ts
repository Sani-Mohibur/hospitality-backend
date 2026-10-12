import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { IPlatformModule } from './platformModule.interface';
import { PlatformModule } from './platformModule.model';
import { Tenant } from '../tenant/tenant.model';

const createPlatformModuleIntoDB = async (payload: IPlatformModule) => {
  const result = await PlatformModule.create(payload);
  return result;
};

const getAllPlatformModulesFromDB = async () => {
  let modules = await PlatformModule.find().sort({ createdAt: 1 }).lean();
  if (modules.length === 0) {
    for (const mod of DEFAULT_PLATFORM_MODULES) {
      await PlatformModule.updateOne({ code: mod.code }, { $setOnInsert: mod }, { upsert: true });
    }
    modules = await PlatformModule.find().sort({ createdAt: 1 }).lean();
  }
  const tenantCounts = await Tenant.aggregate([
    { $match: { isDeleted: false, status: { $ne: 'CANCELLED' } } },
    { $unwind: '$modules' },
    { $group: { _id: '$modules', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(tenantCounts.map((r) => [r._id, r.count]));
  return modules.map((m) => ({
    ...m,
    activeSubscribers: countMap.get(m.code) || 0,
  }));
};

const updatePlatformModuleIntoDB = async (
  id: string,
  payload: Partial<IPlatformModule>
) => {
  const result = await PlatformModule.findByIdAndUpdate(id, payload, {
    returnDocument: 'after',
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
