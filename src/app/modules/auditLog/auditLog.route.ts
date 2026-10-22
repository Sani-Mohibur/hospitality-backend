import express from 'express';
import { AuditLogController } from './auditLog.controller';
import auth, { authorize, tenantUser } from '../../middlewares/auth';
import locationScope from '../../middlewares/locationScope';
import { PERMISSION, USER_ROLE } from '../user/user.constant';

const router = express.Router();

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  locationScope({ required: false }),
  AuditLogController.getAuditLogs
);

router.get(
  '/activity',
  tenantUser(),
  authorize(PERMISSION.AUDIT_VIEW),
  locationScope({ required: false }),
  AuditLogController.getActivity
);

export const AuditLogRoutes = router;
