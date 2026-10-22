// Rule tests (no browser needed).  Run with:  node test.js
// The 26 end-to-end cases from the spec (T01-T26) are in test-ui.js.
const assert = require('assert');
const F = require('./logic.js');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const staff = F.getUserById('u-staff01');
const res1 = F.getUserById('u-res01');   // unit A-12-03
const res2 = F.getUserById('u-res02');   // unit A-12-05

function fresh() { return F.newState(); }
function reg(s, ref, unit, when) {
  const r = F.registerDelivery(s, staff, { unit: unit || 'A-12-03', ref: ref || 'R1' }, when == null ? T0 : when);
  assert.ok(r.ok, 'registration failed: ' + r.reason);
  return r.order;
}
function collect(s, order, now) {
  assert.ok(F.verifyCode(s, staff, order.collectionCode, now).ok);
  const r = F.completeCollection(s, staff, order.orderId, now);
  assert.ok(r.ok, 'collection failed: ' + r.reason);
}
function wrongCode(order) { return order.collectionCode === '123456' ? '654321' : '123456'; }

console.log('Accounts and login');

t('demo accounts: one staff and eight residents, each resident with their own unit', () => {
  const l = F.demoLogins();
  assert.strictEqual(l.length, 9);
  assert.strictEqual(l.filter(a => a.role === 'STAFF').length, 1);
  const res = l.filter(a => a.role === 'RESIDENT');
  assert.strictEqual(res.length, 8);
  assert.strictEqual(new Set(res.map(a => a.unitNumber)).size, 8);
  assert.strictEqual(new Set(l.map(a => a.username)).size, 9);
  assert.deepStrictEqual(F.accountProblems(), []);
});

t('the configured units are exactly the ones planned, and the registration list is built from them', () => {
  const planned = ['A-12-03', 'A-12-05', 'A-12-07', 'A-13-02', 'A-13-05', 'B-05-03', 'B-05-06', 'B-06-01'];
  assert.deepStrictEqual(F.validUnits().slice().sort(), planned.slice().sort());
  assert.deepStrictEqual(F.residentDirectory().map(r => r.unitNumber), F.validUnits());
  F.residentDirectory().forEach(r => assert.ok(r.displayName));
});

t('every demo resident can log in and gets the RESIDENT role with their own unit', () => {
  const s = fresh();
  F.demoLogins().filter(a => a.role === 'RESIDENT').forEach(a => {
    const r = F.login(s, a.username, a.password, T0);
    assert.ok(r.ok, a.username);
    assert.strictEqual(r.user.role, 'RESIDENT');
    assert.strictEqual(r.user.unitNumber, a.unitNumber);
  });
});

t('valid logins return the role stored on the account', () => {
  const s = fresh();
  assert.strictEqual(F.login(s, 'staff01', 'Staff123!', T0).user.role, 'STAFF');
  const r = F.login(s, 'resident01', 'Resident123!', T0);
  assert.strictEqual(r.user.role, 'RESIDENT');
  assert.strictEqual(r.user.unitNumber, 'A-12-03');
  assert.strictEqual(r.user.password, undefined);
});

t('username is not case sensitive, password is', () => {
  const s = fresh();
  assert.ok(F.login(s, 'STAFF01', 'Staff123!', T0).ok);
  assert.strictEqual(F.login(s, 'staff01', 'staff123!', T0).ok, false);
});

t('empty fields, unknown user and wrong password are rejected', () => {
  const s = fresh();
  assert.strictEqual(F.login(s, '', '', T0).reason, 'missing_fields');
  assert.strictEqual(F.login(s, 'staff01', '', T0).reason, 'missing_fields');
  assert.strictEqual(F.login(s, 'nobody', 'x', T0).reason, 'invalid_credentials');
  assert.strictEqual(F.login(s, 'staff01', 'wrong', T0).reason, 'invalid_credentials');
});

t('the log records logins and failed logins but never passwords', () => {
  const s = fresh();
  F.login(s, 'staff01', 'Staff123!', T0);
  F.login(s, 'staff01', 'SuperSecretGuess9', T0);
  const text = JSON.stringify(s.audit);
  assert.ok(!text.includes('Staff123!'));
  assert.ok(!text.includes('SuperSecretGuess9'));
  assert.deepStrictEqual(s.audit.map(e => e.eventType), ['login_failed', 'login']);
});

console.log('Role separation');

t('a resident cannot register, verify, collect, view the log or use demo tools', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  assert.strictEqual(F.registerDelivery(s, res1, { unit: 'A-12-03', ref: 'X' }, T0).reason, 'forbidden');
  assert.strictEqual(F.verifyCode(s, res1, o.collectionCode, T0).reason, 'forbidden');
  assert.strictEqual(F.completeCollection(s, res1, o.orderId, T0).reason, 'forbidden');
  assert.strictEqual(F.getActivityLog(s, res1).reason, 'forbidden');
  assert.strictEqual(F.queue(s, res1, {}, T0).reason, 'forbidden');
  assert.strictEqual(F.summary(s, res1, T0).reason, 'forbidden');
  assert.strictEqual(F.loadDemo(s, res1, T0).reason, 'forbidden');
  assert.strictEqual(F.resetDemo(s, res1, T0).reason, 'forbidden');
  assert.strictEqual(F.advanceClock(s, res1, 5, T0).reason, 'forbidden');
  assert.strictEqual(F.setOverdueMinutes(s, res1, 5, T0).reason, 'forbidden');
  assert.strictEqual(F.addTest(s, res1, { participant: 'P' , seconds: 1 }).reason, 'forbidden');
  assert.strictEqual(s.orders.length, 1);
});

t('staff cannot use resident-only functions', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  assert.strictEqual(F.residentOrders(s, staff).reason, 'forbidden');
  assert.strictEqual(F.createDelegation(s, staff, o.orderId, 'Sam', 30, T0).reason, 'forbidden');
});

