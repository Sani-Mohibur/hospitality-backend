import express from 'express';
import validateRequest from '../../../middlewares/validateRequest';
import { FolioChargeValidation } from './folioCharge.validation';
import { FolioChargeControllers } from './folioCharge.controller';
import auth from '../../../middlewares/auth';

const router = express.Router();

router.post(
  '/',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  validateRequest(FolioChargeValidation.createFolioChargeValidationSchema),
  FolioChargeControllers.createFolioCharge
);

router.get(
  '/folio/:folioId',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  FolioChargeControllers.getChargesByFolio
);

router.get(
  '/:id',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  FolioChargeControllers.getFolioChargeById
);

router.patch(
  '/:id',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  validateRequest(FolioChargeValidation.updateFolioChargeValidationSchema),
  FolioChargeControllers.updateFolioCharge
);

router.delete(
  '/:id',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER'),
  FolioChargeControllers.deleteFolioCharge
);

export const FolioChargeRoutes = router;
