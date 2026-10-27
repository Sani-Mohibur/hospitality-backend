import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailSaleController } from './retailSale.controller';
import { RetailSaleValidations } from './retailSale.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

// Fast product search for POS by name, SKU, or barcode
router.get(
  '/products/search',
  authorize(P.RETAIL_ORDERS_VIEW, P.RETAIL_CATALOGUE_VIEW),
  locationScope({ required: false }),
  validateRequest(RetailSaleValidations.posProductSearchZodSchema),
  RetailSaleController.posProductSearch,
);

// Single product price & stock check
router.get(
  '/products/price-check',
  authorize(P.RETAIL_ORDERS_VIEW, P.RETAIL_CATALOGUE_VIEW),
  locationScope({ required: false }),
  validateRequest(RetailSaleValidations.posPriceCheckZodSchema),
  RetailSaleController.posPriceCheck,
);

// Customer / guest search for loyalty and room charges
router.get(
  '/customers',
  authorize(P.RETAIL_ORDERS_VIEW, P.GUESTS_VIEW),
  RetailSaleController.searchCustomers,
);

// Customer loyalty wallet balance & tier
router.get(
  '/customers/:guestId/loyalty',
  authorize(P.RETAIL_ORDERS_VIEW, P.GUESTS_VIEW),
  RetailSaleController.getCustomerLoyalty,
);

// Live cart pricing & tax calculation
router.post(
  '/cart/calculate',
  authorize(P.RETAIL_ORDERS_VIEW, P.RETAIL_ORDERS_MANAGE),
  validateRequest(RetailSaleValidations.calculateCartZodSchema),
  RetailSaleController.calculateCart,
);

// Checkout and complete sale
router.post(
  '/checkout',
  authorize(P.RETAIL_ORDERS_MANAGE),
  validateRequest(RetailSaleValidations.checkoutZodSchema),
  RetailSaleController.checkout,
);

export const RetailPosRoutes = router;
