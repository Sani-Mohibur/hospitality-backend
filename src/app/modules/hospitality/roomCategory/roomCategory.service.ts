import { IRoomCategory } from './roomCategory.interface';
import { RoomCategory } from './roomCategory.model';

const createRoomCategory = async (payload: IRoomCategory) => {
  const result = await RoomCategory.create(payload);
  return result;
};

const getAllRoomCategories = async (tenantId: string) => {
  const result = await RoomCategory.find({ tenantId });
  return result;
};

const getRoomCategoryById = async (id: string, tenantId: string) => {
  const result = await RoomCategory.findOne({ _id: id, tenantId });
  return result;
};

const updateRoomCategory = async (id: string, tenantId: string, payload: Partial<IRoomCategory>) => {
  const result = await RoomCategory.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });
  return result;
};

const deleteRoomCategory = async (id: string, tenantId: string) => {
  const result = await RoomCategory.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const RoomCategoryServices = {
  createRoomCategory,
  getAllRoomCategories,
  getRoomCategoryById,
  updateRoomCategory,
  deleteRoomCategory,
};
