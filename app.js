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
    filter: 'pending', query: '', logQuery: '', logType: 'all', logCategory: 'all', logStart: '', logEnd: '',
    resMsg: {}, testMsg: null, demoMsg: null, followMsg: null, lastPath: null
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
    bad_seconds: 'Enter the time in seconds.',
    already_disposed: 'That delivery was already disposed of. Do not hand it over.',
    not_overdue: 'That delivery is not overdue, so this action is not available.',
    already_in_holding: 'That delivery is already recorded as moved to the holding area.'
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
    demo_clock: 'Demo clock moved', demo_threshold: 'Overdue limit changed',
    reminder_generated: 'Collection reminder generated', marked_overdue: 'Delivery marked overdue',
    followup_reminder: 'Follow-up: reminder sent', followup_contact: 'Follow-up: resident contacted',
    followup_holding: 'Follow-up: moved to holding area', disposed: 'Delivery disposed'
  };

  // One status for every screen, from F.deliveryStatus (Pending Collection / Overdue / Collected / Disposed).
  function statusBadge(order, t) {
    var st = F.deliveryStatus(order, t, state.settings.overdueMinutes);
    var cls = { PENDING: '', OVERDUE: ' overdue', COLLECTED: ' done', DISPOSED: ' disposed' }[st];
    return '<span class="badge' + cls + '">' + esc(F.STATUS_LABELS[st]) + '</span>';
  }

  // ---------------------------------------------------------------------------------------------
  // Page frame
  // ---------------------------------------------------------------------------------------------
  function navItems(user) {
    if (!user) return [['/login', 'Log in'], ['/about', 'About']];
    if (user.role === F.STAFF) {
      return [['/staff', 'Dashboard'], ['/staff/register', 'Register delivery'], ['/staff/verify', 'Verify collection'],
        ['/staff/log', 'Activity log'], ['/about', 'About']];
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
      return '<p class="empty">' + (ui.query ? 'No orders match that search.' : ui.filter === 'collected' ? 'No collected orders yet.' : ui.filter === 'disposed' ? 'No disposed orders.' :
        ui.filter === 'overdue' ? 'No overdue orders.' : 'No orders in this list. Register a delivery to get started.') + '</p>';
    }
    var h = '<div class="tablewrap"><table><thead><tr><th>Order</th><th>Unit</th><th>Arrived</th><th>Waiting</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    r.orders.forEach(function (o) {
      h += '<tr><td><strong>' + esc(o.orderReference) + '</strong>' + (o.deliveryNote ? '<span class="muted">' + esc(o.deliveryNote) + '</span>' : '') + '</td>' +
        '<td>' + esc(o.residentUnit) + '</td><td>' + fmtTime(o.arrivalTime) + '</td><td>' + F.waitingMinutes(o, t) + ' min</td><td>' + statusBadge(o, t) + '</td><td>' +
        (o.status === F.PENDING
          ? '<button class="ghost" data-action="verify-order" data-id="' + o.orderId + '">Verify code</button>'
          : o.status === F.DISPOSED ? '<span class="muted">Disposed ' + fmtTime(o.disposedTime) + '</span>'
          : '<span class="muted">Collected ' + fmtTime(o.collectionTime) + '</span>') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  // What staff have already done for one overdue delivery, as short labels.
  function followChips(o) {
    var f = F.followUpInfo(o);
    var chips = [];
    if (f.reminders) chips.push('Reminder sent' + (f.reminders > 1 ? ' ×' + f.reminders : '') + ' (last ' + fmtTime(f.lastReminderAt) + ')');
    if (f.contacts) chips.push('Resident contacted' + (f.contacts > 1 ? ' ×' + f.contacts : '') + ' (last ' + fmtTime(f.lastContactAt) + ')');
    if (f.heldAt) chips.push('In holding area since ' + fmtTime(f.heldAt));
    if (!chips.length) return '<span class="muted small">No follow-up recorded yet.</span>';
    return chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join(' ');
  }

  function followCardHtml(user) {
    var t = now();
    var r = F.queue(state, user, { filter: 'overdue' }, t);
    if (!r.ok || !r.orders.length) return '';
    var limit = state.settings.overdueMinutes;
    var h = '<section class="card overdue-card" id="overdue-card" aria-label="Overdue deliveries"><h2>Overdue deliveries to follow up</h2>' +
      '<p class="muted">The resident has already been sent an overdue notice. Food is never disposed of automatically: it stays here until it is collected or a staff member chooses to dispose of it under the building procedure.</p>' +
      msgHtml(ui.followMsg);
    r.orders.forEach(function (o) {
      var id = ' data-id="' + o.orderId + '"';
      h += '<div class="followitem"><div class="order-head"><span class="title">' + esc(o.orderReference) + ' · Unit ' + esc(o.residentUnit) + '</span>' + statusBadge(o, t) + '</div>' +
        '<p class="muted" style="margin:2px 0 6px">Arrived ' + fmtTime(o.arrivalTime) + ', due by ' + fmtTime(F.deadlineTime(o, limit)) + ', waiting ' + F.waitingMinutes(o, t) + ' min' +
        (o.deliveryNote ? ' · ' + esc(o.deliveryNote) : '') + '</p>' +
        '<div class="chips">' + followChips(o) + '</div>' +
        '<div class="actions" style="margin:8px 0 0">' +
        '<button' + id + ' data-action="verify-order">Collect (verify code)</button>' +
        '<button class="ghost"' + id + ' data-action="followup-remind">Send reminder</button>' +
        '<button class="ghost"' + id + ' data-action="followup-contact">Record contact</button>' +
        (F.followUpInfo(o).heldAt ? '' : '<button class="ghost"' + id + ' data-action="followup-hold">Moved to holding area</button>') +
        '<button class="ghost danger"' + id + ' data-action="followup-dispose">Mark as Disposed</button></div></div>';
    });
    return h + '</section>';
  }

  function renderStaffHome(user) {
    var sm = F.summary(state, user, now());
    var h = '<h1 class="page">Staff dashboard</h1>' +
      '<div class="cards3"><div class="stat"><div class="muted">Pending Collection</div><div class="big" id="n-pending">' + sm.onTime + '</div></div>' +
      '<div class="stat overdue"><div class="muted">Overdue</div><div class="big" id="n-overdue">' + sm.overdue + '</div></div>' +
      '<div class="stat"><div class="muted">Collected</div><div class="big" id="n-collected">' + sm.collected + '</div></div>' +
      '<div class="stat"><div class="muted">Disposed</div><div class="big" id="n-disposed">' + sm.disposed + '</div></div></div>';
    h += '<div class="actions" style="margin-top:12px"><a class="btnlink" href="#/staff/register">Register delivery</a>' +
      '<a class="btnlink ghost" href="#/staff/verify">Verify collection</a><a class="btnlink ghost" href="#/staff/log">Activity log</a></div>';

    var fc = followCardHtml(user);
    // The outcome message normally sits in the overdue card; if that was the last overdue delivery the card is gone, so show it here.
    h += fc || (ui.followMsg ? '<div class="notice">' + msgHtml(ui.followMsg) + '</div>' : '');
    h += '<div class="card"><h2>Delivery queue</h2><div class="row">' +
      '<div><label for="q-filter">Show</label><select id="q-filter">' +
      [['pending', 'Awaiting collection'], ['overdue', 'Overdue'], ['collected', 'Collected'], ['disposed', 'Disposed'], ['all', 'All orders']].map(function (o) {
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
    var startTime = ui.logStart ? new Date(ui.logStart).getTime() : null;
    var endTime = ui.logEnd ? new Date(ui.logEnd).getTime() : null;
    var r = F.getActivityLog(state, user, {
      query: ui.logQuery, type: ui.logType, category: ui.logCategory,
      startTime: startTime, endTime: endTime
    });
    if (!r.ok) return msgHtml({ kind: 'bad', text: reasonText(r.reason) });
    if (startTime != null && endTime != null && startTime > endTime) {
      return '<p class="msg warn" role="status">The start time must be earlier than or equal to the end time.</p>';
    }
    if (!r.entries.length) return '<p class="empty">No matching events.</p>';
    var h = '<div class="tablewrap"><table><thead><tr><th>Time</th><th>Category</th><th>Event</th><th>By</th><th>Order</th><th>Outcome</th><th>Details</th></tr></thead><tbody>';
    r.entries.slice(0, 100).forEach(function (e) {
      h += '<tr><td>' + new Date(e.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        '</td><td>' + esc(F.eventCategory(e.eventType)) + '</td><td>' + esc(EVENT_LABELS[e.eventType] || e.eventType) + '</td><td>' +
        esc(e.actorName || e.actorRole) + (e.actorName ? '<span class="muted">' + esc(e.actorRole) +
        (e.actorUserId ? ' · ' + esc(e.actorUserId) : '') + '</span>' : (e.actorUserId ? '<span class="muted">' + esc(e.actorUserId) + '</span>' : '')) +
        '</td><td>' + esc(e.orderReference || '-') + '</td><td>' + esc(e.outcome) + '</td><td>' + esc(e.message) + '</td></tr>';
    });
    return h + '</tbody></table></div>' + (r.entries.length > 100 ? '<p class="muted small">Showing the latest 100 of ' + r.entries.length + ' matching events.</p>' : '');
  }

  function renderLog(user) {
    return '<h1 class="page">Activity log</h1><div class="card"><div class="row">' +
      '<div><label for="log-category">Category</label><select id="log-category">' +
      [['all', 'All categories'], ['Deliveries', 'Deliveries'], ['Collection', 'Collection'], ['Follow-up', 'Follow-up'],
       ['Access and Security', 'Access and Security'], ['System/Demo', 'System/Demo']].map(function (x) {
        return '<option value="' + esc(x[0]) + '"' + (ui.logCategory === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>';
      }).join('') + '</select></div>' +
      '<div><label for="log-type">Event</label><select id="log-type"><option value="all">All events</option>' +
      Object.keys(EVENT_LABELS).map(function (k) {
        return '<option value="' + k + '"' + (ui.logType === k ? ' selected' : '') + '>' + esc(EVENT_LABELS[k]) + '</option>';
      }).join('') + '</select></div>' +
      '<div><label for="log-q">Search</label><input id="log-q" autocomplete="off" value="' + esc(ui.logQuery) + '" placeholder="Event, order, user, outcome..."></div></div>' +
      '<div class="row" style="margin-top:10px"><div><label for="log-start">From date and time</label><input id="log-start" type="datetime-local" value="' + esc(ui.logStart) + '"></div>' +
      '<div><label for="log-end">To date and time</label><input id="log-end" type="datetime-local" value="' + esc(ui.logEnd) + '"></div>' +
      '<div style="align-self:end"><button type="button" class="ghost" data-action="clear-log-filters">Clear filters</button></div></div>' +
      '<div id="logtable" style="margin-top:10px">' + logTableHtml(user) + '</div>' +
      '<p class="muted small" style="margin-bottom:0">Operational and demo/system events share the existing activity history. Times use the stored event timestamps and your browser’s local time. This demonstration record is not tamper-proof; passwords and typed codes are never recorded.</p></div>';
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
  // Wording for each simulated notification (the stored record only holds the type, delivery, unit and times).
  function notifHtml(n) {
    var head = { reminder: 'Collection reminder', overdue: 'Overdue notice', staff_reminder: 'Staff follow-up reminder', disposed: 'Delivery disposed' }[n.type] || 'Notification';
    var body = {
      reminder: 'Please collect this delivery by ' + (n.dueAt != null ? fmtTime(n.dueAt) : 'the collection deadline') + '. FoodSafe does not monitor storage conditions or food safety.',
      overdue: 'The collection deadline passed at ' + (n.dueAt != null ? fmtTime(n.dueAt) : 'the recorded deadline') + '. Please collect your delivery promptly. If you have concerns about its storage or condition, assess it before consumption.',
      staff_reminder: 'A staff member sent this follow-up reminder because the delivery is overdue. Please collect it promptly. If you have concerns about its storage or condition, assess it before consumption.',
      disposed: 'Building staff marked this delivery as disposed after it was not collected. Ask the guard house if you have questions.'
    }[n.type] || '';
    return '<li class="notif ' + esc(n.type) + '"><div><strong>' + esc(head) + '</strong> · ' + esc(n.orderReference) + ' · Unit ' + esc(n.unit) +
      ' <span class="muted small">' + fmtTime(n.createdAt) + '</span></div><div>' + esc(body) + '</div></li>';
  }

  function renderResident(user) {
    var t = now();
    var limit = state.settings.overdueMinutes;
    var r = F.residentOrders(state, user);
    var nr = F.residentNotifications(state, user);
    var h = '<h1 class="page">Welcome, ' + esc(user.displayName) + '</h1><p class="muted" style="margin-top:-4px">Your unit: <strong>' + esc(user.unitNumber) + '</strong></p>' +
      '<p class="muted">Please collect each delivery within ' + limit + ' minutes of arrival. A collection reminder is shown before the deadline when the configured time allows. FoodSafe tracks elapsed time only; it does not monitor storage conditions or guarantee food safety.</p>';

    if (nr.ok && nr.notifications.length) {
      h += '<div class="card" id="notifications"><h2>Notifications</h2><ul class="notifs">' +
        nr.notifications.slice(0, 6).map(notifHtml).join('') + '</ul>' +
        (nr.notifications.length > 6 ? '<p class="muted small" style="margin:6px 0 0">Showing the latest 6 of ' + nr.notifications.length + '.</p>' : '') +
        '<p class="muted small" style="margin:8px 0 0">Demo only: a real system would send these to your phone.</p></div>';
    }

    h += '<h2 style="font-size:18px">Pending deliveries</h2>';
    if (!r.pending.length) h += '<div class="card"><p class="empty">Nothing is waiting for you right now.</p></div>';
    r.pending.forEach(function (o) {
      var over = F.isOverdue(o, t, limit);
      h += '<div class="card' + (over ? ' overdue-card' : '') + '"><div class="order-head"><span class="title">' + esc(o.orderReference) + '</span>' + statusBadge(o, t) + '</div>' +
        '<dl class="facts"><dt>Arrived</dt><dd>' + fmtTime(o.arrivalTime) + '</dd><dt>Collect by</dt><dd>' + fmtTime(F.deadlineTime(o, limit)) + '</dd><dt>Waiting</dt><dd>' + F.waitingMinutes(o, t) + ' min</dd>' +
        (o.deliveryNote ? '<dt>Note</dt><dd>' + esc(o.deliveryNote) + '</dd>' : '') + '</dl>';
      if (over) h += '<div class="msg warn"><strong>Overdue.</strong> The collection deadline has passed. Please collect your delivery promptly. If you have concerns about its storage or condition, assess it before consumption. You can authorise someone below to collect it, and staff may contact you.</div>';
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
      h += '<div class="tablewrap"><table><thead><tr><th>Order</th><th>Arrived</th><th>Outcome</th><th>Time</th><th>Details</th></tr></thead><tbody>';
      r.history.forEach(function (o) {
        var disposed = o.status === F.DISPOSED;
        h += '<tr><td>' + esc(o.orderReference) + '</td><td>' + fmtTime(o.arrivalTime) + '</td><td>' + statusBadge(o, t) + '</td><td>' +
          fmtTime(disposed ? o.disposedTime : o.collectionTime) + '</td><td>' + (disposed ? 'Disposed by building staff' : esc(o.collectedBy)) + '</td></tr>';
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
      '<div class="card"><h2>Why It Exists</h2>' +
      '<p>Food deliveries left unattended in shared residential areas may be collected by the wrong person, mixed up, or left uncollected for too long. Resolving these incidents can be inconvenient for residents and building staff.</p>' +
      '<p>FoodSafe explores a more accountable food-delivery handover process through delivery registration, collection-code verification, simulated resident notifications, and delivery activity records.</p>' +
      '<p>The idea was inspired by a widely shared video depicting food theft at a Singapore condominium. This example illustrates a possible problem but does not establish how common such incidents are.</p></div>' +
      '<div class="card"><h2>How It Works</h2><ol>' +
      '<li><strong>Register a delivery.</strong> Staff record the resident unit, order reference, optional note, and arrival time. FoodSafe generates a collection code for the intended resident.</li>' +
      '<li><strong>View delivery details.</strong> Residents can log in to see deliveries associated with their own unit, view the collection deadline and waiting time, and authorise another person to collect a delivery for a limited period.</li>' +
      '<li><strong>Verify the collection code.</strong> Staff verify the code presented by the collector and check the associated delivery details. Verification alone does not mark the delivery as collected.</li>' +
      '<li><strong>Confirm the handover.</strong> Staff separately confirm that the food has physically been handed over. The delivery is then marked as collected, and the code can no longer be used.</li>' +
      '<li><strong>Manage overdue deliveries.</strong> The prototype displays simulated reminders and overdue notices. Staff can record a follow-up reminder, record that they contacted the resident, record that a delivery was moved to a holding area, or mark it as disposed when permitted by the applicable building procedure. These records do not physically move or dispose of food.</li>' +
      '</ol></div>' +
      '<div class="card"><h2>Who Can Do What?</h2><div class="tablewrap"><table><thead><tr><th>Function</th><th>Staff</th><th>Resident</th></tr></thead><tbody>' +
      '<tr><td>Register deliveries</td><td>Yes</td><td>No</td></tr>' +
      '<tr><td>Verify collection codes and confirm handovers</td><td>Yes</td><td>No</td></tr>' +
      '<tr><td>View all delivery records and activity history</td><td>Yes</td><td>No</td></tr>' +
      '<tr><td>View deliveries associated with their own unit</td><td>No</td><td>Yes</td></tr>' +
      '<tr><td>Authorise another collector</td><td>No</td><td>Yes</td></tr>' +
      '<tr><td>Record follow-up actions for overdue deliveries</td><td>Yes</td><td>No</td></tr>' +
      '<tr><td>View personal delivery notifications</td><td>No</td><td>Yes</td></tr></tbody></table></div>' +
      '<p class="muted">Each demonstration account has a fixed role. Log out before switching accounts.</p></div>' +
      '<div class="card"><h2>Prototype Limitations</h2><ul>' +
      '<li>FoodSafe uses simulated data. Notifications appear within the application; no real SMS, WhatsApp, email, or push notifications are sent.</li>' +
      '<li>The prototype does not connect to delivery platforms, riders, CCTV systems, or physical lockers.</li>' +
      '<li>The login system is for demonstration purposes and does not provide production-level security.</li>' +
      '<li>Data is stored locally in the browser and is not automatically synchronised across devices.</li>' +
      '<li>The activity history is a demonstration record, not a tamper-proof audit log.</li>' +
      '<li>FoodSafe does not identify or track people, monitor food temperature or storage conditions, or guarantee food safety. It supports a more accountable handover process but cannot independently prevent theft.</li>' +
      '</ul></div>';
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

  // Create any reminder / overdue notification that is now due. Idempotent, so it is safe on every render.
  function syncDue() {
    if (F.syncNotifications(state, now()) > 0) save();
  }

  function route() {
    syncDue();
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
      ui.verified = null; ui.verifyMsg = null; ui.regMsg = null; ui.testMsg = null; ui.demoMsg = null; ui.followMsg = null; ui.resMsg = {};
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
    ui.filter = 'pending'; ui.query = ''; ui.logQuery = ''; ui.logType = 'all'; ui.logCategory = 'all'; ui.logStart = ''; ui.logEnd = '';
    ui.resMsg = {}; ui.testMsg = null; ui.demoMsg = null; ui.followMsg = null; ui.lastPath = null;
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
    if (action.indexOf('followup-') === 0) { handleFollowUp(action, Number(b.getAttribute('data-id')), user); return; }
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
    if (action === 'clear-log-filters') {
      ui.logQuery = ''; ui.logType = 'all'; ui.logCategory = 'all'; ui.logStart = ''; ui.logEnd = '';
      route(); return;
    }
    if (action === 'csv') { downloadCsv(); return; }
    if (action === 'clear-tests') {
      if (!window.confirm('Clear all test results?')) return;
      F.clearTests(state, user); save(); route();
    }
  });

  // Staff follow-up on an overdue delivery. The rules (and every check) live in logic.js; this only words the outcome.
  function handleFollowUp(action, id, user) {
    var o = F.findOrder(state, id);
    var ref = o ? o.orderReference : 'this delivery';
    var unit = o ? o.residentUnit : '';
    var res;
    if (action === 'followup-dispose') {
      var okToGo = window.confirm('Mark ' + ref + (unit ? ' (unit ' + unit + ')' : '') + ' as disposed?\n\n' +
        'Only do this when the applicable building procedure allows it for uncollected food. The delivery will be recorded as Disposed, ' +
        'its collection code will stop working, the resident will be told, and this cannot be undone.\n\nSelect OK to confirm or Cancel to keep the delivery.');
      if (!okToGo) { ui.followMsg = { kind: 'warn', text: 'Disposal cancelled. ' + ref + ' is unchanged.' }; route(); return; }
      res = F.disposeDelivery(state, user, id, now());
    } else if (action === 'followup-remind') res = F.sendStaffReminder(state, user, id, now());
    else if (action === 'followup-contact') res = F.recordContact(state, user, id, now());
    else if (action === 'followup-hold') res = F.recordHolding(state, user, id, now());
    else return;

    if (res.ok) {
      ui.followMsg = { kind: 'ok', text: {
        'followup-remind': 'Reminder sent to unit ' + unit + ' for ' + ref + '.',
        'followup-contact': 'Recorded: staff contacted unit ' + unit + ' about ' + ref + '.',
        'followup-hold': 'Recorded: ' + ref + ' moved to the holding area.',
        'followup-dispose': ref + ' is now recorded as disposed. The resident has been told.'
      }[action] };
    } else if (res.reason === 'reminder_too_soon' || res.reason === 'contact_too_soon') {
      ui.followMsg = { kind: 'bad', text: (res.reason === 'reminder_too_soon' ? 'A reminder' : 'A contact') + ' for ' + ref + ' was already recorded at ' + fmtTime(res.lastAt) +
        '. You can record another from ' + fmtTime(res.retryAt) + '.' };
    } else {
      ui.followMsg = { kind: 'bad', text: reasonText(res.reason) };
    }
    save(); route();
  }

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
    else if (id === 'log-category' && user && user.role === F.STAFF) { ui.logCategory = e.target.value; el('logtable').innerHTML = logTableHtml(user); }
    else if (id === 'log-start' && user && user.role === F.STAFF) { ui.logStart = e.target.value; el('logtable').innerHTML = logTableHtml(user); }
    else if (id === 'log-end' && user && user.role === F.STAFF) { ui.logEnd = e.target.value; el('logtable').innerHTML = logTableHtml(user); }
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
