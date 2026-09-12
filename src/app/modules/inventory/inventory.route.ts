import express from 'express';
import { InventoryControllers } from './inventory.controller';
import { InventoryValidation } from './inventory.validation';
import validateRequest from '../../middlewares/validateRequest';
import auth from '../../middlewares/auth';
import { USER_ROLE } from '../user/user.constant';
import auditLogger from '../../middlewares/auditLogger';

const router = express.Router();

router.use(auditLogger('Inventory'));

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(InventoryValidation.createInventoryValidationSchema),
  InventoryControllers.createItem,
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  InventoryControllers.getAllItems,
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  InventoryControllers.getItemById,
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  validateRequest(InventoryValidation.updateInventoryValidationSchema),
  InventoryControllers.updateItem,
);

router.patch(
  '/:id/adjust',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  validateRequest(InventoryValidation.adjustStockValidationSchema),
  InventoryControllers.adjustStock,
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  InventoryControllers.deleteItem,
);

export const InventoryRoutes = router;
