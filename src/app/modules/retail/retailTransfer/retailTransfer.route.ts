import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailTransferController } from './retailTransfer.controller';
import { RetailTransferValidations } from './retailTransfer.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

router.get(
  '/',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  locationScope({ required: false }),
  RetailTransferController.getAllTransfers,
);

router.get(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  RetailTransferController.getTransferById,
);

router.post(
  '/',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  locationScope({ required: false }),
  validateRequest(RetailTransferValidations.createTransferZodSchema),
  RetailTransferController.createTransfer,
);

router.post(
  '/direct',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  locationScope({ required: false }),
  validateRequest(RetailTransferValidations.directTransferZodSchema),
  RetailTransferController.directTransfer,
);

router.post(
  '/:id/dispatch',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  RetailTransferController.dispatchTransfer,
);

router.post(
  '/:id/receive',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_RECEIVE, P.INVENTORY_MANAGE),
  RetailTransferController.receiveTransfer,
);

router.post(
  '/:id/cancel',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailTransferValidations.cancelTransferZodSchema),
  RetailTransferController.cancelTransfer,
);

export const RetailTransferRoutes = router;
