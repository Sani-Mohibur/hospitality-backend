import express from 'express';
import validateRequest from '../../../middlewares/validateRequest';
import { FolioChargeValidation } from './folioCharge.validation';
import { FolioChargeControllers } from './folioCharge.controller';
import auth from '../../../middlewares/auth';
import { USER_ROLE } from '../../user/user.constant';

const router = express.Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  validateRequest(FolioChargeValidation.createFolioChargeValidationSchema),
  FolioChargeControllers.createFolioCharge
);

router.get(
  '/folio/:folioId',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  FolioChargeControllers.getChargesByFolio
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  FolioChargeControllers.getFolioChargeById
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  validateRequest(FolioChargeValidation.updateFolioChargeValidationSchema),
  FolioChargeControllers.updateFolioCharge
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  FolioChargeControllers.deleteFolioCharge
);

export const FolioChargeRoutes = router;
