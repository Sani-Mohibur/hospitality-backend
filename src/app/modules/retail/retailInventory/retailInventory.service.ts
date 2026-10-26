import { Request } from 'express';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { canAccessLocation } from '../../../middlewares/locationScope';
import { escapeRegex, found, metaOf, paginationOf } from '../../../utils/query';
import { runInTransaction } from '../../../utils/transaction';
import { activity } from '../../auditLog/auditLog.service';
import { InventoryItem, PurchaseOrder, StockMovement, Supplier } from '../../inventory/inventory.model';
import { recordMovement } from '../../inventory/inventory.service';
import { RetailProduct } from '../retailProduct/retailProduct.model';
import {
  IAdjustStockPayload,
  IInitializeStockPayload,
  ILogWastePayload,
  IRestockSuggestion,
  IUpdateStockLevelsPayload,
} from './retailInventory.interface';

const ensureInventoryItem = async (
  productId: string,
  variantId: string | undefined,
  locationId: string,
  initialLevels?: {
    parLevel?: number;
    reorderPoint?: number;
    reorderQty?: number;
    supplierId?: string;
    unitCost?: number;
  },
) => {
  const product = found(await RetailProduct.findById(productId).populate('categoryId', 'name').lean(), 'Retail product');

  let sku = product.sku;
  let name = product.name;
  let unitCost = product.costPriceMinor || 0;

  if (variantId) {
    const variant = (product.variants || []).find((v) => String(v._id) === String(variantId));
    if (!variant) throw new AppError(httpStatus.NOT_FOUND, 'Product variant not found');
    sku = variant.sku;
    name = `${product.name} - ${variant.name}`;
    unitCost = variant.costPriceMinor ?? product.costPriceMinor ?? 0;
  }

  let item = await InventoryItem.findOne({
    locationId: new Types.ObjectId(locationId),
    sku,
    isDeleted: { $ne: true },
  });

  if (!item) {
    const categoryName = (product.categoryId as any)?.name || 'Retail';
    const createdDocs = await InventoryItem.create([
      {
        name,
        sku,
        category: categoryName,
        unitOfMeasure: product.unitOfMeasure || 'UNIT',
        quantity: 0,
        unitCost: initialLevels?.unitCost ?? unitCost,
        parLevel: initialLevels?.parLevel,
        reorderPoint: initialLevels?.reorderPoint,
        reorderQty: initialLevels?.reorderQty,
        supplierId: initialLevels?.supplierId ? new Types.ObjectId(initialLevels.supplierId) : undefined,
        locationId: new Types.ObjectId(locationId),
        isMinibar: false,
        isActive: true,
      },
    ]);
    const created = createdDocs[0];
    if (!created) {
      throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create inventory item');
    }
    item = created;
  }

  if (!item) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to resolve inventory item');
  }

  return item;
};

const initializeStock = async (payload: IInitializeStockPayload) => {
  return runInTransaction(async () => {
    const item = await ensureInventoryItem(
      payload.productId,
      payload.variantId,
      payload.locationId,
      {
        parLevel: payload.parLevel,
        reorderPoint: payload.reorderPoint,
        reorderQty: payload.reorderQty,
        supplierId: payload.supplierId,
      },
    );

    if (payload.openingQuantity && payload.openingQuantity > 0) {
      if (item.quantity === 0) {
        await recordMovement({
          stockItemId: item._id,
          type: 'OPENING',
          quantity: payload.openingQuantity,
          unitCost: item.unitCost,
          reason: 'Initial retail stock setup',
        });
      } else {
        throw new AppError(
          httpStatus.CONFLICT,
          `Stock for SKU ${item.sku} at this location already has ${item.quantity} on hand. Use stock adjustment instead.`,
        );
      }
    }

    const updated = await InventoryItem.findById(item._id)
      .populate('supplierId', 'name contactName email phone')
      .lean();

    await activity.record({
      action: 'RETAIL_STOCK_INITIALIZED',
      entity: 'InventoryItem',
      entityId: item._id,
      locationId: payload.locationId,
      message: `Initialized stock for ${item.name} (${item.sku}) with ${payload.openingQuantity || 0} units`,
    });

    return updated;
  });
};

