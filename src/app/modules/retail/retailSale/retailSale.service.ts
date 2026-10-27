import { Request } from 'express';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { canAccessLocation } from '../../../middlewares/locationScope';
import { escapeRegex, found, metaOf, paginationOf } from '../../../utils/query';
import { requestContext } from '../../../utils/requestContext';
import { runInTransaction } from '../../../utils/transaction';
import { emitDomainEvent } from '../../../utils/domainEvents';
import { calculateTax, percentOf, TTaxLine, TTaxRuleLike } from '../../../utils/money';
import { allocate } from '../../restaurant/order/order.pricing';
import { activity } from '../../auditLog/auditLog.service';
import { nextSequence } from '../../system/counter.model';
import { Payment } from '../../payment/payment.model';
import { PAYMENT_METHOD, PAYMENT_STATUS, TPaymentMethod } from '../../payment/payment.interface';
import { PaymentService } from '../../payment/payment.service';
import { CashMovement, Shift } from '../../shift/shift.model';
import { FolioLedger } from '../../hospitality/folio/folio.ledger';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE } from '../../hospitality/folio/folio.interface';
import { Guest } from '../../hospitality/guest/guest.model';
import { ReservationServices } from '../../hospitality/reservation/reservation.service';
import { Tenant } from '../../tenant/tenant.model';
import { Location } from '../../location/location.model';
import { ApprovalService } from '../../approval/approval.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { InventoryItem } from '../../inventory/inventory.model';
import { recordMovement } from '../../inventory/inventory.service';
import { RetailProduct } from '../retailProduct/retailProduct.model';
import { RetailInventoryService } from '../retailInventory/retailInventory.service';
import { taxRulesFor, tenantTaxInclusive } from '../../finance/finance.service';
import {
  IRetailReturn,
  IRetailSale,
  IRetailSaleDiscount,
  IRetailSaleLine,
  IRetailSalePayment,
  RETAIL_PAYMENT_STATUS,
  RETAIL_SALE_STATUS,
} from './retailSale.interface';
import { RetailReturn, RetailSale } from './retailSale.model';

type TCartItemInput = {
  productId: string;
  variantId?: string;
  quantity: number;
  discount?: {
    type: 'PERCENT' | 'AMOUNT' | 'COMP';
    value: number;
    reason?: string;
  };
};

type TCartDiscountInput = {
  type: 'PERCENT' | 'AMOUNT' | 'COMP';
  value: number;
  reason: string;
};

type TPaymentInput = {
  method: TPaymentMethod;
  amountMinor: number;
  tenderedMinor?: number;
  reference?: string;
  note?: string;
  roomCharge?: {
    roomNumber?: string;
    roomStayId?: string;
    guestLastName?: string;
    signatureUrl?: string;
  };
  companyAccountId?: string;
};

