import { Types } from 'mongoose';
import { Payment } from './payment.model';
import { Tenant } from '../tenant/tenant.model';
import { requestContext } from '../../utils/requestContext';

// Charges to a room made while a POS was offline are accepted on sync (the food is
// already served), but going over the tenant's offline limit raises a manager alert.
const checkRoomCharge = async (folioId: Types.ObjectId, amountMinor: number, roomNumber?: string) => {
  const tenantId = requestContext.get()?.tenantId;
  if (!tenantId) return true;
  const tenant = await requestContext.asSystem(() => Tenant.findById(tenantId).select('settings.offlineRoomChargeLimitMinor').lean());
  const limit = tenant?.settings?.offlineRoomChargeLimitMinor ?? 0;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const previous = await Payment.aggregate([
    { $match: { 'folioPosting.folioId': folioId, offline: true, createdAt: { $gte: since }, status: 'COMPLETED' } },
    { $group: { _id: null, total: { $sum: { $add: ['$amountMinor', '$tipMinor'] } } } },
  ]);
  const total = (previous[0]?.total || 0) + amountMinor;
  if (limit && total > limit) {
    const { AlertService } = await import('../alert/alert.service');
    await AlertService.raise({
      type: 'OFFLINE_ROOM_CHARGE_LIMIT',
      severity: 'HIGH',
      title: `Offline room charges over limit${roomNumber ? ` (room ${roomNumber})` : ''}`,
      message: `${total} charged to the room while offline; limit is ${limit}. Check the guest's credit.`,
      dedupeKey: `offline-limit:${folioId}`,
      ref: { kind: 'Folio', id: folioId },
    });
    return false;
  }
  return true;
};

export const OfflineLimits = { checkRoomCharge };
