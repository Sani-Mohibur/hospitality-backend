import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailStocktakeController } from './retailStocktake.controller';
import { RetailStocktakeValidations } from './retailStocktake.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

router.get(
  '/',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  locationScope({ required: false }),
  RetailStocktakeController.getAllStocktakes,
);

router.get(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  RetailStocktakeController.getStocktakeById,
);

router.post(
  '/',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  locationScope({ required: false }),
  validateRequest(RetailStocktakeValidations.startStocktakeZodSchema),
  RetailStocktakeController.startStocktake,
);

router.post(
  '/:id/counts',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailStocktakeValidations.recordCountsZodSchema),
  RetailStocktakeController.recordCounts,
);

router.post(
  '/:id/post',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailStocktakeValidations.postStocktakeZodSchema),
  RetailStocktakeController.reconcileAndPost,
);

router.post(
  '/:id/cancel',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  RetailStocktakeController.cancelStocktake,
);

export const RetailStocktakeRoutes = router;
