import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { Role } from './role.model';
import { SYSTEM_ROLE_TEMPLATES } from '../user/user.constant';
import { User } from '../user/user.model';
import { activity } from '../auditLog/auditLog.service';
import { found } from '../../utils/query';

const seedSystemRoles = async (tenantId: string) => {
  for (const tpl of SYSTEM_ROLE_TEMPLATES) {
    await Role.updateOne(
      { tenantId, key: tpl.key, isSystem: true },
      { $setOnInsert: { tenantId, key: tpl.key, name: tpl.name, permissions: tpl.permissions, isSystem: true } },
      { upsert: true },
    );
  }
};

const listRoles = async () => {
  const roles = await Role.find().sort({ isSystem: -1, name: 1 }).lean();
  const counts = await User.aggregate([{ $match: { roleId: { $ne: null }, isDeleted: { $ne: true } } }, { $group: { _id: '$roleId', n: { $sum: 1 } } }]);
  const byRole = new Map(counts.map((c) => [String(c._id), c.n]));
  return roles.map((r) => ({ ...r, userCount: byRole.get(String(r._id)) || 0 }));
};

const createRole = async (payload: { name: string; description?: string; permissions: string[] }) => {
  const role = await Role.create({ ...payload, isSystem: false });
  await activity.record({ action: 'ROLE_CREATED', entity: 'Role', entityId: role._id, message: `Created role ${role.name}`, after: role.toObject() });
  return role;
};

const cloneRole = async (id: string, name: string) => {
  const source = found(await Role.findById(id).lean(), 'Role');
  return createRole({ name, description: source.description, permissions: source.permissions });
};

const updateRole = async (id: string, payload: { name?: string; description?: string; permissions?: string[] }) => {
  const role = found(await Role.findById(id), 'Role');
  if (role.isSystem) throw new AppError(httpStatus.BAD_REQUEST, 'System roles cannot be edited. Clone it first.');
  const before = role.toObject();
  Object.assign(role, payload);
  await role.save();
  await activity.record({ action: 'ROLE_UPDATED', entity: 'Role', entityId: role._id, message: `Updated role ${role.name}`, before, after: role.toObject() });
  return role;
};

const deleteRole = async (id: string) => {
  const role = found(await Role.findById(id), 'Role');
  if (role.isSystem) throw new AppError(httpStatus.BAD_REQUEST, 'System roles cannot be deleted');
  const inUse = await User.exists({ roleId: role._id });
  if (inUse) throw new AppError(httpStatus.CONFLICT, 'Role is assigned to staff; reassign them first');
  role.isDeleted = true;
  await role.save();
  return role;
};

export const RoleServices = { seedSystemRoles, listRoles, createRole, cloneRole, updateRole, deleteRole };
