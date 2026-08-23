import { ILocation } from './location.interface';
import { Location } from './location.model';

const createLocation = async (payload: ILocation) => {
  const result = await Location.create(payload);
  return result;
};

const getAllLocations = async (tenantId: string) => {
  const result = await Location.find({ tenantId });
  return result;
};

const getLocationById = async (id: string, tenantId: string) => {
  const result = await Location.findOne({ _id: id, tenantId });
  return result;
};

const updateLocation = async (id: string, tenantId: string, payload: Partial<ILocation>) => {
  const result = await Location.findOneAndUpdate({ _id: id, tenantId }, payload, {
    new: true,
  });
  return result;
};

const deleteLocation = async (id: string, tenantId: string) => {
  const result = await Location.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const LocationServices = {
  createLocation,
  getAllLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
};
