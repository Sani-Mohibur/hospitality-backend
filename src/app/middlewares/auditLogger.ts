import { Request, Response, NextFunction } from 'express';
import { AuditLogService } from '../modules/auditLog/auditLog.service';
import logger from '../utils/logger';

const auditLogger = (entity: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const action = req.method === 'POST' ? 'CREATE' : req.method === 'DELETE' ? 'DELETE' : 'UPDATE';
          
          const auditData = {
            action,
            entity,
            // @ts-ignore
            user: req.user?._id || req.user?.id,
            // @ts-ignore
            tenant: req.user?.tenant,
            details: {
              method: req.method,
              url: req.originalUrl,
              body: req.body,
              query: req.query,
              params: req.params,
            },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          };

          AuditLogService.createAuditLog(auditData).catch(err => {
            logger.error(err, 'Failed to create audit log');
          });
        }
      });
    }
    next();
  };
};

export default auditLogger;
