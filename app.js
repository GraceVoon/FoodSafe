/* FoodSafe - UI. Uses FoodSafe (logic.js). Data lives in this browser only (localStorage). */
(function () {
  'use strict';
  var F = window.FoodSafe;
  var KEY = 'foodsafe.v1';
  var state = load();
  var currentView = 'staff';
  var residentUnit = '';
  var staffMsg = {};     // orderId -> {kind, text}
  var residentMsg = {};  // orderId -> {kind, text}
  var staffFormMsg = null;
  var testMsg = null;

  // ---------- storage (never let a storage error break the page) ----------
  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.orders)) {
          var base = F.newState();
          Object.keys(base).forEach(function (k) { if (s[k] === undefined) s[k] = base[k]; });
          return s;
        }
      }
    } catch (e) { /* ignore */ }
    return F.newState();
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function now() { return Date.now() + state.offsetMs; }

  // ---------- helpers ----------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function el(id) { return document.getElementById(id); }
  function msgHtml(m) { return m ? '<div class="msg ' + m.kind + '" role="status">' + esc(m.text) + '</div>' : ''; }

  var REASONS = {
    wrong_code: 'That code does not match. Do not hand over the food.',
    already_collected: 'This order was already collected.',
    locked: 'Locked after too many wrong codes. Check the person\'s ID or unit, then unlock.',
    delegation_expired: 'That authorisation has expired. Ask the resident to make a new one.',
    delegation_cancelled: 'That authorisation was cancelled by a newer one.',
    not_found: 'Order not found.'
  };

  // ---------- staff view ----------
  function renderStaff() {
    var t = now();
    var waiting = state.orders.filter(function (o) { return o.status === 'waiting'; });
    var done = state.orders.filter(function (o) { return o.status === 'collected'; }).slice(-5).reverse();
    var overdue = F.overdueOrders(state, t);

    var h = '';
    if (overdue.length) {
      h += '<div class="alert" role="alert"><strong>' + overdue.length + ' order' + (overdue.length > 1 ? 's' : '') +
        ' waiting over ' + state.settings.overdueMinutes + ' min.</strong> Food may be getting cold. Remind the resident.</div>';
    }

    h += '<div class="card"><h2>Log food that arrived</h2>' +
      '<form id="form-register">' +
      '<div class="row">' +
      '<div><label for="r-unit">Unit number</label><input id="r-unit" placeholder="e.g. A-12-03" autocomplete="off" required></div>' +
      '<div><label for="r-platform">Delivery app</label><select id="r-platform"><option>GrabFood</option><option>foodpanda</option><option>ShopeeFood</option><option>Other</option></select></div>' +
      '<div><label for="r-ref">Order ref (optional)</label><input id="r-ref" placeholder="e.g. GF-4821" autocomplete="off"></div>' +
      '</div>' +
      '<p style="margin:12px 0 0"><button type="submit">Log arrival and notify resident</button></p>' +
      msgHtml(staffFormMsg) +
      '</form></div>';

    h += '<div class="card"><h2>Waiting for collection (' + waiting.length + ')</h2>';
    if (!waiting.length) h += '<p class="empty">Nothing waiting. Log an arrival above, or load demo data below.</p>';
    waiting.forEach(function (o) {
      var isOver = F.isOverdue(o, t, state.settings.overdueMinutes);
      var badge = o.locked ? '<span class="badge locked">Locked</span>'
        : isOver ? '<span class="badge overdue">Waiting too long</span>'
        : '<span class="badge">Waiting</span>';
      h += '<div class="order">' +
        '<div class="order-head"><span class="unit">' + esc(o.unit) + '</span>' + badge + '</div>' +
        '<div class="muted">' + esc(o.platform) + (o.ref ? ' · ' + esc(o.ref) : '') +
        ' · arrived ' + fmtTime(o.arrivedAt) + ' · waiting <span data-arrived="' + o.id + '">' + F.waitingMinutes(o, t) + '</span> min</div>';
      if (o.locked) {
        h += '<p style="margin:8px 0 0"><button class="ghost" data-unlock="' + o.id + '">Unlock after checking ID / unit</button></p>';
      } else {
        h += '<form class="verify" data-verify="' + o.id + '">' +
          '<input inputmode="numeric" maxlength="4" placeholder="Code" aria-label="Collection code for ' + esc(o.unit) + '" autocomplete="off">' +
          '<button type="submit">Verify and hand over</button></form>';
      }
      h += msgHtml(staffMsg[o.id]) + '</div>';
    });
    h += '</div>';

    if (done.length) {
      h += '<div class="card"><h2>Recently collected</h2>';
      done.forEach(function (o) {
        h += '<div class="order"><div class="order-head"><span class="unit">' + esc(o.unit) + '</span><span class="badge done">Collected ' + fmtTime(o.collectedAt) + '</span></div>' +
          '<div class="muted">By ' + esc(o.collectedBy) + ' · waited ' + F.waitingMinutes(o, t) + ' min</div></div>';
      });
      h += '</div>';
    }

    h += renderAudit();
    el('view-staff').innerHTML = h;
  }

  function renderAudit() {
    var h = '<div class="card"><h2>Handoff record</h2>';
    if (!state.audit.length) return h + '<p class="empty">No activity yet.</p></div>';
    h += '<ul class="log">';
    state.audit.slice(0, 12).forEach(function (a) {
      h += '<li><span class="muted">' + fmtTime(a.at) + '</span> ' + esc(a.text) + '</li>';
    });
    return h + '</ul></div>';
  }

  // ---------- resident view ----------
  function residentUnits() {
    var seen = {};
    state.orders.forEach(function (o) { seen[o.unit] = true; });
    return Object.keys(seen).sort();
  }

  function renderResident() {
    var t = now();
    var units = residentUnits();
    if (units.indexOf(residentUnit) === -1) residentUnit = units[0] || '';

    var h = '<div class="card"><h2>Resident view</h2>' +
      '<p class="muted">In a real pilot the resident would get this on their phone. Pick a unit to see what that resident sees.</p>' +
      '<label for="res-unit">Unit</label><select id="res-unit">';
    if (!units.length) h += '<option value="">(no orders yet)</option>';
    units.forEach(function (u) { h += '<option' + (u === residentUnit ? ' selected' : '') + '>' + esc(u) + '</option>'; });
    h += '</select></div>';

    var orders = state.orders.filter(function (o) { return o.unit === residentUnit; }).slice().reverse();
    if (!orders.length) {
      h += '<div class="card"><p class="empty">No food for this unit yet. Log an arrival in the Staff tab.</p></div>';
    }
    orders.forEach(function (o) {
      h += '<div class="card"><div class="order-head"><span class="unit">Your food has arrived</span>';
      if (o.status === 'collected') h += '<span class="badge done">Collected</span>';
      else if (o.locked) h += '<span class="badge locked">Locked</span>';
      else if (F.isOverdue(o, t, state.settings.overdueMinutes)) h += '<span class="badge overdue">Collect soon</span>';
      else h += '<span class="badge">Ready</span>';
      h += '</div><div class="muted">' + esc(o.platform) + (o.ref ? ' · ' + esc(o.ref) : '') + ' · arrived ' + fmtTime(o.arrivedAt) +
        ' · waiting <span data-arrived="' + o.id + '">' + F.waitingMinutes(o, t) + '</span> min</div>';

      if (o.status === 'collected') {
        h += '<p>Collected at ' + fmtTime(o.collectedAt) + ' by ' + esc(o.collectedBy) + '.</p>';
      } else {
        if (F.isOverdue(o, t, state.settings.overdueMinutes)) {
          h += '<div class="msg warn">Your food has been waiting over ' + state.settings.overdueMinutes + ' minutes. Please collect it soon, or authorise someone below.</div>';
        }
        h += '<p style="margin:10px 0 0">Show this code to the guard:</p><div class="code" aria-label="Your collection code">' + esc(o.code) + '</div>';
        h += '<p class="muted small">Demo only: in a real system this code is sent to the resident\'s phone and is not shown to anyone else.</p>';

        var d = F.activeDelegation(o, t);
        h += '<h3 style="margin-top:14px">Someone else collecting?</h3>';
        if (d) {
          h += '<div class="msg ok"><strong>' + esc(d.name) + '</strong> can collect with code <strong>' + esc(d.code) + '</strong> until ' + fmtTime(d.expiresAt) + '. Making a new authorisation cancels this one.</div>';
        }
        h += '<form data-delegate="' + o.id + '"><div class="row">' +
          '<div><label>Name</label><input name="name" placeholder="e.g. Neighbour Sam" autocomplete="off" required></div>' +
          '<div><label>Valid for (minutes)</label><input name="minutes" type="number" min="5" max="240" value="' + state.settings.delegationMinutes + '" required></div>' +
          '</div><p style="margin:10px 0 0"><button type="submit" class="ghost">Authorise this person</button></p></form>';
      }
      h += msgHtml(residentMsg[o.id]) + '</div>';
    });
    el('view-resident').innerHTML = h;
  }

  // ---------- test log view ----------
  function renderTests() {
    var sum = F.testSummary(state);
    function statBox(title, s) {
      return '<div class="stat"><div class="muted">' + title + '</div>' +
        '<div class="big">' + (s.n ? s.correct + ' / ' + s.n + ' correct' : 'no data') + '</div>' +
        '<div class="muted">' + (s.n ? s.correctPct + '% correct · average ' + s.avgSeconds + ' s' : '') + '</div></div>';
    }
    var h = '<div class="card"><h2>Usability test log</h2>' +
      '<p class="muted">Use this on test day. Give each person the same task: collect the right food from a shared shelf, once without the app and once with it. Record what really happened, including bad results.</p>' +
      '<form id="form-test"><div class="row">' +
      '<div><label for="t-who">Participant</label><input id="t-who" placeholder="P1" autocomplete="off" required></div>' +
      '<div><label for="t-cond">Condition</label><select id="t-cond"><option value="without">Without the app</option><option value="with">With the app</option></select></div>' +
      '<div><label for="t-ok">Correct handoff?</label><select id="t-ok"><option value="yes">Yes</option><option value="no">No</option></select></div>' +
      '<div><label for="t-sec">Time (seconds)</label><input id="t-sec" type="number" min="0" step="1" required></div>' +
      '</div><p style="margin:12px 0 0"><button type="submit">Add result</button></p>' + msgHtml(testMsg) + '</form></div>';

    h += '<div class="card"><h2>Results so far</h2><div class="stats">' +
      statBox('Without the app', sum.without) + statBox('With the app', sum.with) + '</div>' +
      '<p class="muted small">Small samples only show what happened in your test, not what would happen across a township. Say so in your pitch.</p></div>';

    h += '<div class="card"><h2>All results</h2>';
    if (!state.tests.length) h += '<p class="empty">No results yet.</p>';
    else {
      h += '<table><thead><tr><th>Who</th><th>Condition</th><th>Correct</th><th>Seconds</th></tr></thead><tbody>';
      state.tests.forEach(function (r) {
        h += '<tr><td>' + esc(r.participant) + '</td><td>' + (r.condition === 'with' ? 'With app' : 'Without app') + '</td><td>' + (r.correct ? 'Yes' : 'No') + '</td><td>' + esc(r.seconds) + '</td></tr>';
      });
      h += '</tbody></table><p style="margin:12px 0 0"><button id="btn-csv" class="ghost">Download CSV</button> <button id="btn-clear-tests" class="ghost danger">Clear results</button></p>';
    }
    h += '</div>';
    el('view-tests').innerHTML = h;
  }

  // ---------- about view ----------
  function renderAbout() {
    el('view-about').innerHTML =
      '<div class="card"><h2>The problem</h2>' +
      '<p>Delivered food is often left in a shared waiting area. It can be taken by the wrong person, mixed up, or sit there until it is cold. Afterwards residents have to check CCTV and chase people. ' +
      'This prototype was inspired by a widely shared video of a food theft in a Singapore condominium. It is one example, not proof of how common the problem is in any particular township.</p></div>' +
      '<div class="card"><h2>What this prototype does</h2><ul>' +
      '<li>Staff log each delivery that arrives and the resident gets a one-time code.</li>' +
      '<li>Food is handed over only after the code is checked, and the handoff is recorded.</li>' +
      '<li>Three wrong codes lock the order until staff check the person\'s ID.</li>' +
      '<li>The resident can authorise someone else for a limited time.</li>' +
      '<li>Food waiting too long triggers an alert.</li></ul></div>' +
      '<div class="card"><h2>What it does not do</h2><ul>' +
      '<li>It cannot stop theft by itself. It only works if food is handed over by a person (or locker) that checks the code, not left on an open shelf.</li>' +
      '<li>It is not connected to Grab, foodpanda or any rider, so staff enter arrivals by hand.</li>' +
      '<li>Data is stored only in this browser. Codes are not secure enough for production.</li>' +
      '<li>It does not use CCTV or identify anyone.</li></ul></div>' +
      '<div class="card"><h2>What a real pilot would need</h2><ul>' +
      '<li>An agreement with the property manager or guard house.</li>' +
      '<li>A staffed counter or lockable shelf so the code check is enforced.</li>' +
      '<li>A real backend, resident accounts and phone notifications.</li>' +
      '<li>Privacy and data-protection checks.</li>' +
      '<li>Testing with residents of a real township, then reuse across other townships by changing the unit list.</li></ul></div>';
  }

  // ---------- rendering and events ----------
  function renderAll() {
    renderStaff(); renderResident(); renderTests(); renderAbout();
    el('clock').textContent = 'Demo time ' + fmtTime(now()) + (state.offsetMs ? ' (skipped ahead ' + Math.round(state.offsetMs / 60000) + ' min)' : '');
  }

  function showView(v) {
    currentView = v;
    ['staff', 'resident', 'tests', 'about'].forEach(function (n) {
      el('view-' + n).hidden = n !== v;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-view') === v));
    });
    renderAll();
  }

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (b) showView(b.getAttribute('data-view'));
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    e.preventDefault();

    if (f.id === 'form-register') {
      var r = F.registerOrder(state, {
        unit: el('r-unit').value, platform: el('r-platform').value, ref: el('r-ref').value
      }, now());
      staffFormMsg = r.ok ? { kind: 'ok', text: 'Logged for ' + r.order.unit + '. The resident can see their code in the Resident tab.' }
                          : { kind: 'bad', text: 'Enter a unit number.' };
      if (r.ok) residentUnit = r.order.unit;
      save(); renderAll(); return;
    }

    if (f.hasAttribute('data-verify')) {
      var id = Number(f.getAttribute('data-verify'));
      var code = f.querySelector('input').value;
      var res = F.verifyCollection(state, id, code, now());
      if (res.ok) {
        staffMsg[id] = { kind: 'ok', text: res.by === 'delegate'
          ? 'Code accepted. Hand over to ' + res.delegateName + ' (authorised by the resident).'
          : 'Code accepted. Hand the food to the resident.' };
      } else {
        var text = REASONS[res.reason] || 'Could not verify.';
        if (res.reason === 'wrong_code' || res.reason === 'delegation_expired' || res.reason === 'delegation_cancelled') {
          text += res.locked ? ' Order is now locked.' : ' ' + res.attemptsLeft + ' attempt(s) left.';
        }
        staffMsg[id] = { kind: 'bad', text: text };
      }
      save(); renderAll(); return;
    }

    if (f.hasAttribute('data-delegate')) {
      var oid = Number(f.getAttribute('data-delegate'));
      var d = F.createDelegation(state, oid, f.elements.name.value, f.elements.minutes.value, now());
      residentMsg[oid] = d.ok ? null : { kind: 'bad', text: d.reason === 'bad_duration' ? 'Choose between 5 and 240 minutes.' : 'Enter a name.' };
      save(); renderAll(); return;
    }

    if (f.id === 'form-test') {
      var tr = F.addTest(state, {
        participant: el('t-who').value, condition: el('t-cond').value,
        correct: el('t-ok').value === 'yes', seconds: el('t-sec').value
      });
      testMsg = tr.ok ? { kind: 'ok', text: 'Added.' } : { kind: 'bad', text: 'Check the participant name and time.' };
      save(); renderAll();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'res-unit') { residentUnit = e.target.value; renderResident(); }
  });

  document.addEventListener('click', function (e) {
    var u = e.target.closest('[data-unlock]');
    if (u) {
      var id = Number(u.getAttribute('data-unlock'));
      F.unlockOrder(state, id, now());
      staffMsg[id] = { kind: 'warn', text: 'Unlocked. Verify the code again.' };
      save(); renderAll(); return;
    }
    if (e.target.id === 'btn-csv') { downloadCsv(); return; }
    if (e.target.id === 'btn-clear-tests') {
      if (window.confirm('Clear all test results?')) { state.tests = []; save(); renderAll(); }
    }
  });

  el('btn-demo').addEventListener('click', function () {
    var keepTests = state.tests;
    state.offsetMs = 0;
    F.loadDemo(state, now());
    state.tests = keepTests;
    staffMsg = {}; residentMsg = {}; staffFormMsg = null;
    residentUnit = '';
    save(); renderAll();
  });
  el('btn-ff5').addEventListener('click', function () { state.offsetMs += 5 * 60000; save(); renderAll(); });
  el('btn-ff10').addEventListener('click', function () { state.offsetMs += 10 * 60000; save(); renderAll(); });
  el('btn-reset').addEventListener('click', function () {
    if (!window.confirm('Delete all orders, records and test results from this browser?')) return;
    state = F.newState(); staffMsg = {}; residentMsg = {}; staffFormMsg = null; testMsg = null; residentUnit = '';
    save(); renderAll();
  });

  function downloadCsv() {
    var blob = new Blob([F.testsToCsv(state)], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'foodsafe-test-results.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Update waiting timers once a minute without redrawing forms (so typing is never lost).
  setInterval(function () {
    var t = now();
    Array.prototype.forEach.call(document.querySelectorAll('[data-arrived]'), function (s) {
      var o = F.findOrder(state, Number(s.getAttribute('data-arrived')));
      if (o) s.textContent = F.waitingMinutes(o, t);
    });
    el('clock').textContent = 'Demo time ' + fmtTime(t) + (state.offsetMs ? ' (skipped ahead ' + Math.round(state.offsetMs / 60000) + ' min)' : '');
  }, 20000);

  showView('staff');
})();
