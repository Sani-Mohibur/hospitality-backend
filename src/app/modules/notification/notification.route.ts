import express from 'express';
import { NotificationController } from './notification.controller';
import { tenantUser } from '../../middlewares/auth';

const router = express.Router();

router.get('/', tenantUser(), NotificationController.getMyNotifications);
router.patch('/read-all', tenantUser(), NotificationController.markAllRead);
router.patch('/:id/read', tenantUser(), NotificationController.markAsRead);

export const NotificationRoutes = router;
