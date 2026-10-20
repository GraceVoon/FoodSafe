// Run with:  node test.js
const assert = require('assert');
const F = require('./logic.js');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);

t('registering an order needs a unit number', () => {
  const s = F.newState();
  assert.strictEqual(F.registerOrder(s, { unit: '  ' }, T0).ok, false);
  assert.strictEqual(s.orders.length, 0);
});

t('registering creates a waiting order with a 4-digit code', () => {
  const s = F.newState();
  const r = F.registerOrder(s, { unit: 'a-12-03', platform: 'GrabFood', ref: 'GF-1' }, T0);
  assert.ok(r.ok);
  assert.strictEqual(r.order.unit, 'A-12-03');
  assert.match(r.order.code, /^\d{4}$/);
  assert.strictEqual(r.order.status, 'waiting');
});

t('codes are unique across waiting orders', () => {
  const s = F.newState();
  const codes = new Set();
  for (let i = 0; i < 300; i++) codes.add(F.registerOrder(s, { unit: 'U' + i }, T0).order.code);
  assert.strictEqual(codes.size, 300);
});

t('correct code releases the food and records who/when', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  const r = F.verifyCollection(s, o.id, o.code, T0 + 5 * MIN);
  assert.ok(r.ok);
  assert.strictEqual(o.status, 'collected');
  assert.strictEqual(o.collectedAt, T0 + 5 * MIN);
});

t('wrong code is rejected and counted', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  const wrong = o.code === '1234' ? '4321' : '1234';
  const r = F.verifyCollection(s, o.id, wrong, T0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'wrong_code');
  assert.strictEqual(r.attemptsLeft, 2);
  assert.strictEqual(o.status, 'waiting');
});

t('three wrong attempts lock the order, even a correct code is then refused', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  const wrong = o.code === '1234' ? '4321' : '1234';
  F.verifyCollection(s, o.id, wrong, T0);
  F.verifyCollection(s, o.id, wrong, T0);
  const third = F.verifyCollection(s, o.id, wrong, T0);
  assert.strictEqual(third.locked, true);
  const r = F.verifyCollection(s, o.id, o.code, T0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'locked');
});

t('staff unlock after a manual check restores normal verification', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  const wrong = o.code === '1234' ? '4321' : '1234';
  for (let i = 0; i < 3; i++) F.verifyCollection(s, o.id, wrong, T0);
  assert.ok(F.unlockOrder(s, o.id, T0).ok);
  assert.ok(F.verifyCollection(s, o.id, o.code, T0).ok);
});

t('an order cannot be collected twice', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  F.verifyCollection(s, o.id, o.code, T0);
  const again = F.verifyCollection(s, o.id, o.code, T0 + MIN);
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.reason, 'already_collected');
});

t('delegation: authorised person can collect with their own code', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  const d = F.createDelegation(s, o.id, 'Neighbour Sam', 30, T0 + MIN);
  assert.ok(d.ok);
  const r = F.verifyCollection(s, o.id, d.delegation.code, T0 + 10 * MIN);
  assert.ok(r.ok);
  assert.strictEqual(r.by, 'delegate');
  assert.match(o.collectedBy, /Neighbour Sam/);
});

t('delegation code expires', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  const d = F.createDelegation(s, o.id, 'Sam', 30, T0);
  const r = F.verifyCollection(s, o.id, d.delegation.code, T0 + 31 * MIN);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'delegation_expired');
  assert.strictEqual(o.status, 'waiting');
});

t('a new delegation cancels the previous one', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  const d1 = F.createDelegation(s, o.id, 'Sam', 30, T0).delegation;
  F.createDelegation(s, o.id, 'Alex', 30, T0);
  const r = F.verifyCollection(s, o.id, d1.code, T0 + MIN);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'delegation_cancelled');
});

t('delegation needs a name and a sensible duration', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  assert.strictEqual(F.createDelegation(s, o.id, '', 30, T0).reason, 'name_required');
  assert.strictEqual(F.createDelegation(s, o.id, 'Sam', 1, T0).reason, 'bad_duration');
  assert.strictEqual(F.createDelegation(s, o.id, 'Sam', 9999, T0).reason, 'bad_duration');
});

t('waiting time and overdue alert', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  assert.strictEqual(F.waitingMinutes(o, T0 + 14 * MIN + 59000), 14);
  assert.strictEqual(F.overdueOrders(s, T0 + 14 * MIN).length, 0);
  assert.strictEqual(F.overdueOrders(s, T0 + 15 * MIN).length, 1);
});

t('collected orders stop counting as overdue and stop their timer', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  F.verifyCollection(s, o.id, o.code, T0 + 8 * MIN);
  assert.strictEqual(F.waitingMinutes(o, T0 + 60 * MIN), 8);
  assert.strictEqual(F.overdueOrders(s, T0 + 60 * MIN).length, 0);
});

t('audit log records the handoff trail', () => {
  const s = F.newState();
  const o = F.registerOrder(s, { unit: 'A1' }, T0).order;
  F.verifyCollection(s, o.id, o.code, T0 + MIN);
  const types = s.audit.map(a => a.type);
  assert.deepStrictEqual(types, ['collected', 'registered']);
});

t('test log summary and CSV export', () => {
  const s = F.newState();
  F.addTest(s, { participant: 'P1', condition: 'without', correct: false, seconds: 40 });
  F.addTest(s, { participant: 'P2', condition: 'without', correct: true, seconds: 30 });
  F.addTest(s, { participant: 'P3', condition: 'with', correct: true, seconds: 12 });
  const sum = F.testSummary(s);
  assert.strictEqual(sum.without.n, 2);
  assert.strictEqual(sum.without.correctPct, 50);
  assert.strictEqual(sum.without.avgSeconds, 35);
  assert.strictEqual(sum.with.correctPct, 100);
  assert.ok(F.testsToCsv(s).startsWith('participant,condition,correct_handoff,seconds'));
  assert.strictEqual(F.addTest(s, { participant: '', seconds: 1 }).ok, false);
});

t('CSV export defuses spreadsheet formulas', () => {
  const s = F.newState();
  F.addTest(s, { participant: '=HYPERLINK("x")', condition: 'with', correct: true, seconds: 5 });
  assert.ok(F.testsToCsv(s).includes("'=HYPERLINK"));
});

t('demo data: three waiting orders, one overdue now, a second after +5 minutes', () => {
  const s = F.newState();
  F.loadDemo(s, T0);
  assert.strictEqual(s.orders.length, 3);
  assert.strictEqual(F.overdueOrders(s, T0).length, 1);          // waiting 18 min vs 15 min alert
  assert.strictEqual(F.overdueOrders(s, T0 + 5 * MIN).length, 2); // 12 min order becomes 17 min
});

console.log('\n' + passed + ' checks passed');
