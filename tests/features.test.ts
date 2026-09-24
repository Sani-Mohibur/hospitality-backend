import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, startApp, TApi } from './helpers';

// Covers the v1/v2 features: booking engine, Guest QR, channel manager, aggregators,
// recipe inventory, loyalty, card payments, KDS, split checks and hotel edge cases.

let api: TApi;
let token = '';
let locationId = '';
let outletId = '';
let stationId = '';
let ownerId = '';
let typeId = '';
let planId = '';
let businessDate = '';
let burgerId = '';

const h = (extra: Record<string, string> = {}) => ({ 'X-Location-Id': locationId, ...extra });
const ok = (res: { status: number; body: any }, status = 200) => assert.equal(res.status, status, JSON.stringify(res.body));

before(async () => {
  api = await startApp();
  const signup = await api.call('POST', '/auth/signup', {
    body: { businessName: 'Harbour Resort', ownerName: 'Owner', email: 'owner@harbour.test', password: 'password123', modules: ['HOSPITALITY', 'RESTAURANT', 'INVENTORY', 'DISTRIBUTION'] },
  });
  ok(signup, 201);
  token = signup.body.data.accessToken;
  ownerId = signup.body.data.user._id;
  locationId = (await api.call('GET', '/location', { token })).body.data[0]._id;
  const outlets = await api.call('GET', '/outlet', { token, headers: h() });
  outletId = outlets.body.data[0]._id;
  stationId = outlets.body.data[0].defaultStationId;

  ok(await api.call('POST', '/finance/tax-rules', { token, body: { name: 'VAT', rateBps: 1000, categories: ['ROOM', 'FOOD', 'BEVERAGE', 'SERVICE'] } }), 201);
  const type = await api.call('POST', '/room-category', { token, headers: h(), body: { name: 'Sea view', code: 'SEA', baseRateMinor: 20000, capacity: 3, maxAdults: 3 } });
  ok(type, 201);
  typeId = type.body.data._id;
  ok(await api.call('POST', '/room/bulk', { token, headers: h(), body: { roomCategoryId: typeId, from: 1, to: 4 } }), 201);
  const plan = await api.call('POST', '/rate/plans', {
    token,
    headers: h(),
    body: { name: 'Bed & breakfast', code: 'BB', rates: [{ roomTypeId: typeId, amountMinor: 20000 }], packages: [{ chargeCode: 'BRKF', label: 'Breakfast', amountMinor: 1500, per: 'PERSON' }], cancellation: { freeUntilHours: 48, penalty: { type: 'NIGHTS', value: 1 } } },
  });
  ok(plan, 201);
  planId = plan.body.data._id;
  businessDate = (await api.call('GET', `/location/${locationId}`, { token })).body.data.businessDate;
  ok(await api.call('PATCH', `/location/${locationId}`, { token, body: { publicBooking: { enabled: true, slug: 'harbour-resort' } } }));
  ok(await api.call('PATCH', '/tenant/me', { token, body: { loyalty: { enabled: true, pointsPerMajorUnit: 1, pointValueMinor: 1 } } }));

  const cat = await api.call('POST', '/restaurant/menu-category', { token, body: { name: 'Mains', locationId } });
  const burger = await api.call('POST', '/restaurant/menu-item', { token, body: { name: 'Burger', sku: 'BRG', priceMinor: 1000, categoryId: cat.body.data._id, locationId } });
  ok(burger, 201);
  burgerId = burger.body.data._id;
});

after(async () => {
  await api.stop();
});

