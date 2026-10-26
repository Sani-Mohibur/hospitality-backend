import { Request } from 'express';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { canAccessLocation } from '../../../middlewares/locationScope';
import { found, metaOf, paginationOf } from '../../../utils/query';
import { requestContext } from '../../../utils/requestContext';
import { runInTransaction } from '../../../utils/transaction';
import { activity } from '../../auditLog/auditLog.service';
import { recordMovement } from '../../inventory/inventory.service';
import { nextSequence } from '../../system/counter.model';
import { RetailInventoryService } from '../retailInventory/retailInventory.service';
import { RetailProduct } from '../retailProduct/retailProduct.model';
import {
  IRetailStocktakeLine,
  RETAIL_STOCKTAKE_STATUS,
} from './retailStocktake.interface';
import { RetailStocktake } from './retailStocktake.model';

const startStocktake = async (
  req: Request,
  locationId: string,
  payload: {
    name: string;
    categoryId?: string;
    notes?: string;
  },
) => {
  if (!canAccessLocation(req, locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
  }

  const productFilter: Record<string, unknown> = {
    isActive: true,
    isDeleted: { $ne: true },
    $or: [{ locationId: new Types.ObjectId(locationId) }, { locationId: null }],
  };

  if (payload.categoryId) {
    productFilter.categoryId = new Types.ObjectId(payload.categoryId);
  }

  const products = await RetailProduct.find(productFilter)
    .populate('categoryId', 'name')
    .lean();

  if (!products.length) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No products found matching criteria for this location');
  }

  const lines: IRetailStocktakeLine[] = [];
  let totalSystemQty = 0;

  for (const product of products) {
    const categoryName = (product.categoryId as any)?.name || 'Retail';

    if (product.hasVariants && product.variants && product.variants.length > 0) {
      for (const variant of product.variants) {
        if (!variant.isActive) continue;
        const stockItem = await RetailInventoryService.ensureInventoryItem(
          String(product._id),
          String(variant._id),
          locationId,
        );

        totalSystemQty += stockItem.quantity;
        lines.push({
          productId: product._id,
          variantId: variant._id,
          stockItemId: stockItem._id,
          sku: variant.sku,
          productName: `${product.name} - ${variant.name}`,
          categoryName,
          systemQty: stockItem.quantity,
          unitCost: stockItem.unitCost || variant.costPriceMinor || product.costPriceMinor || 0,
        });
      }
    } else {
      const stockItem = await RetailInventoryService.ensureInventoryItem(
        String(product._id),
        undefined,
        locationId,
      );

      totalSystemQty += stockItem.quantity;
      lines.push({
        productId: product._id,
        stockItemId: stockItem._id,
        sku: product.sku,
        productName: product.name,
        categoryName,
        systemQty: stockItem.quantity,
        unitCost: stockItem.unitCost || product.costPriceMinor || 0,
      });
    }
  }

  const tenantId = requestContext.get()?.tenantId;
  const seq = await nextSequence(`retail-stocktake:${tenantId}`);
  const stocktakeNumber = `STK-${String(seq).padStart(5, '0')}`;

  const stocktake = await RetailStocktake.create({
    locationId: new Types.ObjectId(locationId),
    stocktakeNumber,
    name: payload.name,
    categoryId: payload.categoryId ? new Types.ObjectId(payload.categoryId) : undefined,
    status: RETAIL_STOCKTAKE_STATUS.IN_PROGRESS,
    lines,
    totalSystemQty,
    notes: payload.notes,
    startedBy: requestContext.get()?.userId ? new Types.ObjectId(requestContext.get()?.userId) : undefined,
    startedAt: new Date(),
  });

  await activity.record({
    action: 'RETAIL_STOCKTAKE_STARTED',
    entity: 'RetailStocktake',
    entityId: stocktake._id,
    locationId,
    message: `Started physical stocktake ${stocktake.stocktakeNumber} (${lines.length} items)`,
  });

  return RetailStocktake.findById(stocktake._id)
    .populate('locationId', 'name code branchType')
    .populate('startedBy', 'name email')
    .lean();
};

