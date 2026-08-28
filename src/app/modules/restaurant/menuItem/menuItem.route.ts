import express from 'express';
import { MenuItemControllers } from './menuItem.controller';
import validateRequest from '../../../middlewares/validateRequest';
import { MenuItemValidation } from './menuItem.validation';
import auth from '../../../middlewares/auth';
import { USER_ROLE } from '../../user/user.constant';

const router = express.Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(MenuItemValidation.createMenuItemValidationSchema),
  MenuItemControllers.createMenuItem,
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  MenuItemControllers.getAllMenuItems,
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  MenuItemControllers.getMenuItemById,
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(MenuItemValidation.updateMenuItemValidationSchema),
  MenuItemControllers.updateMenuItem,
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  MenuItemControllers.deleteMenuItem,
);

export const MenuItemRoutes = router;