t('a doctored actor object cannot grant staff rights (role comes from the account record)', () => {
  const s = fresh();
  const forged = { userId: 'u-res01', role: 'STAFF', unitNumber: null };
  assert.strictEqual(F.registerDelivery(s, forged, { unit: 'A-12-03', ref: 'X' }, T0).reason, 'forbidden');
  assert.strictEqual(F.registerDelivery(s, { userId: 'nope', role: 'STAFF' }, { unit: 'A-12-03', ref: 'X' }, T0).reason, 'not_authenticated');
  assert.strictEqual(F.registerDelivery(s, null, { unit: 'A-12-03', ref: 'X' }, T0).reason, 'not_authenticated');
  const forgedUnit = { userId: 'u-res01', role: 'RESIDENT', unitNumber: 'A-12-05' };
  reg(s, 'R2', 'A-12-05');
  assert.strictEqual(F.residentOrders(s, forgedUnit).pending.length, 0);   // still resident01's unit
});

t('a resident only sees orders for their own unit', () => {
  const s = fresh();
  reg(s, 'R1', 'A-12-03');
  reg(s, 'R2', 'A-12-05');
  assert.deepStrictEqual(F.residentOrders(s, res1).pending.map(o => o.orderReference), ['R1']);
  assert.deepStrictEqual(F.residentOrders(s, res2).pending.map(o => o.orderReference), ['R2']);
});

t('a resident cannot authorise collection of another unit\'s order', () => {
  const s = fresh();
  const o = reg(s, 'R1', 'A-12-03');
  assert.strictEqual(F.createDelegation(s, res2, o.orderId, 'Sam', 30, T0).reason, 'not_found');
  assert.strictEqual(o.delegations.length, 0);
});

console.log('Registering deliveries');

t('registration creates a PENDING order with a 6-digit code and arrival time', () => {
  const s = fresh();
  const o = reg(s, ' FS-1 ', 'a-12-03');
  assert.strictEqual(o.status, 'PENDING');
  assert.strictEqual(o.orderReference, 'FS-1');
  assert.strictEqual(o.residentUnit, 'A-12-03');
  assert.strictEqual(o.arrivalTime, T0);
  assert.match(o.collectionCode, /^\d{6}$/);
  assert.strictEqual(o.collectionTime, null);
});

t('missing unit, unknown unit and missing reference are rejected and create nothing', () => {
  const s = fresh();
  assert.strictEqual(F.registerDelivery(s, staff, { unit: '', ref: 'X' }, T0).reason, 'unit_required');
  assert.strictEqual(F.registerDelivery(s, staff, { unit: 'Z-99-99', ref: 'X' }, T0).reason, 'invalid_unit');
  assert.strictEqual(F.registerDelivery(s, staff, { unit: 'A-12-03', ref: '  ' }, T0).reason, 'ref_required');
  assert.strictEqual(F.registerDelivery(s, staff, { unit: 'A-12-03', ref: 'x'.repeat(41) }, T0).reason, 'ref_too_long');
  assert.strictEqual(F.registerDelivery(s, staff, { unit: 'A-12-03', ref: 'X', note: 'n'.repeat(141) }, T0).reason, 'note_too_long');
  assert.strictEqual(s.orders.length, 0);
  assert.strictEqual(s.nextOrderId, 1);
});

t('order references are unique, ignoring case and spaces at the ends', () => {
  const s = fresh();
  reg(s, 'FS-1');
  assert.strictEqual(F.registerDelivery(s, staff, { unit: 'A-12-05', ref: ' fs-1 ' }, T0).reason, 'duplicate_ref');
  assert.strictEqual(s.orders.length, 1);
});

t('codes are unique across 300 orders and their authorisation codes', () => {
  const s = fresh();
  const codes = new Set();
  for (let i = 0; i < 300; i++) {
    const o = reg(s, 'R' + i);
    codes.add(o.collectionCode);
    const d = F.createDelegation(s, res1, o.orderId, 'Sam', 30, T0);
    codes.add(d.delegation.code);
  }
  assert.strictEqual(codes.size, 600);
});

t('staff can register a delivery for every configured unit, and only that resident sees it', () => {
  const s = fresh();
  F.validUnits().forEach(u => reg(s, 'REF-' + u, u));
  assert.strictEqual(s.orders.length, 8);
  F.demoLogins().filter(a => a.role === 'RESIDENT').forEach(a => {
    const me = F.getUserById('u-res0' + a.username.slice(-1));
    const r = F.residentOrders(s, me);
    assert.strictEqual(r.unit, a.unitNumber);
    assert.deepStrictEqual(r.pending.map(o => o.orderReference), ['REF-' + a.unitNumber]);
  });
});

t('units that are not configured residents are still rejected, whatever they look like', () => {
  const s = fresh();
  ['A-12-04', 'A-12-3', 'A12-03', 'B-06-02', 'C-01-01', 'A-99-99', 'A-12-03 x', '0', 'DROP TABLE'].forEach(u => {
    assert.strictEqual(F.registerDelivery(s, staff, { unit: u, ref: 'X-' + u }, T0).reason, 'invalid_unit', u);
  });
  assert.strictEqual(s.orders.length, 0);
  assert.strictEqual(F.registerDelivery(s, staff, { unit: ' b-06-01 ', ref: 'OK-1' }, T0).order.residentUnit, 'B-06-01');
});

console.log('Verify, then confirm');

t('a valid code finds the order but does not collect it yet', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  const v = F.verifyCode(s, staff, o.collectionCode, T0 + MIN);
  assert.ok(v.ok);
  assert.strictEqual(v.order.orderReference, 'R1');
  assert.strictEqual(o.status, 'PENDING');
});

t('confirming without a passed code check is refused', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  assert.strictEqual(F.completeCollection(s, staff, o.orderId, T0).reason, 'not_verified');
  assert.strictEqual(o.status, 'PENDING');
});

t('confirming after a check collects, stamps the time and uses up the code', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  collect(s, o, T0 + 7 * MIN);
  assert.strictEqual(o.status, 'COLLECTED');
  assert.strictEqual(o.collectionTime, T0 + 7 * MIN);
  assert.strictEqual(o.codeUsed, true);
  assert.strictEqual(o.confirmedBy, 'u-staff01');
});

t('a code check for one order cannot be used to collect another', () => {
  const s = fresh();
  const a = reg(s, 'A');
  const b = reg(s, 'B');
  F.verifyCode(s, staff, a.collectionCode, T0);
  assert.strictEqual(F.completeCollection(s, staff, b.orderId, T0).reason, 'not_verified');
  assert.strictEqual(b.status, 'PENDING');
});