type TCheckoutPayload = {
  locationId?: string;
  items: TCartItemInput[];
  discounts?: TCartDiscountInput[];
  payments: TPaymentInput[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  clientRef?: string;
  notes?: string;
  shiftId?: string;
};

type TReturnLineInput = {
  saleLineId?: string;
  productId: string;
  variantId?: string;
  quantity: number;
  restock: boolean;
  condition?: 'RESELLABLE' | 'DAMAGED' | 'DEFECTIVE';
  reason: string;
};

type TReturnPayload = {
  lines: TReturnLineInput[];
  refundMethod: TPaymentMethod;
  reason: string;
  notes?: string;
  shiftId?: string;
};

// ---------- Helpers ----------

const openShiftOf = async (userId: string) => Shift.findOne({ userId, status: 'OPEN' }).lean();

const discountAmount = (discount: { type: 'PERCENT' | 'AMOUNT' | 'COMP'; value: number } | undefined, base: number) => {
  if (!discount || base <= 0) return 0;
  if (discount.type === 'COMP') return base;
  if (discount.type === 'PERCENT') return Math.min(base, percentOf(base, discount.value));
  return Math.min(base, Math.round(discount.value));
};

const mergeTaxLines = (target: Map<string, TTaxLine>, lines: TTaxLine[]) => {
  for (const line of lines) {
    const key = `${line.name}:${line.rateBps}`;
    const row = target.get(key) || { name: line.name, rateBps: line.rateBps, amountMinor: 0, taxRuleId: line.taxRuleId };
    row.amountMinor += line.amountMinor;
    target.set(key, row);
  }
};

// ---------- Live Cart Pricing Engine ----------

const calculateCartInternal = async (
  locationId: string,
  items: TCartItemInput[],
  discounts: TCartDiscountInput[] = [],
) => {
  if (!items.length) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cart must have at least one item');
  }

  const [rules, inclusive] = await Promise.all([taxRulesFor(locationId), tenantTaxInclusive()]);

  // 1. Fetch products & variants
  const resolvedLines: Array<{
    product: any;
    variant: any;
    quantity: number;
    unitPriceMinor: number;
    costPriceMinor: number;
    discount?: TCartItemInput['discount'];
  }> = [];

  for (const item of items) {
    const product = found(
      await RetailProduct.findOne({
        _id: item.productId,
        isActive: true,
        isDeleted: { $ne: true },
      }).lean(),
      'Retail product',
    );

    let variant: any;
    let unitPriceMinor = product.priceMinor;
    let costPriceMinor = product.costPriceMinor || 0;

    if (item.variantId) {
      variant = (product.variants || []).find((v: any) => String(v._id) === String(item.variantId));
      if (!variant || !variant.isActive) {
        throw new AppError(httpStatus.NOT_FOUND, `Product variant ${item.variantId} not found or inactive`);
      }
      unitPriceMinor = variant.priceMinor;
      costPriceMinor = variant.costPriceMinor ?? product.costPriceMinor ?? 0;
    }

    resolvedLines.push({
      product,
      variant,
      quantity: item.quantity,
      unitPriceMinor,
      costPriceMinor,
      discount: item.discount,
    });
  }

  // 2. Gross & Item-level Discounts
  const grossValues = resolvedLines.map((line) => line.quantity * line.unitPriceMinor);
  const itemDiscounts = resolvedLines.map((line, idx) => discountAmount(line.discount, grossValues[idx]!));
  const afterItemDiscounts = grossValues.map((gross, idx) => gross - itemDiscounts[idx]!);
  const baseTotal = afterItemDiscounts.reduce((sum, val) => sum + val, 0);

  // 3. Whole-Sale / Order Discounts allocated proportionally
  let wholeSaleDiscount = 0;
  for (const d of discounts) {
    wholeSaleDiscount += discountAmount(d, baseTotal - wholeSaleDiscount);
  }
  wholeSaleDiscount = Math.min(wholeSaleDiscount, baseTotal);

  const allocatedCartDiscounts = allocate(wholeSaleDiscount, afterItemDiscounts);
  const nets = afterItemDiscounts.map((after, idx) => after - allocatedCartDiscounts[idx]!);

  // 4. Tax Calculation per line
  const lines: IRetailSaleLine[] = [];
  const taxLinesMap = new Map<string, TTaxLine>();

  let subtotalMinor = 0;
  let discountTotalMinor = 0;
  let netTotalMinor = 0;
  let taxTotalMinor = 0;
  let grandTotalMinor = 0;

  for (let idx = 0; idx < resolvedLines.length; idx++) {
    const resolved = resolvedLines[idx]!;
    const gross = grossValues[idx]!;
    const itemDisc = itemDiscounts[idx]!;
    const cartDisc = allocatedCartDiscounts[idx]!;
    const totalLineDiscount = itemDisc + cartDisc;
    const net = nets[idx]!;

    const taxCategory = resolved.product.taxCategory || 'RETAIL';
    const taxRes = calculateTax(net, taxCategory, rules as TTaxRuleLike[], inclusive);

    mergeTaxLines(taxLinesMap, taxRes.taxLines);

    const lineTotal = inclusive ? net : taxRes.grossMinor;

    subtotalMinor += gross;
    discountTotalMinor += totalLineDiscount;
    netTotalMinor += taxRes.netMinor;
    taxTotalMinor += taxRes.taxMinor;
    grandTotalMinor += lineTotal;

    lines.push({
      productId: resolved.product._id,
      variantId: resolved.variant ? resolved.variant._id : undefined,
      stockItemId: undefined as any, // resolved during checkout
      name: resolved.variant ? `${resolved.product.name} - ${resolved.variant.name}` : resolved.product.name,
      sku: resolved.variant ? resolved.variant.sku : resolved.product.sku,
      barcode: resolved.variant?.barcode || resolved.product.barcode,
      categoryName: resolved.product.categoryId?.name || 'Retail',
      taxCategory,
      quantity: resolved.quantity,
      unitPriceMinor: resolved.unitPriceMinor,
      costPriceMinor: resolved.costPriceMinor,
      discount: resolved.discount
        ? {
            type: resolved.discount.type,
            value: resolved.discount.value,
            amountMinor: totalLineDiscount,
            reason: resolved.discount.reason,
          }
        : undefined,
      grossMinor: gross,
      discountMinor: totalLineDiscount,
      netMinor: taxRes.netMinor,
      taxMinor: taxRes.taxMinor,
      totalMinor: lineTotal,
      taxLines: taxRes.taxLines,
      returnedQuantity: 0,
    });
  }

  const taxLines = Array.from(taxLinesMap.values());

  return {
    lines,
    subtotalMinor,
    discountTotalMinor,
    netTotalMinor,
    taxTotalMinor,
    totalMinor: grandTotalMinor,
    taxLines,
    inclusive,
  };
};

// ---------- POS Product Search & Lookup ----------

