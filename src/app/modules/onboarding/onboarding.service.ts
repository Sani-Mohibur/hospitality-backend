import httpStatus from 'http-status';
import { Request } from 'express';
import AppError from '../../errors/AppError';
import { Tenant } from '../tenant/tenant.model';
import { Location } from '../location/location.model';
import { Outlet, Station } from '../outlet/outlet.model';
import { RoomCategory } from '../hospitality/roomCategory/roomCategory.model';
import { Room } from '../hospitality/room/room.model';
import { RatePlan } from '../hospitality/rate/rate.model';
import { Reservation } from '../hospitality/reservation/reservation.model';
import { ReservationServices } from '../hospitality/reservation/reservation.service';
import { GuestServices } from '../hospitality/guest/guest.service';
import { MenuCategory } from '../restaurant/menuCategory/menuCategory.model';
import { MenuItem, ModifierGroup } from '../restaurant/menuItem/menuItem.model';
import { Table } from '../restaurant/table/table.model';
import { Order } from '../restaurant/order/order.model';
import { User } from '../user/user.model';
import { TaxRule } from '../finance/finance.model';
import { SubscriptionServices } from '../subscription/subscription.service';
import { requestContext } from '../../utils/requestContext';
import { randomToken } from '../../utils/crypto';
import { parseCsv } from '../../utils/csv';
import { found } from '../../utils/query';

