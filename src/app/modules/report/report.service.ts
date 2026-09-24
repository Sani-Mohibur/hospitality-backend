import { Types } from 'mongoose';
import { FolioLine } from '../hospitality/folio/folio.model';
import { Room, RoomBlock } from '../hospitality/room/room.model';
import { RoomStay } from '../hospitality/reservation/reservation.model';
import { STAY_STATUS } from '../hospitality/reservation/reservation.interface';
import { Order } from '../restaurant/order/order.model';
import { Payment } from '../payment/payment.model';
import { ChargeCode } from '../finance/finance.model';
import { Location } from '../location/location.model';
import { Outlet } from '../outlet/outlet.model';
import { Tenant } from '../tenant/tenant.model';
import { requestContext } from '../../utils/requestContext';
import { dateRange } from '../../utils/businessDate';

type TFilter = { locationIds?: Types.ObjectId[] };

const locMatch = (filter: TFilter) => (filter.locationIds ? { locationId: { $in: filter.locationIds } } : {});

// Room nights available in a range: active rooms minus out-of-order nights.
const availableRoomNights = async (filter: TFilter, from: string, to: string) => {
  const days = dateRange(from, to).length;
  const rooms = await Room.countDocuments({ ...locMatch(filter), isActive: true });
  const blocks = await RoomBlock.find({ ...locMatch(filter), type: 'OUT_OF_ORDER', releasedAt: null, from: { $lte: to }, to: { $gt: from } }).lean();
  const blockedNights = blocks.reduce((sum, b) => sum + dateRange(b.from > from ? b.from : from, b.to <= to ? addDaysSafe(b.to, -1) : to).length, 0);
  return Math.max(0, rooms * days - blockedNights);
};