const posProductSearch = async (req: Request, query: Record<string, unknown>) => {
  const locationId = (query.locationId as string) || req.locationId;
  const filter: Record<string, unknown> = {
    isActive: true,
    isDeleted: { $ne: true },
    $or: [{ locationId: { $exists: false } }, { locationId: null }, ...(locationId ? [{ locationId }] : [])],
  };

  if (query.categoryId) {
    filter.categoryId = new Types.ObjectId(String(query.categoryId));
  }

  const search = (query.q as string) || (query.search as string);
  if (search) {
    const rx = escapeRegex(search.trim());
    filter.$and = [
      {
        $or: [
          { name: { $regex: rx, $options: 'i' } },
          { sku: { $regex: rx, $options: 'i' } },
          { barcode: { $regex: rx, $options: 'i' } },
          { 'variants.name': { $regex: rx, $options: 'i' } },
          { 'variants.sku': { $regex: rx, $options: 'i' } },
          { 'variants.barcode': { $regex: rx, $options: 'i' } },
        ],
      },
    ];
  }

  if (query.sku) {
    filter.$or = [{ sku: query.sku }, { 'variants.sku': query.sku }];
  }
  if (query.barcode) {
    filter.$or = [{ barcode: query.barcode }, { 'variants.barcode': query.barcode }];
  }

  const { page, limit, skip } = paginationOf(query, 50);

  const [products, total] = await Promise.all([
    RetailProduct.find(filter)
      .populate('categoryId', 'name')
      .sort({ sortOrder: 1, name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RetailProduct.countDocuments(filter),
  ]);

  // Load stock for products if locationId is given
  const skus: string[] = [];
  for (const p of products) {
    skus.push(p.sku);
    for (const v of p.variants || []) skus.push(v.sku);
  }

  let inventoryMap = new Map<string, number>();
  if (locationId && skus.length) {
    const stockItems = await InventoryItem.find({
      locationId: new Types.ObjectId(locationId),
      sku: { $in: skus },
      isDeleted: { $ne: true },
    })
      .select('sku quantity')
      .lean();
    for (const item of stockItems) {
      inventoryMap.set(item.sku, item.quantity);
    }
  }

  const items = products.flatMap((p) => {
    if (p.hasVariants && p.variants?.length) {
      return p.variants
        .filter((v: any) => v.isActive)
        .map((v: any) => ({
          productId: p._id,
          variantId: v._id,
          name: `${p.name} - ${v.name}`,
          productName: p.name,
          variantName: v.name,
          sku: v.sku,
          barcode: v.barcode,
          priceMinor: v.priceMinor,
          costPriceMinor: v.costPriceMinor ?? p.costPriceMinor ?? 0,
          taxCategory: p.taxCategory,
          unitOfMeasure: p.unitOfMeasure,
          categoryName: (p.categoryId as any)?.name || 'Retail',
          imageUrl: p.imageUrl,
          stockOnHand: inventoryMap.get(v.sku) ?? 0,
          hasVariants: true,
        }));
    }

    return [
      {
        productId: p._id,
        variantId: undefined,
        name: p.name,
        productName: p.name,
        variantName: undefined,
        sku: p.sku,
        barcode: p.barcode,
        priceMinor: p.priceMinor,
        costPriceMinor: p.costPriceMinor || 0,
        taxCategory: p.taxCategory,
        unitOfMeasure: p.unitOfMeasure,
        categoryName: (p.categoryId as any)?.name || 'Retail',
        imageUrl: p.imageUrl,
        stockOnHand: inventoryMap.get(p.sku) ?? 0,
        hasVariants: false,
      },
    ];
  });

  return { data: items, meta: metaOf(page, limit, total) };
};

const posPriceCheck = async (req: Request, query: Record<string, unknown>) => {
  const locationId = (query.locationId as string) || req.locationId;
  const barcode = query.barcode as string;
  const sku = query.sku as string;
  const productId = query.productId as string;
  const variantId = query.variantId as string;

  if (!barcode && !sku && !productId) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Provide barcode, SKU, or productId for price check');
  }

  let product: any;
  let matchedVariant: any;

  if (productId) {
    product = await RetailProduct.findOne({ _id: productId, isActive: true, isDeleted: { $ne: true } })
      .populate('categoryId', 'name')
      .lean();
    if (product && variantId) {
      matchedVariant = (product.variants || []).find((v: any) => String(v._id) === String(variantId));
    }
  } else if (barcode) {
    product = await RetailProduct.findOne({
      isActive: true,
      isDeleted: { $ne: true },
      $or: [{ barcode }, { 'variants.barcode': barcode }],
    })
      .populate('categoryId', 'name')
      .lean();
    if (product) {
      matchedVariant = (product.variants || []).find((v: any) => v.barcode === barcode);
    }
  } else if (sku) {
    product = await RetailProduct.findOne({
      isActive: true,
      isDeleted: { $ne: true },
      $or: [{ sku }, { 'variants.sku': sku }],
    })
      .populate('categoryId', 'name')
      .lean();
    if (product) {
      matchedVariant = (product.variants || []).find((v: any) => v.sku === sku);
    }
  }

  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, 'Product not found');
  }

  const effectiveSku = matchedVariant ? matchedVariant.sku : product.sku;
  let stockOnHand = 0;
  if (locationId) {
    const inv = await InventoryItem.findOne({
      locationId: new Types.ObjectId(locationId),
      sku: effectiveSku,
      isDeleted: { $ne: true },
    })
      .select('quantity')
      .lean();
    stockOnHand = inv?.quantity || 0;
  }

  const [rules, inclusive] = await Promise.all([taxRulesFor(locationId), tenantTaxInclusive()]);
  const priceMinor = matchedVariant ? matchedVariant.priceMinor : product.priceMinor;
  const taxCategory = product.taxCategory || 'RETAIL';
  const tax = calculateTax(priceMinor, taxCategory, rules as TTaxRuleLike[], inclusive);

  return {
    productId: product._id,
    variantId: matchedVariant?._id,
    name: matchedVariant ? `${product.name} - ${matchedVariant.name}` : product.name,
    sku: effectiveSku,
    barcode: matchedVariant?.barcode || product.barcode,
    priceMinor,
    taxCategory,
    stockOnHand,
    taxInclusive: inclusive,
    netMinor: tax.netMinor,
    taxMinor: tax.taxMinor,
    taxLines: tax.taxLines,
  };
};

// ---------- Customer / Guest Lookup ----------

const searchCustomers = async (req: Request, query: Record<string, unknown>) => {
  const search = (query.q as string) || (query.search as string);
  const filter: Record<string, unknown> = {};

  if (search) {
    const rx = escapeRegex(search.trim());
    filter.$or = [
      { firstName: { $regex: rx, $options: 'i' } },
      { lastName: { $regex: rx, $options: 'i' } },
      { email: { $regex: rx, $options: 'i' } },
      { phone: { $regex: rx, $options: 'i' } },
    ];
  }

  const { page, limit, skip } = paginationOf(query, 20);

  const [guests, total] = await Promise.all([
    Guest.find(filter).sort({ lastName: 1, firstName: 1 }).skip(skip).limit(limit).lean(),
    Guest.countDocuments(filter),
  ]);

  const customerList = await Promise.all(
    guests.map(async (g) => {
      let loyalty;
      try {
        loyalty = await LoyaltyService.wallet(String(g._id));
      } catch {
        loyalty = { pointsBalance: 0, tier: 'MEMBER' };
      }
      return {
        _id: g._id,
        name: `${g.firstName} ${g.lastName}`.trim(),
        firstName: g.firstName,
        lastName: g.lastName,
        email: g.email,
        phone: g.phone,
        loyaltyPoints: loyalty?.pointsBalance || 0,
        loyaltyTier: loyalty?.tier || 'MEMBER',
      };
    }),
  );

  return { data: customerList, meta: metaOf(page, limit, total) };
};

