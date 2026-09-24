import { Request } from 'express';
import { ALL_PERMISSIONS } from '../modules/user/user.constant';
import { requestContext } from './requestContext';

// A request-like object for work done without a signed-in user (booking engine,
// channel manager, aggregator webhooks, guest QR). It carries the tenant and location
// so services that expect `req` behave the same; approvals are not needed for it.
export const systemRequest = (tenantId: string, locationId?: string, label = 'system'): Request => {
  requestContext.set({ tenantId, locationId });
  return {
    user: {
      id: undefined as unknown as string,
      role: 'STAFF',
      name: label,
      tenantId,
      permissions: [...ALL_PERMISSIONS],
      locationIds: locationId ? [locationId] : [],
      allLocations: !locationId,
    },
    locationId,
    headers: {},
    ip: undefined,
  } as unknown as Request;
};