t('a new code check cancels the previous one', () => {
  const s = fresh();
  const a = reg(s, 'A');
  const b = reg(s, 'B');
  F.verifyCode(s, staff, a.collectionCode, T0);
  F.verifyCode(s, staff, b.collectionCode, T0);
  assert.strictEqual(F.completeCollection(s, staff, a.orderId, T0).reason, 'not_verified');
  assert.ok(F.completeCollection(s, staff, b.orderId, T0).ok);
});

t('cancelling a check means confirm no longer works', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  F.verifyCode(s, staff, o.collectionCode, T0);
  F.cancelVerification(s, staff);
  assert.strictEqual(F.completeCollection(s, staff, o.orderId, T0).reason, 'not_verified');
});

t('wrong, empty and unknown codes are rejected, change nothing and are logged', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  assert.strictEqual(F.verifyCode(s, staff, '', T0).reason, 'code_required');
  assert.strictEqual(F.verifyCode(s, staff, wrongCode(o), T0).reason, 'code_not_found');
  assert.strictEqual(o.status, 'PENDING');
  assert.strictEqual(s.audit.filter(e => e.eventType === 'verify_failed').length, 2);
});

t('typed codes are never written to the log', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  F.verifyCode(s, staff, '987654', T0);
  F.verifyCode(s, staff, o.collectionCode, T0);
  const texts = s.audit.map(e => e.message + ' ' + (e.orderReference || '')).join(' | ');
  assert.ok(!texts.includes('987654'));
  assert.ok(!texts.includes(o.collectionCode));
});

t('a collected order\'s code is refused when checked again and cannot be collected twice', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  const code = o.collectionCode;
  collect(s, o, T0 + MIN);
  assert.strictEqual(F.verifyCode(s, staff, code, T0 + 2 * MIN).reason, 'already_collected');
  assert.strictEqual(F.completeCollection(s, staff, o.orderId, T0 + 2 * MIN).reason, 'not_verified');
  assert.strictEqual(o.collectionTime, T0 + MIN);
});

t('if the order was collected between check and confirm (e.g. second counter), confirm is rejected', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  F.verifyCode(s, staff, o.collectionCode, T0);
  o.status = 'COLLECTED'; o.collectionTime = T0;     // simulate another session finishing first
  const r = F.completeCollection(s, staff, o.orderId, T0 + MIN);
  assert.strictEqual(r.reason, 'already_collected');
  assert.strictEqual(o.collectionTime, T0);
  assert.strictEqual(s.audit[0].eventType, 'collect_failed');
});

t('checking with an expected order rejects a code from a different order', () => {
  const s = fresh();
  const a = reg(s, 'A');
  const b = reg(s, 'B');
  assert.strictEqual(F.verifyCode(s, staff, b.collectionCode, T0, a.orderId).reason, 'wrong_order');
  assert.ok(F.verifyCode(s, staff, a.collectionCode, T0, a.orderId).ok);
});

t('three failed checks in a row are counted; a good check resets the count', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  F.verifyCode(s, staff, '111111', T0);
  F.verifyCode(s, staff, '222222', T0);
  assert.strictEqual(F.verifyCode(s, staff, '333333', T0).failStreak, 3);
  F.verifyCode(s, staff, o.collectionCode, T0);
  assert.strictEqual(s.failStreak, 0);
});

console.log('Authorised collector');

t('authorised person collects with their own code, with name recorded', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  const d = F.createDelegation(s, res1, o.orderId, 'Neighbour Sam', 30, T0 + MIN);
  assert.ok(d.ok);
  const v = F.verifyCode(s, staff, d.delegation.code, T0 + 5 * MIN);
  assert.strictEqual(v.via, 'delegate');
  assert.strictEqual(v.delegateName, 'Neighbour Sam');
  assert.ok(F.completeCollection(s, staff, o.orderId, T0 + 5 * MIN).ok);
  assert.match(o.collectedBy, /Neighbour Sam/);
});

t('authorisation expires, including between check and confirm', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  const d = F.createDelegation(s, res1, o.orderId, 'Sam', 30, T0).delegation;
  assert.strictEqual(F.verifyCode(s, staff, d.code, T0 + 31 * MIN).reason, 'delegation_expired');
  assert.ok(F.verifyCode(s, staff, d.code, T0 + 29 * MIN).ok);
  assert.strictEqual(F.completeCollection(s, staff, o.orderId, T0 + 31 * MIN).reason, 'delegation_expired');
  assert.strictEqual(o.status, 'PENDING');
});

t('a newer authorisation cancels the older one', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  const d1 = F.createDelegation(s, res1, o.orderId, 'Sam', 30, T0).delegation;
  F.createDelegation(s, res1, o.orderId, 'Alex', 30, T0);
  assert.strictEqual(F.verifyCode(s, staff, d1.code, T0 + MIN).reason, 'delegation_cancelled');
});

t('authorisation needs a name and 5-240 minutes, and only works on pending orders', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  assert.strictEqual(F.createDelegation(s, res1, o.orderId, '', 30, T0).reason, 'name_required');
  assert.strictEqual(F.createDelegation(s, res1, o.orderId, 'Sam', 4, T0).reason, 'bad_duration');
  assert.strictEqual(F.createDelegation(s, res1, o.orderId, 'Sam', 241, T0).reason, 'bad_duration');
  assert.strictEqual(F.createDelegation(s, res1, o.orderId, 'Sam', 10.5, T0).reason, 'bad_duration');
  collect(s, o, T0);
  assert.strictEqual(F.createDelegation(s, res1, o.orderId, 'Sam', 30, T0).reason, 'already_collected');
});

console.log('Waiting time and overdue');

t('overdue starts at the threshold, stays PENDING, and ends when collected', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  assert.strictEqual(F.waitingMinutes(o, T0 + 14 * MIN + 59000), 14);
  assert.strictEqual(F.summary(s, staff, T0 + 14 * MIN).overdue, 0);
  const sm = F.summary(s, staff, T0 + 15 * MIN);
  assert.strictEqual(sm.overdue, 1);
  assert.strictEqual(sm.pending, 1);
  assert.strictEqual(o.status, 'PENDING');
  collect(s, o, T0 + 20 * MIN);
  assert.strictEqual(F.summary(s, staff, T0 + 60 * MIN).overdue, 0);
  assert.strictEqual(F.waitingMinutes(o, T0 + 60 * MIN), 20);       // timer stops at collection
});

