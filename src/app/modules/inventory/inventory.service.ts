import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../errors/AppError';
import { IInventoryItem, TMovementType } from './inventory.interface';
import { InventoryItem, PurchaseOrder, Recipe, StockCount, StockMovement, Supplier } from './inventory.model';
import { Order } from '../restaurant/order/order.model';
import { ITEM_STATUS } from '../restaurant/order/order.interface';
import { Location } from '../location/location.model';
import { nextSequence } from '../system/counter.model';
import { activity } from '../auditLog/auditLog.service';
import { runInTransaction } from '../../utils/transaction';
import { requestContext } from '../../utils/requestContext';
import { onDomainEvent } from '../../utils/domainEvents';
import { found, metaOf, paginationOf } from '../../utils/query';
import logger from '../../utils/logger';

import { Request } from 'express';
import { canAccessLocation } from '../../middlewares/locationScope';

type TId = Types.ObjectId | string;

// ---------- Items ----------
const createItem = async (payload: Partial<IInventoryItem> & { openingQuantity?: number }) => {
  const { openingQuantity, ...rest } = payload;
  return runInTransaction(async () => {
    const [item] = await InventoryItem.create([{ ...rest, quantity: 0 }]);
    if (!item) throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create inventory item');
    if (openingQuantity) {
      await recordMovement({ stockItemId: item._id, type: 'OPENING', quantity: openingQuantity, unitCost: rest.unitCost, reason: 'Opening stock' });
    }
    return InventoryItem.findById(item._id).lean();
  });
};

const getAllItems = async (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const where: Record<string, unknown> = { ...filter };
  if (query.category) where.category = query.category;
  if (query.lowStock === 'true') where.$expr = { $lte: ['$quantity', { $ifNull: ['$reorderPoint', -1] }] };
  if (query.minibar === 'true') where.isMinibar = true;
  return InventoryItem.find(where).populate('supplierId', 'name').sort({ category: 1, name: 1 }).lean();
};

