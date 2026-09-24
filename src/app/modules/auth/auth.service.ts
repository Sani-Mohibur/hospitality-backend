import httpStatus from 'http-status';
import bcrypt from 'bcryptjs';
import config from '../../config';
import AppError from '../../errors/AppError';
import { IUser } from '../user/user.interface';
import { User } from '../user/user.model';
import { USER_ROLE } from '../user/user.constant';
import { Tenant } from '../tenant/tenant.model';
import { Location } from '../location/location.model';
import { Outlet, Station } from '../outlet/outlet.model';
import { Device } from '../device/device.model';
import { Session } from './session.model';
import { RoleServices } from '../role/role.service';
import { SubscriptionServices } from '../subscription/subscription.service';
import { otpTemplate } from '../../utils/otpTemplate';
import { sendEmail } from '../../utils/sendEmail';
import { decrypt, encrypt, generateTotpSecret, randomToken, sha256, totpUri, verifyTotp, randomCode, safeEqual } from '../../utils/crypto';
import { localDate } from '../../utils/businessDate';
import { requestContext } from '../../utils/requestContext';
import { runInTransaction } from '../../utils/transaction';
import { activity } from '../auditLog/auditLog.service';
import {
  issueTokens,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
  signPurposeToken,
  verifyPurposeToken,
} from './token.service';
import logger from '../../utils/logger';

type TClientMeta = { ip?: string; userAgent?: string };

const MFA_ROLES: string[] = [USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tenant';

const uniqueSlug = async (base: string) => {
  let slug = slugify(base);
  for (let i = 0; await Tenant.exists({ slug }); i += 1) slug = `${slugify(base)}-${randomCode(4)}`;
  return slug;
};

const publicUser = (user: any) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  tenantId: user.tenantId,
  profileImage: user.profileImage,
  mfaEnabled: Boolean(user.mfa?.enabled),
});

// ---------- Self-serve signup: tenant + owner + first location + trial ----------
export type TSignupPayload = {
  businessName: string;
  ownerName: string;
  email: string;
  password?: string;
  phone?: string;
  currency?: string;
  timezone?: string;
  locationName?: string;
  address?: string;
  modules?: string[];
};

export const createTenantWithOwner = async (payload: TSignupPayload) => {
  const email = payload.email.toLowerCase().trim();
  if (await requestContext.asSystem(() => User.exists({ email }))) {
    throw new AppError(httpStatus.CONFLICT, 'An account with this email already exists');
  }
  const modules = payload.modules?.length ? payload.modules : ['HOSPITALITY', 'RESTAURANT'];
  const timezone = payload.timezone || 'UTC';

  const { owner, tenant } = await requestContext.asSystem(() =>
    runInTransaction(async () => {
      const slug = await uniqueSlug(payload.businessName);
      const [tenant] = await Tenant.create([
        {
          name: payload.businessName,
          slug,
          modules,
          currency: (payload.currency || 'USD').toUpperCase(),
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() + config.billing.trial_days * 24 * 3600 * 1000),
          settings: { defaultTimezone: timezone },
        },
      ]);
      const tenantId = String(tenant!._id);
      return requestContext.asTenant(tenantId, async () => {
        await RoleServices.seedSystemRoles(tenantId);
        const [location] = await Location.create([
          {
            tenantId,
            name: payload.locationName || payload.businessName,
            address: payload.address,
            timezone,
            businessDate: localDate(timezone),
            hasRooms: modules.includes('HOSPITALITY'),
          },
        ]);
        if (modules.includes('RESTAURANT')) {
          const [outlet] = await Outlet.create([{ tenantId, locationId: location!._id, name: 'Restaurant' }]);
          const [station] = await Station.create([
            { tenantId, locationId: location!._id, outletId: outlet!._id, name: 'Kitchen', type: 'KITCHEN' },
          ]);
          outlet!.defaultStationId = station!._id;
          await outlet!.save();
        }
        const [owner] = await User.create([
          {
            name: payload.ownerName,
            email,
            phone: payload.phone,
            password: payload.password || undefined,
            role: USER_ROLE.TENANT_OWNER,
            tenantId,
            allLocations: true,
            locationIds: [location!._id],
          },
        ]);
        const subscription = await SubscriptionServices.startTrial(tenantId, modules);
        tenant!.subscriptionId = subscription._id;
        await tenant!.save();
        return { owner: owner!, tenant: tenant! };
      });
    }),
  );
  return { owner, tenant };
};

const signup = async (payload: TSignupPayload, meta: TClientMeta) => {
  const { owner, tenant } = await createTenantWithOwner(payload);
  const tokens = await issueTokens(owner, meta);
  return { ...tokens, user: publicUser(owner), tenant: { _id: tenant._id, name: tenant.name, slug: tenant.slug } };
};