t('threshold is configurable (1-240 whole minutes)', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  assert.ok(F.setOverdueMinutes(s, staff, 5, T0).ok);
  assert.strictEqual(F.summary(s, staff, T0 + 5 * MIN).overdue, 1);
  assert.strictEqual(F.setOverdueMinutes(s, staff, 0, T0).reason, 'bad_minutes');
  assert.strictEqual(F.setOverdueMinutes(s, staff, 241, T0).reason, 'bad_minutes');
  assert.strictEqual(F.setOverdueMinutes(s, staff, 2.5, T0).reason, 'bad_minutes');
  assert.strictEqual(s.settings.overdueMinutes, 5);
  assert.ok(o);
});

console.log('Queue, search and log');

t('queue filters: pending (default), overdue, collected, all; search by reference or unit', () => {
  const s = fresh();
  const a = reg(s, 'AAA-1', 'A-12-03', T0);
  reg(s, 'BBB-2', 'A-12-05', T0 + 10 * MIN);
  collect(s, a, T0 + 11 * MIN);
  const now = T0 + 30 * MIN;
  assert.deepStrictEqual(F.queue(s, staff, {}, now).orders.map(o => o.orderReference), ['BBB-2']);
  assert.deepStrictEqual(F.queue(s, staff, { filter: 'overdue' }, now).orders.map(o => o.orderReference), ['BBB-2']);
  assert.deepStrictEqual(F.queue(s, staff, { filter: 'collected' }, now).orders.map(o => o.orderReference), ['AAA-1']);
  assert.strictEqual(F.queue(s, staff, { filter: 'all' }, now).orders.length, 2);
  assert.deepStrictEqual(F.queue(s, staff, { filter: 'all', query: 'bbb' }, now).orders.map(o => o.orderReference), ['BBB-2']);
  assert.deepStrictEqual(F.queue(s, staff, { filter: 'all', query: 'a-12-03' }, now).orders.map(o => o.orderReference), ['AAA-1']);
});

t('activity log has every required event type, and residents cannot read it', () => {
  const s = fresh();
  F.login(s, 'staff01', 'Staff123!', T0);
  const o = reg(s, 'R1');
  F.verifyCode(s, staff, '000001', T0);
  collect(s, o, T0 + MIN);
  F.logout(s, staff, T0 + 2 * MIN);
  const types = F.getActivityLog(s, staff).entries.map(e => e.eventType);
  ['login', 'delivery_registered', 'verify_failed', 'verify_success', 'collected', 'logout'].forEach(x => assert.ok(types.includes(x), x));
  const e = s.audit[0];
  ['logId', 'eventType', 'actorUserId', 'actorRole', 'orderReference', 'timestamp', 'outcome', 'message'].forEach(k => assert.ok(k in e, k));
  assert.strictEqual(F.getActivityLog(s, res1).reason, 'forbidden');
});

t('log search and type filter', () => {
  const s = fresh();
  reg(s, 'R1');
  F.verifyCode(s, staff, '000001', T0);
  assert.strictEqual(F.getActivityLog(s, staff, { type: 'verify_failed' }).entries.length, 1);
  assert.strictEqual(F.getActivityLog(s, staff, { query: 'R1' }).entries.length, 1);
});

t('blocked page visits are logged without needing a login', () => {
  const s = fresh();
  F.recordAccessDenied(s, null, '/staff', T0);
  F.recordAccessDenied(s, res1, '/staff/log', T0);
  assert.deepStrictEqual(s.audit.map(e => e.actorRole), ['RESIDENT', 'ANONYMOUS']);
  assert.strictEqual(s.audit[0].outcome, 'DENIED');
});

console.log('Demo tools');

t('load demo data: 4 orders (1 collected), one overdue now, a second after +5 minutes', () => {
  const s = fresh();
  assert.ok(F.loadDemo(s, staff, T0).ok);
  assert.strictEqual(s.orders.length, 4);
  assert.strictEqual(F.summary(s, staff, T0).collected, 1);
  assert.strictEqual(F.summary(s, staff, T0).overdue, 1);
  assert.strictEqual(F.summary(s, staff, T0 + 5 * MIN).overdue, 2);
  assert.strictEqual(new Set(s.orders.map(o => o.collectionCode)).size, 4);
  s.orders.forEach(o => { if (o.status === 'COLLECTED') assert.ok(o.collectionTime != null && o.codeUsed); });
});

t('saved orders from before the new residents were added still load (units only grew)', () => {
  const s = fresh();
  F.loadDemo(s, staff, T0);
  const saved = JSON.parse(JSON.stringify(s));
  const back = F.normalizeState(saved);
  assert.ok(back);
  assert.strictEqual(back.orders.length, 4);
  assert.deepStrictEqual(back.orders.map(o => o.collectionCode), s.orders.map(o => o.collectionCode));
});

t('demo data matches both residents (A-12-03 has pending and history)', () => {
  const s = fresh();
  F.loadDemo(s, staff, T0);
  const r = F.residentOrders(s, res1);
  assert.strictEqual(r.pending.length, 2);
  assert.strictEqual(r.history.length, 1);
  assert.strictEqual(F.residentOrders(s, res2).pending.length, 1);
});

t('advance clock moves time forward; bad values are refused', () => {
  const s = fresh();
  assert.ok(F.advanceClock(s, staff, 10, T0).ok);
  assert.strictEqual(s.offsetMs, 10 * MIN);
  assert.strictEqual(F.advanceClock(s, staff, 0, T0).reason, 'bad_minutes');
  assert.strictEqual(F.advanceClock(s, staff, 601, T0).reason, 'bad_minutes');
});

t('reset clears orders, log, clock and verifications, keeps accounts and test results', () => {
  const s = fresh();
  F.loadDemo(s, staff, T0);
  F.advanceClock(s, staff, 10, T0);
  F.setOverdueMinutes(s, staff, 3, T0);
  F.addTest(s, staff, { participant: 'P1', condition: 'with', correct: true, seconds: 9 });
  F.verifyCode(s, staff, s.orders[1].collectionCode, T0);
  assert.ok(F.resetDemo(s, staff, T0 + 10 * MIN).ok);
  assert.strictEqual(s.orders.length, 0);
  assert.strictEqual(s.audit.length, 1);
  assert.strictEqual(s.audit[0].eventType, 'demo_reset');
  assert.strictEqual(s.offsetMs, 0);
  assert.strictEqual(s.settings.overdueMinutes, 15);
  assert.deepStrictEqual(s.verifications, {});
  assert.strictEqual(s.tests.length, 1);
  assert.ok(F.login(s, 'staff01', 'Staff123!', T0).ok);
  const o = reg(s, 'AFTER-RESET');
  assert.strictEqual(o.orderId, 1);
});

