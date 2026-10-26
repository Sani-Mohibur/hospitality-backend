import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { ILocation } from './location.interface';
import { Location } from './location.model';
import { localDate } from '../../utils/businessDate';
import { SubscriptionServices } from '../subscription/subscription.service';
import { activity } from '../auditLog/auditLog.service';
import { Outlet, Station } from '../outlet/outlet.model';
import { found } from '../../utils/query';

type TLocationInput = Partial<Omit<ILocation, 'businessDate' | 'tenantId'>>;

const createLocation = async (tenantId: string, payload: TLocationInput) => {
  const timezone = payload.timezone || 'UTC';
  const branchType = payload.branchType;
  let hasRooms = payload.hasRooms;
  if (branchType === 'HOSPITALITY') {
    hasRooms = true;
  } else if (branchType === 'RESTAURANT') {
    hasRooms = false;
  }

  const result = await Location.create({
    ...payload,
    branchType,
    hasRooms: hasRooms ?? false,
    tenantId,
    timezone,
    businessDate: localDate(timezone),
  });

  if (branchType === 'RESTAURANT') {
    const existingOutlet = await Outlet.findOne({ tenantId, locationId: result._id });
    if (!existingOutlet) {
      const [outlet] = await Outlet.create([{ tenantId, locationId: result._id, name: 'Restaurant' }]);
      const [station] = await Station.create([
        { tenantId, locationId: result._id, outletId: outlet!._id, name: 'Kitchen', type: 'KITCHEN' },
      ]);
      outlet!.defaultStationId = station!._id;
      await outlet!.save();
    }
  }

  await activity.record({ action: 'LOCATION_CREATED', entity: 'Location', entityId: result._id, message: `Added location ${result.name}` });
  await SubscriptionServices.recalculate(tenantId);
  return result;
};

const getAllLocations = async (tenantId?: string, filter: Record<string, unknown> = {}) => {
  const query: Record<string, unknown> = {};
  if (tenantId) query.tenantId = tenantId;
  if (filter.locationId) query._id = filter.locationId;
  const result = await Location.find(query).sort({ name: 1 });
  return result;
};

const getLocationById = async (id: string, tenantId?: string) => {
  const query: Record<string, unknown> = { _id: id };
  if (tenantId) query.tenantId = tenantId;
  return found(await Location.findOne(query), 'Location');
};

// The business date is owned by the night audit and cannot be edited here.
const updateLocation = async (tenantId: string, id: string, payload: TLocationInput) => {
  const location = found(await Location.findOne({ _id: id, tenantId }), 'Location');
  const before = location.toObject();
  if (payload.publicBooking?.slug) {
    const taken = await Location.exists({ 'publicBooking.slug': payload.publicBooking.slug, _id: { $ne: id } });
    if (taken) throw new AppError(httpStatus.CONFLICT, 'That booking page address is taken');
  }
  const { nightAudit, publicBooking, coordinates, ...rest } = payload;
  Object.assign(location, rest);
  if (payload.branchType) {
    location.branchType = payload.branchType;
    if (payload.branchType === 'HOSPITALITY') {
      location.hasRooms = true;
    } else if (payload.branchType === 'RESTAURANT') {
      location.hasRooms = false;
    }
  }
  if (nightAudit) Object.assign(location.nightAudit, nightAudit);
  if (publicBooking) Object.assign(location.publicBooking, publicBooking);
  if (coordinates) location.coordinates = { ...location.coordinates, ...coordinates };
  if (payload.mapUrl !== undefined) location.mapUrl = payload.mapUrl;
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
    await Location.findOneAndUpdate({ _id: id, tenantId }, { isDeleted: true, isActive: false }, { returnDocument: 'after' }),
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
