import { IGuest } from './guest.interface';
import { Guest } from './guest.model';

const createGuest = async (payload: IGuest) => {
  const result = await Guest.create(payload);
  return result;
};

const getAllGuests = async (tenantId: string) => {
  const result = await Guest.find({ tenantId });
  return result;
};

const getGuestById = async (id: string, tenantId: string) => {
  const result = await Guest.findOne({ _id: id, tenantId });
  return result;
};

const updateGuest = async (id: string, tenantId: string, payload: Partial<IGuest>) => {
  const result = await Guest.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });
  return result;
};

const deleteGuest = async (id: string, tenantId: string) => {
  const result = await Guest.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const GuestServices = {
  createGuest,
  getAllGuests,
  getGuestById,
  updateGuest,
  deleteGuest,
};