const addDaysSafe = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Owner dashboard KPIs for a business-date range (one location or all granted locations).
const dashboard = async (filter: TFilter, from: string, to: string) => {
  const match = locMatch(filter);
  const [roomLines, allCharges, nightsSold, orders, available, locations] = await Promise.all([
    FolioLine.aggregate([
      { $match: { ...match, businessDate: { $gte: from, $lte: to }, 'source.kind': { $in: ['ROOM_NIGHT'] } } },
      { $group: { _id: null, revenue: { $sum: '$netMinor' }, nights: { $sum: 1 } } },
    ]),
    // Revenue posted on folios, excluding transfers, payments and POS copies (counted from orders)
    FolioLine.aggregate([
      { $match: { ...match, businessDate: { $gte: from, $lte: to }, type: { $in: ['CHARGE', 'ADJUSTMENT'] }, code: { $nin: ['XFER', 'PAY', 'TIP'] }, 'source.kind': { $nin: ['POS', 'TRANSFER', 'PAYMENT'] } } },
      { $group: { _id: null, net: { $sum: '$netMinor' } } },
    ]),
    FolioLine.countDocuments({ ...match, businessDate: { $gte: from, $lte: to }, 'source.kind': 'ROOM_NIGHT', reversedById: null }),
    Order.find({ ...match, businessDate: { $gte: from, $lte: to }, status: 'CLOSED' }).lean(),
    availableRoomNights(filter, from, to),
    Location.find(filter.locationIds ? { _id: { $in: filter.locationIds } } : {}).select('businessDate name').lean(),
  ]);

  const roomRevenue = roomLines[0]?.revenue || 0;
  const covers = orders.reduce((s, o) => s + (o.covers || 0), 0);
  const fnbNet = orders.reduce((s, o) => s + o.items.filter((i) => i.status !== 'VOIDED').reduce((a, i) => a + (i.calc?.netMinor || 0), 0), 0);
  const totalRevenue = (allCharges[0]?.net || 0) + fnbNet;

  // Sales mix
  const mix = new Map<string, { name: string; quantity: number; netMinor: number }>();
  const ticketTimes: number[] = [];
  let voidCount = 0;
  let voidAmount = 0;
  let compAmount = 0;
  const byStaff = new Map<string, { voids: number; voidMinor: number; discountMinor: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.status === 'VOIDED') {
        voidCount += 1;
        voidAmount += item.quantity * item.unitPriceMinor;
        const key = String(item.void?.by || 'unknown');
        const row = byStaff.get(key) || { voids: 0, voidMinor: 0, discountMinor: 0 };
        row.voids += 1;
        row.voidMinor += item.quantity * item.unitPriceMinor;
        byStaff.set(key, row);
        continue;
      }
      const m = mix.get(String(item.menuItemId)) || { name: item.name, quantity: 0, netMinor: 0 };
      m.quantity += item.quantity;
      m.netMinor += item.calc?.netMinor || 0;
      mix.set(String(item.menuItemId), m);
      if (item.firedAt && item.readyAt) ticketTimes.push((new Date(item.readyAt).getTime() - new Date(item.firedAt).getTime()) / 60000);
      if (item.discount?.type === 'COMP') compAmount += item.calc?.discountMinor || 0;
      if (item.discount) {
        const key = String(item.discount.by || 'unknown');
        const row = byStaff.get(key) || { voids: 0, voidMinor: 0, discountMinor: 0 };
        row.discountMinor += item.calc?.discountMinor || 0;
        byStaff.set(key, row);
      }
    }
  }

  // In-house guest capture: stays that spent in an outlet / all in-house stays
  const stays = await RoomStay.find({ ...match, status: { $in: [STAY_STATUS.CHECKED_IN, STAY_STATUS.CHECKED_OUT] }, arrivalDate: { $lte: to }, departureDate: { $gt: from } }).select('_id').lean();
  const stayIds = stays.map((s) => s._id);
  const spenders = await Order.distinct('roomStayId', { ...match, roomStayId: { $in: stayIds }, status: 'CLOSED', businessDate: { $gte: from, $lte: to } });

  const today = await Promise.all(
    locations.map(async (l) => ({
      locationId: l._id,
      name: l.name,
      businessDate: l.businessDate,
      arrivals: await RoomStay.countDocuments({ locationId: l._id, arrivalDate: l.businessDate, status: { $in: [STAY_STATUS.RESERVED, STAY_STATUS.CHECKED_IN] } }),
      departures: await RoomStay.countDocuments({ locationId: l._id, departureDate: l.businessDate, status: { $in: [STAY_STATUS.CHECKED_IN, STAY_STATUS.CHECKED_OUT] } }),
      inHouse: await RoomStay.countDocuments({ locationId: l._id, status: STAY_STATUS.CHECKED_IN }),
    })),
  );

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : 0);
  return {
    range: { from, to },
    rooms: {
      roomNightsAvailable: available,
      roomNightsSold: nightsSold,
      occupancyPct: pct(nightsSold, available),
      roomRevenueMinor: roomRevenue,
      adrMinor: nightsSold ? Math.round(roomRevenue / nightsSold) : 0,
      revparMinor: available ? Math.round(roomRevenue / available) : 0,
    },
    fnb: {
      orders: orders.length,
      covers,
      netRevenueMinor: fnbNet,
      averageCheckMinor: covers ? Math.round(fnbNet / covers) : 0,
      averageTicketMinutes: ticketTimes.length ? Math.round((ticketTimes.reduce((a, b) => a + b, 0) / ticketTimes.length) * 10) / 10 : null,
      salesMix: [...mix.values()].sort((a, b) => b.netMinor - a.netMinor).slice(0, 20),
    },
    crossModule: {
      totalRevenueMinor: totalRevenue,
      trevparMinor: available ? Math.round(totalRevenue / available) : 0,
      inHouseStays: stayIds.length,
      staysSpendingInOutlets: spenders.length,
      inHouseCaptureRatePct: pct(spenders.length, stayIds.length),
    },
    control: {
      voids: { count: voidCount, amountMinor: voidAmount },
      compsMinor: compAmount,
      discountsMinor: orders.reduce((s, o) => s + o.totals.discountMinor, 0),
      byStaff: [...byStaff.entries()].map(([userId, v]) => ({ userId, ...v })),
    },
    today,
  };
};

