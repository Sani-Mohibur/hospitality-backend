import express from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope, { locationFilter, requireLocationId } from '../../middlewares/locationScope';
import requireModule from '../../middlewares/requireModule';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import { PERMISSION } from '../user/user.constant';
import { InventoryServices } from './inventory.service';
import { PurchaseOrder, StockCount } from './inventory.model';
import { found } from '../../utils/query';
import { body, objectId, positiveMinor } from '../../utils/zod';

const router = express.Router();
const P = PERMISSION;

const itemFields = z.object({
  name: z.string().min(1),
  sku: z.string().min(1).max(40),
  category: z.string().optional(),
  unitOfMeasure: z.string().min(1),
  unitCost: positiveMinor.optional(),
  parLevel: z.number().min(0).optional(),
  reorderPoint: z.number().min(0).optional(),
  reorderQty: z.number().min(0).optional(),
  supplierId: objectId.optional(),
  isMinibar: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

router.use(tenantUser(), requireModule('INVENTORY'));

router.get(
  '/',
  authorize(P.INVENTORY_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => ok(res, 'Inventory items retrieved successfully', await InventoryServices.getAllItems(locationFilter(req), req.query))),
);

router.post(
  '/',
  authorize(P.INVENTORY_MANAGE),
  locationScope(),
  validateRequest(z.object({ body: itemFields.extend({ openingQuantity: z.number().min(0).optional() }) })),
  catchAsync(async (req, res) =>
    ok(res, 'Inventory item created successfully', await InventoryServices.createItem({ ...req.body, locationId: requireLocationId(req) }), { statusCode: httpStatus.CREATED }),
  ),
);

router.get(
  '/movements',
  authorize(P.INVENTORY_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const result = await InventoryServices.movements(locationFilter(req), req.query);
    ok(res, 'Stock movements', result.data, { meta: result.meta });
  }),
);

router.post(
  '/waste',
  authorize(P.INVENTORY_MANAGE, P.KDS_UPDATE),
  validateRequest(body({ stockItemId: objectId, quantity: z.number().positive(), reason: z.string().min(2) })),
  catchAsync(async (req, res) => ok(res, 'Waste logged', await InventoryServices.logWaste(req.body), { statusCode: httpStatus.CREATED })),
);

router.post(
  '/transfers',
  authorize(P.INVENTORY_MANAGE),
  validateRequest(body({ stockItemId: objectId, toLocationId: objectId, quantity: z.number().positive(), reason: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Stock transferred', await InventoryServices.transfer(req.body), { statusCode: httpStatus.CREATED })),
);

// ----- Recipes -----
router.get('/recipes/:menuItemId', authorize(P.INVENTORY_VIEW, P.MENU_MANAGE), catchAsync(async (req, res) => ok(res, 'Recipe', await InventoryServices.getRecipe(req.params.menuItemId as string))));

router.put(
  '/recipes/:menuItemId',
  authorize(P.INVENTORY_MANAGE, P.MENU_MANAGE),
  validateRequest(
    body({
      ingredients: z.array(z.object({ sku: z.string().min(1), quantity: z.number().min(0) })),
      modifierIngredients: z.array(z.object({ optionId: objectId, sku: z.string().min(1), quantity: z.number().min(0) })).optional(),
      yieldNote: z.string().optional(),
    }),
  ),
  catchAsync(async (req, res) => ok(res, 'Recipe saved', await InventoryServices.upsertRecipe(req.params.menuItemId as string, req.body))),
);

// ----- Suppliers -----
const supplierFields = z.object({ name: z.string().min(1), contactName: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(), leadTimeDays: z.number().int().min(0).optional(), notes: z.string().optional(), isActive: z.boolean().optional() });

router.get('/suppliers', authorize(P.INVENTORY_VIEW), catchAsync(async (_req, res) => ok(res, 'Suppliers', await InventoryServices.suppliers.list())));
router.post('/suppliers', authorize(P.INVENTORY_MANAGE), validateRequest(z.object({ body: supplierFields })), catchAsync(async (req, res) => ok(res, 'Supplier created', await InventoryServices.suppliers.create(req.body), { statusCode: httpStatus.CREATED })));
router.patch('/suppliers/:id', authorize(P.INVENTORY_MANAGE), validateRequest(z.object({ body: supplierFields.partial() })), catchAsync(async (req, res) => ok(res, 'Supplier updated', await InventoryServices.suppliers.update(req.params.id as string, req.body))));

// ----- Purchase orders -----
router.get(
  '/purchase-orders',
  authorize(P.INVENTORY_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => ok(res, 'Purchase orders', await PurchaseOrder.find({ ...locationFilter(req), ...(req.query.status ? { status: String(req.query.status) } : {}) } as any).populate('supplierId', 'name').sort({ createdAt: -1 }).lean())),
);

router.get('/purchase-orders/:id', authorize(P.INVENTORY_VIEW), catchAsync(async (req, res) => ok(res, 'Purchase order', found(await PurchaseOrder.findById(req.params.id).populate('supplierId lines.stockItemId').lean(), 'Purchase order'))));

router.post(
  '/purchase-orders',
  authorize(P.INVENTORY_MANAGE),
  locationScope(),
  validateRequest(body({ supplierId: objectId, lines: z.array(z.object({ stockItemId: objectId, quantity: z.number().positive(), unitCost: positiveMinor })).min(1), expectedAt: z.string().datetime().optional(), notes: z.string().optional() })),
  catchAsync(async (req, res) => ok(res, 'Purchase order created', await InventoryServices.createPurchaseOrder(requireLocationId(req), req.body), { statusCode: httpStatus.CREATED })),
);

router.post('/purchase-orders/:id/send', authorize(P.INVENTORY_MANAGE), catchAsync(async (req, res) => ok(res, 'Purchase order sent', await InventoryServices.sendPurchaseOrder(req.params.id as string))));

router.post(
  '/purchase-orders/:id/receive',
  authorize(P.INVENTORY_RECEIVE, P.INVENTORY_MANAGE),
  validateRequest(body({ lines: z.array(z.object({ stockItemId: objectId, quantity: z.number().positive(), unitCost: positiveMinor.optional() })).min(1) })),
  catchAsync(async (req, res) => ok(res, 'Goods received', await InventoryServices.receivePurchaseOrder(req.params.id as string, req.body.lines))),
);

router.get('/reorder-suggestions', authorize(P.INVENTORY_VIEW), locationScope(), catchAsync(async (req, res) => ok(res, 'Reorder suggestions', await InventoryServices.reorderSuggestions(requireLocationId(req)))));

// ----- Stock counts -----
router.get('/counts', authorize(P.INVENTORY_VIEW), locationScope({ required: false }), catchAsync(async (req, res) => ok(res, 'Stock counts', await StockCount.find(locationFilter(req)).sort({ createdAt: -1 }).limit(50).lean())));
router.post('/counts', authorize(P.INVENTORY_MANAGE), locationScope(), validateRequest(body({ category: z.string().optional() })), catchAsync(async (req, res) => ok(res, 'Stock count started', await InventoryServices.startCount(requireLocationId(req), req.body.category), { statusCode: httpStatus.CREATED })));
router.patch('/counts/:id', authorize(P.INVENTORY_MANAGE, P.INVENTORY_RECEIVE), validateRequest(body({ lines: z.array(z.object({ stockItemId: objectId, counted: z.number().min(0) })).min(1) })), catchAsync(async (req, res) => ok(res, 'Count saved', await InventoryServices.saveCount(req.params.id as string, req.body.lines))));
router.post('/counts/:id/post', authorize(P.INVENTORY_MANAGE), catchAsync(async (req, res) => ok(res, 'Stock count posted', await InventoryServices.postCount(req.params.id as string))));

// ----- Food cost -----
router.get(
  '/food-cost',
  authorize(P.REPORTS_VIEW, P.INVENTORY_MANAGE),
  locationScope(),
  catchAsync(async (req, res) => ok(res, 'Food cost', await InventoryServices.foodCost(requireLocationId(req), new Date(String(req.query.from)), new Date(String(req.query.to))))),
);

// ----- One item -----
router.get('/:id', authorize(P.INVENTORY_VIEW), catchAsync(async (req, res) => ok(res, 'Inventory item retrieved successfully', await InventoryServices.getItemById(req.params.id as string))));

router.patch('/:id', authorize(P.INVENTORY_MANAGE), validateRequest(z.object({ body: itemFields.partial() })), catchAsync(async (req, res) => ok(res, 'Inventory item updated successfully', await InventoryServices.updateItem(req.params.id as string, req.body))));

router.patch(
  '/:id/adjust',
  authorize(P.INVENTORY_MANAGE),
  validateRequest(body({ quantityChange: z.number().positive('Change amount must be a positive number'), type: z.enum(['ADD', 'SUBTRACT']), reason: z.string().min(2) })),
  catchAsync(async (req, res) => ok(res, 'Stock adjusted successfully', await InventoryServices.adjustStock(req.params.id as string, req.body))),
);

router.delete('/:id', authorize(P.INVENTORY_MANAGE), catchAsync(async (req, res) => ok(res, 'Inventory item deleted successfully', await InventoryServices.deleteItem(req.params.id as string))));

export const InventoryRoutes = router;