describe('distribution', () => {
  it('sells a room on the public booking engine', async () => {
    const page = await api.call('GET', '/public/booking/harbour-resort');
    ok(page);
    const avail = await api.call('GET', `/public/booking/harbour-resort/availability?arrivalDate=${addDays(businessDate, 5)}&departureDate=${addDays(businessDate, 7)}&adults=2`);
    ok(avail);
    assert.equal(avail.body.data[0].totalMinor, 40000);
    const booking = await api.call('POST', '/public/booking/harbour-resort/reservations', {
      body: { guest: { firstName: 'Mia', lastName: 'Chen', email: 'mia@test.com' }, roomTypeId: typeId, ratePlanId: planId, arrivalDate: addDays(businessDate, 5), departureDate: addDays(businessDate, 7), adults: 2, marketingConsent: true },
    });
    ok(booking, 201);
    assert.equal(booking.body.data.status, 'CONFIRMED');
  });

  it('exposes ARI and takes OTA bookings through the channel API (idempotent, modify, cancel)', async () => {
    const key = await api.call('POST', '/integrations/api-keys', { token, body: { name: 'Channel manager', scopes: ['channel:read', 'channel:write', 'orders:write'] } });
    ok(key, 201);
    const headers = { 'X-Api-Key': key.body.data.apiKey };
    const ari = await api.call('GET', `/integrations/channel/ari?locationId=${locationId}&from=${businessDate}&to=${addDays(businessDate, 3)}`, { headers });
    ok(ari);
    assert.equal(ari.body.data.roomTypes[0].availability[0].available, 4);

    const payload = {
      locationId,
      channelName: 'Booking.com',
      externalRef: 'BDC-1',
      action: 'NEW',
      guest: { firstName: 'Lars', lastName: 'Berg' },
      stays: [{ roomTypeCode: 'SEA', ratePlanCode: 'BB', arrivalDate: addDays(businessDate, 20), departureDate: addDays(businessDate, 21), adults: 2, nightly: [{ date: addDays(businessDate, 20), amountMinor: 18500 }] }],
    };
    const first = await api.call('POST', '/integrations/channel/reservations', { headers, body: payload });
    ok(first, 201);
    assert.equal(first.body.data.stays[0].nightlyRates[0].amountMinor, 18500, 'the channel price is kept');
    const repeat = await api.call('POST', '/integrations/channel/reservations', { headers, body: payload });
    assert.equal(repeat.body.data._id, first.body.data._id, 'resending the same booking does not duplicate it');

    const modified = await api.call('POST', '/integrations/channel/reservations', { headers, body: { ...payload, action: 'MODIFY', stays: [{ ...payload.stays[0], arrivalDate: addDays(businessDate, 22), departureDate: addDays(businessDate, 23), nightly: undefined }] } });
    ok(modified, 201);
    const cancelled = await api.call('POST', '/integrations/channel/reservations', { headers, body: { ...payload, action: 'CANCEL' } });
    ok(cancelled, 201);
    assert.equal(cancelled.body.data.status, 'CANCELLED');

    const bad = await api.call('GET', `/integrations/channel/ari?locationId=${locationId}&from=${businessDate}&to=${businessDate}`, { headers: { 'X-Api-Key': 'hpos_nope_nope' } });
    assert.equal(bad.status, 401);
  });

  it('accepts a paid delivery order from an aggregator', async () => {
    const key = await api.call('POST', '/integrations/api-keys', { token, body: { name: 'Aggregator', scopes: ['orders:write'] } });
    const res = await api.call('POST', '/integrations/aggregator/orders', {
      headers: { 'X-Api-Key': key.body.data.apiKey },
      body: { locationId, outletId, aggregator: 'UberEats', externalId: 'UE-9', customer: { name: 'Kim', address: '1 Main St' }, items: [{ sku: 'BRG', quantity: 2 }], paid: true },
    });
    ok(res, 201);
    assert.equal(res.body.data.status, 'CLOSED');
    assert.equal(res.body.data.type, 'DELIVERY');
  });
});

