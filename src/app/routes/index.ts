import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.route';
import { UserRoutes } from '../modules/user/user.route';
import { TenantRoutes } from '../modules/tenant/tenant.route';
import { LocationRoutes } from '../modules/location/location.route';

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
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
