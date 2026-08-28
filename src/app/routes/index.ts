import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.route';
import { UserRoutes } from '../modules/user/user.route';
import { TenantRoutes } from '../modules/tenant/tenant.route';
import { LocationRoutes } from '../modules/location/location.route';
import { RoomCategoryRoutes } from '../modules/hospitality/roomCategory/roomCategory.route';
import { RoomRoutes } from '../modules/hospitality/room/room.route';
import { GuestRoutes } from '../modules/hospitality/guest/guest.route';
import { ReservationRoutes } from '../modules/hospitality/reservation/reservation.route';

const router = Router();

const moduleRoutes = [
  {
    path: '/auth',
    route: AuthRoutes,
  },
  {
    path: '/user',
    route: UserRoutes,
  },
  {
    path: '/tenant',
    route: TenantRoutes,
  },
  {
    path: '/location',
    route: LocationRoutes,
  },
  {
    path: '/room-category',
    route: RoomCategoryRoutes,
  },
  {
    path: '/room',
    route: RoomRoutes,
  },
  {
    path: '/guest',
    route: GuestRoutes,
  },
  {
    path: '/reservation',
    route: ReservationRoutes,
  },
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
