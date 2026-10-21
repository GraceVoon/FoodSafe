// End-to-end test of the real pages (index.html + app.js + logic.js) for cases T01-T26 in the spec.
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
  const badUnit = /not in this prototype/.test(c.text()) && !c.order('T-ORDER-X');
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
  const extras = results.filter((r) => r.id === 'EXTRA');
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