console.log('Saved-data safety');

t('normalizeState accepts a saved state and rejects damaged or inconsistent ones', () => {
  const s = fresh();
  F.loadDemo(s, staff, T0);
  const ok = F.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.ok(ok && ok.orders.length === 4);
  assert.strictEqual(F.normalizeState(null), null);
  assert.strictEqual(F.normalizeState({}), null);
  const bad = JSON.parse(JSON.stringify(s));
  bad.orders[1].status = 'DONE';
  assert.strictEqual(F.normalizeState(bad), null);
  const dupRef = JSON.parse(JSON.stringify(s));
  dupRef.orders[1].orderReference = dupRef.orders[0].orderReference;
  assert.strictEqual(F.normalizeState(dupRef), null);
  const noTime = JSON.parse(JSON.stringify(s));
  noTime.orders[0].collectionTime = null;                    // collected but no timestamp
  assert.strictEqual(F.normalizeState(noTime), null);
  const badUnit = JSON.parse(JSON.stringify(s));
  badUnit.orders[1].residentUnit = 'Z-1';
  assert.strictEqual(F.normalizeState(badUnit), null);
});

console.log('Test log');

t('test summary, CSV export and formula protection (staff only)', () => {
  const s = fresh();
  F.addTest(s, staff, { participant: 'P1', condition: 'without', correct: false, seconds: 40 });
  F.addTest(s, staff, { participant: 'P2', condition: 'without', correct: true, seconds: 30 });
  F.addTest(s, staff, { participant: '=HYPERLINK("x")', condition: 'with', correct: true, seconds: 12 });
  const sum = F.testSummary(s);
  assert.strictEqual(sum.without.correctPct, 50);
  assert.strictEqual(sum.without.avgSeconds, 35);
  assert.strictEqual(sum.with.correctPct, 100);
  assert.ok(F.testsToCsv(s).startsWith('participant,condition,correct_handoff,seconds'));
  assert.ok(F.testsToCsv(s).includes("'=HYPERLINK"));
  assert.strictEqual(F.addTest(s, staff, { participant: '', seconds: 1 }).ok, false);
  assert.strictEqual(F.addTest(s, res1, { participant: 'P', seconds: 1 }).reason, 'forbidden');
  assert.ok(F.clearTests(s, staff).ok);
  assert.strictEqual(s.tests.length, 0);
});

console.log('Overdue workflow: statuses');

function types(s, ref) { return s.notifications.filter(n => !ref || n.orderReference === ref).map(n => n.type); }

t('status is worked out in one place: new = PENDING, overdue at the limit, collected and disposed never overdue', () => {
  const s = fresh();
  const o = reg(s, 'R1');
  const st = (now) => F.deliveryStatus(o, now, s.settings.overdueMinutes);
  assert.strictEqual(st(T0), 'PENDING');
  assert.strictEqual(st(T0 + 14 * MIN), 'PENDING');
  assert.strictEqual(st(T0 + 15 * MIN), 'OVERDUE');
  assert.strictEqual(F.STATUS_LABELS.PENDING, 'Pending Collection');
  collect(s, o, T0 + 20 * MIN);
  assert.strictEqual(st(T0 + 600 * MIN), 'COLLECTED');          // stays collected long after the deadline
  const d = reg(s, 'R2');
  assert.ok(F.disposeDelivery(s, staff, d.orderId, T0 + 30 * MIN).ok);
  assert.strictEqual(F.deliveryStatus(d, T0 + 900 * MIN, 15), 'DISPOSED');
  assert.strictEqual(F.isOverdue(d, T0 + 900 * MIN, 15), false);
  assert.strictEqual(F.isOverdue(o, T0 + 900 * MIN, 15), false);
});

t('summary and queue treat collected and disposed deliveries as not active; disposed has its own filter', () => {
  const s = fresh();
  const a = reg(s, 'A', 'A-12-03');
  const b = reg(s, 'B', 'A-12-05');
  const c = reg(s, 'C', 'A-12-07', T0 + 14 * MIN);
  collect(s, a, T0 + 16 * MIN);
  assert.ok(F.disposeDelivery(s, staff, b.orderId, T0 + 17 * MIN).ok);
  const now = T0 + 20 * MIN;
  const sm = F.summary(s, staff, now);
  assert.deepStrictEqual([sm.pending, sm.onTime, sm.overdue, sm.collected, sm.disposed], [1, 1, 0, 1, 1]);
  assert.deepStrictEqual(F.queue(s, staff, { filter: 'overdue' }, now).orders.map(o => o.orderReference), []);
  assert.deepStrictEqual(F.queue(s, staff, { filter: 'disposed' }, now).orders.map(o => o.orderReference), ['B']);
  assert.deepStrictEqual(F.queue(s, staff, {}, now).orders.map(o => o.orderReference), ['C']);
  assert.strictEqual(F.queue(s, staff, { filter: 'all' }, now).orders.length, 3);
  assert.ok(c);
});

console.log('Overdue workflow: notifications');

t('the reminder comes at two thirds of the limit (10 of 15), names the delivery and unit, and is created once', () => {
  const s = fresh();
  const o = reg(s, 'FS-7', 'A-12-05');
  assert.strictEqual(F.reminderMinutes(15), 10);
  assert.strictEqual(F.reminderMinutes(30), 20);
  assert.strictEqual(F.syncNotifications(s, T0 + 9 * MIN), 0);
  assert.strictEqual(s.notifications.length, 0);
  assert.strictEqual(F.syncNotifications(s, T0 + 10 * MIN), 1);
  const n = s.notifications[0];
  assert.deepStrictEqual([n.type, n.orderReference, n.unit, n.orderId, n.dueAt, n.createdAt], ['reminder', 'FS-7', 'A-12-05', o.orderId, T0 + 15 * MIN, T0 + 10 * MIN]);
  for (let i = 0; i < 5; i++) assert.strictEqual(F.syncNotifications(s, T0 + 10 * MIN + i * 1000), 0);
  assert.strictEqual(s.notifications.length, 1);
  assert.strictEqual(s.audit.filter(e => e.eventType === 'reminder_generated').length, 1);
});