const getCustomerLoyalty = async (guestId: string) => {
  const guest = found(await Guest.findById(guestId).lean(), 'Customer');
  const wallet = await LoyaltyService.wallet(guestId);
  return {
    customer: {
      _id: guest._id,
      name: `${guest.firstName} ${guest.lastName}`.trim(),
      email: guest.email,
      phone: guest.phone,
    },
    loyalty: wallet,
  };
};

// ---------- Calculate Cart (External API) ----------

const calculateCart = async (req: Request, payload: { locationId?: string; items: TCartItemInput[]; discounts?: TCartDiscountInput[]; customerId?: string }) => {
  const locationId = payload.locationId || req.locationId;
  if (!locationId) throw new AppError(httpStatus.BAD_REQUEST, 'Location is required');
  if (!canAccessLocation(req, locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
  }

  const calc = await calculateCartInternal(locationId, payload.items, payload.discounts);

  let customerLoyalty;
  if (payload.customerId) {
    try {
      customerLoyalty = await LoyaltyService.wallet(payload.customerId);
    } catch {
      // ignore
    }
  }

  return {
    ...calc,
    customerLoyalty,
  };
};

// ---------- Checkout ----------

const checkout = async (req: Request, payload: TCheckoutPayload) => {
  const locationId = payload.locationId || req.locationId;
  if (!locationId) throw new AppError(httpStatus.BAD_REQUEST, 'Location is required for checkout');
  if (!canAccessLocation(req, locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
  }

  // 1. Idempotency Check
  if (payload.clientRef) {
    const existing = await RetailSale.findOne({ clientRef: payload.clientRef })
      .populate('cashierId', 'name email')
      .populate('customerId', 'firstName lastName email phone')
      .lean();
    if (existing) {
      return { sale: existing, replayed: true };
    }
  }

  const location = found(await Location.findById(locationId).lean(), 'Location');
  const tenant = found(await Tenant.findById(req.user.tenantId).lean(), 'Tenant');

  // 2. Server-side Live Calculation
  const calc = await calculateCartInternal(locationId, payload.items, payload.discounts);

  // 3. Discount Permissions & Approvals
  const totalDiscount = calc.discountTotalMinor;
  if (totalDiscount > 0) {
    // If discount is COMP or substantial, require discount permission or manager approval
    const hasComp = payload.discounts?.some((d) => d.type === 'COMP') || payload.items.some((i) => i.discount?.type === 'COMP');
    if (hasComp && !req.user.permissions.includes('retail.orders.manage')) {
      await ApprovalService.requireApproval(req, 'COMP', true);
    }
  }

  // 4. Validate Stock Availability & Resolve Inventory Items
  const inventoryItemsToDeduct: Array<{ invItem: any; quantity: number }> = [];

  for (const line of calc.lines) {
    const invItem = await RetailInventoryService.ensureInventoryItem(
      String(line.productId),
      line.variantId ? String(line.variantId) : undefined,
      locationId,
    );

    if (invItem.quantity < line.quantity) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Insufficient stock for "${line.name}". On hand: ${invItem.quantity}, requested: ${line.quantity}`,
      );
    }

    line.stockItemId = invItem._id as Types.ObjectId;
    inventoryItemsToDeduct.push({ invItem, quantity: line.quantity });
  }

  // 5. Payment Validation
  const paymentsTotal = payload.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  if (paymentsTotal < calc.totalMinor) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Payment sum (${paymentsTotal}) is less than total due (${calc.totalMinor})`,
    );
  }

  // 6. Numbering
  const seq = await nextSequence(`retail-sale:${req.user.tenantId}`);
  const receiptNumber = `RCP-${String(seq).padStart(6, '0')}`;
  const prefix = location.code ? `${location.code}-RET` : 'RET';
  const invoiceNumber = `INV-${prefix}-${String(seq).padStart(6, '0')}`;

  let openShift: any;
  const cashPayment = payload.payments.find((p) => p.method === PAYMENT_METHOD.CASH);
  if (cashPayment) {
    openShift = await openShiftOf(req.user.id);
    if (!openShift) {
      throw new AppError(httpStatus.CONFLICT, 'Open a shift (cash drawer) before taking cash payments');
    }
  }

  // 7. Transactional Execution
  const sale = await runInTransaction(async () => {
    // A. Deduct stock for each line using Step 2 recordMovement
    for (const item of inventoryItemsToDeduct) {
      await recordMovement({
        stockItemId: item.invItem._id,
        type: 'SALE',
        quantity: -item.quantity,
        reason: `Retail Sale ${receiptNumber}`,
        ref: { kind: 'RetailSale', id: receiptNumber },
      });
    }

    // B. Build Payments & Folio Postings
    const processedPayments: IRetailSalePayment[] = [];
    let totalChange = 0;

    for (const pay of payload.payments) {
      let changeMinor = 0;
      if (pay.method === PAYMENT_METHOD.CASH) {
        const tendered = pay.tenderedMinor ?? pay.amountMinor;
        changeMinor = Math.max(0, tendered - pay.amountMinor);
        totalChange += changeMinor;

        if (openShift) {
          await CashMovement.create([
            {
              locationId,
              shiftId: openShift._id,
              type: 'SALE',
              amountMinor: pay.amountMinor,
              createdBy: req.user.id,
              reason: `Retail Sale ${receiptNumber}`,
            },
          ]);
        }
      }

      let roomChargePosting;
      if (pay.method === PAYMENT_METHOD.CHARGE_TO_ROOM) {
        if (!pay.roomCharge) {
          throw new AppError(httpStatus.BAD_REQUEST, 'Room charge details (room number / guest name) are required');
        }
        const resolved = await PaymentService.resolveRoomCharge(locationId, pay.roomCharge);
        await FolioLedger.postLine({
          folioId: resolved.folio._id,
          type: FOLIO_LINE_TYPE.CHARGE,
          code: 'RETAIL',
          description: `Retail store #${receiptNumber}`,
          unitAmountMinor: pay.amountMinor,
          source: { kind: FOLIO_SOURCE.RETAIL, refId: new Types.ObjectId() },
          postingKey: `RETAIL:${receiptNumber}`,
          taxOverride: { netMinor: pay.amountMinor, taxMinor: 0, taxLines: [] },
        });

        roomChargePosting = {
          roomNumber: resolved.roomNumber,
          roomStayId: resolved.stay._id as Types.ObjectId,
          folioId: resolved.folio._id as Types.ObjectId,
          guestName: resolved.guest ? `${resolved.guest.firstName} ${resolved.guest.lastName}` : undefined,
        };
      }

      let companyAccountId;
      if (pay.method === PAYMENT_METHOD.CITY_LEDGER) {
        if (!pay.companyAccountId) {
          throw new AppError(httpStatus.BAD_REQUEST, 'Choose company account for city ledger payment');
        }
        const companyFolioId = await ReservationServices.companyFolioFor(pay.companyAccountId, locationId);
        await FolioLedger.postLine({
          folioId: companyFolioId,
          type: FOLIO_LINE_TYPE.CHARGE,
          code: 'RETAIL',
          description: `Retail store #${receiptNumber}`,
          unitAmountMinor: pay.amountMinor,
          source: { kind: FOLIO_SOURCE.RETAIL, refId: new Types.ObjectId() },
          postingKey: `RETAIL:${receiptNumber}`,
          taxOverride: { netMinor: pay.amountMinor, taxMinor: 0, taxLines: [] },
        });
        companyAccountId = new Types.ObjectId(pay.companyAccountId);
      }

      if (pay.method === PAYMENT_METHOD.LOYALTY && payload.customerId) {
        await LoyaltyService.redeemForPayment(payload.customerId, {
          _id: new Types.ObjectId(),
          amountMinor: pay.amountMinor,
        });
      }

      processedPayments.push({
        method: pay.method,
        amountMinor: pay.amountMinor,
        tenderedMinor: pay.tenderedMinor,
        changeMinor,
        reference: pay.reference,
        note: pay.note,
        status: 'COMPLETED',
        roomCharge: roomChargePosting,
        companyAccountId,
        completedAt: new Date(),
      });
    }

    // C. Create Retail Sale Record
    const discountsData: IRetailSaleDiscount[] = (payload.discounts || []).map((d) => ({
      type: d.type,
      value: d.value,
      amountMinor: discountAmount(d, calc.subtotalMinor),
      reason: d.reason,
      approvedBy: undefined,
    }));

    const [createdSale] = await RetailSale.create([
      {
        locationId,
        receiptNumber,
        invoiceNumber,
        businessDate: location.businessDate,
        status: RETAIL_SALE_STATUS.COMPLETED,
        paymentStatus: RETAIL_PAYMENT_STATUS.PAID,
        customerId: payload.customerId ? new Types.ObjectId(payload.customerId) : undefined,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerEmail: payload.customerEmail,
        lines: calc.lines,
        discounts: discountsData,
        subtotalMinor: calc.subtotalMinor,
        discountTotalMinor: calc.discountTotalMinor,
        netTotalMinor: calc.netTotalMinor,
        taxTotalMinor: calc.taxTotalMinor,
        totalMinor: calc.totalMinor,
        paidMinor: paymentsTotal,
        refundedMinor: 0,
        changeMinor: totalChange,
        taxLines: calc.taxLines,
        payments: processedPayments,
        shiftId: openShift ? openShift._id : payload.shiftId ? new Types.ObjectId(payload.shiftId) : undefined,
        cashierId: req.user.id,
        clientRef: payload.clientRef,
        notes: payload.notes,
        loyaltyEarnedPoints: 0,
        loyaltyRedeemedPoints: payload.payments
          .filter((p) => p.method === PAYMENT_METHOD.LOYALTY)
          .reduce((sum, p) => sum + p.amountMinor, 0),
      },
    ]);

    if (!createdSale) {
      throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create retail sale record');
    }

    // D. Earn Loyalty Points
    if (payload.customerId && calc.totalMinor > 0) {
      try {
        const earned = await LoyaltyService.earn(payload.customerId, calc.totalMinor, {
          kind: 'RetailSale',
          id: createdSale._id,
        });
        if (earned) {
          const cfg = (tenant as any)?.loyalty || { pointsPerMajorUnit: 1 };
          createdSale.loyaltyEarnedPoints = Math.floor((calc.totalMinor / 100) * cfg.pointsPerMajorUnit);
          await createdSale.save();
        }
      } catch {
        // Continue even if loyalty earning fails
      }
    }

    // E. Register Payment Document for central reporting & accounting
    for (const p of processedPayments) {
      await Payment.create([
        {
          locationId,
          target: { kind: 'RETAIL_SALE', id: createdSale._id },
          method: p.method,
          amountMinor: p.amountMinor,
          tipMinor: 0,
          tenderedMinor: p.tenderedMinor,
          changeMinor: p.changeMinor,
          currency: tenant.currency || 'USD',
          status: PAYMENT_STATUS.COMPLETED,
          completedAt: new Date(),
          reference: p.reference,
          note: p.note,
          shiftId: createdSale.shiftId,
          createdBy: req.user.id,
          guestId: payload.customerId,
        },
      ]);
    }

    await activity.record({
      action: 'RETAIL_SALE_COMPLETED',
      entity: 'RetailSale',
      entityId: createdSale._id,
      message: `Completed retail sale #${receiptNumber} for ${calc.totalMinor} at ${location.name}`,
    });

    return createdSale;
  });

  emitDomainEvent('retailSale.completed', {
    tenantId: req.user.tenantId!,
    saleId: String(sale._id),
    receiptNumber: sale.receiptNumber,
  });

  const receipt = await formatReceipt(sale._id);

  return { sale, receipt };
};

// ---------- Format Structured Printable Receipt & Invoice ----------

const formatReceipt = async (saleId: string | Types.ObjectId) => {
  const sale = found(
    await RetailSale.findById(saleId)
      .populate('cashierId', 'name email')
      .populate('customerId', 'firstName lastName email phone')
      .lean(),
    'Retail sale',
  );

  const location = found(await Location.findById(sale.locationId).lean(), 'Location');
  const tenant = await requestContext.asSystem(() =>
    Tenant.findById(sale.tenantId).select('name branding currency settings').lean(),
  );

  const money = (v: number) => (v / 100).toFixed(2);
  const width = 42;
  const line = (left: string, right = '') =>
    `${left.slice(0, width - right.length - 1).padEnd(width - right.length)}${right}`;

  const cashierName = (sale.cashierId as any)?.name || 'Cashier';
  const customerName =
    sale.customerName ||
    (sale.customerId ? `${(sale.customerId as any).firstName} ${(sale.customerId as any).lastName}`.trim() : undefined);

  const printableText = [
    (tenant?.branding?.displayName || tenant?.name || 'Retail Store').slice(0, width),
    location.name.slice(0, width),
    location.address ? location.address.slice(0, width) : '',
    location.phone ? `Tel: ${location.phone}` : '',
    '-'.repeat(width),
    line(`Receipt: ${sale.receiptNumber}`, new Date(sale.createdAt).toISOString().slice(0, 16).replace('T', ' ')),
    line(`Invoice: ${sale.invoiceNumber}`, `Cashier: ${cashierName}`),
    ...(customerName ? [line(`Customer: ${customerName}`)] : []),
    '-'.repeat(width),
    ...sale.lines.flatMap((item: IRetailSaleLine) => [
      line(`${item.quantity} x ${item.name}`, money(item.grossMinor)),
      ...(item.discountMinor ? [line('   discount', `-${money(item.discountMinor)}`)] : []),
    ]),
    '-'.repeat(width),
    line('Subtotal', money(sale.subtotalMinor)),
    ...(sale.discountTotalMinor ? [line('Discounts', `-${money(sale.discountTotalMinor)}`)] : []),
    ...sale.taxLines.map((t) => line(`${t.name} (${(t.rateBps / 100).toFixed(1)}%)`, money(t.amountMinor))),
    line('TOTAL', money(sale.totalMinor)),
    '-'.repeat(width),
    ...sale.payments.map((p) =>
      line(
        `Paid ${p.method.replace(/_/g, ' ').toLowerCase()}${p.roomCharge?.roomNumber ? ` (Room ${p.roomCharge.roomNumber})` : ''}`,
        money(p.amountMinor),
      ),
    ),
    ...(sale.changeMinor ? [line('Change Given', money(sale.changeMinor))] : []),
    ...(sale.loyaltyEarnedPoints ? [line('Loyalty Points Earned', String(sale.loyaltyEarnedPoints))] : []),
    '-'.repeat(width),
    'Thank you for shopping with us!',
  ].join('\n');

  return {
    sale: {
      _id: sale._id,
      receiptNumber: sale.receiptNumber,
      invoiceNumber: sale.invoiceNumber,
      businessDate: sale.businessDate,
      status: sale.status,
      paymentStatus: sale.paymentStatus,
      createdAt: sale.createdAt,
    },
    business: {
      name: tenant?.name,
      displayName: tenant?.branding?.displayName || tenant?.name,
      currency: tenant?.currency || 'USD',
      logoUrl: tenant?.branding?.logoUrl,
    },
    location: {
      _id: location._id,
      name: location.name,
      code: location.code,
      address: location.address,
      phone: location.phone,
      email: location.email,
    },
    cashier: {
      id: (sale.cashierId as any)?._id,
      name: cashierName,
    },
    customer: customerName
      ? {
          id: (sale.customerId as any)?._id,
          name: customerName,
          phone: sale.customerPhone || (sale.customerId as any)?.phone,
          email: sale.customerEmail || (sale.customerId as any)?.email,
        }
      : undefined,
    items: sale.lines.map((l) => ({
      name: l.name,
      sku: l.sku,
      barcode: l.barcode,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      grossMinor: l.grossMinor,
      discountMinor: l.discountMinor,
      netMinor: l.netMinor,
      taxMinor: l.taxMinor,
      totalMinor: l.totalMinor,
    })),
    totals: {
      subtotalMinor: sale.subtotalMinor,
      discountTotalMinor: sale.discountTotalMinor,
      netTotalMinor: sale.netTotalMinor,
      taxTotalMinor: sale.taxTotalMinor,
      totalMinor: sale.totalMinor,
      paidMinor: sale.paidMinor,
      changeMinor: sale.changeMinor,
      refundedMinor: sale.refundedMinor,
    },
    taxLines: sale.taxLines,
    payments: sale.payments,
    text: printableText,
  };
};

// ---------- Sales History Querying ----------

const getAllSales = async (req: Request, query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {
    isDeleted: { $ne: true },
  };

  const locationId = (query.locationId as string) || req.locationId;
  if (locationId) {
    if (!canAccessLocation(req, locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
    }
    filter.locationId = new Types.ObjectId(locationId);
  }

  if (query.cashierId) {
    filter.cashierId = new Types.ObjectId(String(query.cashierId));
  }
  if (query.customerId) {
    filter.customerId = new Types.ObjectId(String(query.customerId));
  }
  if (query.status) {
    filter.status = query.status;
  }
  if (query.paymentStatus) {
    filter.paymentStatus = query.paymentStatus;
  }
  if (query.paymentMethod) {
    filter['payments.method'] = query.paymentMethod;
  }
  if (query.businessDate) {
    filter.businessDate = query.businessDate;
  }

  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: new Date(String(query.from)) } : {}),
      ...(query.to ? { $lte: new Date(String(query.to)) } : {}),
    };
  }

  const search = (query.search as string) || (query.q as string);
  if (search) {
    const rx = escapeRegex(search.trim());
    filter.$or = [
      { receiptNumber: { $regex: rx, $options: 'i' } },
      { invoiceNumber: { $regex: rx, $options: 'i' } },
      { customerName: { $regex: rx, $options: 'i' } },
      { customerPhone: { $regex: rx, $options: 'i' } },
      { customerEmail: { $regex: rx, $options: 'i' } },
      { 'lines.name': { $regex: rx, $options: 'i' } },
      { 'lines.sku': { $regex: rx, $options: 'i' } },
    ];
  }

  const { page, limit, skip } = paginationOf(query, 50);
  const sortField = (query.sortBy as string) || 'createdAt';
  const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

  const [data, total] = await Promise.all([
    RetailSale.find(filter)
      .populate('cashierId', 'name email')
      .populate('customerId', 'firstName lastName email phone')
      .populate('locationId', 'name code')
      .sort({ [sortField]: sortDirection })
      .skip(skip)
      .limit(limit)
      .lean(),
    RetailSale.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

const getSaleById = async (req: Request, id: string) => {
  const sale = found(
    await RetailSale.findById(id)
      .populate('cashierId', 'name email')
      .populate('customerId', 'firstName lastName email phone')
      .populate('locationId', 'name code address phone')
      .lean(),
    'Retail sale',
  );

  if (!canAccessLocation(req, sale.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this retail sale');
  }

  const returns = await RetailReturn.find({ saleId: sale._id })
    .populate('processedBy', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  return { ...sale, returns };
};

// ---------- Returns & Refunds ----------

const processReturn = async (req: Request, saleId: string, payload: TReturnPayload) => {
  const sale = found(await RetailSale.findById(saleId), 'Retail sale');

  if (!canAccessLocation(req, sale.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this retail sale');
  }

  if (sale.status === RETAIL_SALE_STATUS.VOIDED) {
    throw new AppError(httpStatus.CONFLICT, 'Sale has already been voided');
  }
  if (sale.status === RETAIL_SALE_STATUS.REFUNDED) {
    throw new AppError(httpStatus.CONFLICT, 'Sale has already been fully refunded');
  }

  if (!payload.lines.length) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Provide at least one item to return');
  }

  // 1. Validate Returned Quantities against original line items
  let totalRefundCalculated = 0;
  const validatedReturnLines: Array<{
    saleLine: IRetailSaleLine;
    returnQty: number;
    refundAmountMinor: number;
    restock: boolean;
    condition: 'RESELLABLE' | 'DAMAGED' | 'DEFECTIVE';
    reason: string;
  }> = [];

  for (const item of payload.lines) {
    let matchedLine: IRetailSaleLine | undefined;
    if (item.saleLineId) {
      matchedLine = sale.lines.find((l) => String(l._id) === String(item.saleLineId));
    } else {
      matchedLine = sale.lines.find(
        (l) =>
          String(l.productId) === String(item.productId) &&
          (item.variantId ? String(l.variantId) === String(item.variantId) : !l.variantId),
      );
    }

    if (!matchedLine) {
      throw new AppError(httpStatus.NOT_FOUND, `Sale line item not found for product ${item.productId}`);
    }

    const remainingReturnable = matchedLine.quantity - (matchedLine.returnedQuantity || 0);
    if (item.quantity > remainingReturnable) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Cannot return ${item.quantity} of "${matchedLine.name}". Only ${remainingReturnable} remaining returnable.`,
      );
    }

    // Calculate line refund amount proportionally to net total paid for this line
    const unitRefundMinor = Math.round(matchedLine.totalMinor / matchedLine.quantity);
    const lineRefundMinor = unitRefundMinor * item.quantity;
    totalRefundCalculated += lineRefundMinor;

    validatedReturnLines.push({
      saleLine: matchedLine,
      returnQty: item.quantity,
      refundAmountMinor: lineRefundMinor,
      restock: item.restock !== false,
      condition: item.condition || 'RESELLABLE',
      reason: item.reason,
    });
  }

  // Check remaining refundable on the entire sale
  const maxRefundable = sale.totalMinor - (sale.refundedMinor || 0);
  if (totalRefundCalculated > maxRefundable) {
    totalRefundCalculated = maxRefundable;
  }

  // Manager Approval for refund if configured or required
  const tenant = found(await Tenant.findById(req.user.tenantId).select('settings.approval').lean(), 'Tenant');
  const approvalNeeded = (tenant as any)?.settings?.approval?.refunds !== false;
  const approvedBy = await ApprovalService.requireApproval(req, 'REFUND', approvalNeeded);

  let openShift: any;
  if (payload.refundMethod === PAYMENT_METHOD.CASH) {
    openShift = await openShiftOf(req.user.id);
    if (!openShift) {
      throw new AppError(httpStatus.CONFLICT, 'Open a shift (cash drawer) to give cash refunds');
    }
  }

  const returnSeq = await nextSequence(`retail-return:${req.user.tenantId}`);
  const returnNumber = `RET-${String(returnSeq).padStart(6, '0')}`;

  const result = await runInTransaction(async () => {
    // 2. Adjust Stock: restock resalable items via SALE_REVERSAL, or record waste if damaged
    for (const line of validatedReturnLines) {
      line.saleLine.returnedQuantity = (line.saleLine.returnedQuantity || 0) + line.returnQty;

      if (line.restock && line.condition === 'RESELLABLE') {
        await recordMovement({
          stockItemId: line.saleLine.stockItemId,
          type: 'SALE_REVERSAL',
          quantity: line.returnQty,
          reason: `Retail Return ${returnNumber}: ${line.reason}`,
          ref: { kind: 'RetailReturn', id: returnNumber },
        });
      } else {
        // Non-restock: if damaged or defective, record waste for stock traceability
        await recordMovement({
          stockItemId: line.saleLine.stockItemId,
          type: 'WASTE',
          quantity: 0, // already left stock at sale; movement logged for audit trail
          reason: `Returned Damaged (not restocked): ${line.reason}`,
          ref: { kind: 'RetailReturn', id: returnNumber },
        });
      }
    }

    // 3. Update Sale Refund Totals & Status
    sale.refundedMinor = (sale.refundedMinor || 0) + totalRefundCalculated;
    if (sale.refundedMinor >= sale.totalMinor) {
      sale.status = RETAIL_SALE_STATUS.REFUNDED;
      sale.paymentStatus = RETAIL_PAYMENT_STATUS.REFUNDED;
    } else {
      sale.status = RETAIL_SALE_STATUS.PARTIALLY_REFUNDED;
      sale.paymentStatus = RETAIL_PAYMENT_STATUS.PARTIALLY_REFUNDED;
    }
    await sale.save();

    // 4. Record Cash Drawer Outflow if CASH refund
    if (payload.refundMethod === PAYMENT_METHOD.CASH && openShift) {
      await CashMovement.create([
        {
          locationId: sale.locationId,
          shiftId: openShift._id,
          type: 'REFUND',
          amountMinor: -totalRefundCalculated,
          reason: `Retail Refund ${returnNumber}`,
          createdBy: req.user.id,
          approvedBy: approvedBy ? new Types.ObjectId(approvedBy) : undefined,
        },
      ]);
    }

    // 5. Reverse Proportional Loyalty Points if customer earned points on this sale
    let pointsToReverse = 0;
    if (sale.customerId && sale.loyaltyEarnedPoints && sale.loyaltyEarnedPoints > 0) {
      const share = totalRefundCalculated / Math.max(sale.totalMinor, 1);
      pointsToReverse = Math.round(sale.loyaltyEarnedPoints * share);
      if (pointsToReverse > 0) {
        try {
          await LoyaltyService.restoreForRefund(sale.customerId, totalRefundCalculated, sale._id);
        } catch {
          // ignore
        }
      }
    }

    // 6. Create Retail Return Document
    const [returnDoc] = await RetailReturn.create([
      {
        locationId: sale.locationId,
        returnNumber,
        saleId: sale._id,
        saleReceiptNumber: sale.receiptNumber,
        lines: validatedReturnLines.map((v) => ({
          saleLineId: v.saleLine._id,
          productId: v.saleLine.productId,
          variantId: v.saleLine.variantId,
          stockItemId: v.saleLine.stockItemId,
          name: v.saleLine.name,
          sku: v.saleLine.sku,
          quantity: v.returnQty,
          unitPriceMinor: v.saleLine.unitPriceMinor,
          refundAmountMinor: v.refundAmountMinor,
          restock: v.restock,
          condition: v.condition,
          reason: v.reason,
        })),
        refundAmountMinor: totalRefundCalculated,
        refundMethod: payload.refundMethod,
        reason: payload.reason,
        notes: payload.notes,
        shiftId: openShift ? openShift._id : payload.shiftId ? new Types.ObjectId(payload.shiftId) : undefined,
        processedBy: req.user.id,
        approvedBy: approvedBy ? new Types.ObjectId(approvedBy) : undefined,
        loyaltyPointsDeducted: pointsToReverse,
      },
    ]);

    await activity.record({
      action: 'RETAIL_RETURN_PROCESSED',
      entity: 'RetailReturn',
      entityId: returnDoc!._id,
      approvedBy,
      message: `Processed return #${returnNumber} for sale #${sale.receiptNumber} (${totalRefundCalculated} refunded)`,
    });

    return returnDoc!;
  });

  emitDomainEvent('retailReturn.completed', {
    tenantId: req.user.tenantId!,
    returnId: String(result._id),
    saleId: String(sale._id),
    amountMinor: totalRefundCalculated,
  });

  return { returnRecord: result, sale };
};

const getAllReturns = async (req: Request, query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};

  const locationId = (query.locationId as string) || req.locationId;
  if (locationId) {
    if (!canAccessLocation(req, locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
    }
    filter.locationId = new Types.ObjectId(locationId);
  }

  if (query.saleId) {
    filter.saleId = new Types.ObjectId(String(query.saleId));
  }
  if (query.processedBy) {
    filter.processedBy = new Types.ObjectId(String(query.processedBy));
  }
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: new Date(String(query.from)) } : {}),
      ...(query.to ? { $lte: new Date(String(query.to)) } : {}),
    };
  }

  const { page, limit, skip } = paginationOf(query, 50);

  const [data, total] = await Promise.all([
    RetailReturn.find(filter)
      .populate('processedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('locationId', 'name code')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RetailReturn.countDocuments(filter),
  ]);

  return { data, meta: metaOf(page, limit, total) };
};

const getReturnById = async (req: Request, id: string) => {
  const ret = found(
    await RetailReturn.findById(id)
      .populate('processedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('locationId', 'name code address phone')
      .lean(),
    'Retail return',
  );

  if (!canAccessLocation(req, ret.locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this return');
  }

  return ret;
};

export const RetailSaleService = {
  posProductSearch,
  posPriceCheck,
  searchCustomers,
  getCustomerLoyalty,
  calculateCart,
  checkout,
  formatReceipt,
  getAllSales,
  getSaleById,
  processReturn,
  getAllReturns,
  getReturnById,
};