// Item / category / outlet / staff / hour sales from closed orders.
const sales = async (filter: TFilter, from: string, to: string, groupBy: 'item' | 'category' | 'outlet' | 'staff' | 'hour' | 'day') => {
  const keyExpr: Record<string, unknown> = {
    item: { id: '$items.menuItemId', name: '$items.name' },
    category: '$items.categoryId',
    outlet: '$outletId',
    staff: '$serverId',
    hour: { $hour: '$createdAt' },
    day: '$businessDate',
  };
  const rows = await Order.aggregate([
    { $match: { ...locMatch(filter), status: 'CLOSED', businessDate: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'VOIDED' } } },
    {
      $group: {
        _id: keyExpr[groupBy],
        quantity: { $sum: '$items.quantity' },
        grossMinor: { $sum: '$items.calc.grossMinor' },
        discountMinor: { $sum: '$items.calc.discountMinor' },
        netMinor: { $sum: '$items.calc.netMinor' },
        taxMinor: { $sum: '$items.calc.taxMinor' },
        orders: { $addToSet: '$_id' },
      },
    },
    { $project: { quantity: 1, grossMinor: 1, discountMinor: 1, netMinor: 1, taxMinor: 1, orders: { $size: '$orders' } } },
    { $sort: { netMinor: -1 } },
  ]);
  if (groupBy === 'outlet') {
    const outlets = await Outlet.find({ _id: { $in: rows.map((r) => r._id) } }).select('name').lean();
    return rows.map((r) => ({ ...r, name: outlets.find((o) => String(o._id) === String(r._id))?.name }));
  }
  if (groupBy === 'staff') {
    const { User } = await import('../user/user.model');
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('name').lean();
    return rows.map((r) => ({ ...r, name: users.find((u) => String(u._id) === String(r._id))?.name }));
  }
  if (groupBy === 'category') {
    const { MenuCategory } = await import('../restaurant/menuCategory/menuCategory.model');
    const cats = await MenuCategory.find({ _id: { $in: rows.map((r) => r._id) } }).select('name').lean();
    return rows.map((r) => ({ ...r, name: cats.find((c) => String(c._id) === String(r._id))?.name }));
  }
  return rows;
};

// Tax collected per tax name and rate: hotel folios plus outlet orders not charged to rooms.
const taxReport = async (filter: TFilter, from: string, to: string) => {
  const [folioTax, orderTax] = await Promise.all([
    FolioLine.aggregate([
      { $match: { ...locMatch(filter), businessDate: { $gte: from, $lte: to }, 'source.kind': { $ne: 'POS' } } },
      { $unwind: '$taxLines' },
      { $group: { _id: { name: '$taxLines.name', rateBps: '$taxLines.rateBps' }, amountMinor: { $sum: '$taxLines.amountMinor' } } },
    ]),
    Order.aggregate([
      { $match: { ...locMatch(filter), status: 'CLOSED', businessDate: { $gte: from, $lte: to } } },
      { $unwind: '$taxLines' },
      { $group: { _id: { name: '$taxLines.name', rateBps: '$taxLines.rateBps' }, amountMinor: { $sum: '$taxLines.amountMinor' } } },
    ]),
  ]);
  const merged = new Map<string, { name: string; rateBps: number; hotelMinor: number; outletsMinor: number; totalMinor: number }>();
  const add = (rows: any[], field: 'hotelMinor' | 'outletsMinor') => {
    for (const r of rows) {
      const key = `${r._id.name}:${r._id.rateBps}`;
      const row = merged.get(key) || { name: r._id.name, rateBps: r._id.rateBps, hotelMinor: 0, outletsMinor: 0, totalMinor: 0 };
      row[field] += r.amountMinor;
      row.totalMinor += r.amountMinor;
      merged.set(key, row);
    }
  };
  add(folioTax, 'hotelMinor');
  add(orderTax, 'outletsMinor');
  return [...merged.values()];
};

const paymentsReport = async (filter: TFilter, from: Date, to: Date) =>
  Payment.aggregate([
    { $match: { ...locMatch(filter), status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, completedAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$method',
        count: { $sum: 1 },
        amountMinor: { $sum: '$amountMinor' },
        tipMinor: { $sum: '$tipMinor' },
        refundedMinor: { $sum: '$refundedMinor' },
        platformFeesMinor: { $sum: { $ifNull: ['$stripe.applicationFeeMinor', 0] } },
      },
    },
    { $sort: { amountMinor: -1 } },
  ]);

