import { INotification } from './notification.interface';
import { Notification } from './notification.model';
import { publish, rooms } from '../../utils/realtime';
import { sendEmail } from '../../utils/sendEmail';
import { sendSms } from '../../utils/sms';
import logger from '../../utils/logger';

const createAndSendNotification = async (payload: Partial<INotification>, contact: { email?: string; phone?: string } = {}) => {
  const notification = await Notification.create(payload);

  try {
    if (payload.type === 'PUSH') {
      await publish({
        tenantId: payload.tenantId,
        rooms: [rooms.user(payload.recipient)],
        event: 'new_notification',
        data: notification.toObject(),
      });
      notification.status = 'SENT';
    } else if (payload.type === 'EMAIL' && contact.email) {
      await sendEmail(contact.email, payload.message!, payload.title!);
      notification.status = 'SENT';
    } else if (payload.type === 'SMS' && contact.phone) {
      await sendSms(contact.phone, `${payload.title}: ${payload.message}`);
      notification.status = 'SENT';
    } else {
      notification.status = 'FAILED';
    }

    await notification.save();
  } catch (error) {
    logger.error(error, 'Failed to send notification');
    notification.status = 'FAILED';
    await notification.save();
  }

  return notification;
};

const getMyNotifications = async (userId: string, query: Record<string, unknown> = {}) => {
  const filter: Record<string, unknown> = { recipient: userId, type: 'PUSH' };
  if (query.unread === 'true') filter.readAt = null;
  const [data, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ recipient: userId, type: 'PUSH', readAt: null }),
  ]);
  return { data, unread };
};

const markAsRead = async (notificationId: string, userId: string) => {
  return await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { readAt: new Date() },
    { returnDocument: 'after' }
  );
};

const markAllRead = async (userId: string) => Notification.updateMany({ recipient: userId, readAt: null }, { readAt: new Date() });

export const NotificationService = {
  createAndSendNotification,
  getMyNotifications,
  markAsRead,
  markAllRead,
};
