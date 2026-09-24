import { Types } from 'mongoose';
import { TSocketAuthorizer } from '../../utils/socket';
import { requestContext } from '../../utils/requestContext';
import { rooms } from '../../utils/realtime';
import { authenticate } from '../../middlewares/auth';
import { Location } from '../location/location.model';
import { Outlet, Station } from '../outlet/outlet.model';
import { PERMISSION, USER_ROLE } from '../user/user.constant';

const canSeeLocation = (user: { allLocations: boolean; locationIds: string[] }, locationId: string) =>
  user.allLocations || user.locationIds.includes(locationId);

export const socketAuthorizer: TSocketAuthorizer = {
  authenticate: async (token: string) => {
    const user = await authenticate({ headers: { authorization: `Bearer ${token}` } } as any);
    return user;
  },

  defaultRooms: (user) => {
    const list = [rooms.user(user.id)];
    if (user.tenantId && (user.role === USER_ROLE.TENANT_OWNER || user.role === USER_ROLE.TENANT_MANAGER)) {
      list.push(rooms.tenant(user.tenantId));
    }
    return list;
  },

  canJoin: async (user, room) => {
    const [kind, id] = room.split(':');
    if (!id || !Types.ObjectId.isValid(id) || !user.tenantId) return false;
    return requestContext.asTenant(user.tenantId, async () => {
      switch (kind) {
        case 'user':
          return id === user.id;
        case 'tenant':
          return id === user.tenantId && user.role !== USER_ROLE.STAFF;
        case 'location':
        case 'housekeeping': {
          const exists = await Location.exists({ _id: id });
          return Boolean(exists) && canSeeLocation(user, id);
        }
        case 'managers': {
          const exists = await Location.exists({ _id: id });
          return Boolean(exists) && canSeeLocation(user, id) && user.permissions.includes(PERMISSION.APPROVALS_GRANT);
        }
        case 'outlet': {
          const outlet = await Outlet.findById(id).select('locationId').lean();
          return Boolean(outlet) && canSeeLocation(user, String(outlet!.locationId));
        }
        case 'station': {
          const station = await Station.findById(id).select('locationId').lean();
          return Boolean(station) && canSeeLocation(user, String(station!.locationId));
        }
        default:
          return false;
      }
    });
  },
};
