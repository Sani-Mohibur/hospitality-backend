import { Request } from 'express';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { canAccessLocation } from '../../../middlewares/locationScope';
import { found } from '../../../utils/query';
import { Location } from '../../location/location.model';
import { Shift, CashMovement } from '../../shift/shift.model';
import { RetailReturn, RetailSale } from '../retailSale/retailSale.model';

const getZReport = async (req: Request, query: Record<string, unknown>) => {
  const locationId = (query.locationId as string) || req.locationId;
  if (!locationId) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Location is required for Z-Report');
  }
  if (!canAccessLocation(req, locationId)) {
    throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
  }

  const location = found(await Location.findById(locationId).lean(), 'Location');
  const tenantId = new Types.ObjectId(req.user.tenantId);
  const locObjectId = new Types.ObjectId(locationId);

  let fromDate: Date;
  let toDate: Date;
  let shiftDoc: any;

  if (query.shiftId) {
    shiftDoc = found(await Shift.findById(query.shiftId).lean(), 'Shift');
    if (String(shiftDoc.locationId) !== locationId) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Shift does not belong to this location');
    }
    fromDate = shiftDoc.openedAt;
    toDate = shiftDoc.closedAt || new Date();
  } else if (query.date) {
    const dayStr = String(query.date);
    fromDate = new Date(`${dayStr}T00:00:00.000Z`);
    toDate = new Date(`${dayStr}T23:59:59.999Z`);
  } else if (query.from || query.to) {
    fromDate = query.from ? new Date(String(query.from)) : new Date(0);
    toDate = query.to ? new Date(String(query.to)) : new Date();
  } else {
    // Default to location's current business date or today
    const bDate = location.businessDate || new Date().toISOString().slice(0, 10);
    fromDate = new Date(`${bDate}T00:00:00.000Z`);
    toDate = new Date(`${bDate}T23:59:59.999Z`);
  }

  const matchFilter: Record<string, unknown> = {
    tenantId,
    locationId: locObjectId,
    createdAt: { $gte: fromDate, $lte: toDate },
    status: { $ne: 'VOIDED' },
  };

  if (shiftDoc) {
    matchFilter.shiftId = shiftDoc._id;
  }

  // 1. Sales & Taxes Aggregation
  const salesAggregate = await RetailSale.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        transactionCount: { $sum: 1 },
        subtotalMinor: { $sum: '$subtotalMinor' },
        discountTotalMinor: { $sum: '$discountTotalMinor' },
        netTotalMinor: { $sum: '$netTotalMinor' },
        taxTotalMinor: { $sum: '$taxTotalMinor' },
        totalMinor: { $sum: '$totalMinor' },
        refundedMinor: { $sum: '$refundedMinor' },
        paidMinor: { $sum: '$paidMinor' },
      },
    },
  ]);

  const salesTotals = salesAggregate[0] || {
    transactionCount: 0,
    subtotalMinor: 0,
    discountTotalMinor: 0,
    netTotalMinor: 0,
    taxTotalMinor: 0,
    totalMinor: 0,
    refundedMinor: 0,
    paidMinor: 0,
  };

  // 2. Payment Method Breakdown
  const paymentBreakdown = await RetailSale.aggregate([
    { $match: matchFilter },
    { $unwind: '$payments' },
    {
      $group: {
        _id: '$payments.method',
        count: { $sum: 1 },
        amountMinor: { $sum: '$payments.amountMinor' },
        tenderedMinor: { $sum: { $ifNull: ['$payments.tenderedMinor', '$payments.amountMinor'] } },
        changeMinor: { $sum: { $ifNull: ['$payments.changeMinor', 0] } },
      },
    },
    { $sort: { amountMinor: -1 } },
  ]);

  // 3. Returns & Refunds Aggregation
  const returnFilter: Record<string, unknown> = {
    tenantId,
    locationId: locObjectId,
    createdAt: { $gte: fromDate, $lte: toDate },
  };
  if (shiftDoc) {
    returnFilter.shiftId = shiftDoc._id;
  }

  const returnsAggregate = await RetailReturn.aggregate([
    { $match: returnFilter },
    {
      $group: {
        _id: '$refundMethod',
        count: { $sum: 1 },
        totalRefundMinor: { $sum: '$refundAmountMinor' },
      },
    },
  ]);

  const totalRefundAmountMinor = returnsAggregate.reduce((sum, r) => sum + r.totalRefundMinor, 0);
  const totalReturnCount = returnsAggregate.reduce((sum, r) => sum + r.count, 0);

  // 4. Cash Drawer Reconciliation
  let cashReconciliation: any = null;
  const cashMovementFilter: Record<string, unknown> = {
    tenantId,
    locationId: locObjectId,
  };

  if (shiftDoc) {
    cashMovementFilter.shiftId = shiftDoc._id;
  } else {
    cashMovementFilter.createdAt = { $gte: fromDate, $lte: toDate };
  }

  const cashMovements = await CashMovement.find(cashMovementFilter).lean();

  const openingFloatMinor = shiftDoc ? shiftDoc.openingFloatMinor || 0 : 0;
  const cashSaleMovements = cashMovements
    .filter((m) => m.type === 'SALE')
    .reduce((sum, m) => sum + m.amountMinor, 0);
  const cashRefundMovements = cashMovements
    .filter((m) => m.type === 'REFUND')
    .reduce((sum, m) => sum + Math.abs(m.amountMinor), 0);
  const paidInsMinor = cashMovements
    .filter((m) => m.type === 'PAID_IN')
    .reduce((sum, m) => sum + m.amountMinor, 0);
  const dropsMinor = cashMovements
    .filter((m) => m.type === 'DROP')
    .reduce((sum, m) => sum + Math.abs(m.amountMinor), 0);
  const payoutsMinor = cashMovements
    .filter((m) => m.type === 'PAYOUT')
    .reduce((sum, m) => sum + Math.abs(m.amountMinor), 0);

  const expectedCashMinor =
    openingFloatMinor + cashSaleMovements - cashRefundMovements + paidInsMinor - dropsMinor - payoutsMinor;

  cashReconciliation = {
    openingFloatMinor,
    cashSalesMinor: cashSaleMovements,
    cashRefundsMinor: cashRefundMovements,
    paidInsMinor,
    dropsMinor,
    payoutsMinor,
    expectedCashMinor,
    actualClosingFloatMinor: shiftDoc?.closingFloatMinor,
    varianceMinor:
      shiftDoc?.closingFloatMinor !== undefined && shiftDoc?.closingFloatMinor !== null
        ? shiftDoc.closingFloatMinor - expectedCashMinor
        : undefined,
  };

  // 5. Category Breakdown for period
  const categorySummary = await RetailSale.aggregate([
    { $match: matchFilter },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.categoryName',
        itemsSold: { $sum: '$lines.quantity' },
        netMinor: { $sum: '$lines.netMinor' },
        taxMinor: { $sum: '$lines.taxMinor' },
        totalMinor: { $sum: '$lines.totalMinor' },
      },
    },
    { $sort: { totalMinor: -1 } },
  ]);

  return {
    location: {
      _id: location._id,
      name: location.name,
      code: location.code,
      businessDate: location.businessDate,
    },
    shift: shiftDoc
      ? {
          _id: shiftDoc._id,
          userId: shiftDoc.userId,
          drawerName: shiftDoc.drawerName,
          status: shiftDoc.status,
          openedAt: shiftDoc.openedAt,
          closedAt: shiftDoc.closedAt,
        }
      : null,
    period: {
      from: fromDate,
      to: toDate,
    },
    sales: {
      transactionCount: salesTotals.transactionCount,
      grossSalesMinor: salesTotals.totalMinor,
      subtotalMinor: salesTotals.subtotalMinor,
      discountMinor: salesTotals.discountTotalMinor,
      netSalesMinor: salesTotals.netTotalMinor,
      taxMinor: salesTotals.taxTotalMinor,
      refundedMinor: salesTotals.refundedMinor,
      netRevenueMinor: salesTotals.totalMinor - salesTotals.refundedMinor,
    },
    payments: paymentBreakdown.map((p) => ({
      method: p._id,
      count: p.count,
      amountMinor: p.amountMinor,
      tenderedMinor: p.tenderedMinor,
      changeMinor: p.changeMinor,
    })),
    returns: {
      count: totalReturnCount,
      totalRefundMinor: totalRefundAmountMinor,
      byMethod: returnsAggregate.map((r) => ({
        method: r._id,
        count: r.count,
        amountMinor: r.totalRefundMinor,
      })),
    },
    cashReconciliation,
    categorySummary: categorySummary.map((c) => ({
      category: c._id || 'Uncategorized',
      itemsSold: c.itemsSold,
      netMinor: c.netMinor,
      taxMinor: c.taxMinor,
      totalMinor: c.totalMinor,
    })),
  };
};