describe('hotel edge cases', () => {
  it('charges the cancellation fee inside the penalty window', async () => {
    const res = await api.call('POST', '/reservation', {
      token,
      headers: h(),
      body: { guest: { firstName: 'Late', lastName: 'Canceller' }, stays: [{ roomTypeId: typeId, ratePlanId: planId, arrivalDate: businessDate, departureDate: addDays(businessDate, 1), adults: 1 }] },
    });
    ok(res, 201);
    const fee = await api.call('GET', `/reservation/${res.body.data._id}/cancellation-fee`, { token });
    assert.equal(fee.body.data.feeMinor, 20000);
    const cancel = await api.call('POST', `/reservation/${res.body.data._id}/cancel`, { token, body: { reason: 'Changed plans' } });
    ok(cancel);
    assert.equal(cancel.body.data.cancellationFeeMinor, 20000);
    const folio = await api.call('GET', `/folio/${res.body.data.stays[0].folioId}`, { token });
    assert.equal(folio.body.data.lines[0].code, 'CXL');
  });

  it('moves an in-house guest and posts package revenue separately at night audit', async () => {
    const res = await api.call('POST', '/reservation', {
      token,
      headers: h(),
      body: { guest: { firstName: 'Sam', lastName: 'Park' }, stays: [{ roomTypeId: typeId, ratePlanId: planId, arrivalDate: businessDate, departureDate: addDays(businessDate, 2), adults: 2 }] },
    });
    ok(res, 201);
    const stay = res.body.data.stays[0];
    const free = await api.call('GET', `/reservation/free-rooms?roomTypeId=${typeId}&arrivalDate=${businessDate}&departureDate=${addDays(businessDate, 2)}`, { token, headers: h() });
    ok(await api.call('POST', `/reservation/stays/${stay._id}/check-in`, { token, body: { roomId: free.body.data[0]._id } }));
    const move = await api.call('POST', `/reservation/stays/${stay._id}/room-move`, { token, body: { roomId: free.body.data[1]._id, reason: 'Noisy AC' } });
    ok(move);
    assert.equal(move.body.data.stays[0].roomId._id, free.body.data[1]._id);

    // A reservation that never arrives becomes a no-show at night audit.
    ok(await api.call('POST', '/reservation', {
      token,
      headers: h(),
      body: { guest: { firstName: 'No', lastName: 'Show' }, stays: [{ roomTypeId: typeId, ratePlanId: planId, arrivalDate: businessDate, departureDate: addDays(businessDate, 1), adults: 1 }], guarantee: { type: 'CARD' } },
    }), 201);

    ok(await api.call('POST', '/night-audit/run', { token, headers: h() }));
    const folio = await api.call('GET', `/folio/${stay.folioId}`, { token });
    const room = folio.body.data.lines.find((l: any) => l.code === 'ROOM');
    const brkf = folio.body.data.lines.find((l: any) => l.code === 'BRKF');
    assert.equal(brkf.netMinor, 3000, 'breakfast for 2 goes to F&B revenue');
    assert.equal(room.netMinor, 17000, 'room revenue is the rate minus the package');
    const noShows = await api.call('GET', '/reservation?status=NO_SHOW', { token, headers: h() });
    assert.equal(noShows.body.data.length, 1);
    const hk = await api.call('GET', '/housekeeping/board', { token, headers: h() });
    assert.ok(hk.body.data.tasks.length >= 1, 'stayover / departure tasks exist for the new day');
  });
});

