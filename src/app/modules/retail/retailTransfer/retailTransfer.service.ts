import { Request } from 'express';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { canAccessLocation } from '../../../middlewares/locationScope';
import { found, metaOf, paginationOf } from '../../../utils/query';
import { requestContext } from '../../../utils/requestContext';
import { runInTransaction } from '../../../utils/transaction';
import { activity } from '../../auditLog/auditLog.service';
import { Location } from '../../location/location.model';
import { InventoryItem } from '../../inventory/inventory.model';
import { recordMovement } from '../../inventory/inventory.service';
import { nextSequence } from '../../system/counter.model';
import { RetailInventoryService } from '../retailInventory/retailInventory.service';
import { RetailProduct } from '../retailProduct/retailProduct.model';
import {
  IRetailTransferLine,
  RETAIL_TRANSFER_STATUS,
} from './retailTransfer.interface';
import { RetailTransfer } from './retailTransfer.model';

const createTransfer = async (
  req: Request,
  fromLocationId: string,
  payload: {
    toLocationId: string;
    lines: {
      productId: string;
      variantId?: string;
      quantity: number;
    }[];
    notes?: string;
    autoDispatch?: boolean;
  },
) => {
  if (String(fromLocationId) === String(payload.toLocationId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Source and destination locations must be different');
  }

  if (!canAccessLocation(req, fromLocationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to the source location');
  }

  found(await Location.findById(payload.toLocationId).lean(), 'Destination location');

  const tenantId = requestContext.get()?.tenantId;
  const processedLines: IRetailTransferLine[] = [];

  for (const line of payload.lines) {
    const product = found(await RetailProduct.findById(line.productId).lean(), 'Retail product');
    let sku = product.sku;
    let productName = product.name;

    if (line.variantId) {
      const variant = (product.variants || []).find((v) => String(v._id) === String(line.variantId));
      if (!variant) throw new AppError(httpStatus.NOT_FOUND, 'Product variant not found');
      sku = variant.sku;
      productName = `${product.name} - ${variant.name}`;
    }

    const stockItem = await RetailInventoryService.ensureInventoryItem(
      line.productId,
      line.variantId,
      fromLocationId,
    );

    if (stockItem.quantity < line.quantity) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Insufficient stock for ${productName} (${sku}) at source location. Available: ${stockItem.quantity}, requested: ${line.quantity}`,
      );
    }

    processedLines.push({
      productId: product._id,
      variantId: line.variantId ? new Types.ObjectId(line.variantId) : undefined,
      stockItemId: stockItem._id,
      sku,
      productName,
      quantity: line.quantity,
      unitCost: stockItem.unitCost,
    });
  }

  const seq = await nextSequence(`retail-transfer:${tenantId}`);
  const transferNumber = `TR-${String(seq).padStart(5, '0')}`;

  const transfer = await RetailTransfer.create({
    transferNumber,
    fromLocationId: new Types.ObjectId(fromLocationId),
    toLocationId: new Types.ObjectId(payload.toLocationId),
    status: RETAIL_TRANSFER_STATUS.DRAFT,
    lines: processedLines,
    notes: payload.notes,
    createdBy: requestContext.get()?.userId ? new Types.ObjectId(requestContext.get()?.userId) : undefined,
  });

  if (payload.autoDispatch) {
    return dispatchTransfer(req, String(transfer._id));
  }

  await activity.record({
    action: 'RETAIL_TRANSFER_CREATED',
    entity: 'RetailTransfer',
    entityId: transfer._id,
    locationId: fromLocationId,
    message: `Created transfer ${transfer.transferNumber} from source to destination location`,
  });

  return RetailTransfer.findById(transfer._id)
    .populate('fromLocationId', 'name code branchType')
    .populate('toLocationId', 'name code branchType')
    .lean();
};

const dispatchTransfer = async (req: Request, id: string) => {
  return runInTransaction(async () => {
    const transfer = found(await RetailTransfer.findById(id), 'Retail transfer');

    if (!canAccessLocation(req, transfer.fromLocationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to dispatch from this location');
    }

    if (transfer.status !== RETAIL_TRANSFER_STATUS.DRAFT) {
      throw new AppError(httpStatus.CONFLICT, `Cannot dispatch transfer with status ${transfer.status}`);
    }

    const toLoc = await Location.findById(transfer.toLocationId).select('name').lean();

    // Deduct stock from origin location (Stock in transit: double counting prevented!)
    for (const line of transfer.lines) {
      const stockItem = found(await InventoryItem.findById(line.stockItemId), 'Source inventory item');
      if (stockItem.quantity < line.quantity) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Cannot dispatch. Insufficient stock for ${line.productName}. Available: ${stockItem.quantity}, requested: ${line.quantity}`,
        );
      }

      await recordMovement({
        stockItemId: line.stockItemId,
        type: 'TRANSFER_OUT',
        quantity: -line.quantity,
        reason: `Transfer ${transfer.transferNumber} dispatched to ${toLoc?.name || 'destination'}`,
        ref: { kind: 'RetailTransfer', id: String(transfer._id) },
      });
    }

    transfer.status = RETAIL_TRANSFER_STATUS.DISPATCHED;
    transfer.dispatchedAt = new Date();
    transfer.dispatchedBy = requestContext.get()?.userId ? new Types.ObjectId(requestContext.get()?.userId) : undefined;
    await transfer.save();

    await activity.record({
      action: 'RETAIL_TRANSFER_DISPATCHED',
      entity: 'RetailTransfer',
      entityId: transfer._id,
      locationId: transfer.fromLocationId,
      message: `Dispatched stock transfer ${transfer.transferNumber}`,
    });

    return RetailTransfer.findById(transfer._id)
      .populate('fromLocationId', 'name code branchType')
      .populate('toLocationId', 'name code branchType')
      .populate('dispatchedBy', 'name email')
      .lean();
  });
};

