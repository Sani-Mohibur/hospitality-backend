import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { escapeRegex, found, metaOf, paginationOf } from '../../../utils/query';
import { activity } from '../../auditLog/auditLog.service';
import { InventoryItem } from '../../inventory/inventory.model';
import { RetailCategory } from '../retailCategory/retailCategory.model';
import { IRetailProduct } from './retailProduct.interface';
import { RetailProduct } from './retailProduct.model';

const validateUniqueSkusAndBarcodes = async (
  skuList: string[],
  barcodeList: string[],
  excludeProductId?: string,
) => {
  const normalizedSkus = skuList.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const skuSet = new Set<string>();
  for (const s of normalizedSkus) {
    if (skuSet.has(s)) {
      throw new AppError(httpStatus.CONFLICT, `Duplicate SKU '${s}' within product or variants`);
    }
    skuSet.add(s);
  }

  const normalizedBarcodes = barcodeList.map((b) => b.trim()).filter(Boolean);
  const barcodeSet = new Set<string>();
  for (const b of normalizedBarcodes) {
    if (barcodeSet.has(b)) {
      throw new AppError(httpStatus.CONFLICT, `Duplicate barcode '${b}' within product or variants`);
    }
    barcodeSet.add(b);
  }

  if (normalizedSkus.length > 0) {
    const skuFilter: Record<string, unknown> = {
      $or: [
        { sku: { $in: normalizedSkus } },
        { 'variants.sku': { $in: normalizedSkus } },
      ],
      isDeleted: { $ne: true },
    };
    if (excludeProductId) {
      skuFilter._id = { $ne: new Types.ObjectId(excludeProductId) };
    }
    const conflict = await RetailProduct.findOne(skuFilter).lean();
    if (conflict) {
      const conflictSku = normalizedSkus.find(
        (s) => conflict.sku === s || (conflict.variants || []).some((v) => v.sku === s),
      );
      throw new AppError(
        httpStatus.CONFLICT,
        `SKU '${conflictSku || normalizedSkus[0]}' is already in use by product '${conflict.name}'`,
      );
    }
  }

  if (normalizedBarcodes.length > 0) {
    const barcodeFilter: Record<string, unknown> = {
      $or: [
        { barcode: { $in: normalizedBarcodes } },
        { 'variants.barcode': { $in: normalizedBarcodes } },
      ],
      isDeleted: { $ne: true },
    };
    if (excludeProductId) {
      barcodeFilter._id = { $ne: new Types.ObjectId(excludeProductId) };
    }
    const conflict = await RetailProduct.findOne(barcodeFilter).lean();
    if (conflict) {
      const conflictBarcode = normalizedBarcodes.find(
        (b) => conflict.barcode === b || (conflict.variants || []).some((v) => v.barcode === b),
      );
      throw new AppError(
        httpStatus.CONFLICT,
        `Barcode '${conflictBarcode || normalizedBarcodes[0]}' is already in use by product '${conflict.name}'`,
      );
    }
  }
};

const createProduct = async (payload: Partial<IRetailProduct>) => {
  const category = found(await RetailCategory.findById(payload.categoryId).lean(), 'Retail category');
  if (payload.locationId && category.locationId && String(category.locationId) !== String(payload.locationId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Category belongs to another location');
  }

  if (!payload.sku) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Product SKU is required');
  }
  payload.sku = payload.sku.trim().toUpperCase();

  const skus: string[] = [payload.sku];
  const barcodes: string[] = [];
  if (payload.barcode?.trim()) {
    payload.barcode = payload.barcode.trim();
    barcodes.push(payload.barcode);
  }

  if (payload.hasVariants && payload.variants && payload.variants.length > 0) {
    for (const v of payload.variants) {
      v.sku = v.sku.trim().toUpperCase();
      skus.push(v.sku);
      if (v.barcode?.trim()) {
        v.barcode = v.barcode.trim();
        barcodes.push(v.barcode);
      }
    }
  } else {
    payload.variants = [];
  }

  await validateUniqueSkusAndBarcodes(skus, barcodes);

  const product = await RetailProduct.create(payload);

  await activity.record({
    action: 'RETAIL_PRODUCT_CREATED',
    entity: 'RetailProduct',
    entityId: product._id,
    message: `Created retail product ${product.name} (${product.sku})`,
  });

  return RetailProduct.findById(product._id)
    .populate('categoryId', 'name code')
    .populate('locationId', 'name code branchType')
    .lean();
};