// ---------- Login with lockout and MFA ----------
const assertNotLocked = (user: { lockedUntil?: Date }) => {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(httpStatus.TOO_MANY_REQUESTS, `Account locked. Try again in ${minutes} minute(s).`);
  }
};

const registerFailedAttempt = async (userId: unknown) => {
  const user = await User.findByIdAndUpdate(userId, { $inc: { failedLoginCount: 1 } }, { returnDocument: 'after' });
  if (user && user.failedLoginCount >= config.security.login_max_attempts) {
    user.lockedUntil = new Date(Date.now() + config.security.login_lock_minutes * 60000);
    user.failedLoginCount = 0;
    await user.save();
  }
};

const completeLogin = async (user: any, meta: TClientMeta) => {
  await User.updateOne({ _id: user._id }, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() });
  if (user.tenantId) await Tenant.updateOne({ _id: user.tenantId }, { lastActivityAt: new Date() });
  const tokens = await issueTokens(user, meta);
  return {
    ...tokens,
    user: publicUser(user),
    mfaSetupRecommended: MFA_ROLES.includes(user.role) && !user.mfa?.enabled,
  };
};

const loginUser = async (payload: { email?: string; password?: string }, meta: TClientMeta) =>
  requestContext.asSystem(async () => {
    if (!payload.email || !payload.password) throw new AppError(400, 'Email and password are required');

    const user = await User.findOne({ email: payload.email.toLowerCase().trim() }).select('+password');
    // Same message for unknown email and wrong password.
    if (!user || !user.password) throw new AppError(401, 'Invalid email or password');
    assertNotLocked(user);
    if (!user.isActive) throw new AppError(403, 'Account is disabled');

    const isPasswordMatched = await bcrypt.compare(payload.password, user.password);
    if (!isPasswordMatched) {
      await registerFailedAttempt(user._id);
      throw new AppError(401, 'Invalid email or password');
    }

    if (user.mfa?.enabled) {
      const mfaToken = signPurposeToken({ typ: 'mfa', id: String(user._id) }, '5m');
      return { mfaRequired: true, mfaToken };
    }
    return completeLogin(user, meta);
  });

const verifyMfaLogin = async (payload: { mfaToken: string; code: string }, meta: TClientMeta) =>
  requestContext.asSystem(async () => {
    const decoded = verifyPurposeToken(payload.mfaToken, 'mfa');
    const user = await User.findById(decoded.id).select('+mfa.secretEnc +mfa.recoveryCodeHashes');
    if (!user || !user.mfa?.enabled || !user.mfa.secretEnc) throw new AppError(401, 'MFA is not enabled');
    assertNotLocked(user);

    const code = String(payload.code).replace(/\s/g, '');
    let valid = verifyTotp(decrypt(user.mfa.secretEnc), code);
    if (!valid && user.mfa.recoveryCodeHashes?.includes(sha256(code))) {
      user.mfa.recoveryCodeHashes = user.mfa.recoveryCodeHashes.filter((h) => h !== sha256(code));
      await user.save();
      valid = true;
    }
    if (!valid) {
      await registerFailedAttempt(user._id);
      throw new AppError(401, 'Invalid authentication code');
    }
    return completeLogin(user, meta);
  });

const setupMfa = async (userId: string) =>
  requestContext.asSystem(async () => {
    const user = await User.findById(userId);
    if (!user) throw new AppError(404, 'User not found');
    const secret = generateTotpSecret();
    user.mfa = { ...(user.mfa || { enabled: false }), pendingSecretEnc: encrypt(secret) } as any;
    await user.save();
    return { secret, otpauthUrl: totpUri(secret, user.email || user.name) };
  });

const enableMfa = async (userId: string, code: string) =>
  requestContext.asSystem(async () => {
    const user = await User.findById(userId).select('+mfa.pendingSecretEnc');
    if (!user?.mfa?.pendingSecretEnc) throw new AppError(400, 'Start MFA setup first');
    const secret = decrypt(user.mfa.pendingSecretEnc);
    if (!verifyTotp(secret, code)) throw new AppError(400, 'Invalid authentication code');
    const recoveryCodes = Array.from({ length: 8 }, () => randomToken(6));
    user.mfa = {
      enabled: true,
      secretEnc: encrypt(secret),
      pendingSecretEnc: undefined,
      recoveryCodeHashes: recoveryCodes.map(sha256),
    };
    await user.save();
    return { enabled: true, recoveryCodes };
  });

