import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { ILocation } from './location.interface';
import { Location } from './location.model';
import { localDate } from '../../utils/businessDate';
import { SubscriptionServices } from '../subscription/subscription.service';
import { activity } from '../auditLog/auditLog.service';
import { found } from '../../utils/query';

type TLocationInput = Partial<Omit<ILocation, 'businessDate' | 'tenantId'>>;

const createLocation = async (tenantId: string, payload: TLocationInput) => {
  const timezone = payload.timezone || 'UTC';
  const result = await Location.create({ ...payload, tenantId, timezone, businessDate: localDate(timezone) });
  await activity.record({ action: 'LOCATION_CREATED', entity: 'Location', entityId: result._id, message: `Added location ${result.name}` });
  await SubscriptionServices.recalculate(tenantId);
  return result;
};

const getAllLocations = async (filter: Record<string, unknown> = {}) => {
  const idFilter = filter.locationId ? { _id: filter.locationId } : {};
  const result = await Location.find(idFilter).sort({ name: 1 });
  return result;
};

const getLocationById = async (id: string) => found(await Location.findById(id), 'Location');

// The business date is owned by the night audit and cannot be edited here.
const updateLocation = async (id: string, payload: TLocationInput) => {
  const location = found(await Location.findById(id), 'Location');
  const before = location.toObject();
  if (payload.publicBooking?.slug) {
    const taken = await Location.exists({ 'publicBooking.slug': payload.publicBooking.slug, _id: { $ne: id } });
    if (taken) throw new AppError(httpStatus.CONFLICT, 'That booking page address is taken');
  }
  const { nightAudit, publicBooking, ...rest } = payload;
  Object.assign(location, rest);
  if (nightAudit) Object.assign(location.nightAudit, nightAudit);
  if (publicBooking) Object.assign(location.publicBooking, publicBooking);
  await location.save();
  await activity.record({
    action: 'LOCATION_UPDATED',
    entity: 'Location',
    entityId: location._id,
    message: `Updated location ${location.name}`,
    before,
    after: location.toObject(),
  });
  return location;
};

const deleteLocation = async (tenantId: string, id: string) => {
  const result = found(
    await Location.findByIdAndUpdate(id, { isDeleted: true, isActive: false }, { returnDocument: 'after' }),
    'Location',
  );
  await activity.record({ action: 'LOCATION_DELETED', entity: 'Location', entityId: result._id, message: `Closed location ${result.name}` });
  await SubscriptionServices.recalculate(tenantId);
  return result;
};

export const LocationServices = {
  createLocation,
  getAllLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
};
