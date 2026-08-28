import { IRoom } from './room.interface';
import { Room } from './room.model';

const createRoom = async (payload: IRoom) => {
  const result = await Room.create(payload);
  return result;
};

const getAllRooms = async (tenantId: string) => {
  const result = await Room.find({ tenantId }).populate('roomCategoryId locationId');
  return result;
};

const getRoomById = async (id: string, tenantId: string) => {
  const result = await Room.findOne({ _id: id, tenantId }).populate('roomCategoryId locationId');
  return result;
};

const updateRoom = async (id: string, tenantId: string, payload: Partial<IRoom>) => {
  const result = await Room.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });
  return result;
};

const deleteRoom = async (id: string, tenantId: string) => {
  const result = await Room.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const RoomServices = {
  createRoom,
  getAllRooms,
  getRoomById,
  updateRoom,
  deleteRoom,
};
