import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import { Request } from 'express';
import { Types } from 'mongoose';
import config from '../../config';
import QueryBuilder from '../../builder/QueryBuilder';
import AppError from '../../errors/AppError';
import { fileDeleter } from '../../utils/deleteFile';
import { fileUploader } from '../../utils/fileUploader';
import { IUser } from './user.interface';
import { User } from './user.model';
import { USER_ROLE } from './user.constant';
import { Role } from '../role/role.model';
import { Location } from '../location/location.model';
import { activity } from '../auditLog/auditLog.service';
import { revokeAllSessions, signPurposeToken } from '../auth/token.service';
import { sendEmail } from '../../utils/sendEmail';
import { requestContext } from '../../utils/requestContext';
import { escapeRegex, found, metaOf, paginationOf } from '../../utils/query';
import logger from '../../utils/logger';

const getProfile = async (userId: string) => {
  const result = await requestContext.asSystem(() =>
    User.findById(userId).populate('roleId', 'name permissions').populate('locationIds', 'name timezone businessDate').lean(),
  );

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User profile not found');
  }
  return result;
};

// Only personal fields can be changed here; role, tenant and grants are managed by admins.
const updateProfile = async (
  userId: string,
  payload: Partial<Pick<IUser, 'name' | 'phone' | 'profileImage'>>,
  file?: any,
) =>
  requestContext.asSystem(async () => {
    const isUserExist = await User.findById(userId);
    if (!isUserExist) {
      throw new AppError(httpStatus.NOT_FOUND, 'User not found');
    }

    const update: Record<string, unknown> = {};
    if (payload.name) update.name = payload.name;
    if (payload.phone !== undefined) update.phone = payload.phone;

    if (file) {
      const uploadResult = await fileUploader.uploadToCloudinary(file);
      update.profileImage = {
        url: uploadResult.url,
        publicId: uploadResult.public_id,
      };
    }

    const result = await User.findByIdAndUpdate(userId, update, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (file && isUserExist.profileImage?.publicId)
      await fileDeleter.deleteFromCloudinary(isUserExist.profileImage.publicId);

    return result;
  });

// ---------- Super admin: all users on the platform ----------
const getAllUsers = async (query: Record<string, unknown>) => {
  const userSearchableFields = ['name', 'email', 'role'];

  const userQuery = new QueryBuilder(User.find(), query)
    .search(userSearchableFields)
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await userQuery.modelQuery;
  const meta = await userQuery.countTotal();

  return {
    meta,
    result,
  };
};

const getSingleUser = async (id: string) => {
  const result = await User.findById(id);

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  return result;
};

const deleteUser = async (id: string) => {
  const result = await User.findByIdAndUpdate(id, { isDeleted: true, isActive: false }, { returnDocument: 'after' });

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }
  await revokeAllSessions(id);

  return result;
};

// ---------- Tenant staff management ----------
type TStaffPayload = {
  name: string;
  email?: string;
  phone?: string;
  password?: string;
  role?: 'TENANT_MANAGER' | 'STAFF';
  roleId?: string;
  locationIds?: string[];
  allLocations?: boolean;
  pin?: string;
  sendInvite?: boolean;
};

const assertCanAssignRole = (req: Request, role: string) => {
  if (role === USER_ROLE.TENANT_MANAGER && req.user.role !== USER_ROLE.TENANT_OWNER && req.user.role !== USER_ROLE.SUPER_ADMIN) {
    throw new AppError(httpStatus.FORBIDDEN, 'Only the owner can create managers');
  }
  if (role === USER_ROLE.TENANT_OWNER || role === USER_ROLE.SUPER_ADMIN) {
    throw new AppError(httpStatus.FORBIDDEN, 'This role cannot be assigned here');
  }
};

const validateGrants = async (payload: { roleId?: string; locationIds?: string[] }) => {
  if (payload.roleId && !(await Role.exists({ _id: payload.roleId }))) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Role not found');
  }
  if (payload.locationIds?.length) {
    const count = await Location.countDocuments({ _id: { $in: payload.locationIds } });
    if (count !== new Set(payload.locationIds).size) throw new AppError(httpStatus.BAD_REQUEST, 'Unknown location in locationIds');
  }
};

const hashPin = async (pin: string) => bcrypt.hash(pin, Number(config.bcrypt_salt_rounds));

