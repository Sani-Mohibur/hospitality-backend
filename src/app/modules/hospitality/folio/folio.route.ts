import express from 'express';
import validateRequest from '../../../middlewares/validateRequest';
import { FolioValidation } from './folio.validation';
import { FolioControllers } from './folio.controller';
import auth from '../../../middlewares/auth';
import { USER_ROLE } from '../../user/user.constant';

const router = express.Router();

router.post(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  validateRequest(FolioValidation.createFolioValidationSchema),
  FolioControllers.createFolio
);

router.get(
  '/',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  FolioControllers.getAllFolios
);

router.get(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  FolioControllers.getFolioById
);

router.patch(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER, USER_ROLE.STAFF),
  validateRequest(FolioValidation.updateFolioValidationSchema),
  FolioControllers.updateFolio
);

router.delete(
  '/:id',
  auth(USER_ROLE.SUPER_ADMIN, USER_ROLE.TENANT_OWNER, USER_ROLE.TENANT_MANAGER),
  FolioControllers.deleteFolio
);

export const FolioRoutes = router;