const getAllStockItems = async (
  locationFilterObj: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const { page, limit, skip } = paginationOf(query, 20);
  const filter: Record<string, unknown> = { ...locationFilterObj };

  if (query.supplierId) {
    filter.supplierId = new Types.ObjectId(String(query.supplierId));
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true';
  }

  if (query.searchTerm && typeof query.searchTerm === 'string') {
    const term = query.searchTerm.trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { sku: { $regex: term, $options: 'i' } },
      { category: { $regex: term, $options: 'i' } },
    ];
  }

  if (query.stockStatus === 'OUT_OF_STOCK') {
    filter.quantity = { $lte: 0 };
  } else if (query.stockStatus === 'LOW_STOCK') {
    filter.quantity = { $gt: 0 };
    filter.$expr = { $lte: ['$quantity', '$reorderPoint'] };
  } else if (query.stockStatus === 'IN_STOCK') {
    filter.$expr = { $gt: ['$quantity', { $ifNull: ['$reorderPoint', 0] }] };
  }

  const sortOrder = (query.sort as string) || 'category name';
  const [items, total] = await Promise.all([
    InventoryItem.find(filter)
      .populate('supplierId', 'name contactName email phone')
      .populate('locationId', 'name code branchType')
      .sort(sortOrder)
      .skip(skip)
      .limit(limit)
      .lean(),
    InventoryItem.countDocuments(filter),
  ]);

  // Enrich with product selling price & barcodes where available
  const skus = items.map((i) => i.sku);
  const products = await RetailProduct.find({
    $or: [{ sku: { $in: skus } }, { 'variants.sku': { $in: skus } }],
    isDeleted: { $ne: true },
  })
    .populate('categoryId', 'name')
    .lean();

  const productMap = new Map<string, any>();
  for (const p of products) {
    productMap.set(p.sku, { product: p, variant: null });
    for (const v of p.variants || []) {
      productMap.set(v.sku, { product: p, variant: v });
    }
  }

  const enriched = items.map((item) => {
    const match = productMap.get(item.sku);
    let stockStatus = 'IN_STOCK';
    if (item.quantity <= 0) stockStatus = 'OUT_OF_STOCK';
    else if (item.reorderPoint && item.quantity <= item.reorderPoint) stockStatus = 'LOW_STOCK';

    return {
      ...item,
      stockStatus,
      sellingPriceMinor: match?.variant ? match.variant.priceMinor : match?.product?.priceMinor,
      barcode: match?.variant ? match.variant.barcode : match?.product?.barcode,
      productId: match?.product?._id,
      variantId: match?.variant?._id,
      retailCategory: (match?.product?.categoryId as any)?.name || item.category,
    };
  });

  return { data: enriched, meta: metaOf(page, limit, total) };
};

const getStockItemById = async (req: Request, id: string) => {
  const item = found(
    await InventoryItem.findById(id)
      .populate('supplierId', 'name contactName email phone leadTimeDays')
      .populate('locationId', 'name code branchType')
      .lean(),
    'Inventory item',
  );

  if (!canAccessLocation(req, item.locationId as any)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
  }

  const product = await RetailProduct.findOne({
    $or: [{ sku: item.sku }, { 'variants.sku': item.sku }],
    isDeleted: { $ne: true },
  })
    .populate('categoryId', 'name code')
    .lean();

  const matchedVariant = product?.variants?.find((v) => v.sku === item.sku);

  const movements = await StockMovement.find({ stockItemId: item._id })
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  let stockStatus = 'IN_STOCK';
  if (item.quantity <= 0) stockStatus = 'OUT_OF_STOCK';
  else if (item.reorderPoint && item.quantity <= item.reorderPoint) stockStatus = 'LOW_STOCK';

  return {
    ...item,
    stockStatus,
    product: product
      ? {
          _id: product._id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          priceMinor: product.priceMinor,
          costPriceMinor: product.costPriceMinor,
          category: product.categoryId,
        }
      : null,
    variant: matchedVariant || null,
    movements,
  };
};