const getSalesSummary = async (req: Request, query: Record<string, unknown>) => {
  const locationId = (query.locationId as string) || req.locationId;
  const tenantId = new Types.ObjectId(req.user.tenantId);

  const matchFilter: Record<string, unknown> = {
    tenantId,
    status: { $ne: 'VOIDED' },
  };

  if (locationId) {
    if (!canAccessLocation(req, locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
    }
    matchFilter.locationId = new Types.ObjectId(locationId);
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromDate = query.from ? new Date(String(query.from)) : thirtyDaysAgo;
  const toDate = query.to ? new Date(String(query.to)) : now;

  matchFilter.createdAt = { $gte: fromDate, $lte: toDate };

  let dateFormat = '%Y-%m-%d';
  if (query.groupBy === 'week') dateFormat = '%Y-W%V';
  if (query.groupBy === 'month') dateFormat = '%Y-%m';

  const [overallAggregate, timelineAggregate] = await Promise.all([
    RetailSale.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalRevenueMinor: { $sum: '$totalMinor' },
          subtotalMinor: { $sum: '$subtotalMinor' },
          discountMinor: { $sum: '$discountTotalMinor' },
          netMinor: { $sum: '$netTotalMinor' },
          taxMinor: { $sum: '$taxTotalMinor' },
          refundedMinor: { $sum: '$refundedMinor' },
          transactionCount: { $sum: 1 },
        },
      },
    ]),
    RetailSale.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
          revenueMinor: { $sum: '$totalMinor' },
          refundedMinor: { $sum: '$refundedMinor' },
          taxMinor: { $sum: '$taxTotalMinor' },
          discountMinor: { $sum: '$discountTotalMinor' },
          transactions: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const overall = overallAggregate[0] || {
    totalRevenueMinor: 0,
    subtotalMinor: 0,
    discountMinor: 0,
    netMinor: 0,
    taxMinor: 0,
    refundedMinor: 0,
    transactionCount: 0,
  };

  const netRevenueMinor = overall.totalRevenueMinor - overall.refundedMinor;
  const averageOrderValueMinor =
    overall.transactionCount > 0 ? Math.round(overall.totalRevenueMinor / overall.transactionCount) : 0;

  return {
    period: { from: fromDate, to: toDate },
    overview: {
      totalRevenueMinor: overall.totalRevenueMinor,
      netRevenueMinor,
      transactionCount: overall.transactionCount,
      averageOrderValueMinor,
      discountMinor: overall.discountMinor,
      taxMinor: overall.taxMinor,
      refundedMinor: overall.refundedMinor,
    },
    timeline: timelineAggregate.map((t) => ({
      date: t._id,
      revenueMinor: t.revenueMinor,
      netRevenueMinor: t.revenueMinor - t.refundedMinor,
      refundedMinor: t.refundedMinor,
      taxMinor: t.taxMinor,
      discountMinor: t.discountMinor,
      transactions: t.transactions,
      averageOrderValueMinor: t.transactions > 0 ? Math.round(t.revenueMinor / t.transactions) : 0,
    })),
  };
};

