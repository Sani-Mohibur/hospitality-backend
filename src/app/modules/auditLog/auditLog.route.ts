import express from 'express';
import { AuditLogController } from './auditLog.controller';
import auth from '../../middlewares/auth';

const router = express.Router();

router.get(
  '/',
  auth('super_admin', 'tenant_admin'),
  AuditLogController.getAuditLogs
);

export const AuditLogRoutes = router;
