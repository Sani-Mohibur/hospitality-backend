import httpStatus from 'http-status';
import AppError from '../../../errors/AppError';
import { IFolioCharge } from './folioCharge.interface';
import { FolioCharge } from './folioCharge.model';
import { Folio } from '../folio/folio.model';

const createFolioCharge = async (payload: IFolioCharge) => {
  // Optional: check if folio exists and is OPEN
  const folio = await Folio.findOne({ _id: payload.folioId, tenantId: payload.tenantId });
  if (!folio) {
    throw new AppError(httpStatus.NOT_FOUND, 'Folio not found');
  }
  if (folio.status === 'CLOSED') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cannot add charge to a closed folio');
  }

  const result = await FolioCharge.create(payload);
  return result;
};

const getChargesByFolio = async (folioId: string, tenantId: string) => {
  const result = await FolioCharge.find({ folioId, tenantId });
  return result;
};

const getFolioChargeById = async (id: string, tenantId: string) => {
  const result = await FolioCharge.findOne({ _id: id, tenantId });
  return result;
};

const updateFolioCharge = async (id: string, tenantId: string, payload: Partial<IFolioCharge>) => {
  const charge = await FolioCharge.findOne({ _id: id, tenantId });
  if (!charge) {
    throw new AppError(httpStatus.NOT_FOUND, 'FolioCharge not found');
  }

  const result = await FolioCharge.findOneAndUpdate({ _id: id, tenantId }, payload, { new: true });
  return result;
};

const deleteFolioCharge = async (id: string, tenantId: string) => {
  const result = await FolioCharge.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const FolioChargeServices = {
  createFolioCharge,
  getChargesByFolio,
  getFolioChargeById,
  updateFolioCharge,
  deleteFolioCharge,
};