const getTopProducts = async (req: Request, query: Record<string, unknown>) => {
  const locationId = (query.locationId as string) || req.locationId;
  const tenantId = new Types.ObjectId(req.user.tenantId);

  const matchFilter: Record<string, unknown> = {
    tenantId,
    status: { $ne: 'VOIDED' },
  };

  if (locationId) {
    if (!canAccessLocation(req, locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
    }
    matchFilter.locationId = new Types.ObjectId(locationId);
  }

  if (query.from || query.to) {
    matchFilter.createdAt = {
      ...(query.from ? { $gte: new Date(String(query.from)) } : {}),
      ...(query.to ? { $lte: new Date(String(query.to)) } : {}),
    };
  }

  const limit = Math.min(Number(query.limit) || 10, 100);
  const sortKey = query.sortBy === 'revenue' ? 'totalRevenueMinor' : 'totalQuantity';

  const rows = await RetailSale.aggregate([
    { $match: matchFilter },
    { $unwind: '$lines' },
    {
      $group: {
        _id: {
          productId: '$lines.productId',
          variantId: '$lines.variantId',
          sku: '$lines.sku',
          name: '$lines.name',
          categoryName: '$lines.categoryName',
        },
        totalQuantity: { $sum: '$lines.quantity' },
        totalRevenueMinor: { $sum: '$lines.totalMinor' },
        totalNetMinor: { $sum: '$lines.netMinor' },
        totalDiscountMinor: { $sum: '$lines.discountMinor' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { [sortKey]: -1 } },
    { $limit: limit },
  ]);

  return rows.map((r) => ({
    productId: r._id.productId,
    variantId: r._id.variantId,
    sku: r._id.sku,
    name: r._id.name,
    categoryName: r._id.categoryName,
    totalQuantity: r.totalQuantity,
    totalRevenueMinor: r.totalRevenueMinor,
    totalNetMinor: r.totalNetMinor,
    totalDiscountMinor: r.totalDiscountMinor,
    orderCount: r.orderCount,
  }));
};

const getCategoryBreakdown = async (req: Request, query: Record<string, unknown>) => {
  const locationId = (query.locationId as string) || req.locationId;
  const tenantId = new Types.ObjectId(req.user.tenantId);

  const matchFilter: Record<string, unknown> = {
    tenantId,
    status: { $ne: 'VOIDED' },
  };

  if (locationId) {
    if (!canAccessLocation(req, locationId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You do not have access to this location');
    }
    matchFilter.locationId = new Types.ObjectId(locationId);
  }

  if (query.from || query.to) {
    matchFilter.createdAt = {
      ...(query.from ? { $gte: new Date(String(query.from)) } : {}),
      ...(query.to ? { $lte: new Date(String(query.to)) } : {}),
    };
  }

  const rows = await RetailSale.aggregate([
    { $match: matchFilter },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.categoryName',
        totalQuantity: { $sum: '$lines.quantity' },
        totalRevenueMinor: { $sum: '$lines.totalMinor' },
        totalNetMinor: { $sum: '$lines.netMinor' },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalRevenueMinor: -1 } },
  ]);

  const grandTotal = rows.reduce((sum, r) => sum + r.totalRevenueMinor, 0);

  return rows.map((r) => ({
    categoryName: r._id || 'Uncategorized',
    totalQuantity: r.totalQuantity,
    totalRevenueMinor: r.totalRevenueMinor,
    totalNetMinor: r.totalNetMinor,
    orderCount: r.orderCount,
    percentage: grandTotal > 0 ? Number(((r.totalRevenueMinor / grandTotal) * 100).toFixed(2)) : 0,
  }));
};

export const RetailReportService = {
  getZReport,
  getSalesSummary,
  getTopProducts,
  getCategoryBreakdown,
};