const sendInvite = async (user: { _id: unknown; email?: string; name: string; tokenVersion?: number }) => {
  if (!user.email) return;
  const token = signPurposeToken({ typ: 'reset', id: String(user._id), email: user.email, tv: user.tokenVersion || 0 }, '72h');
  const link = `${config.urls.frontend || ''}/accept-invite?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
  await sendEmail(user.email, `<p>Hello ${user.name},</p><p>You have been invited to HPOS. <a href="${link}">Set your password</a> (valid for 72 hours).</p>`, 'You are invited to HPOS').catch(
    (err) => logger.warn(err, 'Invite email failed'),
  );
};

const createStaff = async (req: Request, payload: TStaffPayload) => {
  const role = payload.role || USER_ROLE.STAFF;
  assertCanAssignRole(req, role);
  if (role === USER_ROLE.STAFF && !payload.roleId) throw new AppError(httpStatus.BAD_REQUEST, 'Staff need a roleId');
  if (!payload.email && !payload.pin) throw new AppError(httpStatus.BAD_REQUEST, 'Give an email or a PIN');
  await validateGrants(payload);
  if (payload.email && (await requestContext.asSystem(() => User.exists({ email: payload.email!.toLowerCase() })))) {
    throw new AppError(httpStatus.CONFLICT, 'Email is already in use');
  }

  const user = await User.create({
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    password: payload.password,
    role,
    roleId: payload.roleId,
    locationIds: payload.locationIds || [],
    allLocations: Boolean(payload.allLocations),
    pinHash: payload.pin ? await hashPin(payload.pin) : undefined,
  });
  if (payload.email && !payload.password && payload.sendInvite !== false) await sendInvite(user);
  await activity.record({ action: 'STAFF_CREATED', entity: 'User', entityId: user._id, message: `Added ${user.name} (${role})` });
  return user;
};

const listStaff = async (query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 50);
  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.roleId) filter.roleId = query.roleId;
  if (query.locationId) filter.$or = [{ locationIds: new Types.ObjectId(String(query.locationId)) }, { allLocations: true }];
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.searchTerm) {
    const term = escapeRegex(String(query.searchTerm));
    filter.$and = [{ $or: [{ name: { $regex: term, $options: 'i' } }, { email: { $regex: term, $options: 'i' } }] }];
  }
  const [data, total] = await Promise.all([
    User.find(filter).populate('roleId', 'name').sort({ name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  return { data, meta: metaOf(page, limit, total) };
};

const getStaff = async (id: string) =>
  found(await User.findById(id).populate('roleId', 'name permissions').lean(), 'Staff member');

const updateStaff = async (req: Request, id: string, payload: Partial<TStaffPayload> & { isActive?: boolean }) => {
  const user = found(await User.findById(id), 'Staff member');
  if (user.role === USER_ROLE.TENANT_OWNER && req.user.id !== id) {
    throw new AppError(httpStatus.FORBIDDEN, 'The owner account can only be changed by the owner');
  }
  if (payload.role) assertCanAssignRole(req, payload.role);
  if (user.role === USER_ROLE.TENANT_MANAGER) assertCanAssignRole(req, USER_ROLE.TENANT_MANAGER);
  await validateGrants(payload);

  const before = user.toObject();
  const grantsChanged =
    payload.role !== undefined || payload.roleId !== undefined || payload.locationIds !== undefined || payload.allLocations !== undefined;
  if (payload.name) user.name = payload.name;
  if (payload.phone !== undefined) user.phone = payload.phone;
  if (payload.role) user.role = payload.role;
  if (payload.roleId) user.roleId = new Types.ObjectId(payload.roleId);
  if (payload.locationIds) user.locationIds = payload.locationIds.map((l) => new Types.ObjectId(l));
  if (payload.allLocations !== undefined) user.allLocations = payload.allLocations;
  if (payload.isActive !== undefined) user.isActive = payload.isActive;
  if (payload.pin) user.pinHash = await hashPin(payload.pin);
  await user.save();

  // Access changes take effect immediately, not when the token expires.
  if (grantsChanged || payload.isActive === false) await revokeAllSessions(id);
  await activity.record({
    action: 'STAFF_UPDATED',
    entity: 'User',
    entityId: user._id,
    message: `Updated ${user.name}`,
    before,
    after: user.toObject(),
  });
  return user;
};

const setPin = async (id: string, pin: string) => {
  const user = found(await User.findById(id), 'Staff member');
  user.pinHash = await hashPin(pin);
  await user.save();
  await activity.record({ action: 'PIN_CHANGED', entity: 'User', entityId: user._id, message: `PIN changed for ${user.name}` });
  return { message: 'PIN updated' };
};

const removeStaff = async (req: Request, id: string) => {
  const user = found(await User.findById(id), 'Staff member');
  if (user.role === USER_ROLE.TENANT_OWNER) throw new AppError(httpStatus.FORBIDDEN, 'The owner cannot be removed');
  if (user.role === USER_ROLE.TENANT_MANAGER) assertCanAssignRole(req, USER_ROLE.TENANT_MANAGER);
  user.isDeleted = true;
  user.isActive = false;
  await user.save();
  await revokeAllSessions(id);
  await activity.record({ action: 'STAFF_REMOVED', entity: 'User', entityId: user._id, message: `Removed ${user.name}` });
  return user;
};

export const UserServices = {
  getProfile,
  updateProfile,
  getAllUsers,
  getSingleUser,
  deleteUser,
  createStaff,
  listStaff,
  getStaff,
  updateStaff,
  setPin,
  removeStaff,
  sendInvite,
};
