import express from 'express';
import { MenuCategoryControllers } from './menuCategory.controller';
import validateRequest from '../../../middlewares/validateRequest';
import { MenuCategoryValidation } from './menuCategory.validation';
import auth from '../../../middlewares/auth';
import { USER_ROLE } from '../../user/user.constant';

const router = express.Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(MenuCategoryValidation.createMenuCategoryValidationSchema),
  MenuCategoryControllers.createMenuCategory,
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  MenuCategoryControllers.getAllMenuCategories,
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  MenuCategoryControllers.getMenuCategoryById,
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(MenuCategoryValidation.updateMenuCategoryValidationSchema),
  MenuCategoryControllers.updateMenuCategory,
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  MenuCategoryControllers.deleteMenuCategory,
);

export const MenuCategoryRoutes = router;