t('the overdue notice comes at the deadline, once; both entries are in the existing activity log', () => {
  const s = fresh();
  reg(s, 'FS-8');
  F.syncNotifications(s, T0 + 10 * MIN);
  assert.strictEqual(F.syncNotifications(s, T0 + 14 * MIN), 0);
  assert.strictEqual(F.syncNotifications(s, T0 + 15 * MIN), 1);
  assert.strictEqual(F.syncNotifications(s, T0 + 60 * MIN), 0);
  assert.deepStrictEqual(types(s), ['reminder', 'overdue']);
  const over = s.audit.filter(e => e.eventType === 'marked_overdue');
  assert.strictEqual(over.length, 1);
  assert.strictEqual(over[0].timestamp, T0 + 15 * MIN);            // logged at the deadline, not when the page happened to open
  assert.strictEqual(over[0].actorRole, 'SYSTEM');
  assert.strictEqual(over[0].orderReference, 'FS-8');
});

t('time moved in small steps or in one jump gives the same notifications and the same log', () => {
  function run(steps) {
    const s = fresh();
    reg(s, 'X1');
    steps.forEach(m => F.syncNotifications(s, T0 + m * MIN));
    return { n: s.notifications.map(n => [n.key, n.type, n.createdAt]), a: F.getActivityLog(s, staff).entries.map(e => [e.eventType, e.timestamp]) };
  }
  const stepped = run([5, 10, 15, 20]);
  const jumped = run([20]);
  assert.deepStrictEqual(stepped, jumped);
  assert.deepStrictEqual(jumped.n.map(x => x[1]), ['reminder', 'overdue']);
});

t('advancing the demo clock creates what is now due, and repeating or reloading creates nothing more', () => {
  const s = fresh();
  F.registerDelivery(s, staff, { unit: 'A-12-03', ref: 'D1' }, T0);
  F.advanceClock(s, staff, 10, T0);
  assert.deepStrictEqual(types(s), ['reminder']);
  F.advanceClock(s, staff, 10, T0 + 10 * MIN);
  assert.deepStrictEqual(types(s), ['reminder', 'overdue']);
  const reloaded = F.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.strictEqual(F.syncNotifications(reloaded, T0 + 20 * MIN), 0);
  assert.strictEqual(F.syncNotifications(reloaded, T0 + 500 * MIN), 0);
  assert.strictEqual(reloaded.notifications.length, 2);
  assert.strictEqual(reloaded.audit.length, s.audit.length);
});

t('lowering the overdue limit creates the notices that are now due; a limit too short for a reminder skips only the reminder', () => {
  const s = fresh();
  reg(s, 'L1');
  F.setOverdueMinutes(s, staff, 6, T0 + 4 * MIN);               // reminder due at 4
  assert.deepStrictEqual(types(s), ['reminder']);
  F.setOverdueMinutes(s, staff, 1, T0 + 5 * MIN);               // overdue now; no separate reminder fits in 1 minute
  assert.deepStrictEqual(types(s), ['reminder', 'overdue']);
  const s2 = fresh();
  reg(s2, 'L2');
  F.setOverdueMinutes(s2, staff, 1, T0);
  F.syncNotifications(s2, T0 + MIN);
  assert.deepStrictEqual(types(s2), ['overdue']);
});

t('a resident sees only the notifications for their own unit', () => {
  const s = fresh();
  reg(s, 'MINE', 'A-12-03');
  reg(s, 'THEIRS', 'A-12-05');
  F.syncNotifications(s, T0 + 20 * MIN);
  const mine = F.residentNotifications(s, res1).notifications;
  const theirs = F.residentNotifications(s, res2).notifications;
  assert.ok(mine.length === 2 && mine.every(n => n.unit === 'A-12-03' && n.orderReference === 'MINE'));
  assert.ok(theirs.length === 2 && theirs.every(n => n.unit === 'A-12-05' && n.orderReference === 'THEIRS'));
  assert.strictEqual(F.residentNotifications(s, F.getUserById('u-res03')).notifications.length, 0);
  assert.strictEqual(F.residentNotifications(s, staff).reason, 'forbidden');
  const forged = { userId: 'u-res01', role: 'RESIDENT', unitNumber: 'A-12-05' };
  assert.ok(F.residentNotifications(s, forged).notifications.every(n => n.unit === 'A-12-03'));   // unit comes from the account
});

t('after collection there are no more reminders or overdue notices, and the old ones are no longer shown', () => {
  const s = fresh();
  const o = reg(s, 'C1');
  F.syncNotifications(s, T0 + 10 * MIN);
  collect(s, o, T0 + 12 * MIN);
  assert.strictEqual(F.syncNotifications(s, T0 + 600 * MIN), 0);
  assert.deepStrictEqual(types(s), ['reminder']);                // nothing new after collection
  assert.strictEqual(F.residentNotifications(s, res1).notifications.length, 0);
  assert.strictEqual(F.summary(s, staff, T0 + 600 * MIN).overdue, 0);
});

console.log('Overdue workflow: staff follow-up');

t('follow-up actions only work on overdue deliveries, with a clear reason otherwise', () => {
  const s = fresh();
  const o = reg(s, 'F1');
  [F.sendStaffReminder, F.recordContact, F.recordHolding, F.disposeDelivery].forEach(fn => {
    assert.strictEqual(fn(s, staff, o.orderId, T0 + 14 * MIN).reason, 'not_overdue');
    assert.strictEqual(fn(s, staff, 9999, T0 + 20 * MIN).reason, 'not_found');
  });
  assert.strictEqual(o.status, 'PENDING');
  assert.strictEqual(o.followUp, null);
  assert.strictEqual(s.notifications.length, 0);
});

