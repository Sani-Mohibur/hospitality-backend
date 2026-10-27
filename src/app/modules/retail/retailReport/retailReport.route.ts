import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailReportController } from './retailReport.controller';
import { RetailReportValidations } from './retailReport.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

// End-of-shift / daily Cash-up Z-Report
router.get(
  '/z-report',
  authorize(P.REPORTS_VIEW, P.RETAIL_ORDERS_VIEW, P.CASH_MANAGE),
  locationScope({ required: false }),
  validateRequest(RetailReportValidations.zReportZodSchema),
  RetailReportController.getZReport,
);

// Location sales revenue, AOV, transaction trends
router.get(
  '/summary',
  authorize(P.REPORTS_VIEW, P.RETAIL_ORDERS_VIEW),
  locationScope({ required: false }),
  validateRequest(RetailReportValidations.salesSummaryZodSchema),
  RetailReportController.getSalesSummary,
);

// Best-selling products by quantity or revenue
router.get(
  '/top-products',
  authorize(P.REPORTS_VIEW, P.RETAIL_ORDERS_VIEW),
  locationScope({ required: false }),
  validateRequest(RetailReportValidations.topProductsZodSchema),
  RetailReportController.getTopProducts,
);

// Revenue and items sold by retail category
router.get(
  '/category-breakdown',
  authorize(P.REPORTS_VIEW, P.RETAIL_ORDERS_VIEW),
  locationScope({ required: false }),
  validateRequest(RetailReportValidations.categoryBreakdownZodSchema),
  RetailReportController.getCategoryBreakdown,
);

export const RetailReportRoutes = router;
