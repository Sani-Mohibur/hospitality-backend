import { Router } from 'express';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';
import { SuperAdminControllers } from './superAdmin.controller';

const router = Router();

router.get(
  '/stats',
  auth(USER_ROLE.SUPER_ADMIN),
  SuperAdminControllers.getPlatformStats
);

export const SuperAdminRoutes = router;