const updateStockLevels = async (
  req: Request,
  id: string,
  payload: IUpdateStockLevelsPayload,
) => {
  const item = found(await InventoryItem.findById(id), 'Inventory item');
  if (!canAccessLocation(req, item.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
  }

  const before = item.toObject();
  if (payload.parLevel !== undefined) item.parLevel = payload.parLevel ?? undefined;
  if (payload.reorderPoint !== undefined) item.reorderPoint = payload.reorderPoint ?? undefined;
  if (payload.reorderQty !== undefined) item.reorderQty = payload.reorderQty ?? undefined;
  if (payload.supplierId !== undefined) {
    item.supplierId = payload.supplierId ? new Types.ObjectId(payload.supplierId) : undefined;
  }
  if (payload.isActive !== undefined) item.isActive = payload.isActive;

  await item.save();

  await activity.record({
    action: 'RETAIL_STOCK_LEVELS_UPDATED',
    entity: 'InventoryItem',
    entityId: item._id,
    locationId: item.locationId,
    message: `Updated stock levels for ${item.name} (${item.sku})`,
    before,
    after: item.toObject(),
  });

  return InventoryItem.findById(item._id)
    .populate('supplierId', 'name contactName email phone')
    .lean();
};

const adjustStock = async (req: Request, payload: IAdjustStockPayload) => {
  return runInTransaction(async () => {
    const item = found(await InventoryItem.findById(payload.stockItemId), 'Inventory item');
    if (!canAccessLocation(req, item.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
    }

    const signed = payload.type === 'ADD' ? payload.quantityChange : -payload.quantityChange;
    if (signed < 0 && item.quantity + signed < 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Cannot subtract ${payload.quantityChange}. Only ${item.quantity} ${item.unitOfMeasure} available in stock.`,
      );
    }

    const movement = await recordMovement({
      stockItemId: item._id,
      type: 'ADJUSTMENT',
      quantity: signed,
      reason: payload.reason,
    });

    const updated = await InventoryItem.findById(item._id).lean();

    await activity.record({
      action: 'RETAIL_STOCK_ADJUSTED',
      entity: 'InventoryItem',
      entityId: item._id,
      locationId: item.locationId,
      message: `Adjusted ${item.name} by ${signed > 0 ? '+' : ''}${signed}: ${payload.reason}`,
    });

    return { item: updated, movement };
  });
};

const logWaste = async (req: Request, payload: ILogWastePayload) => {
  return runInTransaction(async () => {
    const item = found(await InventoryItem.findById(payload.stockItemId), 'Inventory item');
    if (!canAccessLocation(req, item.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this inventory item');
    }

    const qty = Math.abs(payload.quantity);
    if (item.quantity - qty < 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Cannot log waste of ${qty}. Only ${item.quantity} ${item.unitOfMeasure} in stock.`,
      );
    }

    const movement = await recordMovement({
      stockItemId: item._id,
      type: 'WASTE',
      quantity: -qty,
      reason: payload.reason,
    });

    const updated = await InventoryItem.findById(item._id).lean();

    await activity.record({
      action: 'RETAIL_STOCK_WASTE',
      entity: 'InventoryItem',
      entityId: item._id,
      locationId: item.locationId,
      message: `Logged waste of ${qty} ${item.unitOfMeasure} for ${item.name}: ${payload.reason}`,
    });

    return { item: updated, movement };
  });
};

const getLowStockItems = async (locationId: string): Promise<IRestockSuggestion[]> => {
  const locId = new Types.ObjectId(locationId);
  const items = await InventoryItem.find({
    locationId: locId,
    isActive: true,
    $or: [
      { quantity: { $lte: 0 } },
      { reorderPoint: { $gt: 0 }, $expr: { $lte: ['$quantity', '$reorderPoint'] } },
    ],
  })
    .populate('supplierId', 'name email phone leadTimeDays')
    .lean();

  if (!items.length) return [];

  // Find open PO lines pending delivery at this location
  const openPOs = await PurchaseOrder.find({
    locationId: locId,
    status: { $in: ['SENT', 'PARTIALLY_RECEIVED'] },
  }).lean();

  const onOrderMap = new Map<string, number>();
  for (const po of openPOs) {
    for (const l of po.lines) {
      const remaining = Math.max(0, l.quantity - (l.receivedQty || 0));
      onOrderMap.set(String(l.stockItemId), (onOrderMap.get(String(l.stockItemId)) || 0) + remaining);
    }
  }

  // Find product details
  const skus = items.map((i) => i.sku);
  const products = await RetailProduct.find({
    $or: [{ sku: { $in: skus } }, { 'variants.sku': { $in: skus } }],
    isDeleted: { $ne: true },
  }).lean();

  const productBySku = new Map<string, { product: any; variant: any }>();
  for (const p of products) {
    productBySku.set(p.sku, { product: p, variant: null });
    for (const v of p.variants || []) {
      productBySku.set(v.sku, { product: p, variant: v });
    }
  }

  const suggestions: IRestockSuggestion[] = items.map((item) => {
    const match = productBySku.get(item.sku);
    const pendingIncoming = onOrderMap.get(String(item._id)) || 0;
    const targetStock = item.parLevel || (item.reorderPoint ? item.reorderPoint * 2 : 10);
    const needed = Math.max(0, targetStock - item.quantity - pendingIncoming);

    let suggestedQty = needed;
    if (item.reorderQty && item.reorderQty > 0 && suggestedQty > 0) {
      suggestedQty = Math.ceil(suggestedQty / item.reorderQty) * item.reorderQty;
    }

    const unitCost = item.unitCost || match?.product?.costPriceMinor || 0;

    return {
      stockItemId: item._id,
      productId: match?.product?._id,
      variantId: match?.variant?._id,
      name: item.name,
      sku: item.sku,
      barcode: match?.variant ? match.variant.barcode : match?.product?.barcode,
      unitOfMeasure: item.unitOfMeasure,
      onHand: item.quantity,
      reorderPoint: item.reorderPoint || 0,
      parLevel: item.parLevel,
      reorderQty: item.reorderQty,
      pendingIncoming,
      suggestedQty,
      unitCost,
      estimatedCostMinor: Math.round(suggestedQty * unitCost),
      supplier: item.supplierId as any,
    };
  });

  return suggestions;
};

const getStockMovements = async (
  locationFilterObj: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const { page, limit, skip } = paginationOf(query, 50);
  const filter: Record<string, unknown> = { ...locationFilterObj };

  if (query.stockItemId) {
    filter.stockItemId = new Types.ObjectId(String(query.stockItemId));
  }

  if (query.type) {
    filter.type = query.type;
  }

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) (filter.createdAt as any).$gte = new Date(String(query.from));
    if (query.to) (filter.createdAt as any).$lte = new Date(String(query.to));
  }

  const [data, total] = await Promise.all([
    StockMovement.find(filter)
      .populate('stockItemId', 'name sku unitOfMeasure')
      .populate('createdBy', 'name email')
      .populate('locationId', 'name code')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StockMovement.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

export const RetailInventoryService = {
  ensureInventoryItem,
  initializeStock,
  getAllStockItems,
  getStockItemById,
  updateStockLevels,
  adjustStock,
  logWaste,
  getLowStockItems,
  getStockMovements,
};
