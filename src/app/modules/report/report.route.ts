import express from 'express';
import { ReportController } from './report.controller';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';

const router = express.Router();

router.get(
  '/hospitality-stats',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  ReportController.getHospitalityStats
);

router.get(
  '/restaurant-stats',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  ReportController.getRestaurantStats
);

export const ReportRoutes = router;