describe('outlets', () => {
  it('splits a check, bumps the KDS ticket and pays by card (mock) then refunds', async () => {
    const order = await api.call('POST', '/restaurant/order', {
      token,
      headers: h(),
      body: { outletId, type: 'DINE_IN', covers: 2, items: [{ menuItemId: burgerId, quantity: 1, seat: 1 }, { menuItemId: burgerId, quantity: 1, seat: 2 }] },
    });
    ok(order, 201);
    const orderId = order.body.data._id;
    const checks = await api.call('POST', `/restaurant/order/${orderId}/split`, { token, body: { mode: 'SEATS' } });
    ok(checks);
    assert.deepEqual(checks.body.data.map((c: any) => c.totalMinor), [1100, 1100]);

    ok(await api.call('POST', '/restaurant/order/kitchen-queue/bump', { token, body: { orderId, stationId } }));
    const served = await api.call('GET', `/restaurant/order/${orderId}`, { token });
    assert.ok(served.body.data.items.every((i: any) => i.status === 'READY'));

    const card = await api.call('POST', `/restaurant/order/${orderId}/payments`, { token, headers: h({ 'Idempotency-Key': 'card-1' }), body: { checkNo: 1, method: 'CARD_ONLINE', amountMinor: 1100 } });
    ok(card, 201);
    assert.equal(card.body.data.payment.status, 'PENDING', 'card payments wait for the processor');
    ok(await api.call('POST', `/payment/${card.body.data.payment._id}/simulate-success`, { token }));
    const shift = await api.call('POST', '/shift/open', { token, headers: h(), body: { openingFloatMinor: 0 } });
    ok(shift, 201);
    ok(await api.call('POST', `/restaurant/order/${orderId}/payments`, { token, headers: h({ 'Idempotency-Key': 'cash-9' }), body: { checkNo: 2, method: 'CASH', amountMinor: 1100 } }), 201);
    const closed = await api.call('GET', `/restaurant/order/${orderId}`, { token });
    assert.equal(closed.body.data.status, 'CLOSED');

    const refund = await api.call('POST', `/payment/${card.body.data.payment._id}/refund`, { token, headers: { 'Idempotency-Key': 'refund-1' }, body: { amountMinor: 500, reason: 'Cold fries' } });
    ok(refund);
    assert.equal(refund.body.data.status, 'PARTIALLY_REFUNDED');
    const receipt = await api.call('GET', `/restaurant/order/${orderId}/receipt`, { token });
    ok(receipt);
    assert.match(receipt.body.data.text, /TOTAL/);
  });

  it('depletes stock from recipes when food is fired', async () => {
    const bun = await api.call('POST', '/inventory', { token, headers: h(), body: { name: 'Burger bun', sku: 'BUN', unitOfMeasure: 'pcs', unitCost: 30, openingQuantity: 50, reorderPoint: 10 } });
    ok(bun, 201);
    ok(await api.call('PUT', `/inventory/recipes/${burgerId}`, { token, body: { ingredients: [{ sku: 'BUN', quantity: 1 }] } }));
    ok(await api.call('POST', '/restaurant/order', { token, headers: h(), body: { outletId, type: 'TAKEAWAY', items: [{ menuItemId: burgerId, quantity: 3 }] } }), 201);
    await new Promise((r) => setTimeout(r, 300)); // depletion runs after the order commits
    const item = await api.call('GET', `/inventory/${bun.body.data._id}`, { token });
    assert.equal(item.body.data.quantity, 47);
    assert.ok(item.body.data.movements.some((m: any) => m.type === 'SALE'));
  });

  it('takes a Guest QR order that waits for staff acceptance', async () => {
    const table = await api.call('POST', '/restaurant/table', { token, body: { tableNumber: 'T1', capacity: 4, outletId } });
    ok(table, 201);
    const qr = table.body.data.qrToken;
    ok(await api.call('GET', `/public/qr/${qr}`));
    const menu = await api.call('GET', `/public/qr/${qr}/menu`);
    ok(menu);
    const order = await api.call('POST', `/public/qr/${qr}/orders`, { body: { items: [{ menuItemId: burgerId, quantity: 1 }] } });
    ok(order, 201);
    const queueBefore = await api.call('GET', `/restaurant/order/kitchen-queue?stationId=${stationId}`, { token, headers: h() });
    assert.ok(!queueBefore.body.data.some((t: any) => String(t.orderId) === String(order.body.data.orderId)));
    ok(await api.call('POST', `/restaurant/order/${order.body.data.orderId}/accept`, { token }));
    const queueAfter = await api.call('GET', `/restaurant/order/kitchen-queue?stationId=${stationId}`, { token, headers: h() });
    assert.ok(queueAfter.body.data.some((t: any) => String(t.orderId) === String(order.body.data.orderId)));
  });

  it('earns and spends loyalty points across the business', async () => {
    const guest = await api.call('POST', '/guest', { token, body: { firstName: 'Lena', lastName: 'Frost', email: 'lena@test.com' } });
    ok(guest, 201);
    const guestId = guest.body.data._id;
    const order = await api.call('POST', '/restaurant/order', { token, headers: h(), body: { outletId, type: 'TAKEAWAY', guestId, items: [{ menuItemId: burgerId, quantity: 5 }] } });
    ok(await api.call('POST', `/restaurant/order/${order.body.data._id}/payments`, { token, headers: h({ 'Idempotency-Key': 'loy-cash' }), body: { method: 'CASH', amountMinor: order.body.data.totals.totalMinor } }), 201);
    await new Promise((r) => setTimeout(r, 300));
    const wallet = await api.call('GET', `/loyalty/guests/${guestId}`, { token });
    assert.equal(wallet.body.data.pointsBalance, 55, '$55 spent = 55 points');

    const second = await api.call('POST', '/restaurant/order', { token, headers: h(), body: { outletId, type: 'TAKEAWAY', guestId, items: [{ menuItemId: burgerId, quantity: 1 }] } });
    const pay = await api.call('POST', `/restaurant/order/${second.body.data._id}/payments`, { token, headers: h({ 'Idempotency-Key': 'loy-pts' }), body: { method: 'LOYALTY', amountMinor: 50, guestId } });
    ok(pay, 201);
    const after = await api.call('GET', `/loyalty/guests/${guestId}`, { token });
    assert.equal(after.body.data.pointsBalance, 5);
  });
});

