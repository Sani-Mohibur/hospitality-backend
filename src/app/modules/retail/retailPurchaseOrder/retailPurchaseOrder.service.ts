import { Request } from 'express';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { canAccessLocation } from '../../../middlewares/locationScope';
import logger from '../../../utils/logger';
import { found, metaOf, paginationOf } from '../../../utils/query';
import { requestContext } from '../../../utils/requestContext';
import { runInTransaction } from '../../../utils/transaction';
import { activity } from '../../auditLog/auditLog.service';
import { Supplier } from '../../inventory/inventory.model';
import { recordMovement } from '../../inventory/inventory.service';
import { nextSequence } from '../../system/counter.model';
import { RetailInventoryService } from '../retailInventory/retailInventory.service';
import { RetailProduct } from '../retailProduct/retailProduct.model';
import {
  IReceiveGoodsLineInput,
  IRetailPOLine,
  RETAIL_PO_STATUS,
} from './retailPurchaseOrder.interface';
import { RetailPurchaseOrder } from './retailPurchaseOrder.model';

const createPurchaseOrder = async (
  req: Request,
  locationId: string,
  payload: {
    supplierId: string;
    lines: {
      productId: string;
      variantId?: string;
      quantity: number;
      unitCost?: number;
    }[];
    expectedAt?: string;
    notes?: string;
  },
) => {
  if (!canAccessLocation(req, locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
  }

  const supplier = found(await Supplier.findById(payload.supplierId).lean(), 'Supplier');
  if (!supplier.isActive) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cannot create purchase order for inactive supplier');
  }

  const tenantId = requestContext.get()?.tenantId;
  const processedLines: IRetailPOLine[] = [];
  let subtotalMinor = 0;

  for (const line of payload.lines) {
    const product = found(await RetailProduct.findById(line.productId).lean(), 'Retail product');
    let sku = product.sku;
    let name = product.name;
    let unitCost = line.unitCost ?? product.costPriceMinor ?? 0;

    if (line.variantId) {
      const variant = (product.variants || []).find((v) => String(v._id) === String(line.variantId));
      if (!variant) throw new AppError(httpStatus.NOT_FOUND, 'Product variant not found');
      sku = variant.sku;
      name = `${product.name} - ${variant.name}`;
      unitCost = line.unitCost ?? variant.costPriceMinor ?? product.costPriceMinor ?? 0;
    }

    const stockItem = await RetailInventoryService.ensureInventoryItem(
      line.productId,
      line.variantId,
      locationId,
      { unitCost, supplierId: payload.supplierId },
    );

    const lineTotal = line.quantity * unitCost;
    subtotalMinor += lineTotal;

    processedLines.push({
      productId: product._id,
      variantId: line.variantId ? new Types.ObjectId(line.variantId) : undefined,
      stockItemId: stockItem._id,
      sku,
      name,
      quantity: line.quantity,
      unitCost,
      receivedQty: 0,
      totalMinor: lineTotal,
    });
  }

  const seq = await nextSequence(`retail-po:${tenantId}`);
  const poNumber = `RPO-${String(seq).padStart(5, '0')}`;

  const po = await RetailPurchaseOrder.create({
    locationId: new Types.ObjectId(locationId),
    supplierId: supplier._id,
    poNumber,
    status: RETAIL_PO_STATUS.DRAFT,
    lines: processedLines,
    subtotalMinor,
    expectedAt: payload.expectedAt ? new Date(payload.expectedAt) : undefined,
    notes: payload.notes,
    createdBy: requestContext.get()?.userId ? new Types.ObjectId(requestContext.get()?.userId) : undefined,
  });

  await activity.record({
    action: 'RETAIL_PO_CREATED',
    entity: 'RetailPurchaseOrder',
    entityId: po._id,
    locationId,
    message: `Created retail purchase order ${po.poNumber} for supplier ${supplier.name}`,
  });

  return RetailPurchaseOrder.findById(po._id)
    .populate('supplierId', 'name contactName email phone')
    .populate('locationId', 'name code branchType')
    .lean();
};