const receiveTransfer = async (req: Request, id: string) => {
  return runInTransaction(async () => {
    const transfer = found(await RetailTransfer.findById(id), 'Retail transfer');

    if (!canAccessLocation(req, transfer.toLocationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to receive stock at destination location');
    }

    if (transfer.status !== RETAIL_TRANSFER_STATUS.DISPATCHED) {
      throw new AppError(httpStatus.CONFLICT, `Cannot receive transfer with status ${transfer.status}`);
    }

    const fromLoc = await Location.findById(transfer.fromLocationId).select('name').lean();

    // Credit stock at destination location
    for (const line of transfer.lines) {
      const destItem = await RetailInventoryService.ensureInventoryItem(
        String(line.productId),
        line.variantId ? String(line.variantId) : undefined,
        String(transfer.toLocationId),
        { unitCost: line.unitCost },
      );

      await recordMovement({
        stockItemId: destItem._id,
        type: 'TRANSFER_IN',
        quantity: line.quantity,
        unitCost: line.unitCost,
        reason: `Transfer ${transfer.transferNumber} received from ${fromLoc?.name || 'source'}`,
        ref: { kind: 'RetailTransfer', id: String(transfer._id) },
      });
    }

    transfer.status = RETAIL_TRANSFER_STATUS.RECEIVED;
    transfer.receivedAt = new Date();
    transfer.receivedBy = requestContext.get()?.userId ? new Types.ObjectId(requestContext.get()?.userId) : undefined;
    await transfer.save();

    await activity.record({
      action: 'RETAIL_TRANSFER_RECEIVED',
      entity: 'RetailTransfer',
      entityId: transfer._id,
      locationId: transfer.toLocationId,
      message: `Received stock transfer ${transfer.transferNumber}`,
    });

    return RetailTransfer.findById(transfer._id)
      .populate('fromLocationId', 'name code branchType')
      .populate('toLocationId', 'name code branchType')
      .populate('receivedBy', 'name email')
      .lean();
  });
};

const cancelTransfer = async (req: Request, id: string, reason: string) => {
  return runInTransaction(async () => {
    const transfer = found(await RetailTransfer.findById(id), 'Retail transfer');

    if (!canAccessLocation(req, transfer.fromLocationId) && !canAccessLocation(req, transfer.toLocationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this transfer');
    }

    if (transfer.status === RETAIL_TRANSFER_STATUS.RECEIVED) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Cannot cancel a transfer that has already been received');
    }

    if (transfer.status === RETAIL_TRANSFER_STATUS.CANCELLED) {
      throw new AppError(httpStatus.CONFLICT, 'Transfer is already cancelled');
    }

    // If already dispatched, reverse goods back to origin location!
    if (transfer.status === RETAIL_TRANSFER_STATUS.DISPATCHED) {
      for (const line of transfer.lines) {
        await recordMovement({
          stockItemId: line.stockItemId,
          type: 'TRANSFER_IN',
          quantity: line.quantity,
          unitCost: line.unitCost,
          reason: `Transfer ${transfer.transferNumber} cancelled: returned to source`,
          ref: { kind: 'RetailTransfer', id: String(transfer._id) },
        });
      }
    }

    transfer.status = RETAIL_TRANSFER_STATUS.CANCELLED;
    transfer.cancelledAt = new Date();
    transfer.cancelledBy = requestContext.get()?.userId ? new Types.ObjectId(requestContext.get()?.userId) : undefined;
    transfer.cancellationReason = reason;
    await transfer.save();

    await activity.record({
      action: 'RETAIL_TRANSFER_CANCELLED',
      entity: 'RetailTransfer',
      entityId: transfer._id,
      locationId: transfer.fromLocationId,
      message: `Cancelled transfer ${transfer.transferNumber}: ${reason}`,
    });

    return transfer;
  });
};

const directTransfer = async (
  req: Request,
  fromLocationId: string,
  payload: {
    toLocationId: string;
    lines: {
      productId: string;
      variantId?: string;
      quantity: number;
    }[];
    notes?: string;
  },
) => {
  return runInTransaction(async () => {
    const transferDoc = (await createTransfer(req, fromLocationId, {
      ...payload,
      autoDispatch: false,
    })) as any;

    await dispatchTransfer(req, String(transferDoc._id));
    return receiveTransfer(req, String(transferDoc._id));
  });
};

const getAllTransfers = async (
  locationFilterObj: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const { page, limit, skip } = paginationOf(query, 20);
  const filter: Record<string, unknown> = {};

  if (locationFilterObj.locationId) {
    const locId = locationFilterObj.locationId;
    if (typeof locId === 'object' && '$in' in (locId as any)) {
      filter.$or = [{ fromLocationId: locId }, { toLocationId: locId }];
    } else {
      filter.$or = [{ fromLocationId: locId }, { toLocationId: locId }];
    }
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.fromLocationId) {
    filter.fromLocationId = new Types.ObjectId(String(query.fromLocationId));
  }

  if (query.toLocationId) {
    filter.toLocationId = new Types.ObjectId(String(query.toLocationId));
  }

  if (query.searchTerm && typeof query.searchTerm === 'string') {
    const term = query.searchTerm.trim();
    filter.$or = [{ transferNumber: { $regex: term, $options: 'i' } }, { notes: { $regex: term, $options: 'i' } }];
  }

  const sortOrder = (query.sort as string) || '-createdAt';
  const [data, total] = await Promise.all([
    RetailTransfer.find(filter)
      .populate('fromLocationId', 'name code branchType')
      .populate('toLocationId', 'name code branchType')
      .populate('createdBy', 'name email')
      .populate('dispatchedBy', 'name email')
      .populate('receivedBy', 'name email')
      .sort(sortOrder)
      .skip(skip)
      .limit(limit)
      .lean(),
    RetailTransfer.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

const getTransferById = async (req: Request, id: string) => {
  const transfer = found(
    await RetailTransfer.findById(id)
      .populate('fromLocationId', 'name code branchType address')
      .populate('toLocationId', 'name code branchType address')
      .populate('createdBy', 'name email')
      .populate('dispatchedBy', 'name email')
      .populate('receivedBy', 'name email')
      .lean(),
    'Retail transfer',
  );

  if (
    !canAccessLocation(req, transfer.fromLocationId as any) &&
    !canAccessLocation(req, transfer.toLocationId as any)
  ) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this transfer');
  }

  return transfer;
};

export const RetailTransferService = {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  cancelTransfer,
  directTransfer,
  getAllTransfers,
  getTransferById,
};
