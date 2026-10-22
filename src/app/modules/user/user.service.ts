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
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { activity } from '../auditLog/auditLog.service';
import { revokeAllSessions, signPurposeToken } from '../auth/token.service';
import { sendEmail } from '../../utils/sendEmail';
import { requestContext } from '../../utils/requestContext';
import { escapeRegex, found, metaOf, paginationOf } from '../../utils/query';
import { canAccessLocation } from '../../middlewares/locationScope';
import logger from '../../utils/logger';

const getProfile = async (userId: string) => {
  const result = await requestContext.asSystem(() =>
    User.findById(userId).populate('roleId', 'name permissions').populate('locationIds', 'name timezone businessDate').lean(),
  );

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, 'User profile not found');
  }

  let tenant = null;
  if (result.tenantId) {
    const tenantDoc = await requestContext.asSystem(() => Tenant.findById(result.tenantId).lean());
    if (tenantDoc) {
      let subscription = null;
      if (tenantDoc.subscriptionId) {
        subscription = await requestContext.asSystem(() => Subscription.findById(tenantDoc.subscriptionId).lean());
      }
      tenant = {
        id: tenantDoc._id,
        name: tenantDoc.name,
        status: tenantDoc.status,
        subscribedModules: tenantDoc.modules,
        subscription,
      };
    }
  }

  return { ...result, tenant };
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

    const oldPublicId = isUserExist.profileImage?.publicId;
    if (file && oldPublicId) {
      await fileDeleter.deleteFromCloudinary(oldPublicId);
    }

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

const isEmailTaken = async (email: string) => {
  const normalized = email.toLowerCase().trim();
  const exists = await requestContext.asSystem(() => User.exists({ email: normalized }));
  return Boolean(exists);
};

const createStaff = async (req: Request, payload: TStaffPayload) => {
  const role = payload.role || USER_ROLE.STAFF;
  assertCanAssignRole(req, role);
  if (!payload.email) throw new AppError(httpStatus.BAD_REQUEST, 'Email address is required');
  await validateGrants(payload);

  let allLocations = Boolean(payload.allLocations);
  let locationIds = payload.locationIds || [];

  if (req.user.role === USER_ROLE.TENANT_MANAGER) {
    if (allLocations) {
      throw new AppError(httpStatus.FORBIDDEN, 'Managers cannot assign staff to all locations');
    }
    // If no locations specified, default to currently selected location or manager's authorized location
    if (!locationIds.length) {
      if (req.locationId && canAccessLocation(req, req.locationId)) {
        locationIds = [req.locationId];
      } else {
        const firstLocation = req.user.locationIds?.[0];
        if (firstLocation) {
          locationIds = [firstLocation];
        } else {
          throw new AppError(httpStatus.FORBIDDEN, 'No authorized location available to assign staff');
        }
      }
    }
    for (const locId of locationIds) {
      if (!canAccessLocation(req, locId)) {
        throw new AppError(httpStatus.FORBIDDEN, 'You cannot assign staff to locations outside your access scope');
      }
    }
  } else if (req.user.role === USER_ROLE.TENANT_OWNER || req.user.role === USER_ROLE.SUPER_ADMIN) {
    // Owner adding staff: default to current dashboard location if not allLocations and no locations provided
    if (!allLocations && !locationIds.length && req.locationId) {
      locationIds = [req.locationId];
    }
  }

  const emailExists = await isEmailTaken(payload.email);
  if (emailExists) {
    throw new AppError(httpStatus.CONFLICT, 'A user with this email address already exists');
  }

  const user = await User.create({
    name: payload.name.trim(),
    email: payload.email ? payload.email.toLowerCase().trim() : undefined,
    phone: payload.phone?.trim() || undefined,
    password: payload.password,
    role,
    tenantId: req.user.tenantId ? new Types.ObjectId(req.user.tenantId) : undefined,
    roleId: role === USER_ROLE.STAFF && payload.roleId ? new Types.ObjectId(payload.roleId) : undefined,
    locationIds: locationIds.map((l) => new Types.ObjectId(l)),
    allLocations,
    pinHash: payload.pin ? await hashPin(payload.pin) : undefined,
    isActive: true,
  });

  // Direct addition: Only send invite if explicitly requested (default is no invite)
  if (payload.sendInvite === true && payload.email && !payload.password) {
    await sendInvite(user);
  }

  await activity.record({ action: 'STAFF_CREATED', entity: 'User', entityId: user._id, message: `Added ${user.name} (${role})` });
  return user;
};

