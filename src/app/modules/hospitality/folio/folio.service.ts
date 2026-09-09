import httpStatus from 'http-status';
import AppError from '../../../errors/AppError';
import { IFolio } from './folio.interface';
import { Folio } from './folio.model';

const createFolio = async (payload: IFolio) => {
  const result = await Folio.create(payload);
  return result;
};

const getAllFolios = async (tenantId: string) => {
  const result = await Folio.find({ tenantId }).populate('reservationId guestId locationId');
  return result;
};

const getFolioById = async (id: string, tenantId: string) => {
  const result = await Folio.findOne({ _id: id, tenantId }).populate('reservationId guestId locationId');
  return result;
};

const updateFolio = async (id: string, tenantId: string, payload: Partial<IFolio>) => {
  const folio = await Folio.findOne({ _id: id, tenantId });
  if (!folio) {
    throw new AppError(httpStatus.NOT_FOUND, 'Folio not found');
  }

  const result = await Folio.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });
  return result;
};

const deleteFolio = async (id: string, tenantId: string) => {
  const result = await Folio.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const FolioServices = {
  createFolio,
  getAllFolios,
  getFolioById,
  updateFolio,
  deleteFolio,
};
