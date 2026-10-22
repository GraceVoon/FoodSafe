/*
 * FoodSafe - screens, login session and page protection. Uses window.FoodSafe (logic.js).
 *
 * Demo-only security: the session holds just a user id (sessionStorage, so it ends when the tab closes).
 * The role is ALWAYS looked up from the account record, never read from storage or from a button.
 * Orders are kept in this browser's localStorage, so staff and resident can be tried in two tabs of
 * the same browser. This is not production authentication: see the About page and README.
 */
(function () {
  'use strict';
  var F = window.FoodSafe;
  var STATE_KEY = 'foodsafe.v2';
  var SESSION_KEY = 'foodsafe.session';

  var ui = {
    notice: null, loginMsg: null, loginDraft: '',
    regDraft: { unit: '', ref: '', note: '' }, regMsg: null,
    verifyMsg: null, verified: null, expectedOrderId: null, keepExpected: false,
    filter: 'pending', query: '', logQuery: '', logType: 'all',
    resMsg: {}, testMsg: null, demoMsg: null, lastPath: null
  };
  var pendingRender = false;
  var memSession = null;
  var sessionOk = (function () {
    try { window.sessionStorage.setItem('foodsafe.t', '1'); window.sessionStorage.removeItem('foodsafe.t'); return true; } catch (e) { return false; }
  })();

  // ---------------------------------------------------------------------------------------------
  // Saved data and session
  // ---------------------------------------------------------------------------------------------
  function save() {
    try { window.localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: keep working in memory */ }
  }

  function loadState() {
    var raw = null;
    try { raw = window.localStorage.getItem(STATE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var s = F.normalizeState(JSON.parse(raw));
        if (s) return s;
      } catch (e) { /* fall through */ }
      ui.notice = { kind: 'warn', text: 'Saved data was damaged, so the sample data was loaded again.' };
    }
    var fresh = F.newState();
    F.seed(fresh, null, Date.now(), Math.random);
    try { window.localStorage.setItem(STATE_KEY, JSON.stringify(fresh)); } catch (e) { /* ignore */ }
    return fresh;
  }

  var state = loadState();

  function getSessionId() {
    if (!sessionOk) return memSession;
    try { return window.sessionStorage.getItem(SESSION_KEY); } catch (e) { return memSession; }
  }
  function setSessionId(id) {
    memSession = id || null;
    if (!sessionOk) return;
    try {
      if (id) window.sessionStorage.setItem(SESSION_KEY, id);
      else window.sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  // The logged-in user, looked up from the account record. Anything else in storage is ignored.
  function currentUser() {
    var id = getSessionId();
    if (!id) return null;
    var u = F.getUserById(id);
    if (!u) setSessionId(null);
    return u;
  }

  function now() { return Date.now() + (state.offsetMs || 0); }

  // ---------------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(ms) { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function fmtTimeSec(ms) { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function el(id) { return document.getElementById(id); }
  function msgHtml(m) { return m ? '<div class="msg ' + m.kind + '" role="status">' + esc(m.text) + '</div>' : ''; }
  function home(user) { return user ? (user.role === F.STAFF ? '/staff' : '/resident') : '/login'; }
  function roleLabel(user) { return user.role === F.STAFF ? 'Staff' : 'Resident'; }

  var REASONS = {
    forbidden: 'Your account is not allowed to do that.',
    not_authenticated: 'Please log in again.',
    unit_required: 'Enter the resident unit number.',
    ref_required: 'Enter the order reference.',
    ref_too_long: 'The order reference is too long (40 characters at most).',
    note_too_long: 'The note is too long (140 characters at most).',
    duplicate_ref: 'An order with that reference already exists.',
    code_required: 'Enter the collection code.',
    code_not_found: 'That code is not valid. Do not hand over any food.',
    already_collected: 'That order was already collected. Do not hand it over again.',
    delegation_expired: 'That authorisation has expired. Ask the resident to make a new one.',
    delegation_cancelled: 'That authorisation was cancelled by a newer one. Ask the resident for the current code.',
    wrong_order: 'That code belongs to a different order. Do not hand this order over.',
    not_verified: 'Check the code first, then confirm.',
    not_found: 'Order not found.',
    name_required: 'Enter the name of the person collecting.',
    name_too_long: 'The name is too long (40 characters at most).',
    bad_duration: 'Choose a whole number of minutes between 5 and 240.',
    bad_minutes: 'Enter a whole number of minutes in the allowed range.',
    participant_required: 'Enter a participant name.',
    bad_seconds: 'Enter the time in seconds.'
  };
  function reasonText(reason) {
    if (reason === 'invalid_unit') return 'That unit is not a configured demo resident. Choose one of: ' + F.validUnits().join(', ') + '.';
    return REASONS[reason] || 'That did not work.';
  }

  var EVENT_LABELS = {
    login: 'Login', login_failed: 'Login failed', logout: 'Logout',
    delivery_registered: 'Delivery registered', verify_success: 'Code verified', verify_failed: 'Invalid code attempt',
    collected: 'Collection successful', collect_failed: 'Collection failed', delegation_created: 'Collector authorised',
    access_denied: 'Access denied', demo_loaded: 'Demo data loaded', demo_reset: 'Demo reset',
    demo_clock: 'Demo clock moved', demo_threshold: 'Overdue limit changed'
  };

  function statusBadge(order, t) {
    if (order.status === F.COLLECTED) return '<span class="badge done">Collected</span>';
    if (F.isOverdue(order, t, state.settings.overdueMinutes)) return '<span class="badge overdue">Pending · Overdue</span>';
    return '<span class="badge">Pending</span>';
  }

  // ---------------------------------------------------------------------------------------------
  // Page frame
  // ---------------------------------------------------------------------------------------------
  function navItems(user) {
    if (!user) return [['/login', 'Log in'], ['/about', 'About']];
    if (user.role === F.STAFF) {
      return [['/staff', 'Dashboard'], ['/staff/register', 'Register delivery'], ['/staff/verify', 'Verify collection'],
        ['/staff/log', 'Activity log'], ['/staff/tests', 'Test log'], ['/about', 'About']];
    }
    return [['/resident', 'My deliveries'], ['/about', 'About']];
  }

  function frame(user, path, inner) {
    var notice = ui.notice; ui.notice = null;
    var h = '<div class="wrap"><header class="top"><p class="brand"><a href="#/">FoodSafe</a></p>';
    if (user) {
      h += '<div class="who"><span class="name">' + esc(user.displayName) + '</span>' +
        '<span class="role">' + roleLabel(user) + (user.unitNumber ? ' · ' + esc(user.unitNumber) : '') + '</span>';
      if (state.offsetMs) h += '<span class="clockflag">Demo clock +' + Math.round(state.offsetMs / 60000) + ' min</span>';
      h += '<button class="ghost" data-action="logout">Log out</button></div>';
    }
    h += '</header><nav class="nav" aria-label="Main">';
    navItems(user).forEach(function (n) {
      h += '<a href="#' + n[0] + '"' + (n[0] === path ? ' aria-current="page"' : '') + '>' + esc(n[1]) + '</a>';
    });
    h += '</nav><main id="main">' + (notice ? '<div class="notice">' + msgHtml(notice) + '</div>' : '') + inner + '</main></div>';
    return h;
  }

  // ---------------------------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------------------------
  function renderLogin() {
    var h = '<section class="card login"><h1><span class="logo">F</span>FoodSafe</h1>' +
      '<p class="muted">Secure food handoff for residential communities.</p>' +
      '<form id="form-login" novalidate>' +
      '<label for="l-user">Username</label><input id="l-user" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(ui.loginDraft) + '">' +
      '<label for="l-pass">Password</label><div class="pw"><input id="l-pass" type="password" autocomplete="current-password">' +
      '<button type="button" class="ghost" data-action="togglepw" aria-pressed="false" aria-controls="l-pass">Show</button></div>' +
      '<p style="margin:14px 0 0"><button type="submit">Log in</button></p>' + msgHtml(ui.loginMsg) + '</form></section>';

    h += '<section class="card demoaccts"><h2>Demo accounts</h2>' +
      '<p class="muted">Public demo credentials for this prototype only. Each account has one fixed role, and the role comes from the account, not from a choice you make. To try the other role, log out and log in with the other account (or open a second tab).</p>' +
      '<div class="tablewrap"><table><thead><tr><th>Role</th><th>Username</th><th>Password</th><th>Unit</th><th></th></tr></thead><tbody>';
    F.demoLogins().forEach(function (a) {
      h += '<tr><td>' + (a.role === F.STAFF ? 'Staff' : 'Resident') + '</td><td>' + esc(a.username) + '</td><td>' + esc(a.password) + '</td><td>' +
        esc(a.unitNumber || '-') + '</td><td><button class="ghost" type="button" data-action="fill" data-user="' + esc(a.username) + '">Fill in</button></td></tr>';
    });
    h += '</tbody></table></div></section>';
    return h;
  }

  // ---------------------------------------------------------------------------------------------
  // Staff: dashboard
  // ---------------------------------------------------------------------------------------------
  function queueHtml(user) {
    var t = now();
    var r = F.queue(state, user, { filter: ui.filter, query: ui.query }, t);
    if (!r.ok) return msgHtml({ kind: 'bad', text: reasonText(r.reason) });
    if (!r.orders.length) {
      return '<p class="empty">' + (ui.query ? 'No orders match that search.' : ui.filter === 'collected' ? 'No collected orders yet.' :
        ui.filter === 'overdue' ? 'No overdue orders.' : 'No orders in this list. Register a delivery to get started.') + '</p>';
    }
    var h = '<div class="tablewrap"><table><thead><tr><th>Order</th><th>Unit</th><th>Arrived</th><th>Waiting</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    r.orders.forEach(function (o) {
      h += '<tr><td><strong>' + esc(o.orderReference) + '</strong>' + (o.deliveryNote ? '<span class="muted">' + esc(o.deliveryNote) + '</span>' : '') + '</td>' +
        '<td>' + esc(o.residentUnit) + '</td><td>' + fmtTime(o.arrivalTime) + '</td><td>' + F.waitingMinutes(o, t) + ' min</td><td>' + statusBadge(o, t) + '</td><td>' +
        (o.status === F.PENDING
          ? '<button class="ghost" data-action="verify-order" data-id="' + o.orderId + '">Verify code</button>'
          : '<span class="muted">Collected ' + fmtTime(o.collectionTime) + '</span>') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function renderStaffHome(user) {
    var sm = F.summary(state, user, now());
    var h = '<h1 class="page">Staff dashboard</h1>' +
      '<div class="cards3"><div class="stat"><div class="muted">Pending</div><div class="big" id="n-pending">' + sm.pending + '</div></div>' +
      '<div class="stat overdue"><div class="muted">Overdue</div><div class="big" id="n-overdue">' + sm.overdue + '</div></div>' +
      '<div class="stat"><div class="muted">Collected</div><div class="big" id="n-collected">' + sm.collected + '</div></div></div>';
    if (sm.overdue) {
      h += '<div class="msg warn" role="alert"><strong>' + sm.overdue + ' order' + (sm.overdue > 1 ? 's have' : ' has') + ' been waiting ' +
        state.settings.overdueMinutes + ' minutes or more.</strong> They stay pending until collected.</div>';
    }
    h += '<div class="actions" style="margin-top:12px"><a class="btnlink" href="#/staff/register">Register delivery</a>' +
      '<a class="btnlink ghost" href="#/staff/verify">Verify collection</a><a class="btnlink ghost" href="#/staff/log">Activity log</a></div>';

    h += '<div class="card"><h2>Delivery queue</h2><div class="row">' +
      '<div><label for="q-filter">Show</label><select id="q-filter">' +
      [['pending', 'Awaiting collection'], ['overdue', 'Overdue'], ['collected', 'Collected'], ['all', 'All orders']].map(function (o) {
        return '<option value="' + o[0] + '"' + (ui.filter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div><label for="q-search">Search by order reference or unit</label><input id="q-search" value="' + esc(ui.query) + '" autocomplete="off"></div></div>' +
      '<div id="queue" style="margin-top:10px">' + queueHtml(user) + '</div></div>';

    h += '<div class="card"><h2>Demonstration tools</h2>' +
      '<p class="muted">Demo only, not part of the real workflow. They change the sample data and the demo clock for everyone using this browser.</p>' +
      '<div class="actions"><button class="ghost" data-action="demo-load">Load sample data</button>' +
      '<button class="ghost" data-action="demo-ff5">Skip ahead 5 min</button><button class="ghost" data-action="demo-ff10">Skip ahead 10 min</button>' +
      '<button class="ghost danger" data-action="demo-reset">Reset demo data</button></div>' +
      '<form id="form-thr" class="row" style="align-items:end"><div><label for="d-thr">Overdue after (minutes)</label>' +
      '<input id="d-thr" type="number" min="1" max="240" step="1" value="' + state.settings.overdueMinutes + '"></div>' +
      '<div style="flex:0 0 auto"><button type="submit" class="ghost">Apply</button></div></form>' + msgHtml(ui.demoMsg) +
      '<p class="muted small" style="margin-bottom:0">Reset removes all orders and the activity log and puts the clock and overdue limit back to normal. Demo accounts and saved test results are kept.</p></div>';
    return h;
  }

  // ---------------------------------------------------------------------------------------------
  // Staff: register delivery
  // ---------------------------------------------------------------------------------------------
  function renderRegister() {
    var d = ui.regDraft;
    return '<h1 class="page">Register delivery</h1><div class="card"><form id="form-register" novalidate>' +
      '<p class="muted">The arrival time is recorded automatically, and a collection code is created for the resident.</p>' +
      '<div class="row"><div><label for="r-unit">Resident unit number</label>' +
      '<input id="r-unit" list="units" autocomplete="off" placeholder="e.g. ' + esc(F.validUnits()[0]) + '" value="' + esc(d.unit) + '">' +
      '<datalist id="units">' + F.residentDirectory().map(function (r) {
        return '<option value="' + esc(r.unitNumber) + '" label="' + esc(r.displayName) + '">';
      }).join('') + '</datalist></div>' +
      '<div><label for="r-ref">Order reference</label><input id="r-ref" autocomplete="off" maxlength="40" placeholder="e.g. FS-2041" value="' + esc(d.ref) + '"></div></div>' +
      '<p id="unit-hint" class="muted small" style="margin:8px 0 0">Demo residents: ' + F.validUnits().map(esc).join(', ') + '</p>' +
      '<label for="r-note">Delivery note (optional)</label><input id="r-note" autocomplete="off" maxlength="140" value="' + esc(d.note) + '">' +
      '<p style="margin:14px 0 0"><button type="submit">Register delivery</button> <a class="btnlink ghost" href="#/staff">Cancel</a></p>' +
      msgHtml(ui.regMsg) + '</form></div>';
  }

  // ---------------------------------------------------------------------------------------------
  // Staff: verify collection
  // ---------------------------------------------------------------------------------------------
  function renderVerify() {
    var t = now();
    var h = '<h1 class="page">Verify collection</h1>';
    var exp = ui.expectedOrderId != null ? F.findOrder(state, ui.expectedOrderId) : null;
    if (exp && exp.status !== F.PENDING) { exp = null; ui.expectedOrderId = null; }
    if (exp) {
      h += '<div class="msg warn">Handing over <strong>' + esc(exp.orderReference) + '</strong> for unit <strong>' + esc(exp.residentUnit) +
        '</strong>. Only that order\'s codes will be accepted. <button class="ghost" data-action="clear-expected" style="margin-left:6px">Check any order instead</button></div>';
    }
    h += '<div class="card"><form id="form-verify" novalidate><label for="v-code">Collection code from the person collecting</label>' +
      '<div class="verify"><input id="v-code" inputmode="numeric" maxlength="12" autocomplete="off" aria-describedby="v-help">' +
      '<button type="submit">Verify code</button></div>' +
      '<p id="v-help" class="muted small">The code check does not hand anything over. You confirm the handoff in the next step.</p>' +
      (state.failStreak >= 3 ? '<div class="msg warn" role="alert">' + state.failStreak + ' wrong codes in a row. Ask the person for their unit number and ID before trying again.</div>' : '') +
      msgHtml(ui.verifyMsg) + '</form></div>';

    var v = ui.verified;
    var o = v ? F.findOrder(state, v.orderId) : null;
    if (v && (!o || o.status !== F.PENDING)) { ui.verified = null; v = null; o = null; }
    if (v && o) {
      h += '<div class="card"><h2>Code accepted</h2><dl class="facts">' +
        '<dt>Order</dt><dd>' + esc(o.orderReference) + '</dd><dt>Unit</dt><dd>' + esc(o.residentUnit) + '</dd>' +
        '<dt>Arrived</dt><dd>' + fmtTime(o.arrivalTime) + ' (' + F.waitingMinutes(o, t) + ' min ago)</dd>' +
        '<dt>Collector</dt><dd>' + (v.via === 'delegate' ? esc(v.delegateName) + ' (authorised by unit ' + esc(o.residentUnit) + ')' : 'Resident of unit ' + esc(o.residentUnit)) + '</dd></dl>' +
        '<p class="muted">Check that the person collecting matches this order before you confirm.</p>' +
        '<div class="actions"><button data-action="confirm" data-id="' + o.orderId + '">Confirm handoff</button>' +
        '<button class="ghost" data-action="cancel-verify">Cancel</button></div></div>';
    }
    return h;
  }

  // ---------------------------------------------------------------------------------------------
  // Staff: activity log
  // ---------------------------------------------------------------------------------------------
  function logTableHtml(user) {
    var r = F.getActivityLog(state, user, { query: ui.logQuery, type: ui.logType });
    if (!r.ok) return msgHtml({ kind: 'bad', text: reasonText(r.reason) });
    if (!r.entries.length) return '<p class="empty">No matching events.</p>';
    var h = '<div class="tablewrap"><table><thead><tr><th>Time</th><th>Event</th><th>By</th><th>Order</th><th>Outcome</th><th>Details</th></tr></thead><tbody>';
    r.entries.slice(0, 100).forEach(function (e) {
      h += '<tr><td>' + fmtTimeSec(e.timestamp) + '</td><td>' + esc(EVENT_LABELS[e.eventType] || e.eventType) + '</td><td>' +
        esc(e.actorName || e.actorRole) + (e.actorName ? '<span class="muted">' + esc(e.actorRole) + '</span>' : '') + '</td><td>' + esc(e.orderReference || '-') +
        '</td><td>' + esc(e.outcome) + '</td><td>' + esc(e.message) + '</td></tr>';
    });
    return h + '</tbody></table></div>' + (r.entries.length > 100 ? '<p class="muted small">Showing the latest 100 of ' + r.entries.length + ' matching events.</p>' : '');
  }

  function renderLog(user) {
    return '<h1 class="page">Activity log</h1><div class="card"><div class="row">' +
      '<div><label for="log-type">Event</label><select id="log-type"><option value="all">All events</option>' +
      Object.keys(EVENT_LABELS).map(function (k) {
        return '<option value="' + k + '"' + (ui.logType === k ? ' selected' : '') + '>' + esc(EVENT_LABELS[k]) + '</option>';
      }).join('') + '</select></div>' +
      '<div><label for="log-q">Search</label><input id="log-q" autocomplete="off" value="' + esc(ui.logQuery) + '"></div></div>' +
      '<div id="logtable" style="margin-top:10px">' + logTableHtml(user) + '</div>' +
      '<p class="muted small" style="margin-bottom:0">Demonstration record kept in this browser. It is not tamper-proof. Passwords and typed codes are never recorded.</p></div>';
  }

  // ---------------------------------------------------------------------------------------------
  // Staff: usability test log
  // ---------------------------------------------------------------------------------------------
  function renderTests() {
    var sum = F.testSummary(state);
    function box(title, s) {
      return '<div class="stat"><div class="muted">' + title + '</div><div class="big" style="font-size:22px">' + (s.n ? s.correct + ' / ' + s.n + ' correct' : 'no data') + '</div>' +
        '<div class="muted">' + (s.n ? s.correctPct + '% correct, average ' + s.avgSeconds + ' s' : '') + '</div></div>';
    }
    var h = '<h1 class="page">Test log</h1><div class="card"><h2>Record a test result</h2>' +
      '<p class="muted">Team tool for test day. Give each person the same task (collect the right food from the shared shelf), once without and once with the app. Record what really happened, including bad results.</p>' +
      '<form id="form-test" novalidate><div class="row">' +
      '<div><label for="t-who">Participant</label><input id="t-who" placeholder="P1" autocomplete="off"></div>' +
      '<div><label for="t-cond">Condition</label><select id="t-cond"><option value="without">Without the app</option><option value="with">With the app</option></select></div>' +
      '<div><label for="t-ok">Correct handoff?</label><select id="t-ok"><option value="yes">Yes</option><option value="no">No</option></select></div>' +
      '<div><label for="t-sec">Time (seconds)</label><input id="t-sec" type="number" min="0" step="1"></div></div>' +
      '<p style="margin:12px 0 0"><button type="submit">Add result</button></p>' + msgHtml(ui.testMsg) + '</form></div>';
    h += '<div class="card"><h2>Results so far</h2><div class="stats2">' + box('Without the app', sum.without) + box('With the app', sum.with) + '</div>' +
      '<p class="muted small">A few people only show what happened in your test, not what would happen across a township. Say so in your pitch.</p></div>';
    h += '<div class="card"><h2>All results</h2>';
    if (!state.tests.length) h += '<p class="empty">No results yet.</p>';
    else {
      h += '<div class="tablewrap"><table><thead><tr><th>Who</th><th>Condition</th><th>Correct</th><th>Seconds</th></tr></thead><tbody>';
      state.tests.forEach(function (r) {
        h += '<tr><td>' + esc(r.participant) + '</td><td>' + (r.condition === 'with' ? 'With app' : 'Without app') + '</td><td>' + (r.correct ? 'Yes' : 'No') + '</td><td>' + esc(r.seconds) + '</td></tr>';
      });
      h += '</tbody></table></div><p style="margin:12px 0 0"><button class="ghost" data-action="csv">Download CSV</button> <button class="ghost danger" data-action="clear-tests">Clear results</button></p>';
    }
    return h + '</div>';
  }

  // ---------------------------------------------------------------------------------------------
  // Resident dashboard
  // ---------------------------------------------------------------------------------------------
  function renderResident(user) {
    var t = now();
    var r = F.residentOrders(state, user);
    var h = '<h1 class="page">Welcome, ' + esc(user.displayName) + '</h1><p class="muted" style="margin-top:-4px">Your unit: <strong>' + esc(user.unitNumber) + '</strong></p>';

    h += '<h2 style="font-size:18px">Pending deliveries</h2>';
    if (!r.pending.length) h += '<div class="card"><p class="empty">Nothing is waiting for you right now.</p></div>';
    r.pending.forEach(function (o) {
      var over = F.isOverdue(o, t, state.settings.overdueMinutes);
      h += '<div class="card"><div class="order-head"><span class="title">' + esc(o.orderReference) + '</span>' + statusBadge(o, t) + '</div>' +
        '<dl class="facts"><dt>Arrived</dt><dd>' + fmtTime(o.arrivalTime) + '</dd><dt>Waiting</dt><dd>' + F.waitingMinutes(o, t) + ' min</dd>' +
        (o.deliveryNote ? '<dt>Note</dt><dd>' + esc(o.deliveryNote) + '</dd>' : '') + '</dl>';
      if (over) h += '<div class="msg warn">This has been waiting ' + state.settings.overdueMinutes + ' minutes or more. Please collect it soon, or authorise someone below.</div>';
      h += '<p style="margin:10px 0 0">Show this code to the guard:</p><div class="code" aria-label="Your collection code">' + esc(o.collectionCode) + '</div>' +
        '<p class="muted small">Demo only: a real system would send this code to your phone.</p>';
      var d = F.activeDelegation(o, t);
      h += '<h3 style="margin-top:14px">Someone else collecting?</h3>';
      if (d) {
        h += '<div class="msg ok"><strong>' + esc(d.name) + '</strong> can collect with code <strong>' + esc(d.code) + '</strong> until ' + fmtTime(d.expiresAt) +
          '. A new authorisation cancels this one.</div>';
      }
      h += '<form data-delegate="' + o.orderId + '" novalidate><div class="row"><div><label>Name</label><input name="name" placeholder="e.g. Neighbour Sam" autocomplete="off" maxlength="40"></div>' +
        '<div><label>Valid for (minutes)</label><input name="minutes" type="number" min="5" max="240" value="30"></div></div>' +
        '<p style="margin:10px 0 0"><button type="submit" class="ghost">Authorise this person</button></p></form>' + msgHtml(ui.resMsg[o.orderId]) + '</div>';
    });

    h += '<h2 style="font-size:18px">Collection history</h2><div class="card">';
    if (!r.history.length) h += '<p class="empty">No collected deliveries yet.</p>';
    else {
      h += '<div class="tablewrap"><table><thead><tr><th>Order</th><th>Arrived</th><th>Collected</th><th>Collected by</th></tr></thead><tbody>';
      r.history.forEach(function (o) {
        h += '<tr><td>' + esc(o.orderReference) + '</td><td>' + fmtTime(o.arrivalTime) + '</td><td>' + fmtTime(o.collectionTime) + '</td><td>' + esc(o.collectedBy) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    return h + '</div>';
  }

  // ---------------------------------------------------------------------------------------------
  // About / help (open to everyone)
  // ---------------------------------------------------------------------------------------------
  function renderAbout() {
    return '<h1 class="page">About FoodSafe</h1>' +
      '<div class="card"><h2>Why it exists</h2><p>Delivered food is often left in a shared waiting area or guard house. It can be taken by the wrong person, mixed up, or left until it is cold, and afterwards residents have to check CCTV and chase people. FoodSafe tests a more accountable handoff. It was inspired by a widely shared video of a food theft in a Singapore condominium, which is one example and not proof of how common the problem is in any township.</p></div>' +
      '<div class="card"><h2>How it works</h2><ol>' +
      '<li><strong>Staff register a delivery</strong> with the unit number and order reference. The arrival time is recorded and a collection code is created for the resident.</li>' +
      '<li><strong>Residents log in</strong> and see their own deliveries, the code, and how long the food has been waiting. They can authorise someone else for a limited time.</li>' +
      '<li><strong>Staff verify the code</strong> the person gives them. A good code shows the order and unit, and nothing is handed over yet.</li>' +
      '<li><strong>Staff confirm the handoff.</strong> The order becomes collected, the time is recorded and the code can never be used again.</li>' +
      '<li>Food that waits too long is flagged as overdue. It stays pending until it is collected.</li></ol></div>' +
      '<div class="card"><h2>Who can do what</h2><div class="tablewrap"><table><thead><tr><th></th><th>Staff</th><th>Resident</th></tr></thead><tbody>' +
      '<tr><td>Register deliveries, verify codes, confirm handoffs</td><td>Yes</td><td>No</td></tr>' +
      '<tr><td>See all orders and the activity log</td><td>Yes</td><td>No</td></tr>' +
      '<tr><td>See own unit\'s orders and code</td><td>No</td><td>Yes</td></tr>' +
      '<tr><td>Authorise another collector</td><td>No</td><td>Yes</td></tr>' +
      '<tr><td>Demonstration tools and test log</td><td>Yes</td><td>No</td></tr></tbody></table></div>' +
      '<p class="muted">Each account has one fixed role. To switch role, log out and log in with the other account.</p></div>' +
      '<div class="card"><h2>What it does not do</h2><ul>' +
      '<li>It is a <strong>prototype with simulated data</strong>. No real notifications (SMS, WhatsApp, email or push) are sent, and there is no connection to Grab, foodpanda, riders, CCTV or lockers.</li>' +
      '<li>It cannot stop theft by itself. It only helps if food is handed over by a person or locker that checks the code, not left on an open shelf.</li>' +
      '<li><strong>The login is a demonstration, not real security.</strong> The accounts and checks run in your browser, so anyone who can edit the page code or browser storage can get around them. A real system needs a server to check who is logged in.</li>' +
      '<li>Data is stored in this browser only, so other devices and browsers see their own copy. The activity log is a demonstration record and is not tamper-proof.</li>' +
      '<li>It does not identify or track anyone.</li></ul></div>';
  }

  // ---------------------------------------------------------------------------------------------
  // Routing with protection
  // ---------------------------------------------------------------------------------------------
  var ROUTES = {
    '/login': { pub: true, render: renderLogin },
    '/about': { pub: true, render: renderAbout },
    '/staff': { role: F.STAFF, render: renderStaffHome },
    '/staff/register': { role: F.STAFF, render: renderRegister },
    '/staff/verify': { role: F.STAFF, render: renderVerify },
    '/staff/log': { role: F.STAFF, render: renderLog },
    '/staff/tests': { role: F.STAFF, render: renderTests },
    '/resident': { role: F.RESIDENT, render: renderResident }
  };

  function currentPath() { return (window.location.hash || '').replace(/^#/, '').split('?')[0]; }

  function go(path) {
    if (window.location.hash === '#' + path) route();
    else window.location.hash = '#' + path;
  }

  function redirect(path) {
    try { window.history.replaceState(null, '', '#' + path); }
    catch (e) { window.location.hash = '#' + path; return; }
    route();
  }

  function route() {
    var user = currentUser();
    var path = currentPath();
    if (!path || path === '/') return redirect(home(user));
    var r = ROUTES[path];
    if (!r) {
      ui.notice = { kind: 'warn', text: 'That page does not exist.' };
      return redirect(home(user));
    }
    if (!r.pub) {
      if (!user) {
        F.recordAccessDenied(state, null, path, now()); save();
        ui.notice = { kind: 'warn', text: 'Please log in to continue.' };
        return redirect('/login');
      }
      if (user.role !== r.role) {
        F.recordAccessDenied(state, user, path, now()); save();
        ui.notice = { kind: 'bad', text: 'Access denied: ' + roleLabel(user).toLowerCase() + ' accounts cannot open that page.' };
        return redirect(home(user));
      }
    }
    if (path === '/login' && user) return redirect(home(user));

    if (path !== ui.lastPath) {                         // moving to another page: drop that page's leftovers
      if (ui.verified && user && user.role === F.STAFF) { F.cancelVerification(state, user); save(); }
      ui.verified = null; ui.verifyMsg = null; ui.regMsg = null; ui.testMsg = null; ui.demoMsg = null; ui.resMsg = {};
      if (!ui.keepExpected) ui.expectedOrderId = null;
      ui.keepExpected = false;
      ui.lastPath = path;
    }
    var inner = r.render(user);
    el('app').innerHTML = frame(user, path, inner);
    document.title = 'FoodSafe';
  }

  function resetUi() {
    ui.loginMsg = null; ui.loginDraft = ''; ui.regDraft = { unit: '', ref: '', note: '' }; ui.regMsg = null;
    ui.verifyMsg = null; ui.verified = null; ui.expectedOrderId = null; ui.keepExpected = false;
    ui.filter = 'pending'; ui.query = ''; ui.logQuery = ''; ui.logType = 'all';
    ui.resMsg = {}; ui.testMsg = null; ui.demoMsg = null; ui.lastPath = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------------------------
  window.addEventListener('hashchange', route);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    e.preventDefault();
    var user = currentUser();

    if (f.id === 'form-login') {
      var uname = el('l-user').value;
      ui.loginDraft = uname;
      var r = F.login(state, uname, el('l-pass').value, now());
      save();
      if (!r.ok) {
        ui.loginMsg = { kind: 'bad', text: r.reason === 'missing_fields' ? 'Enter both your username and your password.' : 'Username or password is incorrect.' };
        route();
        return;
      }
      resetUi();
      setSessionId(r.user.userId);
      go(home(r.user));
      return;
    }

    if (!user) { route(); return; }                      // every other form needs a logged-in user

    if (f.id === 'form-register') {
      ui.regDraft = { unit: el('r-unit').value, ref: el('r-ref').value, note: el('r-note').value };
      var rr = F.registerDelivery(state, user, ui.regDraft, now());
      if (rr.ok) {
        ui.regMsg = { kind: 'ok', text: 'Registered ' + rr.order.orderReference + ' for unit ' + rr.order.residentUnit + '. The resident can now see it.' };
        ui.regDraft = { unit: '', ref: '', note: '' };
      } else if (rr.reason === 'invalid_unit') {
        ui.regMsg = { kind: 'bad', text: 'Unit "' + ui.regDraft.unit.trim().toUpperCase().slice(0, 20) + '" is not a configured demo resident. Choose one of: ' + F.validUnits().join(', ') + '.' };
      } else {
        ui.regMsg = { kind: 'bad', text: reasonText(rr.reason) };
      }
      save(); route(); return;
    }

    if (f.id === 'form-verify') {
      var vr = F.verifyCode(state, user, el('v-code').value, now(), ui.expectedOrderId);
      if (vr.ok) {
        ui.verified = { orderId: vr.order.orderId, via: vr.via, delegateName: vr.delegateName };
        ui.verifyMsg = null;
      } else {
        ui.verified = null;
        ui.verifyMsg = { kind: 'bad', text: reasonText(vr.reason) };
      }
      save(); route(); return;
    }

    if (f.hasAttribute('data-delegate')) {
      var oid = Number(f.getAttribute('data-delegate'));
      var dr = F.createDelegation(state, user, oid, f.elements.name.value, f.elements.minutes.value, now());
      ui.resMsg[oid] = dr.ok ? null : { kind: 'bad', text: reasonText(dr.reason) };
      save(); route(); return;
    }

    if (f.id === 'form-test') {
      var tr = F.addTest(state, user, {
        participant: el('t-who').value, condition: el('t-cond').value, correct: el('t-ok').value === 'yes', seconds: el('t-sec').value === '' ? NaN : el('t-sec').value
      });
      ui.testMsg = tr.ok ? { kind: 'ok', text: 'Result added.' } : { kind: 'bad', text: reasonText(tr.reason) };
      save(); route(); return;
    }

    if (f.id === 'form-thr') {
      var thr = F.setOverdueMinutes(state, user, el('d-thr').value, now());
      ui.demoMsg = thr.ok ? { kind: 'ok', text: 'Overdue limit updated.' } : { kind: 'bad', text: reasonText(thr.reason) };
      save(); route();
    }
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action]');
    if (!b) return;
    var action = b.getAttribute('data-action');
    var user = currentUser();

    if (action === 'togglepw') {
      var pw = el('l-pass');
      var show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-pressed', String(show));
      return;
    }
    if (action === 'fill') {
      var acct = F.demoLogins().filter(function (a) { return a.username === b.getAttribute('data-user'); })[0];
      if (acct) { el('l-user').value = acct.username; el('l-pass').value = acct.password; ui.loginDraft = acct.username; }
      return;
    }
    if (action === 'logout') {
      if (user) { F.logout(state, user, now()); save(); }
      setSessionId(null);
      resetUi();
      ui.notice = { kind: 'ok', text: 'You have been logged out.' };
      go('/login');
      return;
    }
    if (!user) { route(); return; }

    var res;
    if (action === 'verify-order') {
      ui.expectedOrderId = Number(b.getAttribute('data-id'));
      ui.keepExpected = true;
      go('/staff/verify');
      return;
    }
    if (action === 'clear-expected') { ui.expectedOrderId = null; route(); return; }
    if (action === 'cancel-verify') {
      F.cancelVerification(state, user);
      ui.verified = null;
      ui.verifyMsg = { kind: 'warn', text: 'Handoff cancelled. The order is still pending.' };
      save(); route(); return;
    }
    if (action === 'confirm') {
      res = F.completeCollection(state, user, Number(b.getAttribute('data-id')), now());
      ui.verified = null;
      ui.verifyMsg = res.ok ? { kind: 'ok', text: 'Handoff confirmed. ' + res.order.orderReference + ' is now collected and its code can no longer be used.' }
                            : { kind: 'bad', text: reasonText(res.reason) };
      save(); route(); return;
    }
    if (action === 'demo-load') {
      if (!window.confirm('Replace all orders and the activity log with sample data?')) return;
      res = F.loadDemo(state, user, now(), Math.random);
      ui.demoMsg = res.ok ? { kind: 'ok', text: 'Sample data loaded.' } : { kind: 'bad', text: reasonText(res.reason) };
      save(); route(); return;
    }
    if (action === 'demo-ff5' || action === 'demo-ff10') {
      res = F.advanceClock(state, user, action === 'demo-ff5' ? 5 : 10, now());
      ui.demoMsg = res.ok ? { kind: 'ok', text: 'Demo clock moved ahead.' } : { kind: 'bad', text: reasonText(res.reason) };
      save(); route(); return;
    }
    if (action === 'demo-reset') {
      if (!window.confirm('Delete all orders and the activity log? Demo accounts and test results are kept.')) return;
      res = F.resetDemo(state, user, now());
      ui.verified = null;
      ui.demoMsg = res.ok ? { kind: 'ok', text: 'Demo data reset. There are no orders now.' } : { kind: 'bad', text: reasonText(res.reason) };
      save(); route(); return;
    }
    if (action === 'csv') { downloadCsv(); return; }
    if (action === 'clear-tests') {
      if (!window.confirm('Clear all test results?')) return;
      F.clearTests(state, user); save(); route();
    }
  });

  document.addEventListener('input', function (e) {
    var id = e.target.id;
    var user = currentUser();
    if (id === 'r-unit') ui.regDraft.unit = e.target.value;
    else if (id === 'r-ref') ui.regDraft.ref = e.target.value;
    else if (id === 'r-note') ui.regDraft.note = e.target.value;
    else if (id === 'q-search' && user && user.role === F.STAFF) { ui.query = e.target.value; el('queue').innerHTML = queueHtml(user); }
    else if (id === 'log-q' && user && user.role === F.STAFF) { ui.logQuery = e.target.value; el('logtable').innerHTML = logTableHtml(user); }
  });

  document.addEventListener('change', function (e) {
    var id = e.target.id;
    var user = currentUser();
    if (id === 'q-filter' && user && user.role === F.STAFF) { ui.filter = e.target.value; el('queue').innerHTML = queueHtml(user); }
    else if (id === 'log-type' && user && user.role === F.STAFF) { ui.logType = e.target.value; el('logtable').innerHTML = logTableHtml(user); }
  });

  function downloadCsv() {
    var blob = new Blob([F.testsToCsv(state)], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'foodsafe-test-results.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Keep other open tabs and the clock fresh, without wiping what someone is typing.
  function isTyping() {
    var a = document.activeElement;
    return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
  }
  function softRender() {
    if (isTyping()) { pendingRender = true; return; }
    pendingRender = false;
    route();
  }
  document.addEventListener('focusout', function () {
    setTimeout(function () { if (pendingRender && !isTyping()) softRender(); }, 0);
  });
  window.addEventListener('storage', function (e) {
    if (e.key !== STATE_KEY) return;
    var s = null;
    try { s = F.normalizeState(JSON.parse(e.newValue)); } catch (err) { s = null; }
    if (s) { state = s; softRender(); }
  });
  setInterval(softRender, 30000);

  route();
})();