// Double-entry journal for the accountant, per business date and GL account.
// Outlet sales are recognised at the outlet; charge-to-room moves them to the guest ledger.
const accountingJournal = async (filter: TFilter, from: string, to: string) => {
  const codes = await ChargeCode.find().lean();
  const glOf = (code: string) => codes.find((c) => c.code === code)?.glCode || '4900';
  const lines: { date: string; account: string; description: string; debitMinor: number; creditMinor: number }[] = [];
  const push = (date: string, account: string, description: string, amount: number) => {
    if (!amount) return;
    lines.push({ date, account, description, debitMinor: amount > 0 ? amount : 0, creditMinor: amount < 0 ? -amount : 0 });
  };

  // Hotel revenue from folios (room, packages, manual charges), and guest ledger debits
  const folioRows = await FolioLine.aggregate([
    { $match: { ...locMatch(filter), businessDate: { $gte: from, $lte: to }, type: { $in: ['CHARGE', 'ADJUSTMENT'] }, code: { $nin: ['XFER'] } } },
    { $group: { _id: { date: '$businessDate', code: '$code', pos: { $eq: ['$source.kind', 'POS'] } }, net: { $sum: '$netMinor' }, tax: { $sum: '$taxMinor' }, gross: { $sum: '$amountMinor' } } },
  ]);
  for (const r of folioRows) {
    push(r._id.date, '1200', `Guest ledger ${r._id.code}`, r.gross);
    if (r._id.code === 'TIP') {
      push(r._id.date, '2300', 'Tips charged to rooms', -r.gross);
    } else if (r._id.pos) {
      push(r._id.date, '1250', `Outlet charges moved to rooms (${r._id.code})`, -r.gross);
    } else {
      push(r._id.date, glOf(r._id.code), `Revenue ${r._id.code}`, -r.net);
      push(r._id.date, '2200', `Tax on ${r._id.code}`, -r.tax);
    }
  }

  // Outlet revenue
  const orderRows = await Order.aggregate([
    { $match: { ...locMatch(filter), status: 'CLOSED', businessDate: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'VOIDED' } } },
    { $group: { _id: { date: '$businessDate', outletId: '$outletId', cat: '$items.taxCategory' }, net: { $sum: '$items.calc.netMinor' }, tax: { $sum: '$items.calc.taxMinor' }, total: { $sum: '$items.calc.totalMinor' } } },
  ]);
  const outlets = await Outlet.find().select('glCodes name').lean();
  for (const r of orderRows) {
    const outlet = outlets.find((o) => String(o._id) === String(r._id.outletId));
    const account = r._id.cat === 'FOOD' ? outlet?.glCodes?.food || glOf('FOOD') : ['BEVERAGE', 'ALCOHOL'].includes(r._id.cat) ? outlet?.glCodes?.beverage || glOf('BEV') : outlet?.glCodes?.other || glOf('MISC');
    push(r._id.date, '1250', `Outlet sales clearing ${outlet?.name || ''}`, r.total);
    push(r._id.date, account, `Outlet revenue ${outlet?.name || ''} ${r._id.cat}`, -(r.total - r.tax));
    push(r._id.date, '2200', `Outlet tax ${r._id.cat}`, -r.tax);
  }

  // Payments settle the clearing accounts
  const accountForMethod: Record<string, string> = { CASH: '1000', CARD_ONLINE: '1010', CARD_TERMINAL: '1010', CARD_EXTERNAL: '1015', BANK_TRANSFER: '1020', VOUCHER: '2400', LOYALTY: '2410', CHARGE_TO_ROOM: '1200', CITY_LEDGER: '1210' };
  const pays = await Payment.aggregate([
    { $match: { ...locMatch(filter), status: { $in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } },
    { $lookup: { from: 'orders', localField: 'target.id', foreignField: '_id', as: 'order' } },
    { $lookup: { from: 'foliolines', localField: 'folioLineIds', foreignField: '_id', as: 'lines' } },
    { $addFields: { date: { $ifNull: [{ $first: '$order.businessDate' }, { $first: '$lines.businessDate' }] } } },
    { $match: { date: { $gte: from, $lte: to } } },
    { $group: { _id: { date: '$date', method: '$method', kind: '$target.kind' }, amount: { $sum: { $subtract: ['$amountMinor', '$refundedMinor'] } }, tip: { $sum: '$tipMinor' } } },
  ]);
  for (const p of pays) {
    if (p._id.method === 'CHARGE_TO_ROOM' || p._id.method === 'CITY_LEDGER') continue; // already on the guest ledger
    push(p._id.date, accountForMethod[p._id.method] || '1090', `${p._id.method} received`, p.amount + p.tip);
    push(p._id.date, p._id.kind === 'ORDER' ? '1250' : '1200', `${p._id.method} applied`, -p.amount);
    push(p._id.date, '2300', 'Tips payable', -p.tip);
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account));
  const totals = lines.reduce((t, l) => ({ debit: t.debit + l.debitMinor, credit: t.credit + l.creditMinor }), { debit: 0, credit: 0 });
  return { from, to, lines, totals, balanced: totals.debit === totals.credit };
};

