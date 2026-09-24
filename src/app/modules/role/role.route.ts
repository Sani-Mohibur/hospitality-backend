import { Router } from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { tenantUser, authorize } from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { ALL_PERMISSIONS, PERMISSION } from '../user/user.constant';
import { RoleServices } from './role.service';

const router = Router();

const permissionList = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]]));

router.get(
  '/',
  tenantUser(),
  authorize(PERMISSION.ROLES_MANAGE, PERMISSION.STAFF_MANAGE),
  catchAsync(async (_req, res) => {
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Roles retrieved', data: await RoleServices.listRoles() });
  }),
);

router.get(
  '/permissions',
  tenantUser(),
  authorize(PERMISSION.ROLES_MANAGE),
  catchAsync(async (_req, res) => {
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Permissions retrieved', data: ALL_PERMISSIONS });
  }),
);

router.post(
  '/',
  tenantUser(),
  authorize(PERMISSION.ROLES_MANAGE),
  validateRequest(z.object({ body: z.object({ name: z.string().min(1), description: z.string().optional(), permissions: permissionList }) })),
  catchAsync(async (req, res) => {
    sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Role created', data: await RoleServices.createRole(req.body) });
  }),
);

router.post(
  '/:id/clone',
  tenantUser(),
  authorize(PERMISSION.ROLES_MANAGE),
  validateRequest(z.object({ body: z.object({ name: z.string().min(1) }) })),
  catchAsync(async (req, res) => {
    const data = await RoleServices.cloneRole(req.params.id as string, req.body.name);
    sendResponse(res, { statusCode: httpStatus.CREATED, success: true, message: 'Role cloned', data });
  }),
);

router.patch(
  '/:id',
  tenantUser(),
  authorize(PERMISSION.ROLES_MANAGE),
  validateRequest(
    z.object({ body: z.object({ name: z.string().min(1).optional(), description: z.string().optional(), permissions: permissionList.optional() }) }),
  ),
  catchAsync(async (req, res) => {
    const data = await RoleServices.updateRole(req.params.id as string, req.body);
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Role updated', data });
  }),
);

router.delete(
  '/:id',
  tenantUser(),
  authorize(PERMISSION.ROLES_MANAGE),
  catchAsync(async (req, res) => {
    const data = await RoleServices.deleteRole(req.params.id as string);
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message: 'Role deleted', data });
  }),
);

export const RoleRoutes = router;
