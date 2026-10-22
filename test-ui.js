// End-to-end test of the real pages (index.html + app.js + logic.js): cases T01-T26 in the spec, the eight residents,
// upgrading saved data, and the overdue workflow (OVD01-OVD11: reminders, overdue, staff follow-up, disposal, refresh).
// One-time setup:  npm install      (installs jsdom, a browser simulator, for this test only)
// Run:             node test-ui.js              (add --report to write TEST_REPORT.md)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const STATE_KEY = 'foodsafe.v2';
const SESSION_KEY = 'foodsafe.session';
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 25));

function pageHtml() {
  let html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  html = html.replace(/<link[^>]*>/g, '');
  return html.replace(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g, (m, f) =>
    '<script>' + fs.readFileSync(path.join(DIR, f), 'utf8') + '</script>');
}

const scriptErrors = [];

async function boot(opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => scriptErrors.push(String(e && e.message || e)));
  const dom = new JSDOM(pageHtml(), {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'http://localhost/' + (opts.hash || ''),
    beforeParse(w) {
      w.confirm = () => true;
      w.addEventListener('error', (e) => scriptErrors.push(String(e.message)));
      Object.keys(opts.local || {}).forEach((k) => w.localStorage.setItem(k, opts.local[k]));
      Object.keys(opts.session || {}).forEach((k) => w.sessionStorage.setItem(k, opts.session[k]));
    }
  });
  await tick(60);
  return wrap(dom.window);
}

function wrap(w) {
  const d = w.document;
  const c = {
    w, d,
    $: (s) => d.querySelector(s),
    $$: (s) => Array.from(d.querySelectorAll(s)),
    text: () => d.getElementById('app').textContent.replace(/\s+/g, ' '),
    hash: () => w.location.hash,
    state: () => JSON.parse(w.localStorage.getItem(STATE_KEY)),
    F: w.FoodSafe,
    async nav(h) { w.location.hash = h; await tick(); },
    async click(el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(); },
    async submit(form) { form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); },
    set(el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    async login(u, p) {
      if (!c.$('#form-login')) { await c.nav('#/login'); }
      c.set(c.$('#l-user'), u); c.set(c.$('#l-pass'), p);
      await c.submit(c.$('#form-login'));
    },
    async logout() { await c.click(c.$('[data-action="logout"]')); },
    async register(unit, ref, note) {
      await c.nav('#/staff/register');
      c.set(c.$('#r-unit'), unit); c.set(c.$('#r-ref'), ref); c.set(c.$('#r-note'), note || '');
      await c.submit(c.$('#form-register'));
    },
    async verify(code) {
      await c.nav('#/staff/verify');
      c.set(c.$('#v-code'), code);
      await c.submit(c.$('#form-verify'));
    },
    order(ref) { return c.state().orders.find((o) => o.orderReference === ref); },
    user(id) { return c.F.getUserById(id); }
  };
  return c;
}

const results = [];
function check(id, desc, cond, detail) {
  results.push({ id, desc, pass: !!cond, detail: detail || '' });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + id.padEnd(5) + desc + (cond || !detail ? '' : '   <- ' + detail));
}

