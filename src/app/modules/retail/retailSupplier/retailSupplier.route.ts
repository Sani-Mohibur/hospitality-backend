import express from 'express';
import { authorize, tenantUser } from '../../../middlewares/auth';
import requireModule from '../../../middlewares/requireModule';
import validateRequest from '../../../middlewares/validateRequest';
import { PERMISSION } from '../../user/user.constant';
import { RetailSupplierController } from './retailSupplier.controller';
import { RetailSupplierValidations } from './retailSupplier.validation';

const router = express.Router();
const P = PERMISSION;

router.use(tenantUser(), requireModule('RETAIL'));

router.get(
  '/',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  RetailSupplierController.getAllSuppliers,
);

router.get(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_VIEW, P.INVENTORY_VIEW),
  RetailSupplierController.getSupplierById,
);

router.post(
  '/',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailSupplierValidations.createSupplierZodSchema),
  RetailSupplierController.createSupplier,
);

router.patch(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  validateRequest(RetailSupplierValidations.updateSupplierZodSchema),
  RetailSupplierController.updateSupplier,
);

router.delete(
  '/:id',
  authorize(P.RETAIL_CATALOGUE_MANAGE, P.INVENTORY_MANAGE),
  RetailSupplierController.deleteSupplier,
);

export const RetailSupplierRoutes = router;