// Setup checklist that drives the onboarding wizard.
const status = async (locationId: string) => {
  const tenantId = requestContext.get()?.tenantId;
  const tenant = found(await requestContext.asSystem(() => Tenant.findById(tenantId).lean()), 'Tenant');
  const hotel = tenant.modules.includes('HOSPITALITY');
  const fnb = tenant.modules.includes('RESTAURANT');
  const [location, types, rooms, plans, outlets, items, tables, staff, taxes, orders, bookings] = await Promise.all([
    Location.findById(locationId).lean(),
    RoomCategory.countDocuments({ locationId }),
    Room.countDocuments({ locationId }),
    RatePlan.countDocuments({ locationId }),
    Outlet.countDocuments({ locationId }),
    MenuItem.countDocuments({ $or: [{ locationId }, { locationId: null }] }),
    Table.countDocuments({ locationId }),
    User.countDocuments({ role: { $in: ['TENANT_MANAGER', 'STAFF'] } }),
    TaxRule.countDocuments(),
    Order.countDocuments({ locationId }),
    Reservation.countDocuments({ locationId }),
  ]);
  const steps = [
    { key: 'property', label: 'Property details and timezone', done: Boolean(location?.address && location?.timezone) },
    { key: 'taxes', label: 'Tax rates', done: taxes > 0 },
    ...(hotel
      ? [
          { key: 'roomTypes', label: 'Room types', done: types > 0 },
          { key: 'rooms', label: 'Rooms', done: rooms > 0 },
          { key: 'rates', label: 'Rate plans', done: plans > 0 },
        ]
      : []),
    ...(fnb
      ? [
          { key: 'outlets', label: 'Outlets and kitchen stations', done: outlets > 0 },
          { key: 'menu', label: 'Menu', done: items > 0 },
          { key: 'tables', label: 'Tables', done: tables > 0 },
        ]
      : []),
    { key: 'staff', label: 'Staff and PINs', done: staff > 0 },
    { key: 'payments', label: 'Card payments (Stripe)', done: Boolean(tenant.stripe?.chargesEnabled) },
    { key: 'firstTransaction', label: hotel ? 'First booking' : 'First order', done: hotel ? bookings > 0 : orders > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  return { progressPct: Math.round((done / steps.length) * 100), next: steps.find((s) => !s.done)?.key || null, steps };
};

// Sample property data so a new owner can try everything before real setup.
const seedDemo = async (req: Request, locationId: string) => {
  const tenant = found(await requestContext.asSystem(() => Tenant.findById(req.user.tenantId).lean()), 'Tenant');
  const created: Record<string, number> = {};
  if (!(await TaxRule.exists({}))) {
    await TaxRule.create([
      { name: 'VAT', rateBps: 1000, categories: ['ROOM', 'FOOD', 'BEVERAGE', 'SERVICE', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER'] },
      { name: 'Alcohol duty', rateBps: 1500, categories: ['ALCOHOL'] },
    ]);
    created.taxRules = 2;
  }
  if (tenant.modules.includes('HOSPITALITY') && !(await RoomCategory.exists({ locationId }))) {
    await Location.updateOne({ _id: locationId }, { hasRooms: true });
    const [std, dlx] = await RoomCategory.create([
      { locationId, name: 'Standard Double', code: 'STD', baseRateMinor: 9000, capacity: 2, maxAdults: 2, maxChildren: 1, extraChildMinor: 1500 },
      { locationId, name: 'Deluxe King', code: 'DLX', baseRateMinor: 14000, capacity: 3, maxAdults: 3, maxChildren: 1, extraAdultMinor: 3000 },
    ]);
    const rooms = [];
    for (let n = 101; n <= 110; n += 1) rooms.push({ locationId, roomNumber: String(n), roomCategoryId: std!._id, floor: '1', qrToken: randomToken(12) });
    for (let n = 201; n <= 205; n += 1) rooms.push({ locationId, roomNumber: String(n), roomCategoryId: dlx!._id, floor: '2', qrToken: randomToken(12) });
    await Room.insertMany(rooms);
    const [bar] = await RatePlan.create([
      { locationId, name: 'Best available rate', code: 'BAR', rates: [{ roomTypeId: std!._id, amountMinor: 9000 }, { roomTypeId: dlx!._id, amountMinor: 14000 }], weekendRates: [{ roomTypeId: std!._id, amountMinor: 11000 }, { roomTypeId: dlx!._id, amountMinor: 16500 }] },
    ]);
    await RatePlan.create([
      { locationId, name: 'Bed and breakfast', code: 'BB', mealPlan: 'BB', pricingMode: 'DERIVED', parentRatePlanId: bar!._id, adjustMinor: 2400, packages: [{ chargeCode: 'BRKF', label: 'Breakfast', amountMinor: 1200, per: 'PERSON' }] },
      { locationId, name: 'Non-refundable', code: 'NRF', pricingMode: 'DERIVED', parentRatePlanId: bar!._id, adjustBps: -1000, isRefundable: false, cancellation: { freeUntilHours: 0, penalty: { type: 'PERCENT', value: 100 } }, deposit: { type: 'PERCENT', value: 100, dueDaysBeforeArrival: 0 } },
    ]);
    created.roomTypes = 2;
    created.rooms = rooms.length;
    created.ratePlans = 3;
  }
  if (tenant.modules.includes('RESTAURANT') && !(await MenuItem.exists({ locationId }))) {
    let outlet = await Outlet.findOne({ locationId });
    if (!outlet) outlet = await Outlet.create({ locationId, name: 'Restaurant' });
    let kitchen = await Station.findOne({ outletId: outlet._id, type: 'KITCHEN' });
    if (!kitchen) kitchen = await Station.create({ locationId, outletId: outlet._id, name: 'Kitchen', type: 'KITCHEN' });
    const bar = await Station.create({ locationId, outletId: outlet._id, name: 'Bar', type: 'BAR', targetMinutes: 5 });
    outlet.defaultStationId = kitchen._id;
    await outlet.save();
    const [mains, drinks] = await MenuCategory.create([{ locationId, name: 'Mains' }, { locationId, name: 'Drinks' }]);
    const [sides] = await ModifierGroup.create([
      { locationId, name: 'Choose a side', minSelect: 1, maxSelect: 1, options: [{ name: 'Fries', priceMinor: 0 }, { name: 'Salad', priceMinor: 0 }, { name: 'Sweet potato fries', priceMinor: 150 }] },
    ]);
    await MenuItem.create([
      { locationId, categoryId: mains!._id, name: 'Beef burger', priceMinor: 1450, taxCategory: 'FOOD', modifierGroupIds: [sides!._id], allergens: ['gluten', 'dairy'] },
      { locationId, categoryId: mains!._id, name: 'Grilled chicken', priceMinor: 1650, taxCategory: 'FOOD', modifierGroupIds: [sides!._id] },
      { locationId, categoryId: mains!._id, name: 'Vegetable curry', priceMinor: 1300, taxCategory: 'FOOD', allergens: ['nuts'] },
      { locationId, categoryId: drinks!._id, name: 'Espresso', priceMinor: 300, taxCategory: 'BEVERAGE', stationId: bar._id },
      { locationId, categoryId: drinks!._id, name: 'House red (glass)', priceMinor: 750, taxCategory: 'ALCOHOL', stationId: bar._id },
      { locationId, categoryId: drinks!._id, name: 'Sparkling water', priceMinor: 350, taxCategory: 'BEVERAGE', stationId: bar._id },
    ]);
    await Table.insertMany(Array.from({ length: 8 }, (_, i) => ({ locationId, outletId: outlet!._id, tableNumber: `T${i + 1}`, capacity: i < 4 ? 2 : 4, qrToken: randomToken(12), position: { x: (i % 4) * 2, y: Math.floor(i / 4) * 2, w: 1, h: 1, rotation: 0 } })));
    created.menuItems = 6;
    created.tables = 8;
  }
  await SubscriptionServices.recalculate(req.user.tenantId!);
  return { created };
};

type TImportResult = { created: number; failed: { row: number; error: string }[] };

// CSV imports for migrating from another system.
const importCsv = async (req: Request, locationId: string, kind: 'guests' | 'rooms' | 'menu' | 'reservations', csv: string): Promise<TImportResult> => {
  const rows = parseCsv(csv);
  if (!rows.length) throw new AppError(httpStatus.BAD_REQUEST, 'The CSV has no rows');
  if (rows.length > 5000) throw new AppError(httpStatus.BAD_REQUEST, 'Import at most 5000 rows at once');
  const result: TImportResult = { created: 0, failed: [] };
  for (const [i, row] of rows.entries()) {
    try {
      if (kind === 'guests') {
        await GuestServices.createGuest(
          { firstName: row.firstName!, lastName: row.lastName!, email: row.email || undefined, phone: row.phone || undefined, nationality: row.nationality || undefined, address: row.address || undefined, notes: row.notes || undefined, tags: row.tags ? row.tags.split('|') : [] },
          { allowDuplicate: false },
        );
      } else if (kind === 'rooms') {
        const type = found(await RoomCategory.findOne({ locationId, $or: [{ code: row.roomTypeCode?.toUpperCase() }, { name: row.roomType }] }).lean(), `Room type ${row.roomTypeCode || row.roomType}`);
        await Room.create({ locationId, roomNumber: row.roomNumber, roomCategoryId: type._id, floor: row.floor || undefined, qrToken: randomToken(12) });
      } else if (kind === 'menu') {
        let category = await MenuCategory.findOne({ locationId, name: row.category });
        if (!category) category = await MenuCategory.create({ locationId, name: row.category });
        const price = Math.round(Number(row.price) * 100);
        if (!Number.isFinite(price)) throw new Error('price must be a number like 12.50');
        await MenuItem.create({ locationId, categoryId: category._id, name: row.name, description: row.description || undefined, sku: row.sku || undefined, priceMinor: price, taxCategory: (row.taxCategory || 'FOOD').toUpperCase() });
      } else if (kind === 'reservations') {
        const type = found(await RoomCategory.findOne({ locationId, $or: [{ code: row.roomTypeCode?.toUpperCase() }, { name: row.roomType }] }).lean(), 'Room type');
        const plan = found(await RatePlan.findOne({ locationId, code: (row.ratePlanCode || 'BAR').toUpperCase() }).lean(), 'Rate plan');
        await ReservationServices.createReservation(req, {
          locationId,
          guest: { firstName: row.firstName, lastName: row.lastName, email: row.email || undefined, phone: row.phone || undefined },
          stays: [{ roomTypeId: String(type._id), ratePlanId: String(plan._id), arrivalDate: row.arrivalDate!, departureDate: row.departureDate!, adults: Number(row.adults || 1), children: Number(row.children || 0) }],
          source: 'DIRECT',
          notes: [row.notes, row.externalRef ? `Imported ref ${row.externalRef}` : ''].filter(Boolean).join(' - ') || undefined,
          confirm: true,
          overrideRestrictions: true,
        });
      }
      result.created += 1;
    } catch (err: any) {
      result.failed.push({ row: i + 2, error: err.message });
    }
  }
  if (kind === 'rooms') await SubscriptionServices.recalculate(req.user.tenantId!);
  return result;
};

export const OnboardingServices = { status, seedDemo, importCsv };