const getAllPurchaseOrders = async (
  locationFilterObj: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const { page, limit, skip } = paginationOf(query, 20);
  const filter: Record<string, unknown> = { ...locationFilterObj };

  if (query.supplierId) {
    filter.supplierId = new Types.ObjectId(String(query.supplierId));
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.searchTerm && typeof query.searchTerm === 'string') {
    const term = query.searchTerm.trim();
    filter.$or = [{ poNumber: { $regex: term, $options: 'i' } }, { notes: { $regex: term, $options: 'i' } }];
  }

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) (filter.createdAt as any).$gte = new Date(String(query.from));
    if (query.to) (filter.createdAt as any).$lte = new Date(String(query.to));
  }

  const sortOrder = (query.sort as string) || '-createdAt';
  const [data, total] = await Promise.all([
    RetailPurchaseOrder.find(filter)
      .populate('supplierId', 'name contactName email phone')
      .populate('locationId', 'name code branchType')
      .populate('createdBy', 'name email')
      .sort(sortOrder)
      .skip(skip)
      .limit(limit)
      .lean(),
    RetailPurchaseOrder.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

const getPurchaseOrderById = async (req: Request, id: string) => {
  const po = found(
    await RetailPurchaseOrder.findById(id)
      .populate('supplierId', 'name contactName email phone address')
      .populate('locationId', 'name code branchType address')
      .populate('createdBy', 'name email')
      .lean(),
    'Retail purchase order',
  );

  if (!canAccessLocation(req, po.locationId as any)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this purchase order');
  }

  return po;
};

const updatePurchaseOrder = async (
  req: Request,
  id: string,
  payload: {
    supplierId?: string;
    lines?: {
      productId: string;
      variantId?: string;
      quantity: number;
      unitCost?: number;
    }[];
    expectedAt?: string | null;
    notes?: string;
  },
) => {
  const po = found(await RetailPurchaseOrder.findById(id), 'Retail purchase order');

  if (!canAccessLocation(req, po.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this purchase order');
  }

  if (po.status !== RETAIL_PO_STATUS.DRAFT) {
    throw new AppError(httpStatus.CONFLICT, `Cannot edit purchase order in ${po.status} status`);
  }

  if (payload.supplierId) {
    const supplier = found(await Supplier.findById(payload.supplierId).lean(), 'Supplier');
    po.supplierId = supplier._id;
  }

  if (payload.expectedAt !== undefined) {
    po.expectedAt = payload.expectedAt ? new Date(payload.expectedAt) : undefined;
  }

  if (payload.notes !== undefined) {
    po.notes = payload.notes;
  }

  if (payload.lines && payload.lines.length > 0) {
    const processedLines: IRetailPOLine[] = [];
    let subtotalMinor = 0;

    for (const line of payload.lines) {
      const product = found(await RetailProduct.findById(line.productId).lean(), 'Retail product');
      let sku = product.sku;
      let name = product.name;
      let unitCost = line.unitCost ?? product.costPriceMinor ?? 0;

      if (line.variantId) {
        const variant = (product.variants || []).find((v) => String(v._id) === String(line.variantId));
        if (!variant) throw new AppError(httpStatus.NOT_FOUND, 'Product variant not found');
        sku = variant.sku;
        name = `${product.name} - ${variant.name}`;
        unitCost = line.unitCost ?? variant.costPriceMinor ?? product.costPriceMinor ?? 0;
      }

      const stockItem = await RetailInventoryService.ensureInventoryItem(
        line.productId,
        line.variantId,
        String(po.locationId),
        { unitCost, supplierId: String(po.supplierId) },
      );

      const lineTotal = line.quantity * unitCost;
      subtotalMinor += lineTotal;

      processedLines.push({
        productId: product._id,
        variantId: line.variantId ? new Types.ObjectId(line.variantId) : undefined,
        stockItemId: stockItem._id,
        sku,
        name,
        quantity: line.quantity,
        unitCost,
        receivedQty: 0,
        totalMinor: lineTotal,
      });
    }

    po.lines = processedLines;
    po.subtotalMinor = subtotalMinor;
  }

  await po.save();

  await activity.record({
    action: 'RETAIL_PO_UPDATED',
    entity: 'RetailPurchaseOrder',
    entityId: po._id,
    locationId: po.locationId,
    message: `Updated retail purchase order ${po.poNumber}`,
  });

  return RetailPurchaseOrder.findById(po._id)
    .populate('supplierId', 'name contactName email phone')
    .populate('locationId', 'name code branchType')
    .lean();
};

const sendPurchaseOrder = async (req: Request, id: string) => {
  const po = found(await RetailPurchaseOrder.findById(id), 'Retail purchase order');

  if (!canAccessLocation(req, po.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this purchase order');
  }

  if (po.status !== RETAIL_PO_STATUS.DRAFT) {
    throw new AppError(httpStatus.CONFLICT, `Purchase order is already ${po.status}`);
  }

  po.status = RETAIL_PO_STATUS.SENT;
  po.sentAt = new Date();
  await po.save();

  const supplier = await Supplier.findById(po.supplierId).lean();
  if (supplier?.email) {
    const { sendEmail } = await import('../../../utils/sendEmail');
    const rows = po.lines
      .map((l) => `<tr><td>${l.name} (${l.sku})</td><td>${l.quantity}</td></tr>`)
      .join('');
    await sendEmail(
      supplier.email,
      `<p>Purchase Order <strong>${po.poNumber}</strong></p><table border="1" cellpadding="5"><tr><th>Item</th><th>Qty</th></tr>${rows}</table><p>${po.notes || ''}</p>`,
      `Purchase order ${po.poNumber}`,
    ).catch((err) => logger.warn(err, 'Retail PO email failed'));
  }

  await activity.record({
    action: 'RETAIL_PO_SENT',
    entity: 'RetailPurchaseOrder',
    entityId: po._id,
    locationId: po.locationId,
    message: `Sent purchase order ${po.poNumber} to supplier ${supplier?.name || ''}`,
  });

  return po;
};

const receiveGoods = async (
  req: Request,
  id: string,
  payload: {
    lines: IReceiveGoodsLineInput[];
    notes?: string;
  },
) => {
  return runInTransaction(async () => {
    const po = found(await RetailPurchaseOrder.findById(id), 'Retail purchase order');

    if (!canAccessLocation(req, po.locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this purchase order');
    }

    if (!([RETAIL_PO_STATUS.SENT, RETAIL_PO_STATUS.PARTIALLY_RECEIVED, RETAIL_PO_STATUS.DRAFT] as string[]).includes(po.status)) {
      throw new AppError(httpStatus.CONFLICT, `Cannot receive goods on purchase order with status ${po.status}`);
    }

    for (const received of payload.lines) {
      const line = po.lines.find((l) => String(l.stockItemId) === String(received.stockItemId));
      if (!line) {
        throw new AppError(httpStatus.BAD_REQUEST, `Item is not on purchase order ${po.poNumber}`);
      }

      const remaining = line.quantity - line.receivedQty;
      if (received.receivedQuantity > remaining) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Cannot receive ${received.receivedQuantity} units of ${line.name}. Only ${remaining} units remaining to receive.`,
        );
      }

      await recordMovement({
        stockItemId: line.stockItemId,
        type: 'RECEIPT',
        quantity: received.receivedQuantity,
        unitCost: received.unitCost ?? line.unitCost,
        reason: `PO ${po.poNumber}${payload.notes ? ` - ${payload.notes}` : ''}`,
        ref: { kind: 'RetailPurchaseOrder', id: String(po._id) },
      });

      line.receivedQty += received.receivedQuantity;
    }

    const allFulfilled = po.lines.every((l) => l.receivedQty >= l.quantity);
    po.status = allFulfilled ? RETAIL_PO_STATUS.RECEIVED : RETAIL_PO_STATUS.PARTIALLY_RECEIVED;
    if (po.status === RETAIL_PO_STATUS.RECEIVED) {
      po.receivedAt = new Date();
    }

    await po.save();

    await activity.record({
      action: 'RETAIL_PO_GOODS_RECEIVED',
      entity: 'RetailPurchaseOrder',
      entityId: po._id,
      locationId: po.locationId,
      message: `Received ${payload.lines.length} item line(s) on PO ${po.poNumber}. Status: ${po.status}`,
    });

    return RetailPurchaseOrder.findById(po._id)
      .populate('supplierId', 'name contactName email phone')
      .populate('locationId', 'name code branchType')
      .lean();
  });
};

const cancelPurchaseOrder = async (req: Request, id: string, reason?: string) => {
  const po = found(await RetailPurchaseOrder.findById(id), 'Retail purchase order');

  if (!canAccessLocation(req, po.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this purchase order');
  }

  const totalReceived = po.lines.reduce((sum, l) => sum + (l.receivedQty || 0), 0);
  if (totalReceived > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot cancel purchase order ${po.poNumber} because ${totalReceived} item(s) have already been received.`,
    );
  }

  if (po.status === RETAIL_PO_STATUS.CANCELLED) {
    throw new AppError(httpStatus.CONFLICT, 'Purchase order is already cancelled');
  }

  po.status = RETAIL_PO_STATUS.CANCELLED;
  if (reason) {
    po.notes = po.notes ? `${po.notes}\nCancellation reason: ${reason}` : `Cancellation reason: ${reason}`;
  }
  await po.save();

  await activity.record({
    action: 'RETAIL_PO_CANCELLED',
    entity: 'RetailPurchaseOrder',
    entityId: po._id,
    locationId: po.locationId,
    message: `Cancelled retail purchase order ${po.poNumber}${reason ? `: ${reason}` : ''}`,
  });

  return po;
};

export const RetailPurchaseOrderService = {
  createPurchaseOrder,
  getAllPurchaseOrders,
  getPurchaseOrderById,
  updatePurchaseOrder,
  sendPurchaseOrder,
  receiveGoods,
  cancelPurchaseOrder,
};
