import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailInventoryController } from './retailInventory.controller';
import { RetailInventoryValidations } from './retailInventory.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

router.get(
  '/',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  locationScope({ required: false }),
  RetailInventoryController.getAllStockItems,
);

router.get(
  '/low-stock',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  locationScope(),
  RetailInventoryController.getLowStockItems,
);

router.get(
  '/movements',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  locationScope({ required: false }),
  RetailInventoryController.getStockMovements,
);

router.get(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  RetailInventoryController.getStockItemById,
);

router.post(
  '/initialize',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  locationScope({ required: false }),
  validateRequest(RetailInventoryValidations.initializeStockZodSchema),
  RetailInventoryController.initializeStock,
);

router.patch(
  '/:id/levels',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailInventoryValidations.updateStockLevelsZodSchema),
  RetailInventoryController.updateStockLevels,
);

router.post(
  '/adjust',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailInventoryValidations.adjustStockZodSchema),
  RetailInventoryController.adjustStock,
);

router.post(
  '/waste',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailInventoryValidations.logWasteZodSchema),
  RetailInventoryController.logWaste,
);

export const RetailInventoryRoutes = router;
