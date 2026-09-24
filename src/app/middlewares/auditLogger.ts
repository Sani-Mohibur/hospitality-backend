import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AuditLogService } from '../modules/auditLog/auditLog.service';
import logger from '../utils/logger';
import { redact } from '../utils/redact';

const SKIP_PATHS = [/^\/auth\/(login|refresh-token|pin-login|forgot-password|verify-otp|reset-password|mfa)/, /^\/webhooks\//];

const entityFromPath = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  const segment = parts.find((p) => !Types.ObjectId.isValid(p)) || 'unknown';
  return segment.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
};

// Records every successful POST/PATCH/PUT/DELETE with a redacted body. Passwords,
// PINs, OTPs, tokens, card data and ID numbers never reach the log.
const auditLogger = (entity?: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Captured now: Express rewrites req.path while routing into sub-routers.
    const path = req.path;
    const url = req.originalUrl.split('?')[0];
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) || SKIP_PATHS.some((r) => r.test(path))) {
      return next();
    }
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const action = req.method === 'POST' ? 'CREATE' : req.method === 'DELETE' ? 'DELETE' : 'UPDATE';
      const idParam = Object.values(req.params || {}).find((v) => typeof v === 'string' && Types.ObjectId.isValid(v));

      AuditLogService.createAuditLog({
        action,
        entity: entity || entityFromPath(path),
        entityId: idParam ? new Types.ObjectId(idParam as string) : undefined,
        user: req.user?.id ? new Types.ObjectId(req.user.id) : undefined,
        tenantId: req.user?.tenantId ? new Types.ObjectId(req.user.tenantId) : undefined,
        impersonatedBy: req.user?.impersonatedBy ? new Types.ObjectId(req.user.impersonatedBy) : undefined,
        statusCode: res.statusCode,
        details: {
          method: req.method,
          url,
          body: redact(req.body),
          params: req.params,
          locationId: req.locationId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch((err) => {
        logger.error(err, 'Failed to create audit log');
      });
    });
    next();
  };
};

export default auditLogger;