const getAllProducts = async (
  locationFilterObj: Record<string, unknown>,
  query: Record<string, unknown>,
) => {
  const { page, limit, skip } = paginationOf(query, 20);
  const filter: Record<string, unknown> = { ...locationFilterObj };

  if (query.categoryId) {
    filter.categoryId = new Types.ObjectId(String(query.categoryId));
  }

  if (query.master === 'true') {
    filter.locationId = null;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true';
  }

  if (query.hasVariants !== undefined) {
    filter.hasVariants = query.hasVariants === 'true';
  }

  if (query.sku && typeof query.sku === 'string') {
    const s = query.sku.trim().toUpperCase();
    filter.$or = [{ sku: s }, { 'variants.sku': s }];
  }

  if (query.barcode && typeof query.barcode === 'string') {
    const b = query.barcode.trim();
    filter.$or = [{ barcode: b }, { 'variants.barcode': b }];
  }

  if (query.searchTerm && typeof query.searchTerm === 'string') {
    const term = query.searchTerm.trim();
    const searchFilter = {
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { sku: { $regex: term, $options: 'i' } },
        { barcode: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
        { tags: { $in: [new RegExp(escapeRegex(term), 'i')] } },
        { 'variants.name': { $regex: term, $options: 'i' } },
        { 'variants.sku': { $regex: term, $options: 'i' } },
        { 'variants.barcode': { $regex: term, $options: 'i' } },
      ],
    };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, searchFilter];
      delete filter.$or;
    } else {
      Object.assign(filter, searchFilter);
    }
  }

  const sortOrder = (query.sort as string) || 'sortOrder name';
  const [data, total] = await Promise.all([
    RetailProduct.find(filter)
      .populate('categoryId', 'name code')
      .populate('locationId', 'name code branchType')
      .sort(sortOrder)
      .skip(skip)
      .limit(limit)
      .lean(),
    RetailProduct.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

const getProductById = async (id: string) => {
  return found(
    await RetailProduct.findById(id)
      .populate('categoryId', 'name code')
      .populate('locationId', 'name code branchType')
      .lean(),
    'Retail product',
  );
};

const getProductByBarcode = async (barcode: string) => {
  const cleanBarcode = barcode.trim();
  const product = await RetailProduct.findOne({
    $or: [{ barcode: cleanBarcode }, { 'variants.barcode': cleanBarcode }],
    isDeleted: { $ne: true },
  })
    .populate('categoryId', 'name code')
    .populate('locationId', 'name code branchType')
    .lean();

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, `Product with barcode '${cleanBarcode}' not found`);
  }

  const matchedVariant = (product.variants || []).find((v) => v.barcode === cleanBarcode);

  return {
    ...product,
    matchedVariant: matchedVariant || null,
  };
};

const getProductBySku = async (sku: string) => {
  const cleanSku = sku.trim().toUpperCase();
  const product = await RetailProduct.findOne({
    $or: [{ sku: cleanSku }, { 'variants.sku': cleanSku }],
    isDeleted: { $ne: true },
  })
    .populate('categoryId', 'name code')
    .populate('locationId', 'name code branchType')
    .lean();

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, `Product with SKU '${cleanSku}' not found`);
  }

  const matchedVariant = (product.variants || []).find((v) => v.sku === cleanSku);

  return {
    ...product,
    matchedVariant: matchedVariant || null,
  };
};