const disableMfa = async (userId: string, password: string, code: string) =>
  requestContext.asSystem(async () => {
    const user = await User.findById(userId).select('+password +mfa.secretEnc');
    if (!user?.mfa?.enabled || !user.mfa.secretEnc) throw new AppError(400, 'MFA is not enabled');
    if (!user.password || !(await bcrypt.compare(password, user.password))) throw new AppError(401, 'Password not matched');
    if (!verifyTotp(decrypt(user.mfa.secretEnc), code)) throw new AppError(401, 'Invalid authentication code');
    user.mfa = { enabled: false };
    await user.save();
    return { enabled: false };
  });

// ---------- Refresh / logout / sessions ----------
const refreshToken = async (token: string, meta: TClientMeta) => {
  if (!token) throw new AppError(400, 'Refresh token is required');
  const result = await rotateRefreshToken(token, meta);
  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
};

const logout = async (token?: string, sessionId?: string) => {
  const id = sessionId || (token ? token.split('.')[0] : undefined);
  if (id) await revokeSession(id);
};

const listSessions = async (userId: string) =>
  requestContext.asSystem(() =>
    Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
      .select('ip userAgent deviceId createdAt lastUsedAt impersonatedBy')
      .sort({ createdAt: -1 })
      .lean(),
  );

// ---------- Password reset (OTP) ----------
const forgotPassword = async (email: string) =>
  requestContext.asSystem(async () => {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    // Do not reveal whether the email exists.
    if (!user) return { message: 'If the email exists, an OTP has been sent' };

    const otp = randomCode(6);
    user.otpHash = sha256(otp);
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    user.otpAttempts = 0;
    await user.save();

    await sendEmail(user.email!, otpTemplate(otp), 'Password Reset OTP');
    return { message: 'If the email exists, an OTP has been sent' };
  });

const verifyOtp = async (email: string, otp: string) =>
  requestContext.asSystem(async () => {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+otpHash +otpExpires +otpAttempts');
    if (!user || !user.otpHash) throw new AppError(400, 'Invalid OTP');
    if (!user.otpExpires || new Date() > user.otpExpires) throw new AppError(400, 'OTP has expired');
    if ((user.otpAttempts || 0) >= 5) throw new AppError(429, 'Too many attempts. Request a new OTP.');

    if (!safeEqual(user.otpHash, sha256(String(otp)))) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      throw new AppError(400, 'Invalid OTP');
    }

    user.otpHash = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

    // Bound to this user and email; the old implementation accepted any reset token for any email.
    const resetToken = signPurposeToken({ typ: 'reset', id: String(user._id), email: user.email, tv: user.tokenVersion }, '10m');
    return { resetToken, message: 'OTP verified successfully' };
  });

const resetPassword = async (email: string, newPassword: string, resetToken: string) =>
  requestContext.asSystem(async () => {
    if (!resetToken) throw new AppError(401, 'Reset token is required');
    const decoded = verifyPurposeToken(resetToken, 'reset');
    if (decoded.email !== String(email).toLowerCase().trim()) throw new AppError(401, 'Reset token does not match this email');

    const user = await User.findById(decoded.id).select('+password');
    if (!user || (user.tokenVersion || 0) !== (decoded.tv || 0)) throw new AppError(401, 'Reset token is no longer valid');

    user.password = newPassword;
    await user.save();
    // A password reset signs the user out everywhere.
    await revokeAllSessions(String(user._id));
    const fresh = await User.findById(user._id).lean();
    return issueTokens(fresh!, {});
  });

const changePassword = async (userId: string, oldPassword: string, newPassword: string, currentSessionId?: string) =>
  requestContext.asSystem(async () => {
    const user = await User.findById(userId).select('+password');
    if (!user || !user.password) throw new AppError(404, 'User not found');

    const isPasswordMatched = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordMatched) throw new AppError(400, 'Password not matched');

    user.password = newPassword;
    await user.save();
    await Session.updateMany(
      { userId, revokedAt: null, ...(currentSessionId ? { _id: { $ne: currentSessionId } } : {}) },
      { revokedAt: new Date() },
    );
    return { message: 'Password changed successfully. Other sessions were signed out.' };
  });

// ---------- Shared devices: staff grid + PIN login ----------
const deviceFromToken = async (deviceToken?: string) => {
  if (!deviceToken) throw new AppError(401, 'Device token is required');
  const device = await Device.findOne({ tokenHash: sha256(deviceToken), isActive: true, revokedAt: null });
  if (!device) throw new AppError(401, 'Device is not paired');
  return device;
};

const deviceStaff = async (deviceToken?: string) =>
  requestContext.asSystem(async () => {
    const device = await deviceFromToken(deviceToken);
    const staff = await User.find({
      tenantId: device.tenantId,
      isActive: true,
      $or: [{ allLocations: true }, { locationIds: device.locationId }, { role: USER_ROLE.TENANT_OWNER }],
    })
      .select('name profileImage role roleId')
      .sort({ name: 1 })
      .lean();
    return staff;
  });

