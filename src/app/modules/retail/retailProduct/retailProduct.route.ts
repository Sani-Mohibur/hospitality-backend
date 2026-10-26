import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailProductController } from './retailProduct.controller';
import { RetailProductValidations } from './retailProduct.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

router.get(
  '/',
  authorize(P.RETAIL_CATALOGUE_VIEW),
  locationScope({ required: false }),
  RetailProductController.getAllProducts,
);

router.get(
  '/barcode/:barcode',
  authorize(P.RETAIL_CATALOGUE_VIEW),
  RetailProductController.getProductByBarcode,
);

router.get(
  '/sku/:sku',
  authorize(P.RETAIL_CATALOGUE_VIEW),
  RetailProductController.getProductBySku,
);

router.get(
  '/:id/inventory-status',
  authorize(P.RETAIL_CATALOGUE_VIEW),
  locationScope({ required: false }),
  RetailProductController.getProductInventoryStatus,
);

router.get(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_VIEW),
  RetailProductController.getProductById,
);

router.post(
  '/',
  authorize(P.RETAIL_CATALOGUE_MANAGE),
  validateRequest(RetailProductValidations.createProductZodSchema),
  RetailProductController.createProduct,
);

router.patch(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_MANAGE),
  validateRequest(RetailProductValidations.updateProductZodSchema),
  RetailProductController.updateProduct,
);

router.delete(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_MANAGE),
  RetailProductController.deleteProduct,
);

export const RetailProductRoutes = router;