const updateProduct = async (id: string, payload: Partial<IRetailProduct>) => {
  const product = found(await RetailProduct.findById(id), 'Retail product');

  if (payload.categoryId) {
    const category = found(await RetailCategory.findById(payload.categoryId).lean(), 'Retail category');
    const targetLoc = payload.locationId !== undefined ? payload.locationId : product.locationId;
    if (targetLoc && category.locationId && String(category.locationId) !== String(targetLoc)) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Category belongs to another location');
    }
  }

  const effectiveSku = payload.sku ? payload.sku.trim().toUpperCase() : product.sku;
  const effectiveBarcode = payload.barcode !== undefined ? (payload.barcode?.trim() || undefined) : product.barcode;

  const skus: string[] = [effectiveSku];
  const barcodes: string[] = effectiveBarcode ? [effectiveBarcode] : [];

  const effectiveHasVariants = payload.hasVariants !== undefined ? payload.hasVariants : product.hasVariants;
  const effectiveVariants = payload.variants !== undefined ? payload.variants : product.variants;

  if (effectiveHasVariants && effectiveVariants && effectiveVariants.length > 0) {
    for (const v of effectiveVariants) {
      v.sku = v.sku.trim().toUpperCase();
      skus.push(v.sku);
      if (v.barcode?.trim()) {
        v.barcode = v.barcode.trim();
        barcodes.push(v.barcode);
      }
    }
  }

  if (payload.sku) payload.sku = effectiveSku;
  if (payload.barcode !== undefined) payload.barcode = effectiveBarcode;
  if (payload.variants) {
    payload.variants = effectiveVariants;
  }

  await validateUniqueSkusAndBarcodes(skus, barcodes, id);

  const before = product.toObject();
  Object.assign(product, payload);
  if (payload.hasVariants === false) {
    product.variants = [];
  }
  await product.save();

  await activity.record({
    action: 'RETAIL_PRODUCT_UPDATED',
    entity: 'RetailProduct',
    entityId: product._id,
    message: `Updated retail product ${product.name} (${product.sku})`,
    before,
    after: product.toObject(),
  });

  return RetailProduct.findById(product._id)
    .populate('categoryId', 'name code')
    .populate('locationId', 'name code branchType')
    .lean();
};

const deleteProduct = async (id: string) => {
  const product = found(await RetailProduct.findById(id), 'Retail product');
  product.isDeleted = true;
  product.isActive = false;
  await product.save();

  await activity.record({
    action: 'RETAIL_PRODUCT_DELETED',
    entity: 'RetailProduct',
    entityId: product._id,
    message: `Deleted retail product ${product.name} (${product.sku})`,
  });

  return product;
};

const getProductInventoryStatus = async (id: string, locationId?: string) => {
  const product = found(await RetailProduct.findById(id).lean(), 'Retail product');
  const skus = [product.sku, ...(product.variants || []).map((v) => v.sku)].filter(Boolean);

  const filter: Record<string, unknown> = {
    sku: { $in: skus },
    isDeleted: { $ne: true },
  };
  if (locationId) {
    filter.locationId = new Types.ObjectId(String(locationId));
  }

  const items = await InventoryItem.find(filter)
    .populate('locationId', 'name code branchType')
    .lean();

  return {
    productId: product._id,
    productName: product.name,
    sku: product.sku,
    hasVariants: product.hasVariants,
    variants: (product.variants || []).map((v) => ({
      _id: v._id,
      name: v.name,
      sku: v.sku,
      barcode: v.barcode,
    })),
    stockItems: items.map((item: any) => ({
      _id: item._id,
      sku: item.sku,
      quantity: item.quantity,
      unitCost: item.unitCost,
      unitOfMeasure: item.unitOfMeasure,
      parLevel: item.parLevel,
      reorderPoint: item.reorderPoint,
      reorderQty: item.reorderQty,
      location: item.locationId,
    })),
  };
};

export const RetailProductService = {
  createProduct,
  getAllProducts,
  getProductById,
  getProductByBarcode,
  getProductBySku,
  updateProduct,
  deleteProduct,
  getProductInventoryStatus,
};