t('staff reminder: notifies the right resident, is logged, and cannot be repeated straight away', () => {
  const s = fresh();
  const o = reg(s, 'F2', 'A-12-05');
  const at = T0 + 20 * MIN;
  const r = F.sendStaffReminder(s, staff, o.orderId, at);
  assert.ok(r.ok);
  assert.deepStrictEqual([r.notification.type, r.notification.unit, r.notification.orderReference], ['staff_reminder', 'A-12-05', 'F2']);
  const again = F.sendStaffReminder(s, staff, o.orderId, at + 2 * MIN);
  assert.strictEqual(again.reason, 'reminder_too_soon');
  assert.strictEqual(again.retryAt, at + F.FOLLOWUP_GAP_MIN * MIN);
  assert.strictEqual(s.notifications.filter(n => n.type === 'staff_reminder').length, 1);
  assert.ok(F.sendStaffReminder(s, staff, o.orderId, at + 5 * MIN).ok);
  assert.strictEqual(F.followUpInfo(o).reminders, 2);
  assert.strictEqual(s.audit.filter(e => e.eventType === 'followup_reminder').length, 2);
  assert.ok(F.residentNotifications(s, res2).notifications.some(n => n.type === 'staff_reminder'));
  assert.strictEqual(F.residentNotifications(s, res1).notifications.length, 0);
});

t('record contact and holding area: logged, shown in follow-up info, duplicates refused', () => {
  const s = fresh();
  const o = reg(s, 'F3');
  const at = T0 + 20 * MIN;
  assert.ok(F.recordContact(s, staff, o.orderId, at).ok);
  assert.strictEqual(F.recordContact(s, staff, o.orderId, at + MIN).reason, 'contact_too_soon');
  assert.ok(F.recordContact(s, staff, o.orderId, at + 6 * MIN).ok);
  assert.ok(F.recordHolding(s, staff, o.orderId, at + 7 * MIN).ok);
  assert.strictEqual(F.recordHolding(s, staff, o.orderId, at + 8 * MIN).reason, 'already_in_holding');
  const info = F.followUpInfo(o);
  assert.deepStrictEqual([info.contacts, info.reminders, info.heldAt], [2, 0, at + 7 * MIN]);
  const types2 = s.audit.map(e => e.eventType);
  assert.strictEqual(types2.filter(x => x === 'followup_contact').length, 2);
  assert.strictEqual(types2.filter(x => x === 'followup_holding').length, 1);
  assert.strictEqual(o.status, 'PENDING');                       // follow-up never changes the status
});

t('no follow-up on collected or disposed deliveries, and residents cannot use any of it', () => {
  const s = fresh();
  const c = reg(s, 'G1');
  const d = reg(s, 'G2');
  collect(s, c, T0 + 20 * MIN);
  F.disposeDelivery(s, staff, d.orderId, T0 + 20 * MIN);
  const at = T0 + 40 * MIN;
  [F.sendStaffReminder, F.recordContact, F.recordHolding, F.disposeDelivery].forEach(fn => {
    assert.strictEqual(fn(s, staff, c.orderId, at).reason, 'already_collected');
    assert.strictEqual(fn(s, staff, d.orderId, at).reason, 'already_disposed');
    assert.strictEqual(fn(s, res1, d.orderId, at).reason, 'forbidden');
  });
  assert.strictEqual(s.notifications.filter(n => n.type === 'staff_reminder').length, 0);
});

console.log('Overdue workflow: disposal');

t('disposal: overdue only; records status, time, who and a log entry; the resident is told', () => {
  const s = fresh();
  const o = reg(s, 'Z1', 'A-12-03');
  assert.strictEqual(F.disposeDelivery(s, staff, o.orderId, T0 + 5 * MIN).reason, 'not_overdue');
  assert.strictEqual(o.status, 'PENDING');
  const at = T0 + 25 * MIN;
  const r = F.disposeDelivery(s, staff, o.orderId, at);
  assert.ok(r.ok);
  assert.deepStrictEqual([o.status, o.disposedTime, o.disposedBy], ['DISPOSED', at, 'u-staff01']);
  const e = s.audit[0];
  assert.deepStrictEqual([e.eventType, e.timestamp, e.orderReference, e.actorName], ['disposed', at, 'Z1', 'staff01']);
  assert.ok(F.residentNotifications(s, res1).notifications.some(n => n.type === 'disposed' && n.orderReference === 'Z1'));
  assert.strictEqual(F.residentOrders(s, res1).pending.length, 0);
  assert.strictEqual(F.residentOrders(s, res1).history[0].status, 'DISPOSED');
  assert.strictEqual(F.waitingMinutes(o, T0 + 900 * MIN), 25);   // the clock stops at disposal
});

t('after disposal: no more reminders, codes are refused, it cannot be disposed or collected again', () => {
  const s = fresh();
  const o = reg(s, 'Z2');
  const code = o.collectionCode;
  const dl = F.createDelegation(s, res1, o.orderId, 'Sam', 60, T0 + MIN).delegation;
  F.syncNotifications(s, T0 + 20 * MIN);
  const before = s.notifications.length;
  F.disposeDelivery(s, staff, o.orderId, T0 + 21 * MIN);
  assert.strictEqual(s.notifications.length, before + 1);        // only the disposal notice
  assert.strictEqual(F.syncNotifications(s, T0 + 900 * MIN), 0);
  assert.strictEqual(F.disposeDelivery(s, staff, o.orderId, T0 + 22 * MIN).reason, 'already_disposed');
  assert.strictEqual(F.verifyCode(s, staff, code, T0 + 22 * MIN).reason, 'already_disposed');
  assert.strictEqual(F.verifyCode(s, staff, dl.code, T0 + 22 * MIN).reason, 'already_disposed');
  assert.strictEqual(F.createDelegation(s, res1, o.orderId, 'Alex', 30, T0 + 22 * MIN).reason, 'already_disposed');
  assert.strictEqual(F.completeCollection(s, staff, o.orderId, T0 + 22 * MIN).reason, 'not_verified');
  assert.strictEqual(o.status, 'DISPOSED');
  assert.strictEqual(o.collectionTime, null);
});

t('a code check that was open when the delivery was disposed cannot finish the handoff', () => {
  const s = fresh();
  const o = reg(s, 'Z3');
  assert.ok(F.verifyCode(s, staff, o.collectionCode, T0 + 16 * MIN).ok);
  assert.ok(F.disposeDelivery(s, staff, o.orderId, T0 + 17 * MIN).ok);
  assert.notStrictEqual(F.completeCollection(s, staff, o.orderId, T0 + 18 * MIN).ok, true);
  assert.strictEqual(o.status, 'DISPOSED');
});