const recordCounts = async (
  req: Request,
  id: string,
  payload: {
    lines: { stockItemId: string; countedQty: number }[];
    notes?: string;
  },
) => {
  const stocktake = found(await RetailStocktake.findById(id), 'Retail stocktake');

  if (!canAccessLocation(req, stocktake.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this stocktake');
  }

  if (stocktake.status !== RETAIL_STOCKTAKE_STATUS.IN_PROGRESS) {
    throw new AppError(httpStatus.CONFLICT, `Cannot record counts on stocktake in ${stocktake.status} status`);
  }

  const countMap = new Map<string, number>(payload.lines.map((l) => [String(l.stockItemId), l.countedQty]));

  let totalCounted = 0;
  let totalVariance = 0;
  let totalVarianceCost = 0;

  for (const line of stocktake.lines) {
    const counted = countMap.get(String(line.stockItemId));
    if (counted !== undefined) {
      line.countedQty = counted;
      line.varianceQty = counted - line.systemQty;
      line.varianceCostMinor = Math.round(line.varianceQty * line.unitCost);
    }

    if (line.countedQty !== undefined) {
      totalCounted += line.countedQty;
      totalVariance += line.varianceQty || 0;
      totalVarianceCost += line.varianceCostMinor || 0;
    }
  }

  stocktake.totalCountedQty = totalCounted;
  stocktake.totalVarianceQty = totalVariance;
  stocktake.totalVarianceCostMinor = totalVarianceCost;
  if (payload.notes) stocktake.notes = payload.notes;

  await stocktake.save();

  return RetailStocktake.findById(stocktake._id)
    .populate('locationId', 'name code branchType')
    .lean();
};

const reconcileAndPost = async (req: Request, id: string, notes?: string) => {
  return runInTransaction(async () => {
    const stocktake = found(await RetailStocktake.findById(id), 'Retail stocktake');

    if (!canAccessLocation(req, stocktake.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this stocktake');
    }

    if (stocktake.status !== RETAIL_STOCKTAKE_STATUS.IN_PROGRESS) {
      throw new AppError(httpStatus.CONFLICT, `Cannot post stocktake in ${stocktake.status} status`);
    }

    let varianceCount = 0;

    for (const line of stocktake.lines) {
      if (line.countedQty === undefined || line.countedQty === null) continue;
      if (line.varianceQty && line.varianceQty !== 0) {
        await recordMovement({
          stockItemId: line.stockItemId,
          type: 'COUNT',
          quantity: line.varianceQty,
          reason: `Stocktake ${stocktake.stocktakeNumber} reconciliation`,
          ref: { kind: 'RetailStocktake', id: String(stocktake._id) },
        });
        varianceCount++;
      }
    }

    stocktake.status = RETAIL_STOCKTAKE_STATUS.COMPLETED;
    stocktake.completedAt = new Date();
    stocktake.completedBy = requestContext.get()?.userId ? new Types.ObjectId(requestContext.get()?.userId) : undefined;
    if (notes) {
      stocktake.notes = stocktake.notes ? `${stocktake.notes}\n${notes}` : notes;
    }
    await stocktake.save();

    await activity.record({
      action: 'RETAIL_STOCKTAKE_COMPLETED',
      entity: 'RetailStocktake',
      entityId: stocktake._id,
      locationId: stocktake.locationId,
      message: `Completed stocktake ${stocktake.stocktakeNumber} with ${varianceCount} variance adjustment(s)`,
    });

    return RetailStocktake.findById(stocktake._id)
      .populate('locationId', 'name code branchType')
      .populate('completedBy', 'name email')
      .lean();
  });
};

const cancelStocktake = async (req: Request, id: string) => {
  const stocktake = found(await RetailStocktake.findById(id), 'Retail stocktake');

  if (!canAccessLocation(req, stocktake.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this stocktake');
  }

  if (stocktake.status === RETAIL_STOCKTAKE_STATUS.COMPLETED) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cannot cancel a completed stocktake');
  }

  if (stocktake.status === RETAIL_STOCKTAKE_STATUS.CANCELLED) {
    throw new AppError(httpStatus.CONFLICT, 'Stocktake is already cancelled');
  }

  stocktake.status = RETAIL_STOCKTAKE_STATUS.CANCELLED;
  await stocktake.save();

  await activity.record({
    action: 'RETAIL_STOCKTAKE_CANCELLED',
    entity: 'RetailStocktake',
    entityId: stocktake._id,
    locationId: stocktake.locationId,
    message: `Cancelled stocktake ${stocktake.stocktakeNumber}`,
  });

  return stocktake;
};

const getAllStocktakes = async (
  locationFilterObj: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const { page, limit, skip } = paginationOf(query, 20);
  const filter: Record<string, unknown> = { ...locationFilterObj };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.searchTerm && typeof query.searchTerm === 'string') {
    const term = query.searchTerm.trim();
    filter.$or = [{ stocktakeNumber: { $regex: term, $options: 'i' } }, { name: { $regex: term, $options: 'i' } }];
  }

  const sortOrder = (query.sort as string) || '-createdAt';
  const [data, total] = await Promise.all([
    RetailStocktake.find(filter)
      .populate('locationId', 'name code branchType')
      .populate('startedBy', 'name email')
      .populate('completedBy', 'name email')
      .sort(sortOrder)
      .skip(skip)
      .limit(limit)
      .lean(),
    RetailStocktake.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

const getStocktakeById = async (req: Request, id: string) => {
  const stocktake = found(
    await RetailStocktake.findById(id)
      .populate('locationId', 'name code branchType')
      .populate('categoryId', 'name code')
      .populate('startedBy', 'name email')
      .populate('completedBy', 'name email')
      .lean(),
    'Retail stocktake',
  );

  if (!canAccessLocation(req, stocktake.locationId as any)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this stocktake');
  }

  return stocktake;
};

export const RetailStocktakeService = {
  startStocktake,
  recordCounts,
  reconcileAndPost,
  cancelStocktake,
  getAllStocktakes,
  getStocktakeById,
};
