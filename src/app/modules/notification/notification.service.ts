import { INotification } from './notification.interface';
import { Notification } from './notification.model';
import { socketManager } from '../../utils/socket';
import { sendEmail } from '../../utils/sendEmail';
import logger from '../../utils/logger';

const createAndSendNotification = async (payload: Partial<INotification>, userEmail?: string) => {
  const notification = await Notification.create(payload);

  try {
    if (payload.type === 'PUSH') {
      // Assuming socket rooms are user IDs
      socketManager.emitToRoom(payload.recipient!.toString(), 'new_notification', notification);
      notification.status = 'SENT';
    } else if (payload.type === 'EMAIL' && userEmail) {
      await sendEmail(userEmail, payload.message!, payload.title!);
      notification.status = 'SENT';
    }
    
    await notification.save();
  } catch (error) {
    logger.error(error, 'Failed to send notification');
    notification.status = 'FAILED';
    await notification.save();
  }

  return notification;
};

const getMyNotifications = async (userId: string, tenantId: string) => {
  return await Notification.find({ recipient: userId, tenant: tenantId })
    .sort({ createdAt: -1 })
    .limit(50);
};

const markAsRead = async (notificationId: string, userId: string) => {
  return await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { readAt: new Date() },
    { new: true }
  );
};

export const NotificationService = {
  createAndSendNotification,
  getMyNotifications,
  markAsRead,
};
