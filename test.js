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

t('three demo accounts: one staff, two residents with different units', () => {
  const l = F.demoLogins();
  assert.strictEqual(l.length, 3);
  assert.strictEqual(l.filter(a => a.role === 'STAFF').length, 1);
  assert.notStrictEqual(l[1].unitNumber, l[2].unitNumber);
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

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (some FAILED)' : ''));