const pinLogin = async (deviceToken: string | undefined, payload: { userId: string; pin: string }, meta: TClientMeta) =>
  requestContext.asSystem(async () => {
    const device = await deviceFromToken(deviceToken);
    const user = await User.findOne({ _id: payload.userId, tenantId: device.tenantId }).select('+pinHash');
    if (!user || !user.isActive || !user.pinHash) throw new AppError(401, 'Invalid PIN');
    assertNotLocked(user);
    const allowed = user.allLocations || user.role === USER_ROLE.TENANT_OWNER || user.locationIds.map(String).includes(String(device.locationId));
    if (!allowed) throw new AppError(403, 'You are not assigned to this location');
    if (!(await bcrypt.compare(String(payload.pin), user.pinHash))) {
      await registerFailedAttempt(user._id);
      throw new AppError(401, 'Invalid PIN');
    }
    device.lastSeenAt = new Date();
    await device.save();
    await User.updateOne({ _id: user._id }, { failedLoginCount: 0, lastLoginAt: new Date() });
    // A PIN session lasts one shift and has no refresh token.
    const tokens = await issueTokens(user, { ...meta, deviceId: String(device._id), withRefresh: false, accessExpiresIn: '12h' });
    return {
      accessToken: tokens.accessToken,
      user: publicUser(user),
      device: { _id: device._id, name: device.name, locationId: device.locationId, outletId: device.outletId, orderPrefix: device.orderPrefix },
    };
  });

// ---------- Google sign-in (SSO for existing accounts) ----------
const googleLogin = async (idToken: string, meta: TClientMeta) =>
  requestContext.asSystem(async () => {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!response.ok) throw new AppError(401, 'Invalid Google token');
    const info = (await response.json()) as { aud?: string; sub?: string; email?: string; email_verified?: string | boolean };
    const audiences = [config.google.client_id, config.google.android_client_id, config.google.ios_client_id].filter(Boolean);
    if (!info.aud || !audiences.includes(info.aud)) throw new AppError(401, 'Google token was issued for another app');
    if (!info.email || !(info.email_verified === true || info.email_verified === 'true')) {
      throw new AppError(401, 'Google email is not verified');
    }
    const user = await User.findOne({ $or: [{ googleSub: info.sub }, { email: info.email.toLowerCase() }] });
    if (!user) throw new AppError(404, 'No HPOS account uses this Google email. Ask your manager for an invite.');
    assertNotLocked(user);
    if (!user.googleSub) {
      user.googleSub = info.sub;
      await user.save();
    }
    if (user.mfa?.enabled) {
      return { mfaRequired: true, mfaToken: signPurposeToken({ typ: 'mfa', id: String(user._id) }, '5m') };
    }
    return completeLogin(user, meta);
  });

// ---------- Super admin impersonation (support access) ----------
const impersonateTenant = async (superAdminId: string, tenantId: string, reason: string, meta: TClientMeta) =>
  requestContext.asSystem(async () => {
    if (!reason || reason.trim().length < 5) throw new AppError(400, 'Give a reason for accessing this tenant');
    const user = await User.findOne({ tenantId, role: USER_ROLE.TENANT_OWNER, isActive: true });
    if (!user) throw new AppError(404, 'No owner found for this tenant');

    const tokens = await issueTokens(user, {
      ...meta,
      impersonatedBy: superAdminId,
      withRefresh: false,
      accessExpiresIn: '30m',
    });
    await requestContext.asTenant(tenantId, () =>
      activity.record({
        action: 'IMPERSONATION_STARTED',
        entity: 'Tenant',
        entityId: tenantId,
        actorId: superAdminId,
        message: `Platform support signed in as ${user.name}. Reason: ${reason}`,
        meta: { reason, ip: meta.ip },
      }),
    );
    logger.warn({ superAdminId, tenantId, reason }, 'Impersonation started');
    return { accessToken: tokens.accessToken, expiresIn: '30m', user: publicUser(user) };
  });

const getMe = async (userId: string) =>
  requestContext.asSystem(async () => User.findById(userId).populate('roleId', 'name permissions').lean());

export const AuthServices = {
  signup,
  loginUser,
  verifyMfaLogin,
  setupMfa,
  enableMfa,
  disableMfa,
  refreshToken,
  logout,
  listSessions,
  revokeSession,
  revokeAllSessions,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  deviceStaff,
  pinLogin,
  googleLogin,
  impersonateTenant,
  getMe,
};

export type TAuthUserDoc = IUser;
