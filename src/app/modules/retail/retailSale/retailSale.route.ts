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

// Returns list & detail (placed above /:id to avoid route shadowing)
router.get(
  '/returns',
  authorize(P.RETAIL_ORDERS_VIEW, P.REPORTS_VIEW),
  locationScope({ required: false }),
  RetailSaleController.getAllReturns,
);

router.get(
  '/returns/:id',
  authorize(P.RETAIL_ORDERS_VIEW, P.REPORTS_VIEW),
  RetailSaleController.getReturnById,
);

// Sales list
router.get(
  '/',
  authorize(P.RETAIL_ORDERS_VIEW, P.REPORTS_VIEW),
  locationScope({ required: false }),
  RetailSaleController.getAllSales,
);

// Sale detail & receipt
router.get(
  '/:id',
  authorize(P.RETAIL_ORDERS_VIEW, P.REPORTS_VIEW),
  RetailSaleController.getSaleById,
);

router.get(
  '/:id/receipt',
  authorize(P.RETAIL_ORDERS_VIEW, P.REPORTS_VIEW),
  RetailSaleController.getSaleReceipt,
);

// Process return / refund for a sale
router.post(
  '/:id/returns',
  authorize(P.RETAIL_ORDERS_MANAGE),
  validateRequest(RetailSaleValidations.processReturnZodSchema),
  RetailSaleController.processReturn,
);

export const RetailSaleRoutes = router;
