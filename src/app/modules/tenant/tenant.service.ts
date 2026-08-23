import { ITenant } from './tenant.interface';
import { Tenant } from './tenant.model';

const createTenant = async (payload: ITenant) => {
  const result = await Tenant.create(payload);
  return result;
};

const getAllTenants = async () => {
  const result = await Tenant.find();
  return result;
};

const getTenantById = async (id: string) => {
  const result = await Tenant.findById(id);
  return result;
};

const updateTenant = async (id: string, payload: Partial<ITenant>) => {
  const result = await Tenant.findByIdAndUpdate(id, payload, {
    new: true,
  });
  return result;
};

const deleteTenant = async (id: string) => {
  const result = await Tenant.findByIdAndUpdate(
    id,
    { isDeleted: true },
    { new: true }
  );
  return result;
};

export const TenantServices = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
};