const getItemById = async (req: Request, id: string) => {
  const item = found(await InventoryItem.findById(id).populate('supplierId', 'name').lean(), 'Inventory item');
  if (!canAccessLocation(req, item.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
  }
  const movements = await StockMovement.find({ stockItemId: id }).sort({ createdAt: -1 }).limit(50).lean();
  return { ...item, movements };
};

// Quantity is intentionally not editable here: use a movement (receipt, waste, count...).
const updateItem = async (req: Request, id: string, payload: Partial<IInventoryItem>) => {
  const existing = found(await InventoryItem.findById(id), 'Inventory item');
  if (!canAccessLocation(req, existing.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
  }
  const { quantity: _ignored, ...rest } = payload as any;
  return found(await InventoryItem.findByIdAndUpdate(id, rest, { returnDocument: 'after', runValidators: true }), 'Inventory item');
};

const deleteItem = async (req: Request, id: string) => {
  const existing = found(await InventoryItem.findById(id), 'Inventory item');
  if (!canAccessLocation(req, existing.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
  }
  return found(await InventoryItem.findByIdAndUpdate(id, { isDeleted: true, isActive: false }, { returnDocument: 'after' }), 'Inventory item');
};

// ---------- Movement ledger ----------
type TMovementInput = {
  stockItemId: TId;
  type: TMovementType;
  quantity: number;
  unitCost?: number;
  reason?: string;
  ref?: { kind: string; id: string };
};

// The only way stock changes. Receipts update the moving-average cost. Sales may take
// stock below zero (the food was served); a low-stock alert follows.
export const recordMovement = async (input: TMovementInput) => {
  if (!input.quantity) return undefined;
  const item = found(await InventoryItem.findById(input.stockItemId), 'Inventory item');
  const allowNegative = ['SALE', 'MINIBAR'].includes(input.type);
  if (!allowNegative && input.quantity < 0 && item.quantity + input.quantity < 0) {
    throw new AppError(httpStatus.BAD_REQUEST, `Only ${item.quantity} ${item.unitOfMeasure} of ${item.name} in stock`);
  }
  let unitCost = item.unitCost;
  if ((input.type === 'RECEIPT' || input.type === 'OPENING' || input.type === 'TRANSFER_IN') && input.quantity > 0 && input.unitCost !== undefined) {
    const onHand = Math.max(item.quantity, 0);
    unitCost = onHand + input.quantity > 0 ? Math.round((onHand * item.unitCost + input.quantity * input.unitCost) / (onHand + input.quantity)) : input.unitCost;
  }
  const updated = await InventoryItem.findOneAndUpdate(
    { _id: item._id },
    { $inc: { quantity: input.quantity }, $set: { unitCost } },
    { returnDocument: 'after' },
  );
  const [movement] = await StockMovement.create([
    {
      locationId: item.locationId,
      stockItemId: item._id,
      type: input.type,
      quantity: input.quantity,
      unitCost: input.unitCost ?? item.unitCost,
      quantityAfter: updated ? updated.quantity : item.quantity + input.quantity,
      reason: input.reason,
      ref: input.ref,
      createdBy: requestContext.get()?.userId,
    },
  ]);
  return movement;
};

const adjustStock = async (req: Request, id: string, payload: { quantityChange: number; type: 'ADD' | 'SUBTRACT'; reason: string }) =>
  runInTransaction(async () => {
    const item = found(await InventoryItem.findById(id), 'Inventory item');
    if (!canAccessLocation(req, item.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
    }
    const signed = payload.type === 'ADD' ? payload.quantityChange : -payload.quantityChange;
    await recordMovement({ stockItemId: id, type: 'ADJUSTMENT', quantity: signed, reason: payload.reason });
    const updated = await InventoryItem.findById(id).lean();
    await activity.record({ action: 'STOCK_ADJUSTED', entity: 'InventoryItem', entityId: id, message: `Adjusted ${updated?.name} by ${signed}: ${payload.reason}` });
    return updated;
  });

const logWaste = async (req: Request, payload: { stockItemId: string; quantity: number; reason: string }) =>
  runInTransaction(async () => {
    const item = found(await InventoryItem.findById(payload.stockItemId), 'Inventory item');
    if (!canAccessLocation(req, item.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
    }
    const movement = await recordMovement({ stockItemId: payload.stockItemId, type: 'WASTE', quantity: -Math.abs(payload.quantity), reason: payload.reason });
    await activity.record({ action: 'WASTE', entity: 'InventoryItem', entityId: payload.stockItemId, message: `Waste ${payload.quantity}: ${payload.reason}` });
    return movement;
  });

// Moves stock between two locations of the tenant (same SKU at both ends).
const transfer = async (req: Request, payload: { stockItemId: string; toLocationId: string; quantity: number; reason?: string }) =>
  runInTransaction(async () => {
    const from = found(await InventoryItem.findById(payload.stockItemId), 'Inventory item');
    if (!canAccessLocation(req, from.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to the source location');
    }
    if (!canAccessLocation(req, payload.toLocationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to the destination location');
    }
    if (String(from.locationId) === payload.toLocationId) throw new AppError(httpStatus.BAD_REQUEST, 'Choose another location');
    found(await Location.findById(payload.toLocationId).lean(), 'Location');
    let to = await InventoryItem.findOne({ locationId: payload.toLocationId, sku: from.sku });
    if (!to) {
      const [created] = await InventoryItem.create([
        { name: from.name, sku: from.sku, category: from.category, unitOfMeasure: from.unitOfMeasure, unitCost: from.unitCost, locationId: new Types.ObjectId(payload.toLocationId), quantity: 0 },
      ]);
      if (!created) throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create destination inventory item');
      to = created;
    }
    const ref = { kind: 'Transfer', id: new Types.ObjectId().toHexString() };
    await recordMovement({ stockItemId: from._id, type: 'TRANSFER_OUT', quantity: -payload.quantity, reason: payload.reason, ref });
    await recordMovement({ stockItemId: to._id, type: 'TRANSFER_IN', quantity: payload.quantity, unitCost: from.unitCost, reason: payload.reason, ref });
    return { from: from._id, to: to._id, quantity: payload.quantity };
  });

const movements = async (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const { page, limit, skip } = paginationOf(query, 50);
  const where: Record<string, unknown> = { ...filter };
  if (query.type) where.type = query.type;
  if (query.stockItemId) where.stockItemId = query.stockItemId;
  const [data, total] = await Promise.all([
    StockMovement.find(where).populate('stockItemId', 'name sku unitOfMeasure').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StockMovement.countDocuments(where),
  ]);
  return { data, meta: metaOf(page, limit, total) };
};

// ---------- Recipes and automatic depletion ----------
const upsertRecipe = async (menuItemId: string, payload: { ingredients: { sku: string; quantity: number }[]; modifierIngredients?: { optionId: string; sku: string; quantity: number }[]; yieldNote?: string }) =>
  Recipe.findOneAndUpdate({ menuItemId }, { $set: { ...payload, menuItemId } }, { upsert: true, returnDocument: 'after', runValidators: true });

const getRecipe = async (menuItemId: string) => Recipe.findOne({ menuItemId }).lean();

// Stock one order item uses, per SKU (item recipe x quantity + chosen modifiers).
const usageOf = (recipe: any, item: { quantity: number; modifiers: { optionId?: Types.ObjectId; quantity?: number }[] }) => {
  const usage = new Map<string, number>();
  for (const ing of recipe.ingredients || []) usage.set(ing.sku, (usage.get(ing.sku) || 0) + ing.quantity * item.quantity);
  for (const mod of item.modifiers || []) {
    for (const ing of (recipe.modifierIngredients || []).filter((m: any) => String(m.optionId) === String(mod.optionId))) {
      usage.set(ing.sku, (usage.get(ing.sku) || 0) + ing.quantity * (mod.quantity || 1) * item.quantity);
    }
  }
  return usage;
};

const applyOrderItems = async (orderId: string, itemIds: string[], direction: 1 | -1, type: TMovementType) => {
  const order = await Order.findById(orderId).lean();
  if (!order) return;
  const items = order.items.filter((i) => itemIds.includes(String(i._id)));
  const recipes = await Recipe.find({ menuItemId: { $in: items.map((i) => i.menuItemId) } }).lean();
  const byMenuItem = new Map(recipes.map((r) => [String(r.menuItemId), r]));
  const totals = new Map<string, number>();
  for (const item of items) {
    const recipe = byMenuItem.get(String(item.menuItemId));
    if (!recipe) continue;
    for (const [sku, qty] of usageOf(recipe, item)) totals.set(sku, (totals.get(sku) || 0) + qty);
  }
  if (!totals.size) return;
  await runInTransaction(async () => {
    for (const [sku, qty] of totals) {
      const stock = await InventoryItem.findOne({ locationId: order.locationId, sku }).lean();
      if (!stock) {
        logger.warn({ sku, orderId }, 'Recipe SKU has no stock item at this location');
        continue;
      }
      await recordMovement({ stockItemId: stock._id, type, quantity: direction * qty, reason: `Order ${order.orderNumber}`, ref: { kind: 'Order', id: orderId } });
    }
  });
};

// Fired items take their ingredients out of stock; voided items that were not
// wasted go back in.
onDomainEvent('order.itemsFired', async ({ orderId, itemIds }) => {
  await applyOrderItems(orderId, itemIds, -1, 'SALE');
});
onDomainEvent('order.itemsVoided', async ({ orderId, itemIds, waste }) => {
  if (!waste) await applyOrderItems(orderId, itemIds, 1, 'SALE_REVERSAL');
});

// ---------- Suppliers and purchase orders ----------
const suppliers = {
  list: () => Supplier.find().sort({ name: 1 }).lean(),
  create: (payload: Record<string, unknown>) => Supplier.create(payload),
  update: async (id: string, payload: Record<string, unknown>) =>
    found(await Supplier.findByIdAndUpdate(id, payload, { returnDocument: 'after', runValidators: true }), 'Supplier'),
};

const createPurchaseOrder = async (locationId: string, payload: { supplierId: string; lines: { stockItemId: string; quantity: number; unitCost: number }[]; expectedAt?: string; notes?: string }) => {
  found(await Supplier.findById(payload.supplierId).lean(), 'Supplier');
  const count = await InventoryItem.countDocuments({ _id: { $in: payload.lines.map((l) => l.stockItemId) }, locationId });
  if (count !== new Set(payload.lines.map((l) => l.stockItemId)).size) throw new AppError(httpStatus.BAD_REQUEST, 'Every line must be a stock item of this location');
  const seq = await nextSequence(`po:${requestContext.get()?.tenantId}`);
  return PurchaseOrder.create({ ...payload, locationId, number: `PO-${String(seq).padStart(5, '0')}`, createdBy: requestContext.get()?.userId });
};

const sendPurchaseOrder = async (req: Request, id: string) => {
  const po = found(await PurchaseOrder.findById(id), 'Purchase order');
  if (!canAccessLocation(req, po.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this purchase order');
  }
  if (po.status !== 'DRAFT') throw new AppError(httpStatus.CONFLICT, `Purchase order is ${po.status}`);
  po.status = 'SENT';
  po.sentAt = new Date();
  await po.save();
  const supplier = await Supplier.findById(po.supplierId).lean();
  if (supplier?.email) {
    const { sendEmail } = await import('../../utils/sendEmail');
    const items = await InventoryItem.find({ _id: { $in: po.lines.map((l) => l.stockItemId) } }).lean();
    const name = (id: unknown) => items.find((i) => String(i._id) === String(id))?.name || '';
    const rows = po.lines.map((l) => `<tr><td>${name(l.stockItemId)}</td><td>${l.quantity}</td></tr>`).join('');
    await sendEmail(supplier.email, `<p>Purchase order ${po.number}</p><table>${rows}</table><p>${po.notes || ''}</p>`, `Purchase order ${po.number}`).catch((err) =>
      logger.warn(err, 'PO email failed'),
    );
  }
  return po;
};

// Goods in: receipt movements at the delivered cost; partial deliveries allowed.
const receivePurchaseOrder = async (req: Request, id: string, lines: { stockItemId: string; quantity: number; unitCost?: number }[]) =>
  runInTransaction(async () => {
    const po = found(await PurchaseOrder.findById(id), 'Purchase order');
    if (!canAccessLocation(req, po.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this purchase order');
    }
    if (!['SENT', 'PARTIALLY_RECEIVED', 'DRAFT'].includes(po.status)) throw new AppError(httpStatus.CONFLICT, `Purchase order is ${po.status}`);
    for (const received of lines) {
      const line = po.lines.find((l) => String(l.stockItemId) === received.stockItemId);
      if (!line) throw new AppError(httpStatus.BAD_REQUEST, 'Item is not on this purchase order');
      await recordMovement({
        stockItemId: received.stockItemId,
        type: 'RECEIPT',
        quantity: received.quantity,
        unitCost: received.unitCost ?? line.unitCost,
        reason: `PO ${po.number}`,
        ref: { kind: 'PurchaseOrder', id: String(po._id) },
      });
      line.receivedQty += received.quantity;
    }
    po.status = po.lines.every((l) => l.receivedQty >= l.quantity) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    if (po.status === 'RECEIVED') po.receivedAt = new Date();
    await po.save();
    await activity.record({ action: 'PO_RECEIVED', entity: 'PurchaseOrder', entityId: po._id, message: `Received goods on ${po.number}` });
    return po;
  });

// ---------- Stock counts ----------
const startCount = async (locationId: string, category?: string) => {
  const items = await InventoryItem.find({ locationId, isActive: true, ...(category ? { category } : {}) }).lean();
  return StockCount.create({ locationId, lines: items.map((i) => ({ stockItemId: i._id, expected: i.quantity })), countedBy: requestContext.get()?.userId });
};

const saveCount = async (req: Request, id: string, lines: { stockItemId: string; counted: number }[]) => {
  const count = found(await StockCount.findOne({ _id: id, status: 'OPEN' }), 'Open stock count');
  if (!canAccessLocation(req, count.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this stock count');
  }
  for (const l of lines) {
    const line = count.lines.find((x) => String(x.stockItemId) === l.stockItemId);
    if (line) line.counted = l.counted;
  }
  await count.save();
  return count;
};

// Posting a count books the differences as COUNT movements (shrinkage / overage).
const postCount = async (req: Request, id: string) =>
  runInTransaction(async () => {
    const count = found(await StockCount.findOne({ _id: id, status: 'OPEN' }), 'Open stock count');
    if (!canAccessLocation(req, count.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this stock count');
    }
    let variances = 0;
    for (const line of count.lines) {
      if (line.counted === undefined || line.counted === null) continue;
      const item = await InventoryItem.findById(line.stockItemId).lean();
      if (!item) continue;
      const diff = line.counted - item.quantity;
      if (diff !== 0) {
        await recordMovement({ stockItemId: item._id, type: 'COUNT', quantity: diff, reason: 'Stock count', ref: { kind: 'StockCount', id: String(count._id) } });
        variances += 1;
      }
    }
    count.status = 'POSTED';
    count.postedAt = new Date();
    await count.save();
    return { countId: count._id, variances };
  });

// ---------- Food cost and reorder ----------
// Theoretical cost = recipes of what was sold. Actual usage = opening + purchases - closing
// (from the ledger). The gap is waste, over-portioning or theft.
const foodCost = async (locationId: string, from: Date, to: Date) => {
  const oid = new Types.ObjectId(locationId);
  const [sales, byType, revenue] = await Promise.all([
    StockMovement.aggregate([
      { $match: { locationId: oid, type: { $in: ['SALE', 'SALE_REVERSAL'] }, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, cost: { $sum: { $multiply: [{ $multiply: ['$quantity', -1] }, '$unitCost'] } } } },
    ]),
    StockMovement.aggregate([
      { $match: { locationId: oid, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$type', quantity: { $sum: '$quantity' }, cost: { $sum: { $multiply: ['$quantity', '$unitCost'] } } } },
    ]),
    Order.aggregate([
      { $match: { locationId: oid, status: 'CLOSED', closedAt: { $gte: from, $lte: to } } },
      { $unwind: '$items' },
      { $match: { 'items.status': { $ne: ITEM_STATUS.VOIDED }, 'items.taxCategory': { $in: ['FOOD', 'BEVERAGE', 'ALCOHOL'] } } },
      { $group: { _id: null, net: { $sum: '$items.calc.netMinor' } } },
    ]),
  ]);
  const theoretical = Math.round(sales[0]?.cost || 0);
  const costOf = (types: string[]) => -byType.filter((t) => types.includes(t._id)).reduce((s, t) => s + t.cost, 0);
  const actual = Math.round(costOf(['SALE', 'SALE_REVERSAL', 'WASTE', 'COUNT', 'ADJUSTMENT']));
  const fnbRevenue = revenue[0]?.net || 0;
  return {
    from,
    to,
    fnbRevenueMinor: fnbRevenue,
    theoreticalCostMinor: theoretical,
    actualCostMinor: actual,
    wasteCostMinor: Math.round(costOf(['WASTE'])),
    varianceMinor: actual - theoretical,
    theoreticalFoodCostPct: fnbRevenue ? Math.round((theoretical / fnbRevenue) * 10000) / 100 : 0,
    actualFoodCostPct: fnbRevenue ? Math.round((actual / fnbRevenue) * 10000) / 100 : 0,
    movementsByType: byType,
  };
};

// Suggested order = par level - on hand - already on order.
const reorderSuggestions = async (locationId: string) => {
  const items = await InventoryItem.find({ locationId, isActive: true, parLevel: { $gt: 0 } }).populate('supplierId', 'name leadTimeDays').lean();
  const open = await PurchaseOrder.find({ locationId, status: { $in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } }).lean();
  const onOrder = new Map<string, number>();
  for (const po of open) for (const l of po.lines) onOrder.set(String(l.stockItemId), (onOrder.get(String(l.stockItemId)) || 0) + l.quantity - l.receivedQty);
  return items
    .map((i) => {
      const pending = onOrder.get(String(i._id)) || 0;
      const suggested = Math.max(0, (i.parLevel || 0) - i.quantity - pending);
      return { stockItemId: i._id, name: i.name, sku: i.sku, onHand: i.quantity, onOrder: pending, parLevel: i.parLevel, suggestedQty: i.reorderQty ? Math.ceil(suggested / i.reorderQty) * i.reorderQty : suggested, supplier: i.supplierId, unitCost: i.unitCost };
    })
    .filter((s) => s.suggestedQty > 0);
};

const checkLowStock = async () => {
  const low = await InventoryItem.find({ isActive: true, reorderPoint: { $gt: 0 }, $expr: { $lte: ['$quantity', '$reorderPoint'] } }).lean();
  const { AlertService } = await import('../alert/alert.service');
  for (const item of low) {
    await AlertService.raise({
      type: 'LOW_STOCK',
      severity: item.quantity <= 0 ? 'HIGH' : 'LOW',
      locationId: item.locationId,
      title: `Low stock: ${item.name}`,
      message: `${item.quantity} ${item.unitOfMeasure} left (reorder at ${item.reorderPoint}).`,
      ref: { kind: 'InventoryItem', id: item._id },
      dedupeKey: `lowstock:${item._id}`,
    });
  }
  const ok = await InventoryItem.find({ isActive: true, reorderPoint: { $gt: 0 }, $expr: { $gt: ['$quantity', '$reorderPoint'] } }).select('_id').lean();
  for (const item of ok) await AlertService.resolveByKey(`lowstock:${item._id}`);
  return low.length;
};

export const InventoryServices = {
  createItem,
  getAllItems,
  getItemById,
  updateItem,
  deleteItem,
  recordMovement,
  adjustStock,
  logWaste,
  transfer,
  movements,
  upsertRecipe,
  getRecipe,
  suppliers,
  createPurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  startCount,
  saveCount,
  postCount,
  foodCost,
  reorderSuggestions,
  checkLowStock,
};