(async () => {
  // ---------------------------------------------------------------- T01 .. T06
  let c = await boot();
  check('T01', 'Open the website without a session: login page appears',
    !!c.$('#form-login') && c.hash() === '#/login' && !/Staff dashboard|My deliveries|Welcome,/.test(c.text()));

  await c.submit(c.$('#form-login'));
  check('T05', 'Submit an empty login form: validation message appears', /Enter both your username and your password/.test(c.text()) && !!c.$('#form-login'));

  await c.login('staff01', 'wrong-password');
  check('T04', 'Enter an incorrect password: login rejected, no session created',
    /incorrect/.test(c.text()) && !!c.$('#form-login') && c.w.sessionStorage.getItem(SESSION_KEY) === null && c.hash() === '#/login');

  await c.login('staff01', 'Staff123!');
  check('T02', 'Log in with valid staff credentials: staff dashboard appears', c.hash() === '#/staff' && /Staff dashboard/.test(c.text()));
  check('POLISH', 'Staff navigation keeps Activity Log but hides Test Log',
    c.$$('.nav a').some((a) => /Activity log/i.test(a.textContent)) &&
    !c.$$('.nav a').some((a) => /Test log/i.test(a.textContent)));

  await c.logout();
  check('T06', 'Staff logs out: login page appears and session is cleared',
    c.hash() === '#/login' && !!c.$('#form-login') && c.w.sessionStorage.getItem(SESSION_KEY) === null);

  await c.login('resident01', 'Resident123!');
  check('T03', 'Log in with valid resident credentials: resident dashboard appears',
    c.hash() === '#/resident' && /Welcome, Demo Resident A/.test(c.text()) && /A-12-03/.test(c.text()));

  // ---------------------------------------------------------------- T09, T07, T23 (as resident)
  check('T09', 'Resident cannot see registration or demo tools on their page', !/Register delivery|Demonstration tools|Verify collection/.test(c.text()));
  await c.nav('#/staff/register');
  const t09ui = c.hash() === '#/resident' && /Access denied/.test(c.text());
  const stateBefore = c.state().orders.length;
  const direct = c.F.registerDelivery(c.F.normalizeState(c.state()), c.user('u-res01'), { unit: 'A-12-03', ref: 'SNEAKY-1' }, Date.now());
  check('T09', 'Resident attempts to register a delivery: page blocked and the action itself is rejected',
    t09ui && direct.ok === false && direct.reason === 'forbidden' && c.state().orders.length === stateBefore);

  await c.nav('#/staff');
  check('T07', 'Resident opens staff route directly: access denied and sent to resident dashboard',
    c.hash() === '#/resident' && /Access denied/.test(c.text()) && !/Staff dashboard/.test(c.text()));

  await c.nav('#/staff/log');
  check('T23', 'Resident attempts to open the activity log: access denied',
    c.hash() === '#/resident' && /Access denied/.test(c.text()) && !/Activity log/.test(c.text().replace(/Access denied.*?page\./, '')));
  await c.logout();

  // ---------------------------------------------------------------- T08, T10, T11, T12 (as staff)
  await c.login('staff01', 'Staff123!');
  await c.nav('#/resident');
  check('T08', 'Staff opens resident route directly: access denied and sent to staff dashboard',
    c.hash() === '#/staff' && /Access denied/.test(c.text()) && /Staff dashboard/.test(c.text()));

  const n0 = c.state().orders.length;
  await c.register('A-12-03', 'T-ORDER-1', 'Left at counter');
  const o1 = c.order('T-ORDER-1');
  check('T10', 'Staff registers a valid delivery: pending order created',
    /Registered T-ORDER-1/.test(c.text()) && c.state().orders.length === n0 + 1 && o1 && o1.status === 'PENDING' && /^\d{6}$/.test(o1.collectionCode) && typeof o1.arrivalTime === 'number');

  await c.register('A-12-05', 't-order-1');
  check('T11', 'Duplicate order reference: registration rejected, nothing created',
    /already exists/.test(c.text()) && c.state().orders.length === n0 + 1);

  await c.register('Z-99-99', 'T-ORDER-X');
  const badUnit = /not a configured demo resident/.test(c.text()) && !c.order('T-ORDER-X');
  await c.register('', 'T-ORDER-Y');
  check('T12', 'Invalid or missing resident unit: registration rejected',
    badUnit && /Enter the resident unit number/.test(c.text()) && !c.order('T-ORDER-Y') && c.state().orders.length === n0 + 1);
  check('T12', 'A failed registration keeps what the staff member typed', c.$('#r-ref').value === 'T-ORDER-Y');
  await c.logout();

  // ---------------------------------------------------------------- T13, T14
  await c.login('resident01', 'Resident123!');
  const code1 = o1.collectionCode;
  check('T13', 'Correct resident opens the dashboard: their assigned order and code are visible',
    /T-ORDER-1/.test(c.text()) && c.$$('.code').some((e) => e.textContent.trim() === code1));
  await c.logout();

  await c.login('resident02', 'Resident456!');
  check('T14', 'Different resident opens the dashboard: the first resident\'s order is hidden',
    !/T-ORDER-1/.test(c.text()) && !c.$$('.code').some((e) => e.textContent.trim() === code1) && /FS-1002/.test(c.text()));
  await c.logout();

  // ---------------------------------------------------------------- T15, T16, T26, T18, T17, T19
  await c.login('staff01', 'Staff123!');
  await c.verify(code1);
  check('T15', 'Staff verifies a valid pending code: matching order appears, nothing collected yet',
    /Code accepted/.test(c.text()) && /T-ORDER-1/.test(c.text()) && /A-12-03/.test(c.text()) && !!c.$('[data-action="confirm"]') && c.order('T-ORDER-1').status === 'PENDING');

  await c.nav('#/staff/log');
  await c.nav('#/staff/verify');
  const wrong = ['000000', '111111', '222222'].find((x) => !c.state().orders.some((o) => o.collectionCode === x || o.delegations.some((d) => d.code === x)));
  await c.verify(wrong);
  check('T16', 'Staff verifies an invalid code: verification rejected and no confirm button',
    /not valid/.test(c.text()) && !/Code accepted/.test(c.text()) && !c.$('[data-action="confirm"]'));

  await c.nav('#/staff/log');
  check('T26', 'A failed attempt leaves the order pending and the failure is logged',
    c.order('T-ORDER-1').status === 'PENDING' && /Invalid code attempt/.test(c.text()) && !c.state().orders.some((o) => o.collectionCode === wrong));

  await c.verify(code1);
  await c.click(c.$('[data-action="confirm"]'));
  const done1 = c.order('T-ORDER-1');
  check('T18', 'Staff confirms a valid collection: status becomes COLLECTED with a timestamp',
    /Handoff confirmed/.test(c.text()) && done1.status === 'COLLECTED' && typeof done1.collectionTime === 'number' && done1.codeUsed === true && !c.$('[data-action="confirm"]'));

  await c.verify(code1);
  check('T17', 'Staff verifies a code for a collected order: verification rejected',
    /already collected/.test(c.text()) && !/Code accepted/.test(c.text()) && !c.$('[data-action="confirm"]'));

  const live = c.F.normalizeState(c.state());
  const reuse = c.F.completeCollection(live, c.user('u-staff01'), done1.orderId, Date.now());
  check('T19', 'Staff attempts to reuse a collected code: second collection rejected, time unchanged',
    reuse.ok === false && live.orders.find((o) => o.orderId === done1.orderId).collectionTime === done1.collectionTime);

  await c.nav('#/staff');
  c.set(c.$('#q-filter'), 'collected');
  check('T18', 'Collected order shows under the Collected filter of the staff queue', /T-ORDER-1/.test(c.$('#queue').textContent));
  await c.logout();
  await c.login('resident01', 'Resident123!');
  check('T18', 'Resident dashboard shows the order in collection history', /Collection history/.test(c.text()) && /T-ORDER-1/.test(c.$$('table').map((t) => t.textContent).join(' ')) && !c.$$('.code').some((e) => e.textContent.trim() === code1));
  await c.logout();

  // ---------------------------------------------------------------- T20, T21
  await c.login('staff01', 'Staff123!');
  await c.register('A-12-05', 'T-ORDER-2');
  await c.nav('#/staff');
  c.set(c.$('#q-search'), 'T-ORDER-2');
  const rowBefore = c.$('#queue tbody tr').textContent;
  await c.click(c.$('[data-action="demo-ff10"]'));
  await c.click(c.$('[data-action="demo-ff10"]'));
  c.set(c.$('#q-search'), 'T-ORDER-2');
  const rowAfter = c.$('#queue tbody tr').textContent;
  check('T20', 'An order reaches the overdue threshold: overdue indicator appears on the staff queue and stays PENDING',
    !/Overdue/.test(rowBefore) && /Overdue/.test(rowAfter) && c.order('T-ORDER-2').status === 'PENDING');
  await c.logout();
  await c.login('resident02', 'Resident456!');
  check('T20', 'The resident sees the overdue indicator on their own order', /T-ORDER-2/.test(c.text()) && /Overdue/.test(c.text()));
  const code2 = c.order('T-ORDER-2').collectionCode;
  await c.logout();

  await c.login('staff01', 'Staff123!');
  await c.verify(code2);
  await c.click(c.$('[data-action="confirm"]'));
  await c.nav('#/staff');
  c.set(c.$('#q-filter'), 'overdue');
  check('T21', 'An overdue order is collected: becomes COLLECTED and leaves the overdue list',
    c.order('T-ORDER-2').status === 'COLLECTED' && !/T-ORDER-2/.test(c.$('#queue').textContent));

  // ---------------------------------------------------------------- T22
  await c.nav('#/staff/log');
  const logText = c.text();
  check('T22', 'Staff opens the activity log: recent events appear',
    /Delivery registered/.test(logText) && /Collection successful/.test(logText) && /Invalid code attempt/.test(logText) && /Login/.test(logText) && /Logout/.test(logText) && /Access denied/.test(logText));
  check('T22', 'The log never shows passwords or typed codes', !/Staff123!|Resident123!|Resident456!/.test(logText) && !logText.includes(wrong + ' '));
  check('POLISH', 'Activity Log includes category and real timestamp filters',
    !!c.$('#log-category') && !!c.$('#log-start') && !!c.$('#log-end') && /Category/.test(logText));
  c.set(c.$('#log-category'), 'Collection');
  const categoryFiltered = !!c.$('#logtable') && !/Delivery registered/.test(c.$('#logtable').textContent);
  c.set(c.$('#log-category'), 'all');
  c.set(c.$('#log-start'), '2099-01-01T00:00');
  const futureFiltered = /No matching events/.test(c.$('#logtable').textContent);
  c.set(c.$('#log-start'), '');
  check('POLISH', 'Activity Log category and start-time filters narrow the existing event history',
    categoryFiltered && futureFiltered);

  // ---------------------------------------------------------------- T24 (refresh)
  const snapLocal = { [STATE_KEY]: c.w.localStorage.getItem(STATE_KEY) };
  const snapSession = { [SESSION_KEY]: c.w.sessionStorage.getItem(SESSION_KEY) };
  const r1 = await boot({ local: snapLocal, session: snapSession, hash: '#/staff' });
  check('T24', 'Refresh during a staff session: still staff', r1.hash() === '#/staff' && /Staff dashboard/.test(r1.text()));
  const r2 = await boot({ local: snapLocal, session: { [SESSION_KEY]: 'STAFF' }, hash: '#/staff' });
  check('T24', 'A role typed into browser storage is not accepted: user is sent to login', r2.hash() === '#/login' && !!r2.$('#form-login'));
  const r3 = await boot({ local: snapLocal, session: { [SESSION_KEY]: 'u-res01' }, hash: '#/staff' });
  check('T24', 'A resident session pointed at a staff page stays resident (refresh cannot swap roles)',
    r3.hash() === '#/resident' && /Welcome, Demo Resident A/.test(r3.text()) && !/Staff dashboard/.test(r3.text()));
  const r4 = await boot({ local: { [STATE_KEY]: '{"orders": "broken"' }, hash: '' });
  check('T24', 'Damaged saved data does not crash the page: sample data is loaded again', !!r4.$('#form-login') && /damaged/.test(r4.text()) && r4.state().orders.length === 4);

  // ---------------------------------------------------------------- Authorised collector (UI)
  await c.nav('#/staff');
  await c.logout();
  await c.login('resident01', 'Resident123!');
  const f = c.$('form[data-delegate]');
  f.elements.name.value = 'Neighbour Sam'; f.elements.minutes.value = '30';
  await c.submit(f);
  const dCode = (c.$('.msg.ok strong:nth-of-type(2)') || { textContent: '' }).textContent.trim();
  check('EXTRA', 'Resident authorises a neighbour: a separate code is shown', /Neighbour Sam/.test(c.text()) && /^\d{6}$/.test(dCode));
  await c.logout();
  await c.login('staff01', 'Staff123!');
  await c.verify(dCode);
  const sawName = /Neighbour Sam/.test(c.text());
  await c.click(c.$('[data-action="confirm"]'));
  check('EXTRA', 'Staff verify and confirm the neighbour\'s code: collected, collector name recorded',
    sawName && c.state().orders.some((o) => /Neighbour Sam/.test(o.collectedBy || '') && o.status === 'COLLECTED'));

  // ---------------------------------------------------------------- Safety extras
  await c.register('A-12-03', '<img src=x onerror=alert(1)>', '<b>bold</b>');
  await c.nav('#/staff');
  c.set(c.$('#q-filter'), 'all');
  check('EXTRA', 'Text typed into forms is escaped (no injected HTML)', !c.$('#queue img') && !c.$('#queue b') && /<img src=x/.test(c.$('#queue').textContent));

  await c.nav('#/staff/verify');
  await c.verify('999991'); await c.verify('999992'); await c.verify('999993');
  check('EXTRA', 'Three wrong codes in a row show a warning to ask for ID', /3 wrong codes in a row/.test(c.text()));

  await c.nav('#/staff/tests');
  c.set(c.$('#t-who'), 'P1'); c.set(c.$('#t-cond'), 'without'); c.set(c.$('#t-ok'), 'no'); c.set(c.$('#t-sec'), '40');
  await c.submit(c.$('#form-test'));
  c.set(c.$('#t-who'), 'P2'); c.set(c.$('#t-cond'), 'with'); c.set(c.$('#t-ok'), 'yes'); c.set(c.$('#t-sec'), '12');
  await c.submit(c.$('#form-test'));
  check('EXTRA', 'Test log (staff only) records results and summarises both conditions', /0 \/ 1 correct/.test(c.text()) && /1 \/ 1 correct/.test(c.text()));

  // ---------------------------------------------------------------- T25 (reset)
  await c.nav('#/staff');
  await c.click(c.$('[data-action="demo-reset"]'));
  const st = c.state();
  check('T25', 'Reset demo data: orders and log cleared as documented (one reset entry, clock back to normal, test results kept)',
    st.orders.length === 0 && st.audit.length === 1 && st.audit[0].eventType === 'demo_reset' && st.offsetMs === 0 && st.tests.length === 2 && /Reset|reset/.test(c.text()));
  check('T25', 'After reset the dashboard shows zero counts and consistent data',
    c.$('#n-pending').textContent === '0' && c.$('#n-overdue').textContent === '0' && c.$('#n-collected').textContent === '0');
  await c.click(c.$('[data-action="demo-load"]'));
  const st2 = c.state();
  check('T25', 'Load sample data restores 4 consistent orders with unique codes',
    st2.orders.length === 4 && new Set(st2.orders.map((o) => o.collectionCode)).size === 4 &&
    st2.orders.every((o) => o.status === 'PENDING' || (typeof o.collectionTime === 'number' && o.codeUsed)));
  await c.logout();
  await c.login('resident01', 'Resident123!');
  check('T25', 'Demo accounts still work after a reset', c.hash() === '#/resident');
  check('T09', 'Resident has no demonstration controls to reset anything', !c.$('[data-action="demo-reset"]') && !c.$('[data-action="demo-load"]'));
  await c.logout();

  // ---------------------------------------------------------------- Eight demo residents
  const L = require('./logic.js');
  const units = L.validUnits();
  check('RES', 'Eight configured units, no duplicates, account list has no problems',
    units.length === 8 && new Set(units).size === 8 && L.accountProblems().length === 0);

  await c.login('staff01', 'Staff123!');
  await c.nav('#/staff/register');
  const options = c.$$('#units option').map((o) => o.value);
  const hint = c.$('#unit-hint').textContent;
  check('RES', 'Unit list on the registration form is built from the resident data (all 8 units in the list and the hint)',
    options.length === 8 && units.every((u) => options.includes(u) && hint.includes(u)));

  for (const u of units) await c.register(u, 'UNIT-' + u, 'for ' + u);
  check('RES', 'Staff can register a delivery for every configured unit',
    units.every((u) => c.order('UNIT-' + u) && c.order('UNIT-' + u).residentUnit === u && c.order('UNIT-' + u).status === 'PENDING'));

  await c.register('b-06-01', 'LOWER-1');
  check('RES', 'A unit typed in lower case is accepted and stored in the standard form', c.order('LOWER-1') && c.order('LOWER-1').residentUnit === 'B-06-01');

  const countBefore = c.state().orders.length;
  let badOk = true;
  for (const u of ['A-12-04', 'B-06-02', 'A-99-99', 'a-12-3']) {
    await c.register(u, 'BAD-' + u);
    badOk = badOk && /is not a configured demo resident/.test(c.text()) && c.text().includes('"' + u.toUpperCase() + '"') && units.every((x) => c.text().includes(x)) && !c.order('BAD-' + u);
  }
  check('RES', 'Unknown unit numbers are rejected with a clear error that names the unit and lists the valid ones',
    badOk && c.state().orders.length === countBefore);
  await c.logout();

  let isolated = true;
  for (const a of L.demoLogins().filter((x) => x.role === 'RESIDENT')) {
    await c.login(a.username, a.password);
    const t = c.text();
    const mineVisible = t.includes('UNIT-' + a.unitNumber) && t.includes(a.unitNumber);
    const othersHidden = units.filter((u) => u !== a.unitNumber).every((u) => !t.includes('UNIT-' + u));
    if (!(c.hash() === '#/resident' && mineVisible && othersHidden)) { isolated = false; console.log('      isolation problem for ' + a.username); }
    await c.logout();
  }
  check('RES', 'Each of the 8 residents logs in and sees only the deliveries for their own unit', isolated);

  // ---------------------------------------------------------------- Upgrade: browser already holds data from before
  const oldState = L.newState();
  L.seed(oldState, null, Date.now(), Math.random);
  const gd = L.getUserById('u-staff01');
  const kept = L.registerDelivery(oldState, gd, { unit: 'A-12-05', ref: 'OLD-1', note: 'kept' }, Date.now()).order;
  L.verifyCode(oldState, gd, kept.collectionCode, Date.now());
  L.completeCollection(oldState, gd, kept.orderId, Date.now());
  const pend = L.registerDelivery(oldState, gd, { unit: 'A-12-03', ref: 'OLD-2' }, Date.now()).order;
  L.addTest(oldState, gd, { participant: 'OldP', condition: 'with', correct: true, seconds: 9 });
  L.setOverdueMinutes(oldState, gd, 20, Date.now());
  const oldJson = JSON.stringify(oldState);

  const up = await boot({ local: { [STATE_KEY]: oldJson }, hash: '#/login' });
  await up.login('staff01', 'Staff123!');
  const afterLogin = up.state();
  check('UPG', 'Existing saved data is loaded as it was (orders, codes, collected records, test results, overdue limit all unchanged)',
    JSON.stringify(afterLogin.orders) === JSON.stringify(oldState.orders) && JSON.stringify(afterLogin.tests) === JSON.stringify(oldState.tests) &&
    afterLogin.settings.overdueMinutes === 20 && afterLogin.orders.some((o) => o.orderReference === 'OLD-1' && o.status === 'COLLECTED' && o.collectionTime === kept.collectionTime || false));
  check('UPG', 'The activity history from before is still there', oldState.audit.every((e) => afterLogin.audit.some((x) => x.logId === e.logId && x.message === e.message)));

  await up.register('B-06-01', 'NEW-AFTER-UPGRADE', 'new resident, old data');
  const afterReg = up.state();
  check('UPG', 'A new resident\'s unit works on top of the old data, and nothing old was lost or reset',
    up.order('NEW-AFTER-UPGRADE') && afterReg.orders.length === oldState.orders.length + 1 &&
    oldState.orders.every((o) => JSON.stringify(afterReg.orders.find((x) => x.orderId === o.orderId)) === JSON.stringify(o)));
  await up.logout();
  await up.login('resident08', 'Resident008!');
  check('UPG', 'The new resident logs in and sees the delivery registered after the upgrade', up.hash() === '#/resident' && /NEW-AFTER-UPGRADE/.test(up.text()) && !/OLD-2/.test(up.text()));
  await up.logout();
  await up.login('resident01', 'Resident123!');
  check('UPG', 'An existing resident still sees their old pending delivery with the same code', /OLD-2/.test(up.text()) && up.$$('.code').some((e) => e.textContent.trim() === pend.collectionCode));
  await up.logout();
  await up.login('staff01', 'Staff123!');
  await up.click(up.$('[data-action="demo-reset"]'));
  const afterResetUp = up.state();
  check('UPG', 'Reset still works on upgraded data (orders and log cleared, test results kept) and new residents can still be used',
    afterResetUp.orders.length === 0 && afterResetUp.tests.length === 1);
  await up.register('A-13-05', 'POST-RESET-1');
  check('UPG', 'Registering for a new resident after a reset works', !!up.order('POST-RESET-1'));

  // ---------------------------------------------------------------- Overdue workflow: reminders, overdue, follow-up, disposal
  const ov = await boot();
  await ov.login('staff01', 'Staff123!');
  await ov.click(ov.$('[data-action="demo-reset"]'));
  await ov.register('A-12-03', 'OV-1', 'Left at counter');
  await ov.register('A-12-05', 'OV-2');
  const ovId = (ref) => ov.order(ref).orderId;
  const nOf = (ref, type) => ov.state().notifications.filter((n) => n.orderReference === ref && (!type || n.type === type));
  const logN = (type, ref) => ov.state().audit.filter((e) => e.eventType === type && (!ref || e.orderReference === ref)).length;
  const asStaff = async () => { await ov.logout(); await ov.login('staff01', 'Staff123!'); };
  const asRes = async (u, p) => { await ov.logout(); await ov.login(u, p); };
  const press = async (action, ref) => ov.click(ov.$('[data-action="' + action + '"][data-id="' + ovId(ref) + '"]'));

  await ov.nav('#/staff');
  const q1 = ov.$('#queue').textContent;
  check('OVD01', 'A newly registered delivery starts as Pending Collection (stored and shown), with no notification yet',
    ov.order('OV-1').status === 'PENDING' && /Pending Collection/.test(q1) && !/Overdue/.test(q1) && ov.state().notifications.length === 0);
  await asRes('resident01', 'Resident123!');
  const rt1 = ov.text();
  check('OVD01', 'The resident sees the new delivery as Pending Collection with its collect-by time, and nobody else\'s',
    /OV-1/.test(rt1) && /Pending Collection/.test(rt1) && /Collect by/.test(rt1) && !/OV-2/.test(rt1) && !/Collection reminder/.test(rt1));

  // reminder time (10 of 15 minutes)
  await asStaff();
  await ov.click(ov.$('[data-action="demo-ff10"]'));
  const rem = nOf('OV-1', 'reminder')[0];
  check('OVD02', 'Demo clock +10 min: a collection reminder is created for the right delivery and unit, and nothing is overdue yet',
    nOf('OV-1', 'reminder').length === 1 && nOf('OV-2', 'reminder').length === 1 && rem.unit === 'A-12-03' && nOf('OV-2', 'reminder')[0].unit === 'A-12-05' &&
    ov.state().notifications.every((n) => n.type === 'reminder') && ov.order('OV-1').status === 'PENDING' && ov.$('#n-overdue').textContent === '0' && !ov.$('#overdue-card'));
  await asRes('resident01', 'Resident123!');
  const rt2 = ov.text();
  await asRes('resident02', 'Resident456!');
  const rt2b = ov.text();
  check('OVD02', 'Each resident sees the reminder for their own delivery and unit only',
    /Collection reminder/.test(rt2) && /OV-1/.test(rt2) && /A-12-03/.test(rt2) && !/OV-2/.test(rt2) &&
    /Collection reminder/.test(rt2b) && /OV-2/.test(rt2b) && /A-12-05/.test(rt2b) && !/OV-1/.test(rt2b));

  // refresh / reopen
  async function refreshCheck(label) {
    const before = ov.state();
    const snap = { [STATE_KEY]: ov.w.localStorage.getItem(STATE_KEY) };
    const rf = await boot({ local: snap, session: { [SESSION_KEY]: 'u-staff01' }, hash: '#/staff' });
    await rf.nav('#/staff/log'); await rf.nav('#/staff'); await rf.nav('#/staff/verify'); await rf.nav('#/staff');
    const after = rf.state();
    const keys = after.notifications.map((n) => n.key);
    const rf2 = await boot({ local: { [STATE_KEY]: rf.w.localStorage.getItem(STATE_KEY) }, session: { [SESSION_KEY]: 'u-res01' }, hash: '#/resident' });
    await rf2.nav('#/resident');
    const after2 = rf2.state();
    check('OVD11', label + ': refreshing and reopening dashboards creates no duplicate notifications or activity entries',
      after.notifications.length === before.notifications.length && new Set(keys).size === keys.length && after.audit.length === before.audit.length &&
      after2.notifications.length === before.notifications.length && after2.audit.length === before.audit.length,
      JSON.stringify({ n: [before.notifications.length, after.notifications.length, after2.notifications.length], a: [before.audit.length, after.audit.length, after2.audit.length] }));
  }
  await refreshCheck('After the reminder');

  // overdue (15 minutes)
  await asStaff();
  await ov.click(ov.$('[data-action="demo-ff10"]'));
  const card = ov.$('#overdue-card') ? ov.$('#overdue-card').textContent : '';
  check('OVD03', 'Demo clock +20 min: both deliveries are Overdue on the staff dashboard (derived status, stored order still PENDING, one overdue notice each)',
    ov.$('#n-overdue').textContent === '2' && /OV-1/.test(card) && /OV-2/.test(card) && /Overdue/.test(card) && /Unit A-12-03/.test(card) &&
    ov.order('OV-1').status === 'PENDING' && nOf('OV-1', 'overdue').length === 1 && nOf('OV-2', 'overdue').length === 1 && logN('marked_overdue') === 2 && logN('reminder_generated') === 2);
  const tableRow = ov.$$('#queue tbody tr').find((tr) => /OV-1/.test(tr.textContent));
  check('OVD03', 'The overdue delivery is also marked Overdue in the queue, visibly different from Pending Collection', !!tableRow && !!tableRow.querySelector('.badge.overdue') && /Overdue/.test(tableRow.textContent));
  await asRes('resident01', 'Resident123!');
  const rt3 = ov.text();
  await asRes('resident02', 'Resident456!');
  const rt3b = ov.text();
  check('OVD04', 'The correct resident sees the overdue notice (delivery and unit named) and is told to collect promptly; the other resident does not see it',
    /Overdue · OV-1 · Unit A-12-03/.test(rt3) && /collect (it|this delivery) promptly/.test(rt3) && !/OV-2/.test(rt3) &&
    /Overdue · OV-2 · Unit A-12-05/.test(rt3b) && !/OV-1/.test(rt3b));
  await refreshCheck('After the overdue notice');

  // staff follow-up
  await asStaff();
  await press('followup-remind', 'OV-1');
  const cardA = ov.$('#overdue-card').textContent;
  check('OVD05', 'Staff send another reminder: confirmation shown, recorded in the log, the follow-up is visible on the card',
    /Reminder sent to unit A-12-03 for OV-1/.test(cardA) && /Reminder sent \(last/.test(cardA) && nOf('OV-1', 'staff_reminder').length === 1 && logN('followup_reminder', 'OV-1') === 1);
  await press('followup-remind', 'OV-1');
  check('OVD09', 'Sending a second reminder straight away is refused with a clear message and nothing is added',
    /already recorded at/.test(ov.$('#overdue-card').textContent) && nOf('OV-1', 'staff_reminder').length === 1 && logN('followup_reminder', 'OV-1') === 1);
  await press('followup-contact', 'OV-1');
  await press('followup-hold', 'OV-1');
  const cardB = ov.$('#overdue-card').textContent;
  check('OVD05', 'Staff record contact and a move to the holding area: both logged and shown, and the holding button is gone',
    /moved to the holding area/.test(cardB) && /Resident contacted/.test(cardB) && /In holding area since/.test(cardB) && logN('followup_contact', 'OV-1') === 1 && logN('followup_holding', 'OV-1') === 1 &&
    !ov.$('[data-action="followup-hold"][data-id="' + ovId('OV-1') + '"]') && !!ov.$('[data-action="followup-hold"][data-id="' + ovId('OV-2') + '"]') &&
    ov.order('OV-1').status === 'PENDING');
  await ov.nav('#/staff/log');
  const lg = ov.text();
  check('OVD05', 'The existing activity log shows registration, reminder, overdue and every follow-up (no separate log)',
    /Delivery registered/.test(lg) && /Collection reminder generated/.test(lg) && /Delivery marked overdue/.test(lg) && /Follow-up: reminder sent/.test(lg) &&
    /Follow-up: resident contacted/.test(lg) && /Follow-up: moved to holding area/.test(lg) && /system/.test(lg));
  await asRes('resident01', 'Resident123!');
  check('OVD05', 'The resident sees the staff reminder, only on their own page', /Staff follow-up reminder · OV-1 · Unit A-12-03/.test(ov.text()) && !/OV-2/.test(ov.text()));

  // resident collects an overdue delivery (normal code check by staff)
  const code1ov = ov.order('OV-1').collectionCode;
  await asStaff();
  await ov.verify(code1ov);
  const sawOverdueOrder = /OV-1/.test(ov.text());
  await ov.click(ov.$('[data-action="confirm"]'));
  await ov.nav('#/staff');
  const notifBefore = ov.state().notifications.length;
  const cardC = ov.$('#overdue-card') ? ov.$('#overdue-card').textContent : '';
  check('OVD06', 'Collecting an overdue delivery makes it Collected and removes it from the overdue list',
    sawOverdueOrder && ov.order('OV-1').status === 'COLLECTED' && !/OV-1/.test(cardC) && /OV-2/.test(cardC) && ov.$('#n-overdue').textContent === '1' && ov.$('#n-collected').textContent === '1');
  await asRes('resident01', 'Resident123!');
  const rt6 = ov.text();
  check('OVD06', 'The resident sees it in their history as Collected, with no overdue notices left for it',
    /Collection history/.test(rt6) && /Collected/.test(ov.$$('table').map((x) => x.textContent).join(' ')) && !/Overdue ·/.test(rt6) && !/Staff follow-up reminder/.test(rt6) && ov.$$('.code').length === 0);
  await asStaff();
  await ov.click(ov.$('[data-action="demo-ff10"]'));
  check('OVD07', 'A collected delivery stays Collected after its deadline and gets no further reminders or overdue entries',
    ov.order('OV-1').status === 'COLLECTED' && nOf('OV-1').length === 3 && logN('reminder_generated', 'OV-1') === 1 && logN('marked_overdue', 'OV-1') === 1 && !/OV-1/.test(ov.$('#overdue-card').textContent));
  check('OVD07', 'Collected deliveries get no new notifications when the clock moves', ov.state().notifications.length === notifBefore);

  // disposal
  const dispId = ovId('OV-2');
  ov.w.confirm = () => false;
  await press('followup-dispose', 'OV-2');
  check('OVD08', 'Cancelling the disposal dialog changes nothing', ov.order('OV-2').status === 'PENDING' && /Disposal cancelled/.test(ov.text()) && logN('disposed') === 0);
  let asked = '';
  ov.w.confirm = (m) => { asked = String(m); return true; };
  await press('followup-dispose', 'OV-2');
  const d2 = ov.order('OV-2');
  check('OVD08', 'The disposal dialog names the delivery and the building procedure; confirming marks it Disposed with a time and a log entry',
    /OV-2/.test(asked) && /building procedure/.test(asked) && /cannot be undone/.test(asked) && d2.status === 'DISPOSED' && typeof d2.disposedTime === 'number' &&
    logN('disposed', 'OV-2') === 1 && /Delivery disposed|now recorded as disposed/.test(ov.text()));
  ov.w.confirm = () => true;
  await ov.nav('#/staff');
  c.set(ov.$('#q-filter'), 'disposed');
  check('OVD08', 'The dashboard counts it as Disposed (not overdue) and lists it under the Disposed filter',
    ov.$('#n-disposed').textContent === '1' && ov.$('#n-overdue').textContent === '0' && !ov.$('#overdue-card') && /OV-2/.test(ov.$('#queue').textContent) && /Disposed/.test(ov.$('#queue').textContent));
  const code2ov = d2.collectionCode;
  await ov.verify(code2ov);
  check('OVD09', 'The code of a disposed delivery is refused with a clear message and no confirm button',
    /disposed/i.test(ov.text()) && !ov.$('[data-action="confirm"]') && ov.order('OV-2').status === 'DISPOSED');
  const nBeforeFf = ov.state().notifications.length;
  await ov.nav('#/staff');
  await ov.click(ov.$('[data-action="demo-ff10"]'));
  check('OVD08', 'After disposal there are no more reminders for it as time moves on (reminder, overdue and the disposal notice only)',
    nOf('OV-2').length === 3 && nOf('OV-2').map((n) => n.type).sort().join() === 'disposed,overdue,reminder' && ov.state().notifications.length === nBeforeFf);
  await asRes('resident02', 'Resident456!');
  const rt8 = ov.text();
  check('OVD08', 'The resident is told it was disposed, sees it in history as Disposed, and has no code or overdue notice left for it',
    /Delivery disposed · OV-2 · Unit A-12-05/.test(rt8) && /Disposed/.test(ov.$$('table').map((x) => x.textContent).join(' ')) && ov.$$('.code').length === 0 && !/Overdue ·/.test(rt8));
  const live2 = ov.F.normalizeState(ov.state());
  const staffU = ov.user('u-staff01');
  const nowT = Date.now() + live2.offsetMs;
  check('OVD09', 'Invalid actions are refused by the rules themselves: disposing a collected or disposed delivery, or following up on one',
    ov.F.disposeDelivery(live2, staffU, ovId('OV-1'), nowT).reason === 'already_collected' && ov.F.disposeDelivery(live2, staffU, ovId('OV-2'), nowT).reason === 'already_disposed' &&
    ov.F.sendStaffReminder(live2, staffU, ovId('OV-1'), nowT).reason === 'already_collected' && ov.F.recordContact(live2, staffU, ovId('OV-2'), nowT).reason === 'already_disposed' &&
    ov.F.disposeDelivery(live2, ov.user('u-res02'), ovId('OV-2'), nowT).reason === 'forbidden');
  await refreshCheck('After collection and disposal');

  // consistent counts as time advances
  await asStaff();
  await ov.register('A-12-07', 'OV-3');
  await ov.nav('#/staff');
  const spots = [];
  for (let i = 0; i < 3; i++) {
    const live = ov.F.normalizeState(ov.state());
    const sm = ov.F.summary(live, staffU, Date.now() + live.offsetMs);
    spots.push(ov.$('#n-pending').textContent === String(sm.onTime) && ov.$('#n-overdue').textContent === String(sm.overdue) &&
      ov.$('#n-collected').textContent === String(sm.collected) && ov.$('#n-disposed').textContent === String(sm.disposed));
    await ov.click(ov.$('[data-action="demo-ff10"]'));
  }
  check('OVD10', 'Advancing the demo clock step by step: the dashboard counts always match the rules, and OV-3 goes Pending Collection, reminder, Overdue once each',
    spots.every(Boolean) && nOf('OV-3', 'reminder').length === 1 && nOf('OV-3', 'overdue').length === 1 && ov.order('OV-3').status === 'PENDING' && ov.$('#n-overdue').textContent === '1');

  // saved data from the version before this feature
  const legacy = L.newState();
  L.seed(legacy, null, Date.now(), Math.random);
  const lj = JSON.parse(JSON.stringify(legacy));
  delete lj.notifications; delete lj.nextNotifId;
  lj.audit = lj.audit.filter((e) => !/^(reminder_generated|marked_overdue)$/.test(e.eventType));
  lj.orders.forEach((o) => { delete o.disposedTime; delete o.disposedBy; delete o.followUp; });
  const legacyOrders = JSON.stringify(lj.orders);
  const lg1 = await boot({ local: { [STATE_KEY]: JSON.stringify(lj) }, hash: '#/login' });
  await lg1.login('staff01', 'Staff123!');
  const s1 = lg1.state();
  const k1 = s1.notifications.map((n) => n.type + ':' + n.orderReference).sort().join();
  const lg2 = await boot({ local: { [STATE_KEY]: lg1.w.localStorage.getItem(STATE_KEY) }, session: { [SESSION_KEY]: 'u-staff01' }, hash: '#/staff' });
  await lg2.nav('#/staff/log'); await lg2.nav('#/staff');
  const s2 = lg2.state();
  check('UPG', 'Data saved before the overdue feature: deliveries unchanged, the already-overdue delivery gets its notices once, and a refresh adds nothing',
    JSON.stringify(s1.orders) === legacyOrders && k1 === 'overdue:FS-1001,reminder:FS-1001,reminder:FS-1002' && s2.notifications.length === s1.notifications.length && s2.audit.length === s1.audit.length &&
    /FS-1001/.test(lg1.$('#overdue-card').textContent) && lg1.$('#n-overdue').textContent === '1', k1);

  check('EXTRA', 'No script errors in any test page', scriptErrors.length === 0, scriptErrors.join(' | '));

  // ---------------------------------------------------------------- summary
  const spec = Array.from({ length: 26 }, (_, i) => 'T' + String(i + 1).padStart(2, '0'));
  console.log('\nSpec cases');
  const rows = [];
  spec.forEach((id) => {
    const mine = results.filter((r) => r.id === id);
    const status = mine.length === 0 ? 'NOT RUN' : mine.every((r) => r.pass) ? 'PASS' : 'FAIL';
    rows.push({ id, status, checks: mine.length, text: mine.map((r) => r.desc).join(' / ') });
    console.log('  ' + id + '  ' + status + '  (' + mine.length + ' check' + (mine.length === 1 ? '' : 's') + ')');
  });
  const extras = results.filter((r) => !/^T\d\d$/.test(r.id));
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed. Extra checks: ' + extras.filter((r) => r.pass).length + '/' + extras.length + ' passed.');

  if (process.argv.includes('--report')) {
    const lines = ['# FoodSafe test report', '', 'Generated by `node test-ui.js --report`. Each case runs the real pages in a simulated browser (jsdom), not a live phone or desktop browser.', '',
      '| Test | Result | What was checked |', '|---|---|---|'];
    rows.forEach((r) => lines.push('| ' + r.id + ' | ' + r.status + ' | ' + r.text.replace(/\|/g, '/') + ' |'));
    lines.push('', 'Extra checks beyond the spec: ' + extras.filter((r) => r.pass).length + ' of ' + extras.length + ' passed.', '');
    extras.forEach((r) => lines.push('- ' + (r.pass ? 'PASS' : 'FAIL') + ': ' + r.desc));
    fs.writeFileSync(path.join(DIR, 'TEST_REPORT.md'), lines.join('\n') + '\n');
    console.log('Wrote TEST_REPORT.md');
  }
  process.exit(failed.length || rows.some((r) => r.status !== 'PASS') ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
