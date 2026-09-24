import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, startApp, TApi } from './helpers';

// End-to-end flows through the HTTP API against a real (in-memory) MongoDB replica set.

let api: TApi;

type TTenant = { token: string; locationId: string; outletId: string; stationId: string; userId: string };

const signup = async (name: string, email: string): Promise<TTenant> => {
  const res = await api.call('POST', '/auth/signup', {
    body: { businessName: name, ownerName: 'Owner', email, password: 'password123', timezone: 'UTC', currency: 'USD' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const token = res.body.data.accessToken;
  const locations = await api.call('GET', '/location', { token });
  const locationId = locations.body.data[0]._id;
  const outlets = await api.call('GET', '/outlet', { token, headers: { 'X-Location-Id': locationId } });
  const outletId = outlets.body.data[0]._id;
  return { token, locationId, outletId, stationId: outlets.body.data[0].defaultStationId, userId: res.body.data.user._id };
};

const h = (t: TTenant, extra: Record<string, string> = {}) => ({ 'X-Location-Id': t.locationId, ...extra });

before(async () => {
  api = await startApp();
});

after(async () => {
  await api.stop();
});

describe('security fixes', () => {
  it('no longer lets anyone register as SUPER_ADMIN', async () => {
    const res = await api.call('POST', '/auth/register', { body: { name: 'x', email: 'x@x.com', password: 'password123', role: 'SUPER_ADMIN' } });
    assert.equal(res.status, 404);
  });

  it('logs in (User find hooks work on Mongoose 9) and rejects bad passwords with a generic message', async () => {
    await signup('Login Hotel', 'login@test.com');
    const ok = await api.call('POST', '/auth/login', { body: { email: 'login@test.com', password: 'password123' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.data.accessToken);
    assert.equal(ok.body.data.refreshToken, undefined, 'refresh token must only be in the httpOnly cookie');
    const bad = await api.call('POST', '/auth/login', { body: { email: 'login@test.com', password: 'wrong-password' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.message, 'Invalid email or password');
  });

  it('isolates tenants even when another tenant id is supplied', async () => {
    const a = await signup('Tenant A', 'a@test.com');
    const b = await signup('Tenant B', 'b@test.com');
    const read = await api.call('GET', `/location/${a.locationId}`, { token: b.token });
    assert.equal(read.status, 404, 'the tenant filter hides rows of other tenants');
    const scoped = await api.call('GET', '/guest', { token: b.token, headers: { 'X-Location-Id': a.locationId } });
    assert.equal(scoped.status, 200); // header ignored for a non-location route; data is B's only
    const create = await api.call('POST', '/room-category', {
      token: b.token,
      headers: { 'X-Location-Id': a.locationId },
      body: { name: 'Hack', baseRateMinor: 100, capacity: 2 },
    });
    assert.equal(create.status, 404, 'a location of another tenant cannot be selected');
  });

  it('does not let a user promote themselves through update-profile', async () => {
    const t = await signup('Profile Co', 'profile@test.com');
    await api.call('PATCH', '/user/update-profile', { token: t.token, body: { name: 'New', role: 'SUPER_ADMIN', tenantId: '000000000000000000000000' } });
    const me = await api.call('GET', '/user/me', { token: t.token });
    assert.equal(me.body.data.role, 'TENANT_OWNER');
    assert.equal(me.body.data.name, 'New');
  });

  it('has no client-side payment completion endpoint any more', async () => {
    const t = await signup('Pay Co', 'pay@test.com');
    const res = await api.call('POST', '/payment/000000000000000000000000/complete', { token: t.token, body: {} });
    assert.equal(res.status, 404);
  });
});

describe('hotel + restaurant: one guest, one bill', () => {
  let t: TTenant;
  let typeId: string;
  let planId: string;
  let stayId: string;
  let folioId: string;
  let businessDate: string;

  before(async () => {
    t = await signup('Seaside Hotel', 'owner@seaside.test');
    await api.call('POST', '/finance/tax-rules', { token: t.token, body: { name: 'VAT', rateBps: 1000, categories: ['ROOM', 'FOOD', 'BEVERAGE'] } });
    const type = await api.call('POST', '/room-category', { token: t.token, headers: h(t), body: { name: 'Double', code: 'DBL', baseRateMinor: 10000, capacity: 2 } });
    assert.equal(type.status, 201, JSON.stringify(type.body));
    typeId = type.body.data._id;
    const rooms = await api.call('POST', '/room/bulk', { token: t.token, headers: h(t), body: { roomCategoryId: typeId, from: 101, to: 102 } });
    assert.equal(rooms.status, 201, JSON.stringify(rooms.body));
    const plan = await api.call('POST', '/rate/plans', { token: t.token, headers: h(t), body: { name: 'Best rate', code: 'BAR', rates: [{ roomTypeId: typeId, amountMinor: 12000 }] } });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    planId = plan.body.data._id;
    const loc = await api.call('GET', `/location/${t.locationId}`, { token: t.token });
    businessDate = loc.body.data.businessDate;
  });

  it('prevents overbooking a room type, even for concurrent requests', async () => {
    const book = () =>
      api.call('POST', '/reservation', {
        token: t.token,
        headers: h(t),
        body: {
          guest: { firstName: 'Ana', lastName: 'Silva', email: `ana${Math.random()}@test.com` },
          stays: [{ roomTypeId: typeId, ratePlanId: planId, arrivalDate: addDays(businessDate, 10), departureDate: addDays(businessDate, 12), adults: 2 }],
        },
      });
    const results = await Promise.all([book(), book(), book()]);
    const created = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409).length;
    assert.equal(created, 2, results.map((r) => `${r.status} ${r.body.message}`).join(' | '));
    assert.equal(rejected, 1);
  });

  it('books, assigns a room and checks in today', async () => {
    const res = await api.call('POST', '/reservation', {
      token: t.token,
      headers: h(t),
      body: {
        guest: { firstName: 'John', lastName: 'Smith', email: 'john@test.com' },
        stays: [{ roomTypeId: typeId, ratePlanId: planId, arrivalDate: businessDate, departureDate: addDays(businessDate, 2), adults: 1 }],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'CONFIRMED');
    stayId = res.body.data.stays[0]._id;
    folioId = res.body.data.stays[0].folioId;
    assert.deepEqual(res.body.data.stays[0].nightlyRates.map((n: any) => n.amountMinor), [12000, 12000]);

    const free = await api.call('GET', `/reservation/free-rooms?roomTypeId=${typeId}&arrivalDate=${businessDate}&departureDate=${addDays(businessDate, 2)}`, { token: t.token, headers: h(t) });
    const roomId = free.body.data[0]._id;
    const checkIn = await api.call('POST', `/reservation/stays/${stayId}/check-in`, { token: t.token, body: { roomId } });
    assert.equal(checkIn.status, 200, JSON.stringify(checkIn.body));
    const board = await api.call('GET', '/room/board', { token: t.token, headers: h(t) });
    assert.equal(board.body.data.summary.occupied, 1);
  });

  it('charges a restaurant order to the room as itemised folio lines (server-side prices)', async () => {
    const cat = await api.call('POST', '/restaurant/menu-category', { token: t.token, body: { name: 'Mains', locationId: t.locationId } });
    const group = await api.call('POST', '/restaurant/menu-item/modifier-groups', {
      token: t.token,
      body: { name: 'Side', minSelect: 1, maxSelect: 1, options: [{ name: 'Fries', priceMinor: 0 }, { name: 'Salad', priceMinor: 200 }] },
    });
    assert.equal(group.status, 201, JSON.stringify(group.body));
    const salad = group.body.data.options[1]._id;
    const item = await api.call('POST', '/restaurant/menu-item', {
      token: t.token,
      body: { name: 'Burger', priceMinor: 1500, categoryId: cat.body.data._id, locationId: t.locationId, modifierGroupIds: [group.body.data._id] },
    });
    assert.equal(item.status, 201, JSON.stringify(item.body));

    const missingSide = await api.call('POST', '/restaurant/order', {
      token: t.token,
      headers: h(t),
      body: { outletId: t.outletId, type: 'DINE_IN', items: [{ menuItemId: item.body.data._id, quantity: 1 }] },
    });
    assert.equal(missingSide.status, 400, 'required modifier group must be enforced');

    const order = await api.call('POST', '/restaurant/order', {
      token: t.token,
      headers: h(t),
      body: {
        outletId: t.outletId,
        type: 'DINE_IN',
        items: [{ menuItemId: item.body.data._id, quantity: 2, modifiers: [{ groupId: group.body.data._id, optionId: salad }], price: 1 }],
      },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    // 2 x (1500 + 200) = 3400 net + 10% VAT = 3740
    assert.equal(order.body.data.totals.totalMinor, 3740);
    assert.equal(order.body.data.items[0].status, 'QUEUED', 'course 1 is fired to the kitchen');

    const kds = await api.call('GET', `/restaurant/order/kitchen-queue?stationId=${t.stationId}`, { token: t.token, headers: h(t) });
    assert.equal(kds.body.data.length, 1);

    const wrongName = await api.call('POST', `/restaurant/order/${order.body.data._id}/payments`, {
      token: t.token,
      headers: h(t, { 'Idempotency-Key': 'room-charge-bad' }),
      body: { method: 'CHARGE_TO_ROOM', amountMinor: 3740, roomCharge: { roomStayId: stayId, guestLastName: 'Jones' } },
    });
    assert.equal(wrongName.status, 403);

    const pay = await api.call('POST', `/restaurant/order/${order.body.data._id}/payments`, {
      token: t.token,
      headers: h(t, { 'Idempotency-Key': 'room-charge-1' }),
      body: { method: 'CHARGE_TO_ROOM', amountMinor: 3740, tipMinor: 300, roomCharge: { roomStayId: stayId, guestLastName: 'smith' } },
    });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));

    const replay = await api.call('POST', `/restaurant/order/${order.body.data._id}/payments`, {
      token: t.token,
      headers: h(t, { 'Idempotency-Key': 'room-charge-1' }),
      body: { method: 'CHARGE_TO_ROOM', amountMinor: 3740, tipMinor: 300, roomCharge: { roomStayId: stayId, guestLastName: 'smith' } },
    });
    assert.equal(replay.status, 201, 'same Idempotency-Key replays the first response');

    const folio = await api.call('GET', `/folio/${folioId}`, { token: t.token });
    const posLines = folio.body.data.lines.filter((l: any) => l.source.kind === 'POS');
    assert.equal(posLines.length, 2, 'one item line + one tip line, not a lump sum');
    assert.equal(folio.body.data.balanceMinor, 3740 + 300);

    const closed = await api.call('GET', `/restaurant/order/${order.body.data._id}`, { token: t.token });
    assert.equal(closed.body.data.status, 'CLOSED');
  });

  it('runs the night audit: posts the room night and advances the business date', async () => {
    const preview = await api.call('GET', '/night-audit/preview', { token: t.token, headers: h(t) });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.canRun, true, JSON.stringify(preview.body.data.blocking));
    const run = await api.call('POST', '/night-audit/run', { token: t.token, headers: h(t) });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    const history = await api.call('GET', '/night-audit/history', { token: t.token, headers: h(t) });
    assert.equal(history.body.data[0].businessDate, businessDate);
    assert.equal(history.body.data[0].status, 'COMPLETED');

    const folio = await api.call('GET', `/folio/${folioId}`, { token: t.token });
    const roomLines = folio.body.data.lines.filter((l: any) => l.source.kind === 'ROOM_NIGHT');
    assert.equal(roomLines.length, 1);
    assert.equal(roomLines[0].amountMinor, 13200, '12000 + 10% VAT');
    const loc = await api.call('GET', `/location/${t.locationId}`, { token: t.token });
    assert.equal(loc.body.data.businessDate, addDays(businessDate, 1));
  });

  it('voids a folio line with a reversal and keeps the original', async () => {
    const charge = await api.call('POST', `/folio/${folioId}/charges`, { token: t.token, body: { code: 'MINI', description: 'Water', unitAmountMinor: 500 } });
    assert.equal(charge.status, 201, JSON.stringify(charge.body));
    const voided = await api.call('POST', `/folio/lines/${charge.body.data._id}/void`, { token: t.token, body: { reason: 'Posted by mistake' } });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    const folio = await api.call('GET', `/folio/${folioId}`, { token: t.token });
    const mini = folio.body.data.lines.filter((l: any) => l.code === 'MINI');
    assert.equal(mini.length, 2);
    assert.equal(mini[0].amountMinor + mini[1].amountMinor, 0);
  });

  it('blocks check-out with a balance, takes cash only with an open shift, then invoices', async () => {
    const blocked = await api.call('POST', `/reservation/stays/${stayId}/check-out`, { token: t.token, body: {} });
    assert.equal(blocked.status, 409);

    const folio = await api.call('GET', `/folio/${folioId}`, { token: t.token });
    const balance = folio.body.data.balanceMinor;
    const noShift = await api.call('POST', `/folio/${folioId}/payments`, {
      token: t.token,
      headers: h(t, { 'Idempotency-Key': 'cash-1' }),
      body: { method: 'CASH', amountMinor: balance },
    });
    assert.equal(noShift.status, 409, 'cash needs an open drawer');

    const shift = await api.call('POST', '/shift/open', { token: t.token, headers: h(t), body: { openingFloatMinor: 10000 } });
    assert.equal(shift.status, 201, JSON.stringify(shift.body));
    const cash = await api.call('POST', `/folio/${folioId}/payments`, {
      token: t.token,
      headers: h(t, { 'Idempotency-Key': 'cash-2' }),
      body: { method: 'CASH', amountMinor: balance, tenderedMinor: balance + 500 },
    });
    assert.equal(cash.status, 201, JSON.stringify(cash.body));
    assert.equal(cash.body.data.changeMinor, 500);

    const out = await api.call('POST', `/reservation/stays/${stayId}/check-out`, { token: t.token, body: {} });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const invoices = await api.call('GET', '/folio/invoices', { token: t.token, headers: h(t) });
    assert.equal(invoices.body.data.length, 1);
    assert.match(invoices.body.data[0].number, /^INV-000001$/);

    const close = await api.call('POST', `/shift/${shift.body.data._id}/close`, { token: t.token, body: { countedCashMinor: 10000 + balance } });
    assert.equal(close.status, 200, JSON.stringify(close.body));
    assert.equal(close.body.data.cash.varianceMinor, 0);
  });

  it('reports KPIs on the owner dashboard', async () => {
    const dash = await api.call('GET', `/report/dashboard?from=${businessDate}&to=${businessDate}`, { token: t.token, headers: h(t) });
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    assert.equal(dash.body.data.rooms.roomNightsSold, 1);
    assert.equal(dash.body.data.rooms.adrMinor, 12000);
    assert.equal(dash.body.data.crossModule.inHouseCaptureRatePct, 100);
    const journal = await api.call('GET', `/report/accounting-journal?from=${businessDate}&to=${businessDate}`, { token: t.token, headers: h(t) });
    assert.equal(journal.status, 200);
    assert.equal(journal.body.data.balanced, true, JSON.stringify(journal.body.data.totals));
  });
});

describe('staff permissions and manager approval', () => {
  it('limits a waiter and requires a manager PIN to void a fired item', async () => {
    const t = await signup('Bistro', 'owner@bistro.test');
    const roles = await api.call('GET', '/role', { token: t.token });
    const waiterRole = roles.body.data.find((r: any) => r.key === 'WAITER');
    const waiter = await api.call('POST', '/user/staff', {
      token: t.token,
      body: { name: 'Wanda', email: 'wanda@bistro.test', password: 'password123', roleId: waiterRole._id, locationIds: [t.locationId] },
    });
    assert.equal(waiter.status, 201, JSON.stringify(waiter.body));
    await api.call('PATCH', '/user/me/pin', { token: t.token, body: { pin: '4321' } });

    const login = await api.call('POST', '/auth/login', { body: { email: 'wanda@bistro.test', password: 'password123' } });
    const wToken = login.body.data.accessToken;

    const reports = await api.call('GET', '/report/dashboard?from=2026-01-01&to=2026-01-02', { token: wToken });
    assert.equal(reports.status, 403);

    const cat = await api.call('POST', '/restaurant/menu-category', { token: t.token, body: { name: 'Drinks', locationId: t.locationId } });
    const item = await api.call('POST', '/restaurant/menu-item', { token: t.token, body: { name: 'Cola', priceMinor: 300, categoryId: cat.body.data._id, locationId: t.locationId, taxCategory: 'BEVERAGE' } });
    const order = await api.call('POST', '/restaurant/order', {
      token: wToken,
      headers: h(t),
      body: { outletId: t.outletId, type: 'TAKEAWAY', items: [{ menuItemId: item.body.data._id, quantity: 1 }] },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const itemId = order.body.data.items[0]._id;

    const denied = await api.call('POST', `/restaurant/order/${order.body.data._id}/items/${itemId}/void`, { token: wToken, body: { reason: 'Wrong item' } });
    assert.equal(denied.status, 403);
    assert.match(denied.body.message, /MANAGER_APPROVAL_REQUIRED/);

    const approval = await api.call('POST', '/approval/pin', { token: wToken, body: { managerId: t.userId, pin: '4321', action: 'VOID_ITEM' } });
    assert.equal(approval.status, 200, JSON.stringify(approval.body));
    const approved = await api.call('POST', `/restaurant/order/${order.body.data._id}/items/${itemId}/void`, {
      token: wToken,
      headers: { 'X-Approval-Token': approval.body.data.approvalToken },
      body: { reason: 'Wrong item' },
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));

    const added = await api.call('POST', `/restaurant/order/${order.body.data._id}/items`, { token: wToken, body: { items: [{ menuItemId: item.body.data._id, quantity: 1 }] } });
    const secondItem = added.body.data.items[1]._id;
    const reused = await api.call('POST', `/restaurant/order/${order.body.data._id}/items/${secondItem}/void`, {
      token: wToken,
      headers: { 'X-Approval-Token': approval.body.data.approvalToken },
      body: { reason: 'again' },
    });
    assert.equal(reused.status, 403, 'approval tokens are single-use');
    const discount = await api.call('POST', '/approval/pin', { token: wToken, body: { managerId: t.userId, pin: '4321', action: 'DISCOUNT' } });
    const wrongAction = await api.call('POST', `/restaurant/order/${order.body.data._id}/items/${secondItem}/void`, {
      token: wToken,
      headers: { 'X-Approval-Token': discount.body.data.approvalToken },
      body: { reason: 'again' },
    });
    assert.equal(wrongAction.status, 403, 'approval tokens are bound to one action');

    const feed = await api.call('GET', '/audit-log/activity', { token: t.token });
    assert.ok(feed.body.data.some((e: any) => e.action === 'ITEM_VOIDED' && e.approvedBy === t.userId));
  });
});

describe('subscription pricing', () => {
  it('prices the Hotel + F&B Suite per room and outlet', async () => {
    const t = await signup('Price Hotel', 'price@test.com');
    const type = await api.call('POST', '/room-category', { token: t.token, headers: h(t), body: { name: 'Std', baseRateMinor: 5000, capacity: 2 } });
    await api.call('POST', '/room/bulk', { token: t.token, headers: h(t), body: { roomCategoryId: type.body.data._id, from: 1, to: 40 } });
    await api.call('POST', '/outlet', { token: t.token, headers: h(t), body: { name: 'Bar', type: 'BAR' } });
    const sub = await api.call('GET', '/subscription/my-subscription', { token: t.token });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    // 40 rooms x $4 + 2 outlets x $29 = $218 (plan example)
    assert.equal(sub.body.data.monthlyMinor, 21800);
    assert.equal(sub.body.data.planName, 'Hotel + F&B Suite');
  });
});