// Staff whose voids/discounts are far above their peers over the last N days (z-score).
const anomalies = async (filter: TFilter, days = 30, zThreshold = 2) => {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await Order.aggregate([
    { $match: { ...locMatch(filter), createdAt: { $gte: since } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$serverId',
        items: { $sum: 1 },
        voids: { $sum: { $cond: [{ $eq: ['$items.status', 'VOIDED'] }, 1, 0] } },
        discounts: { $sum: { $ifNull: ['$items.calc.discountMinor', 0] } },
        gross: { $sum: { $ifNull: ['$items.calc.grossMinor', 0] } },
      },
    },
    { $match: { items: { $gte: 20 } } },
  ]);
  const withRates = rows.map((r) => ({ ...r, voidRate: r.voids / r.items, discountRate: r.gross ? r.discounts / r.gross : 0 }));
  const stats = (values: number[]) => {
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1));
    return { mean, sd };
  };
  const v = stats(withRates.map((r) => r.voidRate));
  const d = stats(withRates.map((r) => r.discountRate));
  return withRates
    .map((r) => ({
      userId: r._id,
      items: r.items,
      voids: r.voids,
      voidRatePct: Math.round(r.voidRate * 10000) / 100,
      discountRatePct: Math.round(r.discountRate * 10000) / 100,
      voidZ: v.sd ? Math.round(((r.voidRate - v.mean) / v.sd) * 100) / 100 : 0,
      discountZ: d.sd ? Math.round(((r.discountRate - d.mean) / d.sd) * 100) / 100 : 0,
    }))
    .filter((r) => r.voidZ >= zThreshold || r.discountZ >= zThreshold);
};

// Daily job: raise UNUSUAL_VOIDS alerts per tenant.
const runAnomalyChecks = async () => {
  const tenants = await requestContext.asSystem(() => Tenant.find({ isActive: true, modules: 'RESTAURANT' }).select('_id').lean());
  const { AlertService } = await import('../alert/alert.service');
  const { User } = await import('../user/user.model');
  for (const tenant of tenants) {
    await requestContext.asTenant(String(tenant._id), async () => {
      for (const a of await anomalies({})) {
        const user = await User.findById(a.userId).select('name').lean();
        await AlertService.raise({
          type: 'UNUSUAL_VOIDS',
          severity: 'MEDIUM',
          title: `Unusual voids/discounts: ${user?.name || 'staff member'}`,
          message: `Void rate ${a.voidRatePct}% (z ${a.voidZ}), discount rate ${a.discountRatePct}% (z ${a.discountZ}) over 30 days.`,
          ref: a.userId ? { kind: 'User', id: a.userId } : undefined,
          dedupeKey: `anomaly:${a.userId}:${new Date().toISOString().slice(0, 7)}`,
        });
      }
    });
  }
};

// Kept for the original endpoints; now filtered by the right field names (tenantId).
const getHospitalityStats = async (filter: TFilter) => {
  const statusCounts = await RoomStay.aggregate([{ $match: locMatch(filter) }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  return { totalStays: statusCounts.reduce((s, c) => s + c.count, 0), statusCounts };
};

const getRestaurantStats = async (filter: TFilter) => {
  const [totalOrders, revenue] = await Promise.all([
    Order.countDocuments(locMatch(filter)),
    Order.aggregate([{ $match: { ...locMatch(filter), status: 'CLOSED' } }, { $group: { _id: null, total: { $sum: '$totals.totalMinor' } } }]),
  ]);
  return { totalOrders, totalRevenueMinor: revenue[0]?.total || 0 };
};

export const ReportService = {
  dashboard,
  sales,
  taxReport,
  paymentsReport,
  accountingJournal,
  anomalies,
  runAnomalyChecks,
  getHospitalityStats,
  getRestaurantStats,
};
