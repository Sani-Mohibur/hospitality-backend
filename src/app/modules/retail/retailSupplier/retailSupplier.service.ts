import httpStatus from 'http-status';
import AppError from '../../../errors/AppError';
import { escapeRegex, found, metaOf, paginationOf } from '../../../utils/query';
import { activity } from '../../auditLog/auditLog.service';
import { PurchaseOrder, Supplier } from '../../inventory/inventory.model';
import { ISupplier } from '../../inventory/inventory.interface';

const createSupplier = async (payload: Partial<ISupplier>) => {
  if (payload.code) {
    const codeUpper = payload.code.trim().toUpperCase();
    const exists = await Supplier.exists({ code: codeUpper });
    if (exists) {
      throw new AppError(httpStatus.CONFLICT, `Supplier code '${codeUpper}' is already in use`);
    }
    payload.code = codeUpper;
  }

  const supplier = await Supplier.create(payload);

  await activity.record({
    action: 'RETAIL_SUPPLIER_CREATED',
    entity: 'Supplier',
    entityId: supplier._id,
    message: `Created retail supplier ${supplier.name}`,
  });

  return supplier;
};

const getAllSuppliers = async (query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 20);
  const filter: Record<string, unknown> = {};

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true';
  }

  if (query.searchTerm && typeof query.searchTerm === 'string') {
    const term = query.searchTerm.trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { code: { $regex: term, $options: 'i' } },
      { contactName: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { phone: { $regex: term, $options: 'i' } },
    ];
  }

  const sortOrder = (query.sort as string) || 'name';
  const [data, total] = await Promise.all([
    Supplier.find(filter).sort(sortOrder).skip(skip).limit(limit).lean(),
    Supplier.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

const getSupplierById = async (id: string) => {
  const supplier = found(await Supplier.findById(id).lean(), 'Supplier');
  const openPOCount = await PurchaseOrder.countDocuments({
    supplierId: supplier._id,
    status: { $in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] },
  });
  return { ...supplier, openPOCount };
};

const updateSupplier = async (id: string, payload: Partial<ISupplier>) => {
  const supplier = found(await Supplier.findById(id), 'Supplier');

  if (payload.code) {
    const codeUpper = payload.code.trim().toUpperCase();
    const exists = await Supplier.exists({ _id: { $ne: id }, code: codeUpper });
    if (exists) {
      throw new AppError(httpStatus.CONFLICT, `Supplier code '${codeUpper}' is already in use`);
    }
    payload.code = codeUpper;
  }

  const before = supplier.toObject();
  Object.assign(supplier, payload);
  await supplier.save();

  await activity.record({
    action: 'RETAIL_SUPPLIER_UPDATED',
    entity: 'Supplier',
    entityId: supplier._id,
    message: `Updated retail supplier ${supplier.name}`,
    before,
    after: supplier.toObject(),
  });

  return supplier;
};

const deleteSupplier = async (id: string) => {
  const supplier = found(await Supplier.findById(id), 'Supplier');

  const openPOs = await PurchaseOrder.countDocuments({
    supplierId: supplier._id,
    status: { $in: ['SENT', 'PARTIALLY_RECEIVED'] },
  });
  if (openPOs > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot delete supplier with ${openPOs} open purchase order(s). Please complete or cancel them first.`,
    );
  }

  supplier.isActive = false;
  await supplier.save();

  await activity.record({
    action: 'RETAIL_SUPPLIER_DEACTIVATED',
    entity: 'Supplier',
    entityId: supplier._id,
    message: `Deactivated retail supplier ${supplier.name}`,
  });

  return supplier;
};

export const RetailSupplierService = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
};
