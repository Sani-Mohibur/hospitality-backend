import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailPurchaseOrderController } from './retailPurchaseOrder.controller';
import { RetailPurchaseOrderValidations } from './retailPurchaseOrder.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

router.get(
  '/',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  locationScope({ required: false }),
  RetailPurchaseOrderController.getAllPurchaseOrders,
);

router.get(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  RetailPurchaseOrderController.getPurchaseOrderById,
);

router.post(
  '/',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  locationScope({ required: false }),
  validateRequest(RetailPurchaseOrderValidations.createPurchaseOrderZodSchema),
  RetailPurchaseOrderController.createPurchaseOrder,
);

router.patch(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailPurchaseOrderValidations.updatePurchaseOrderZodSchema),
  RetailPurchaseOrderController.updatePurchaseOrder,
);

router.post(
  '/:id/send',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  RetailPurchaseOrderController.sendPurchaseOrder,
);

router.post(
  '/:id/receive',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_RECEIVE, P.INVENTORY_MANAGE),
  validateRequest(RetailPurchaseOrderValidations.receiveGoodsZodSchema),
  RetailPurchaseOrderController.receiveGoods,
);

router.post(
  '/:id/cancel',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  RetailPurchaseOrderController.cancelPurchaseOrder,
);

export const RetailPurchaseOrderRoutes = router;
