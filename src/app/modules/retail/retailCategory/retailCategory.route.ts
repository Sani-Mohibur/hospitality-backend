import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope from '../../../middlewares/locationScope';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailCategoryController } from './retailCategory.controller';
import { RetailCategoryValidations } from './retailCategory.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

router.get(
  '/',
  authorize(P.RETAIL_CATALOGUE_VIEW),
  locationScope({ required: false }),
  RetailCategoryController.getAllCategories,
);

router.get(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_VIEW),
  RetailCategoryController.getCategoryById,
);

router.post(
  '/',
  authorize(P.RETAIL_CATALOGUE_MANAGE),
  validateRequest(RetailCategoryValidations.createCategoryZodSchema),
  RetailCategoryController.createCategory,
);

router.patch(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_MANAGE),
  validateRequest(RetailCategoryValidations.updateCategoryZodSchema),
  RetailCategoryController.updateCategory,
);

router.delete(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_MANAGE),
  RetailCategoryController.deleteCategory,
);

export const RetailCategoryRoutes = router;