t('a collected delivery cannot be disposed of; an overdue one can still be collected with the normal code check', () => {
  const s = fresh();
  const a = reg(s, 'Y1');
  const b = reg(s, 'Y2');
  collect(s, a, T0 + 10 * MIN);
  assert.strictEqual(F.disposeDelivery(s, staff, a.orderId, T0 + 30 * MIN).reason, 'already_collected');
  assert.strictEqual(a.status, 'COLLECTED');
  collect(s, b, T0 + 40 * MIN);                                  // collected while overdue
  assert.strictEqual(b.status, 'COLLECTED');
  assert.strictEqual(F.deliveryStatus(b, T0 + 90 * MIN, 15), 'COLLECTED');
  assert.strictEqual(F.summary(s, staff, T0 + 90 * MIN).overdue, 0);
  assert.strictEqual(F.disposeDelivery(s, staff, b.orderId, T0 + 90 * MIN).reason, 'already_collected');
});

console.log('Overdue workflow: saved data');

t('saved data from before this feature loads unchanged, then gets each due notice exactly once', () => {
  const s = fresh();
  F.loadDemo(s, staff, T0);
  const old = JSON.parse(JSON.stringify(s));
  delete old.notifications; delete old.nextNotifId;               // what a save from the previous version looks like
  old.audit = old.audit.filter(e => !/^(reminder_generated|marked_overdue)$/.test(e.eventType));
  old.orders.forEach(o => { delete o.disposedTime; delete o.disposedBy; delete o.followUp; });
  const ordersBefore = JSON.stringify(old.orders);
  const auditBefore = old.audit.length;
  const back = F.normalizeState(old);
  assert.ok(back);
  assert.strictEqual(JSON.stringify(back.orders), ordersBefore);
  assert.deepStrictEqual(back.notifications, []);
  const made = F.syncNotifications(back, T0);
  assert.ok(made > 0);
  assert.strictEqual(F.syncNotifications(back, T0), 0);
  assert.strictEqual(F.syncNotifications(F.normalizeState(JSON.parse(JSON.stringify(back))), T0), 0);
  assert.strictEqual(JSON.stringify(back.orders), ordersBefore);   // sync never edits deliveries
  assert.ok(back.audit.length > auditBefore);
  assert.strictEqual(F.deliveryStatus(back.orders[1], T0, 15), 'OVERDUE');    // FS-1001, waiting 18 min
  assert.strictEqual(F.deliveryStatus(back.orders[0], T0, 15), 'COLLECTED');
  assert.strictEqual(F.summary(back, staff, T0).overdue, 1);
});

t('normalizeState keeps DISPOSED orders, repairs a damaged follow-up record, and drops duplicate or orphaned notifications', () => {
  const s = fresh();
  const a = reg(s, 'N1');
  reg(s, 'N2', 'A-12-05');
  F.syncNotifications(s, T0 + 20 * MIN);
  F.disposeDelivery(s, staff, a.orderId, T0 + 21 * MIN);
  const good = F.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.ok(good);
  assert.strictEqual(good.orders[0].status, 'DISPOSED');
  assert.strictEqual(good.notifications.length, s.notifications.length);
  const noTime = JSON.parse(JSON.stringify(s)); noTime.orders[0].disposedTime = null;
  assert.strictEqual(F.normalizeState(noTime), null);
  const dmg = JSON.parse(JSON.stringify(s)); dmg.orders[1].followUp = 'broken';
  assert.strictEqual(F.normalizeState(dmg).orders[1].followUp, null);
  const dup = JSON.parse(JSON.stringify(s));
  dup.notifications.push(Object.assign({}, dup.notifications[0], { id: 999 }));                         // same key again
  dup.notifications.push({ id: 1000, key: '77:reminder', orderId: 77, unit: 'A-12-03', orderReference: 'GONE', type: 'reminder', createdAt: T0 });   // no such order
  dup.notifications.push({ id: 1001, key: '1:reminder-x', orderId: 1, unit: 'A-12-05', orderReference: 'N1', type: 'reminder', createdAt: T0 });     // wrong unit
  const fixed = F.normalizeState(dup);
  assert.strictEqual(fixed.notifications.length, s.notifications.length);
  assert.ok(fixed.nextNotifId > 1001 || fixed.nextNotifId > Math.max.apply(null, fixed.notifications.map(n => n.id)));
});

t('reset removes notifications along with orders and the log; sample data starts with its due notices already made', () => {
  const s = fresh();
  F.loadDemo(s, staff, T0);
  assert.ok(s.notifications.length > 0);
  assert.strictEqual(s.notifications.filter(n => n.orderReference === 'FS-1003').length, 0);      // 4 min: nothing due yet
  assert.deepStrictEqual(s.notifications.filter(n => n.orderReference === 'FS-1002').map(n => n.type), ['reminder']);   // 12 min: reminder only
  assert.deepStrictEqual(s.notifications.filter(n => n.orderReference === 'FS-1001').map(n => n.type), ['reminder', 'overdue']);
  assert.strictEqual(s.notifications.filter(n => n.orderReference === 'FS-0999').length, 0);       // already collected
  F.advanceClock(s, staff, 5, T0);
  assert.deepStrictEqual(s.notifications.filter(n => n.orderReference === 'FS-1002').map(n => n.type), ['reminder', 'overdue']);
  F.resetDemo(s, staff, T0 + 5 * MIN);
  assert.deepStrictEqual([s.orders.length, s.notifications.length, s.nextNotifId], [0, 0, 1]);
  assert.strictEqual(s.audit.length, 1);
});

t('the activity log lists events by when they happened, and system events are labelled SYSTEM', () => {
  const s = fresh();
  reg(s, 'T1');
  F.login(s, 'staff01', 'Staff123!', T0 + 40 * MIN);              // logged in long after the deadline...
  F.syncNotifications(s, T0 + 40 * MIN);                          // ...and the notices are created afterwards
  const e = F.getActivityLog(s, staff).entries;
  assert.deepStrictEqual(e.map(x => x.eventType), ['login', 'marked_overdue', 'reminder_generated', 'delivery_registered']);
  assert.ok(e.every((x, i) => i === 0 || x.timestamp <= e[i - 1].timestamp));
  assert.strictEqual(e[1].actorRole, 'SYSTEM');
  assert.ok(!JSON.stringify(s.notifications).includes(s.orders[0].collectionCode));      // codes are never in notifications
});

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (some FAILED)' : ''));
