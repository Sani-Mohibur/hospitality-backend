import express from 'express';
import validateRequest from '../../../middlewares/validateRequest';
import { FolioValidation } from './folio.validation';
import { FolioControllers } from './folio.controller';
import auth from '../../../middlewares/auth';

const router = express.Router();

router.post(
  '/',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  validateRequest(FolioValidation.createFolioValidationSchema),
  FolioControllers.createFolio
);

router.get(
  '/',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  FolioControllers.getAllFolios
);

router.get(
  '/:id',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  FolioControllers.getFolioById
);

router.patch(
  '/:id',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER', 'FRONT_DESK'),
  validateRequest(FolioValidation.updateFolioValidationSchema),
  FolioControllers.updateFolio
);

router.delete(
  '/:id',
  auth('SUPER_ADMIN', 'TENANT_ADMIN', 'HOSPITALITY_MANAGER'),
  FolioControllers.deleteFolio
);

export const FolioRoutes = router;