const listStaff = async (req: Request, query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 50);
  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.roleId) filter.roleId = query.roleId;

  const queryLocationId = typeof query.locationId === 'string' ? query.locationId : undefined;
  const effectiveLocationId = req.locationId || queryLocationId;
  if (effectiveLocationId) {
    if (!canAccessLocation(req, effectiveLocationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
    }
    filter.$or = [{ locationIds: new Types.ObjectId(effectiveLocationId) }, { allLocations: true }];
  } else if (!req.user.allLocations) {
    const accessibleOids = (req.user.locationIds || []).map((id) => new Types.ObjectId(id));
    filter.$or = [{ locationIds: { $in: accessibleOids } }, { allLocations: true }];
  }

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

const getStaff = async (req: Request, id: string) => {
  const staff = found(await User.findById(id).populate('roleId', 'name permissions').lean(), 'Staff member');
  if (req.user.role === USER_ROLE.TENANT_MANAGER) {
    const userInScope = staff.allLocations || (staff.locationIds || []).some((lId: any) => canAccessLocation(req, String(lId)));
    if (!userInScope) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this staff member');
    }
  }
  return staff;
};

const updateStaff = async (req: Request, id: string, payload: Partial<TStaffPayload> & { isActive?: boolean }) => {
  const user = found(await User.findById(id), 'Staff member');
  if (user.role === USER_ROLE.TENANT_OWNER && req.user.id !== id) {
    throw new AppError(httpStatus.FORBIDDEN, 'The owner account can only be changed by the owner');
  }
  if (payload.role) assertCanAssignRole(req, payload.role);
  if (user.role === USER_ROLE.TENANT_MANAGER && req.user.role !== USER_ROLE.TENANT_OWNER && req.user.role !== USER_ROLE.SUPER_ADMIN) {
    throw new AppError(httpStatus.FORBIDDEN, 'Only the owner can modify managers');
  }

  if (req.user.role === USER_ROLE.TENANT_MANAGER) {
    const userInScope = user.allLocations || (user.locationIds || []).some((lId) => canAccessLocation(req, String(lId)));
    if (!userInScope) {
      throw new AppError(httpStatus.FORBIDDEN, 'You cannot manage staff outside your authorized locations');
    }
    if (payload.allLocations) {
      throw new AppError(httpStatus.FORBIDDEN, 'Managers cannot assign staff to all locations');
    }
    if (payload.locationIds) {
      for (const locId of payload.locationIds) {
        if (!canAccessLocation(req, locId)) {
          throw new AppError(httpStatus.FORBIDDEN, 'You cannot assign staff to locations outside your access scope');
        }
      }
    }
  }

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
  if (user.role === USER_ROLE.TENANT_MANAGER && req.user.role !== USER_ROLE.TENANT_OWNER && req.user.role !== USER_ROLE.SUPER_ADMIN) {
    throw new AppError(httpStatus.FORBIDDEN, 'Only the owner can remove managers');
  }
  if (req.user.role === USER_ROLE.TENANT_MANAGER) {
    const userInScope = user.allLocations || (user.locationIds || []).some((lId) => canAccessLocation(req, String(lId)));
    if (!userInScope) {
      throw new AppError(httpStatus.FORBIDDEN, 'You cannot remove staff outside your authorized locations');
    }
  }
  user.isDeleted = true;
  user.isActive = false;
  await user.save();
  await revokeAllSessions(id);
  await activity.record({ action: 'STAFF_REMOVED', entity: 'User', entityId: user._id, message: `Removed ${user.name}` });
  return user;
};

const ensureSuperAdmin = async () => {
  const adminEmail = (config.email.admin || 'admin@hospitality.com').toLowerCase();
  const existing = await User.findOne({ role: USER_ROLE.SUPER_ADMIN });
  if (!existing) {
    const password = 'Password123!';
    await User.create({
      name: 'Super Admin',
      email: adminEmail,
      password,
      role: USER_ROLE.SUPER_ADMIN,
      allLocations: true,
      isActive: true,
    });
    logger.info(`Super Admin user initialized: ${adminEmail}`);
  }
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
  isEmailTaken,
  ensureSuperAdmin,
};
