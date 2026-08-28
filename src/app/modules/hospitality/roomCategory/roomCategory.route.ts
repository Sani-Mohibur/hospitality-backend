import { Router } from 'express';
import { RoomCategoryControllers } from './roomCategory.controller';
import validateRequest from '../../../middlewares/validateRequest';
import { RoomCategoryValidation } from './roomCategory.validation';
import auth from '../../../middlewares/auth';
import { USER_ROLE } from '../../user/user.constant';

const router = Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(RoomCategoryValidation.createRoomCategoryValidationSchema),
  RoomCategoryControllers.createRoomCategory,
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  RoomCategoryControllers.getAllRoomCategories
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  RoomCategoryControllers.getRoomCategoryById
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(RoomCategoryValidation.updateRoomCategoryValidationSchema),
  RoomCategoryControllers.updateRoomCategory,
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  RoomCategoryControllers.deleteRoomCategory
);

export const RoomCategoryRoutes = router;
