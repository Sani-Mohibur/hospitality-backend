import { ITable } from './table.interface';
import { Table } from './table.model';

const createTable = async (payload: ITable) => {
  const result = await Table.create(payload);
  return result;
};

const getAllTables = async (tenantId: string) => {
  const result = await Table.find({ tenantId }).populate('locationId');
  return result;
};

const getTableById = async (id: string, tenantId: string) => {
  const result = await Table.findOne({ _id: id, tenantId }).populate('locationId');
  return result;
};

const updateTable = async (id: string, tenantId: string, payload: Partial<ITable>) => {
  const result = await Table.findOneAndUpdate({ _id: id, tenantId }, payload, {
    new: true,
  });
  return result;
};

const deleteTable = async (id: string, tenantId: string) => {
  const result = await Table.findOneAndUpdate(
    { _id: id, tenantId },
    { isDeleted: true },
    { new: true },
  );
  return result;
};

export const TableServices = {
  createTable,
  getAllTables,
  getTableById,
  updateTable,
  deleteTable,
};