describe('platform', () => {
  it('reports onboarding progress, imports CSV and exports a guest', async () => {
    const status = await api.call('GET', '/onboarding/status', { token, headers: h() });
    ok(status);
    assert.ok(status.body.data.progressPct > 0);
    const imp = await api.call('POST', '/onboarding/import/guests', { token, headers: h(), body: { csv: 'firstName,lastName,email\nAda,Lovelace,ada@test.com\n"O\'Neil, Jr",Pat,pat@test.com\n,,\n' } });
    ok(imp);
    assert.equal(imp.body.data.created, 2);
    const guests = await api.call('GET', '/guest?searchTerm=Lovelace', { token });
    const exp = await api.call('GET', `/guest/${guests.body.data[0]._id}/export`, { token });
    ok(exp);
    assert.equal(exp.body.data.profile.email, 'ada@test.com');
  });

  it('keeps an activity feed with before/after values and redacts secrets from the raw log', async () => {
    ok(await api.call('PATCH', `/room-category/${typeId}`, { token, body: { baseRateMinor: 21000 } }));
    const feed = await api.call('GET', '/audit-log/activity?entity=RoomCategory', { token });
    const change = feed.body.data.find((e: any) => e.action === 'ROOM_TYPE_UPDATED');
    assert.deepEqual(change.changes.baseRateMinor, { from: 20000, to: 21000 });
    ok(await api.call('POST', '/auth/change-password', { token, body: { oldPassword: 'password123', newPassword: 'password456' } }));
    await new Promise((r) => setTimeout(r, 200));
    const raw = await api.call('GET', '/audit-log?entity=auth', { token });
    const entry = raw.body.data.find((e: any) => e.details?.url?.includes('change-password'));
    assert.equal(entry.details.body.newPassword, '[REDACTED]');
    void ownerId;
  });
});

describe('background jobs', () => {
  it('runs every scheduled job without errors', async () => {
    const { registerJobs } = await import('../src/app/jobs');
    const { runJobNow } = await import('../src/app/utils/scheduler');
    registerJobs();
    for (const name of ['alert-checks', 'webhook-deliveries', 'platform-billing', 'id-document-retention', 'staff-anomalies', 'night-audit-auto']) {
      await runJobNow(name);
    }
    const alerts = await api.call('GET', '/alert', { token });
    ok(alerts);
  });
});
