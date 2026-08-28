import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.route';
import { UserRoutes } from '../modules/user/user.route';
import { TenantRoutes } from '../modules/tenant/tenant.route';
import { LocationRoutes } from '../modules/location/location.route';
import { RoomCategoryRoutes } from '../modules/hospitality/roomCategory/roomCategory.route';
import { RoomRoutes } from '../modules/hospitality/room/room.route';
import { GuestRoutes } from '../modules/hospitality/guest/guest.route';
import { ReservationRoutes } from '../modules/hospitality/reservation/reservation.route';
import { MenuCategoryRoutes } from '../modules/restaurant/menuCategory/menuCategory.route';
import { MenuItemRoutes } from '../modules/restaurant/menuItem/menuItem.route';
import { TableRoutes } from '../modules/restaurant/table/table.route';
import { OrderRoutes } from '../modules/restaurant/order/order.route';

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
  {
    path: '/restaurant/menu-category',
    route: MenuCategoryRoutes,
  },
  {
    path: '/restaurant/menu-item',
    route: MenuItemRoutes,
  },
  {
    path: '/restaurant/table',
    route: TableRoutes,
  },
  {
    path: '/restaurant/order',
    route: OrderRoutes,
  },
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
