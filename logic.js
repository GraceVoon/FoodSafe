/*
 * FoodSafe - accounts, roles, rules and data model. No UI code here.
 * Works in the browser (window.FoodSafe) and in Node (require) so the rules can be tested.
 *
 * Rules that matter:
 *  - Every protected action takes an `actor` and checks the role against the ACCOUNT RECORD in
 *    ACCOUNTS. The `role` field of the object passed in is ignored, so a doctored object cannot
 *    grant itself staff rights.
 *  - Time is always passed in as `now` (ms) so the demo clock and the tests can simulate it.
 *  - An action either completes fully or changes nothing.
 *  - A delivery's status is stored as PENDING, COLLECTED or DISPOSED. "Overdue" is never stored: it is
 *    worked out from the arrival time, the overdue limit and `now` by deliveryStatus() (the one place
 *    that decides), so every screen and rule agrees. There are no timers.
 *  - Reminders and overdue notifications are created by syncNotifications(state, now). It can be called
 *    any number of times (page refresh, dashboard reopened, demo clock moved) and each notification is
 *    created once, because every one has a unique key.
 *
 * IMPORTANT: this is a front-end only prototype. Checks that run in browser JavaScript show correct
 * role separation, but anyone who can edit the code or browser storage can bypass them. Real
 * security needs a server that checks the logged-in user. Do not present this as production security.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FoodSafe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STAFF = 'STAFF';
  var RESIDENT = 'RESIDENT';
  var PENDING = 'PENDING';
  var COLLECTED = 'COLLECTED';
  var DISPOSED = 'DISPOSED';
  var OVERDUE = 'OVERDUE';           // derived display status only, never stored on an order
  var SYSTEM = 'SYSTEM';             // actor for events the app records by itself (reminders, overdue)

  var CODE_MIN = 100000;          // 6-digit codes
  var CODE_SPAN = 900000;
  var DEFAULT_OVERDUE_MIN = 15;
  var MIN_DELEGATION_MIN = 5;
  var MAX_DELEGATION_MIN = 240;
  var LOG_LIMIT = 500;
  var FOLLOWUP_GAP_MIN = 5;          // a staff reminder or contact record can be repeated after this many minutes
  var STATUS_LABELS = { PENDING: 'Pending Collection', OVERDUE: 'Overdue', COLLECTED: 'Collected', DISPOSED: 'Disposed' };

  // ---------------------------------------------------------------------------------------------
  // The ONE place demo accounts are defined. These are public demo credentials, not real security.
  // ---------------------------------------------------------------------------------------------
  var ACCOUNTS = Object.freeze([
    Object.freeze({ userId: 'u-staff01', username: 'staff01', password: 'Staff123!', role: STAFF, unitNumber: null, displayName: 'Demo Guard' }),
    Object.freeze({ userId: 'u-res01', username: 'resident01', password: 'Resident123!', role: RESIDENT, unitNumber: 'A-12-03', displayName: 'Demo Resident A' }),
    Object.freeze({ userId: 'u-res02', username: 'resident02', password: 'Resident456!', role: RESIDENT, unitNumber: 'A-12-05', displayName: 'Demo Resident B' }),
    // Added later: six more fictional residents. One account per unit. To add another, copy a line,
    // give it a new userId, username and unit number, and `node test.js` will check nothing clashes.
    Object.freeze({ userId: 'u-res03', username: 'resident03', password: 'Resident003!', role: RESIDENT, unitNumber: 'A-12-07', displayName: 'Demo Resident C' }),
    Object.freeze({ userId: 'u-res04', username: 'resident04', password: 'Resident004!', role: RESIDENT, unitNumber: 'A-13-02', displayName: 'Demo Resident D' }),
    Object.freeze({ userId: 'u-res05', username: 'resident05', password: 'Resident005!', role: RESIDENT, unitNumber: 'A-13-05', displayName: 'Demo Resident E' }),
    Object.freeze({ userId: 'u-res06', username: 'resident06', password: 'Resident006!', role: RESIDENT, unitNumber: 'B-05-03', displayName: 'Demo Resident F' }),
    Object.freeze({ userId: 'u-res07', username: 'resident07', password: 'Resident007!', role: RESIDENT, unitNumber: 'B-05-06', displayName: 'Demo Resident G' }),
    Object.freeze({ userId: 'u-res08', username: 'resident08', password: 'Resident008!', role: RESIDENT, unitNumber: 'B-06-01', displayName: 'Demo Resident H' })
  ]);

  // Problems in the account list (duplicates, bad format, resident without a unit). Empty list = fine.
  function accountProblems() {
    var problems = [];
    var ids = {}, names = {}, units = {};
    ACCOUNTS.forEach(function (a) {
      if (ids[a.userId]) problems.push('duplicate userId ' + a.userId);
      ids[a.userId] = true;
      if (names[a.username.toLowerCase()]) problems.push('duplicate username ' + a.username);
      names[a.username.toLowerCase()] = true;
      if (a.role === RESIDENT) {
        if (!a.unitNumber) problems.push(a.username + ' has no unit number');
        else {
          if (!/^[A-Z]-\d{2}-\d{2}$/.test(a.unitNumber)) problems.push(a.username + ' unit "' + a.unitNumber + '" is not in the form A-12-03');
          if (units[a.unitNumber]) problems.push('duplicate unit ' + a.unitNumber);
          units[a.unitNumber] = true;
        }
      } else if (a.unitNumber) problems.push(a.username + ' is staff but has a unit number');
    });
    return problems;
  }

  function publicUser(acc) {
    return { userId: acc.userId, username: acc.username, role: acc.role, unitNumber: acc.unitNumber, displayName: acc.displayName };
  }

  function getUserById(userId) {
    if (typeof userId !== 'string') return null;
    for (var i = 0; i < ACCOUNTS.length; i++) if (ACCOUNTS[i].userId === userId) return publicUser(ACCOUNTS[i]);
    return null;
  }

  // Re-resolve an actor from the account record. Whatever role the caller claims is ignored.
  function authActor(actor) {
    if (!actor || typeof actor !== 'object') return null;
    return getUserById(actor.userId);
  }

  function guard(actor, role) {
    var a = authActor(actor);
    if (!a) return { fail: { ok: false, reason: 'not_authenticated' } };
    if (a.role !== role) return { fail: { ok: false, reason: 'forbidden' } };
    return { actor: a };
  }

  function demoLogins() {
    return ACCOUNTS.map(function (a) {
      return { username: a.username, password: a.password, role: a.role, unitNumber: a.unitNumber, displayName: a.displayName };
    });
  }

  function validUnits() {
    var seen = {};
    var out = [];
    ACCOUNTS.forEach(function (a) {
      if (a.role === RESIDENT && a.unitNumber && !seen[a.unitNumber]) { seen[a.unitNumber] = true; out.push(a.unitNumber); }
    });
    return out;
  }

  // Units with the demo resident's name, for the staff registration list (built from ACCOUNTS).
  function residentDirectory() {
    return ACCOUNTS.filter(function (a) { return a.role === RESIDENT && a.unitNumber; })
      .map(function (a) { return { unitNumber: a.unitNumber, displayName: a.displayName }; });
  }

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------
  function newState() {
    return {
      orders: [],
      audit: [],
      tests: [],
      nextOrderId: 1,
      nextLogId: 1,
      notifications: [],                 // simulated messages to residents
      nextNotifId: 1,
      offsetMs: 0,                       // demo clock offset
      settings: { overdueMinutes: DEFAULT_OVERDUE_MIN },
      verifications: {},                 // userId -> code check passed, waiting for staff confirmation
      failStreak: 0                      // consecutive failed code checks
    };
  }

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  // Validate state read back from browser storage. Returns a clean state, or null if it is damaged.
  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.orders)) return null;
    var seenIds = {};
    var seenRefs = {};
    var maxId = 0;
    for (var i = 0; i < raw.orders.length; i++) {
      var o = raw.orders[i];
      if (!o || typeof o !== 'object') return null;
      if (!isInt(o.orderId) || o.orderId < 1 || seenIds[o.orderId]) return null;
      if (typeof o.orderReference !== 'string' || !o.orderReference) return null;
      if (seenRefs[o.orderReference.toLowerCase()]) return null;
      if (validUnits().indexOf(o.residentUnit) === -1) return null;
      if (o.status !== PENDING && o.status !== COLLECTED && o.status !== DISPOSED) return null;
      if (typeof o.collectionCode !== 'string' || !o.collectionCode) return null;
      if (typeof o.arrivalTime !== 'number' || !isFinite(o.arrivalTime)) return null;
      if (!Array.isArray(o.delegations)) return null;
      if (o.status === COLLECTED && (typeof o.collectionTime !== 'number' || !isFinite(o.collectionTime))) return null;
      if (o.status === DISPOSED && (typeof o.disposedTime !== 'number' || !isFinite(o.disposedTime))) return null;
      // Follow-up record is optional (orders saved before this feature do not have one). Only repair it if it is damaged.
      if (o.followUp != null && (typeof o.followUp !== 'object' || Array.isArray(o.followUp))) o.followUp = null;
      seenIds[o.orderId] = true;
      seenRefs[o.orderReference.toLowerCase()] = true;
      if (o.orderId > maxId) maxId = o.orderId;
    }
    var audit = Array.isArray(raw.audit) ? raw.audit.filter(function (e) { return e && typeof e === 'object' && isInt(e.logId); }) : [];
    var maxLog = audit.reduce(function (m, e) { return e.logId > m ? e.logId : m; }, 0);
    var tests = Array.isArray(raw.tests) ? raw.tests.filter(function (t) {
      return t && typeof t.participant === 'string' && (t.condition === 'with' || t.condition === 'without') && typeof t.seconds === 'number' && isFinite(t.seconds);
    }) : [];
    var byId = {};
    raw.orders.forEach(function (o) { byId[o.orderId] = o; });
    var notifs = [];
    var seenKeys = {};
    var maxNotif = 0;
    (Array.isArray(raw.notifications) ? raw.notifications : []).forEach(function (n) {
      if (!n || typeof n !== 'object' || !isInt(n.id) || typeof n.key !== 'string' || typeof n.type !== 'string') return;
      if (typeof n.createdAt !== 'number' || !isFinite(n.createdAt)) return;
      var ord = byId[n.orderId];
      if (!ord || ord.residentUnit !== n.unit) return;          // orphaned or mismatched: never shown to anyone
      if (seenKeys[n.key]) return;                               // never keep two copies of one notification
      seenKeys[n.key] = true;
      if (n.id > maxNotif) maxNotif = n.id;
      notifs.push(n);
    });
    var overdue = raw.settings && isInt(raw.settings.overdueMinutes) && raw.settings.overdueMinutes >= 1 && raw.settings.overdueMinutes <= 240
      ? raw.settings.overdueMinutes : DEFAULT_OVERDUE_MIN;
    return {
      orders: raw.orders,
      audit: audit,
      tests: tests,
      nextOrderId: Math.max(isInt(raw.nextOrderId) ? raw.nextOrderId : 1, maxId + 1),
      nextLogId: Math.max(isInt(raw.nextLogId) ? raw.nextLogId : 1, maxLog + 1),
      notifications: notifs,
      nextNotifId: Math.max(isInt(raw.nextNotifId) ? raw.nextNotifId : 1, maxNotif + 1),
      offsetMs: typeof raw.offsetMs === 'number' && isFinite(raw.offsetMs) ? raw.offsetMs : 0,
      settings: { overdueMinutes: overdue },
      verifications: raw.verifications && typeof raw.verifications === 'object' && !Array.isArray(raw.verifications) ? raw.verifications : {},
      failStreak: isInt(raw.failStreak) && raw.failStreak >= 0 ? raw.failStreak : 0
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Activity log (never records passwords or typed codes)
  // ---------------------------------------------------------------------------------------------
  function log(state, now, eventType, actor, orderReference, outcome, message) {
    var isSystem = actor === SYSTEM;
    var a = actor && !isSystem ? authActor(actor) : null;
    state.audit.unshift({
      logId: state.nextLogId++,
      eventType: eventType,
      actorUserId: a ? a.userId : null,
      actorRole: isSystem ? SYSTEM : a ? a.role : 'ANONYMOUS',
      actorName: isSystem ? 'system' : a ? a.username : null,
      orderReference: orderReference || null,
      timestamp: now,
      outcome: outcome,
      message: message
    });
    if (state.audit.length > LOG_LIMIT) state.audit.length = LOG_LIMIT;
  }

  function eventLabel(eventType) {
    var labels = {
      login: 'Login', login_failed: 'Login failed', logout: 'Logout',
      delivery_registered: 'Delivery registered', verify_success: 'Code verified',
      verify_failed: 'Invalid code attempt', collected: 'Collection successful',
      collect_failed: 'Collection failed', delegation_created: 'Collector authorised',
      access_denied: 'Access denied', demo_loaded: 'Demo data loaded', demo_reset: 'Demo reset',
      demo_clock: 'Demo clock moved', demo_threshold: 'Overdue limit changed',
      reminder_generated: 'Collection reminder generated', marked_overdue: 'Delivery marked overdue',
      followup_reminder: 'Follow-up: reminder sent', followup_contact: 'Follow-up: resident contacted',
      followup_holding: 'Follow-up: moved to holding area', disposed: 'Delivery disposed'
    };
    return labels[eventType] || eventType;
  }

  // Shared event categories keep operational activity distinct from demo/system controls.
  function eventCategory(eventType) {
    var categories = {
      delivery_registered: 'Deliveries',
      verify_success: 'Collection', verify_failed: 'Collection', collected: 'Collection',
      collect_failed: 'Collection', delegation_created: 'Collection',
      reminder_generated: 'Follow-up', marked_overdue: 'Follow-up',
      followup_reminder: 'Follow-up', followup_contact: 'Follow-up',
      followup_holding: 'Follow-up', disposed: 'Follow-up',
      login: 'Access and Security', login_failed: 'Access and Security',
      logout: 'Access and Security', access_denied: 'Access and Security',
      demo_loaded: 'System/Demo', demo_reset: 'System/Demo',
      demo_clock: 'System/Demo', demo_threshold: 'System/Demo'
    };
    return categories[eventType] || 'System/Demo';
  }

  function getActivityLog(state, actor, opts) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    opts = opts || {};
    var q = String(opts.query || '').trim().toLowerCase();
    var type = opts.type && opts.type !== 'all' ? opts.type : null;
    var category = opts.category && opts.category !== 'all' ? opts.category : null;
    var startTime = typeof opts.startTime === 'number' && isFinite(opts.startTime) ? opts.startTime : null;
    var endTime = typeof opts.endTime === 'number' && isFinite(opts.endTime) ? opts.endTime : null;
    var entries = state.audit.filter(function (e) {
      if (type && e.eventType !== type) return false;
      if (category && eventCategory(e.eventType) !== category) return false;
      if (startTime != null && e.timestamp < startTime) return false;
      if (endTime != null && e.timestamp > endTime) return false;
      if (!q) return true;
      return [e.eventType, eventLabel(e.eventType), eventCategory(e.eventType), e.actorUserId, e.actorRole, e.actorName,
        e.orderReference, e.outcome, e.message]
        .join(' ').toLowerCase().indexOf(q) !== -1;
    });
    // Newest first by the time the event happened (a reminder created later still sits at its own time).
    entries.sort(function (x, y) { return (y.timestamp - x.timestamp) || (y.logId - x.logId); });
    return { ok: true, entries: entries };
  }

  function recordAccessDenied(state, actor, route, now) {
    var r = String(route == null ? '' : route).slice(0, 60);
    log(state, now, 'access_denied', actor, null, 'DENIED', 'Blocked access to ' + r);
  }

  // ---------------------------------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------------------------------
  function login(state, username, password, now) {
    var u = String(username == null ? '' : username).trim();
    var p = String(password == null ? '' : password);
    if (!u || !p) return { ok: false, reason: 'missing_fields' };
    var acc = null;
    for (var i = 0; i < ACCOUNTS.length; i++) {
      if (ACCOUNTS[i].username.toLowerCase() === u.toLowerCase()) { acc = ACCOUNTS[i]; break; }
    }
    if (!acc || acc.password !== p) {
      log(state, now, 'login_failed', null, null, 'FAILURE', 'Failed login attempt');
      return { ok: false, reason: 'invalid_credentials' };
    }
    log(state, now, 'login', acc, null, 'SUCCESS', acc.displayName + ' logged in');
    return { ok: true, user: publicUser(acc) };
  }

  function logout(state, actor, now) {
    var a = authActor(actor);
    if (!a) return { ok: false, reason: 'not_authenticated' };
    log(state, now, 'logout', a, null, 'SUCCESS', a.displayName + ' logged out');
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------
  // Orders and codes
  // ---------------------------------------------------------------------------------------------
  function findOrder(state, orderId) {
    for (var i = 0; i < state.orders.length; i++) if (state.orders[i].orderId === orderId) return state.orders[i];
    return null;
  }

  function findOrderByRef(state, ref) {
    var r = String(ref).toLowerCase();
    for (var i = 0; i < state.orders.length; i++) if (state.orders[i].orderReference.toLowerCase() === r) return state.orders[i];
    return null;
  }

  // Codes are unique across every code ever issued (resident codes and delegate codes),
  // so a used code can never match a different order later.
  function generateCode(state, rng) {
    rng = rng || Math.random;
    var used = {};
    state.orders.forEach(function (o) {
      used[o.collectionCode] = true;
      o.delegations.forEach(function (d) { used[d.code] = true; });
    });
    for (var i = 0; i < 500; i++) {
      var c = String(Math.floor(rng() * CODE_SPAN) + CODE_MIN);
      if (!used[c]) return c;
    }
    throw new Error('No free code available');
  }

  function findByCode(state, code) {
    for (var i = 0; i < state.orders.length; i++) {
      var o = state.orders[i];
      if (o.collectionCode === code) return { order: o, via: 'resident', delegation: null };
      for (var j = 0; j < o.delegations.length; j++) {
        if (o.delegations[j].code === code) return { order: o, via: 'delegate', delegation: o.delegations[j] };
      }
    }
    return null;
  }

  function makeOrder(state, createdBy, ref, unit, note, arrival, rng) {
    var order = {
      orderId: state.nextOrderId,
      orderReference: ref,
      residentUnit: unit,
      arrivalTime: arrival,
      collectionCode: generateCode(state, rng),
      status: PENDING,
      collectionTime: null,
      deliveryNote: note,
      createdBy: createdBy,
      codeUsed: false,
      delegations: [],
      collectedBy: null,
      confirmedBy: null,
      disposedTime: null,
      disposedBy: null,
      followUp: null                     // created when staff first record a follow-up action
    };
    state.nextOrderId++;
    state.orders.push(order);
    return order;
  }

  // Staff only. Nothing is created unless every check passes.
  function registerDelivery(state, actor, input, now, rng) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    input = input || {};
    var unit = String(input.unit == null ? '' : input.unit).trim().toUpperCase();
    var ref = String(input.ref == null ? '' : input.ref).trim();
    var note = String(input.note == null ? '' : input.note).trim();
    if (!unit) return { ok: false, reason: 'unit_required' };
    if (validUnits().indexOf(unit) === -1) return { ok: false, reason: 'invalid_unit' };
    if (!ref) return { ok: false, reason: 'ref_required' };
    if (ref.length > 40) return { ok: false, reason: 'ref_too_long' };
    if (note.length > 140) return { ok: false, reason: 'note_too_long' };
    if (findOrderByRef(state, ref)) return { ok: false, reason: 'duplicate_ref' };
    var order = makeOrder(state, g.actor.userId, ref, unit, note, now, rng);
    log(state, now, 'delivery_registered', g.actor, ref, 'SUCCESS', 'Delivery ' + ref + ' registered for unit ' + unit);
    return { ok: true, order: order };
  }

  // ---------------------------------------------------------------------------------------------
  // Verify a code, then (separately) confirm the handoff
  // ---------------------------------------------------------------------------------------------
  // Why a delivery that is no longer pending cannot be acted on.
  function closedReason(order) { return order.status === DISPOSED ? 'already_disposed' : 'already_collected'; }

  function failVerify(state, actor, now, ref, reason, message) {
    state.failStreak = (state.failStreak || 0) + 1;
    log(state, now, 'verify_failed', actor, ref, 'FAILURE', message);
    return { ok: false, reason: reason, failStreak: state.failStreak };
  }

  function verifyCode(state, actor, code, now, expectedOrderId) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    if (!state.verifications) state.verifications = {};
    delete state.verifications[g.actor.userId];             // any new check cancels an earlier one

    var c = String(code == null ? '' : code).replace(/\s+/g, '');
    if (!c) return failVerify(state, g.actor, now, null, 'code_required', 'Code check with an empty code');

    var hit = findByCode(state, c);
    if (!hit) return failVerify(state, g.actor, now, null, 'code_not_found', 'Invalid collection code entered');

    var order = hit.order;
    if (order.status !== PENDING) {
      return failVerify(state, g.actor, now, order.orderReference, closedReason(order),
        'Code rejected: ' + order.orderReference + (order.status === DISPOSED ? ' was disposed of' : ' was already collected'));
    }
    if (hit.via === 'delegate') {
      if (hit.delegation.revoked) {
        return failVerify(state, g.actor, now, order.orderReference, 'delegation_cancelled',
          'Authorisation code rejected: cancelled by a newer authorisation');
      }
      if (hit.delegation.expiresAt <= now) {
        return failVerify(state, g.actor, now, order.orderReference, 'delegation_expired',
          'Authorisation code rejected: expired');
      }
    }
    if (expectedOrderId != null && expectedOrderId !== order.orderId) {
      return failVerify(state, g.actor, now, null, 'wrong_order',
        'Code rejected: it does not belong to the order being handed over');
    }

    state.verifications[g.actor.userId] = {
      orderId: order.orderId, code: c, via: hit.via,
      delegateName: hit.delegation ? hit.delegation.name : null, verifiedAt: now
    };
    state.failStreak = 0;
    log(state, now, 'verify_success', g.actor, order.orderReference, 'SUCCESS',
      'Code verified for ' + order.orderReference + (hit.via === 'delegate' ? ' (authorised collector)' : ''));
    return { ok: true, order: order, via: hit.via, delegateName: hit.delegation ? hit.delegation.name : null };
  }

  function cancelVerification(state, actor) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    if (state.verifications) delete state.verifications[g.actor.userId];
    return { ok: true };
  }

  function failCollect(state, actor, now, order, reason, message) {
    if (state.verifications) delete state.verifications[actor.userId];
    log(state, now, 'collect_failed', actor, order ? order.orderReference : null, 'FAILURE', message);
    return { ok: false, reason: reason };
  }

  // Needs a code check that passed for this staff member and this order. Typing a code is never enough.
  function completeCollection(state, actor, orderId, now) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    var v = state.verifications && state.verifications[g.actor.userId];
    if (!v || v.orderId !== orderId) return { ok: false, reason: 'not_verified' };

    var order = findOrder(state, orderId);
    if (!order) return failCollect(state, g.actor, now, null, 'not_found', 'Collection failed: order not found');
    if (order.status !== PENDING) {
      return failCollect(state, g.actor, now, order, closedReason(order),
        'Collection rejected: ' + order.orderReference + (order.status === DISPOSED ? ' was disposed of' : ' was already collected'));
    }
    if (v.via === 'delegate') {
      var d = null;
      for (var i = 0; i < order.delegations.length; i++) if (order.delegations[i].code === v.code) d = order.delegations[i];
      if (!d || d.revoked) return failCollect(state, g.actor, now, order, 'delegation_cancelled', 'Collection rejected: authorisation was cancelled');
      if (d.expiresAt <= now) return failCollect(state, g.actor, now, order, 'delegation_expired', 'Collection rejected: authorisation expired');
    } else if (order.collectionCode !== v.code) {
      return failCollect(state, g.actor, now, order, 'not_verified', 'Collection rejected: code check no longer valid');
    }

    // Commit: every change happens together.
    order.status = COLLECTED;
    order.collectionTime = now;
    order.codeUsed = true;
    order.collectedBy = v.via === 'delegate' ? v.delegateName + ' (authorised by unit ' + order.residentUnit + ')' : 'Resident of unit ' + order.residentUnit;
    order.confirmedBy = g.actor.userId;
    delete state.verifications[g.actor.userId];
    log(state, now, 'collected', g.actor, order.orderReference, 'SUCCESS', order.orderReference + ' collected by ' + order.collectedBy);
    return { ok: true, order: order };
  }

  // ---------------------------------------------------------------------------------------------
  // Resident: authorise someone else for a limited time
  // ---------------------------------------------------------------------------------------------
  function createDelegation(state, actor, orderId, name, minutes, now, rng) {
    var g = guard(actor, RESIDENT);
    if (g.fail) return g.fail;
    var order = findOrder(state, orderId);
    if (!order || order.residentUnit !== g.actor.unitNumber) return { ok: false, reason: 'not_found' };
    if (order.status !== PENDING) return { ok: false, reason: closedReason(order) };
    var n = String(name == null ? '' : name).trim();
    if (!n) return { ok: false, reason: 'name_required' };
    if (n.length > 40) return { ok: false, reason: 'name_too_long' };
    var m = Number(minutes);
    if (!isFinite(m) || Math.floor(m) !== m || m < MIN_DELEGATION_MIN || m > MAX_DELEGATION_MIN) return { ok: false, reason: 'bad_duration' };
    var d = { name: n, code: generateCode(state, rng), createdAt: now, expiresAt: now + m * 60000, revoked: false };
    order.delegations.forEach(function (x) { x.revoked = true; });   // a new authorisation cancels the old one
    order.delegations.push(d);
    log(state, now, 'delegation_created', g.actor, order.orderReference, 'SUCCESS', 'Unit ' + order.residentUnit + ' authorised ' + n + ' for ' + m + ' min');
    return { ok: true, delegation: d };
  }

  function activeDelegation(order, now) {
    for (var i = order.delegations.length - 1; i >= 0; i--) {
      var d = order.delegations[i];
      if (!d.revoked && d.expiresAt > now) return d;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Waiting time, queue, dashboards
  // ---------------------------------------------------------------------------------------------
  function waitingMinutes(order, now) {
    var end = now;
    if (order.status === COLLECTED && order.collectionTime != null) end = order.collectionTime;
    else if (order.status === DISPOSED && order.disposedTime != null) end = order.disposedTime;
    return Math.max(0, Math.floor((end - order.arrivalTime) / 60000));
  }

  // The collection deadline: arrival time plus the overdue limit.
  function deadlineTime(order, thresholdMin) { return order.arrivalTime + thresholdMin * 60000; }

  // THE one place that decides a delivery's status. PENDING means "Pending Collection".
  function deliveryStatus(order, now, thresholdMin) {
    if (order.status === COLLECTED) return COLLECTED;
    if (order.status === DISPOSED) return DISPOSED;
    return waitingMinutes(order, now) >= thresholdMin ? OVERDUE : PENDING;
  }

  function isOverdue(order, now, thresholdMin) {
    return deliveryStatus(order, now, thresholdMin) === OVERDUE;
  }

  // When the reminder is due, in minutes after arrival: two thirds of the way to the deadline
  // (20 of 30, 10 of 15). Null when the limit is too short to fit a reminder before it.
  function reminderMinutes(thresholdMin) {
    var m = Math.max(1, Math.floor(thresholdMin * 2 / 3));
    return m < thresholdMin ? m : null;
  }

  function summary(state, actor, now) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    var pending = 0, overdue = 0, collected = 0, disposed = 0;
    state.orders.forEach(function (o) {
      if (o.status === COLLECTED) collected++;
      else if (o.status === DISPOSED) disposed++;
      else { pending++; if (isOverdue(o, now, state.settings.overdueMinutes)) overdue++; }
    });
    // pending = everything still awaiting collection (overdue included); onTime = pending and not yet overdue
    return { ok: true, pending: pending, onTime: pending - overdue, overdue: overdue, collected: collected, disposed: disposed };
  }

  function closedAt(o) { return o.status === COLLECTED ? o.collectionTime : o.disposedTime; }

  // filter: 'pending' (default, includes overdue) | 'overdue' | 'collected' | 'disposed' | 'all'
  function queue(state, actor, opts, now) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    opts = opts || {};
    var filter = opts.filter || 'pending';
    var q = String(opts.query || '').trim().toLowerCase();
    var list = state.orders.filter(function (o) {
      if (filter === 'pending' && o.status !== PENDING) return false;
      if (filter === 'overdue' && !isOverdue(o, now, state.settings.overdueMinutes)) return false;
      if (filter === 'collected' && o.status !== COLLECTED) return false;
      if (filter === 'disposed' && o.status !== DISPOSED) return false;
      if (q && o.orderReference.toLowerCase().indexOf(q) === -1 && o.residentUnit.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      var ap = a.status === PENDING, bp = b.status === PENDING;
      if (ap !== bp) return ap ? -1 : 1;
      if (ap) return a.arrivalTime - b.arrivalTime;           // oldest waiting first
      return closedAt(b) - closedAt(a);                       // latest finished first
    });
    return { ok: true, orders: list };
  }

  // Residents only ever get orders for the unit on their own account.
  function residentOrders(state, actor) {
    var g = guard(actor, RESIDENT);
    if (g.fail) return g.fail;
    var mine = state.orders.filter(function (o) { return o.residentUnit === g.actor.unitNumber; });
    var pending = mine.filter(function (o) { return o.status === PENDING; }).sort(function (a, b) { return a.arrivalTime - b.arrivalTime; });
    var history = mine.filter(function (o) { return o.status !== PENDING; }).sort(function (a, b) { return closedAt(b) - closedAt(a); });
    return { ok: true, unit: g.actor.unitNumber, pending: pending, history: history };
  }

  // ---------------------------------------------------------------------------------------------
  // Simulated notifications. Nothing is really sent: these are messages shown on the resident's page.
  // ---------------------------------------------------------------------------------------------
  function addNotification(state, order, type, key, createdAt, dueAt) {
    var n = {
      id: state.nextNotifId++, key: key, orderId: order.orderId, orderReference: order.orderReference,
      unit: order.residentUnit, type: type, createdAt: createdAt, dueAt: dueAt == null ? null : dueAt
    };
    state.notifications.push(n);
    return n;
  }

  // Creates any reminder / overdue notification that is due at `now` and does not exist yet, and writes the
  // matching activity entries at the time they became due. Safe to call as often as you like: each
  // notification has a unique key (orderId:reminder, orderId:overdue), so nothing is ever created twice.
  // Only PENDING orders are looked at, so collected and disposed deliveries never get another one.
  // Returns how many notifications it created.
  function syncNotifications(state, now) {
    if (!Array.isArray(state.notifications)) state.notifications = [];
    if (!isInt(state.nextNotifId) || state.nextNotifId < 1) state.nextNotifId = 1;
    var limit = state.settings.overdueMinutes;
    var remAt = reminderMinutes(limit);
    var keys = {};
    state.notifications.forEach(function (n) { keys[n.key] = true; });
    var created = 0;
    state.orders.forEach(function (o) {
      if (o.status !== PENDING) return;
      var waited = waitingMinutes(o, now);
      var due = deadlineTime(o, limit);
      var rKey = o.orderId + ':reminder';
      var oKey = o.orderId + ':overdue';
      if (remAt != null && waited >= remAt && !keys[rKey] && !keys[oKey]) {
        var rAt = o.arrivalTime + remAt * 60000;
        addNotification(state, o, 'reminder', rKey, rAt, due);
        keys[rKey] = true; created++;
        log(state, rAt, 'reminder_generated', SYSTEM, o.orderReference, 'SUCCESS',
          'Collection reminder generated for unit ' + o.residentUnit + ' (' + o.orderReference + ')');
      }
      if (waited >= limit && !keys[oKey]) {
        addNotification(state, o, 'overdue', oKey, due, due);
        keys[oKey] = true; created++;
        log(state, due, 'marked_overdue', SYSTEM, o.orderReference, 'SUCCESS',
          o.orderReference + ' marked overdue; overdue notification generated for unit ' + o.residentUnit);
      }
    });
    return created;
  }

  // A resident only ever gets the notifications for the unit on their own account. Reminders and overdue
  // notices are shown only while the delivery is still waiting; a disposal notice stays visible.
  function residentNotifications(state, actor) {
    var g = guard(actor, RESIDENT);
    if (g.fail) return g.fail;
    var list = (state.notifications || []).filter(function (n) {
      if (n.unit !== g.actor.unitNumber) return false;
      var o = findOrder(state, n.orderId);
      if (!o || o.residentUnit !== n.unit) return false;
      return n.type === 'disposed' ? o.status === DISPOSED : o.status === PENDING;
    });
    list.sort(function (a, b) { return (b.createdAt - a.createdAt) || (b.id - a.id); });
    return { ok: true, unit: g.actor.unitNumber, notifications: list };
  }

  // ---------------------------------------------------------------------------------------------
  // Staff follow-up on overdue deliveries (staff only; every action is recorded in the activity log)
  // ---------------------------------------------------------------------------------------------
  function overdueTarget(state, actor, orderId, now) {
    var g = guard(actor, STAFF);
    if (g.fail) return { fail: g.fail };
    var order = findOrder(state, orderId);
    if (!order) return { fail: { ok: false, reason: 'not_found' } };
    if (order.status === COLLECTED) return { fail: { ok: false, reason: 'already_collected' } };
    if (order.status === DISPOSED) return { fail: { ok: false, reason: 'already_disposed' } };
    if (!isOverdue(order, now, state.settings.overdueMinutes)) return { fail: { ok: false, reason: 'not_overdue' } };
    return { actor: g.actor, order: order };
  }

  function ensureFollowUp(order) {
    if (!order.followUp) order.followUp = { reminders: 0, lastReminderAt: null, contacts: 0, lastContactAt: null, heldAt: null };
    return order.followUp;
  }

  // Read-only view of what staff have already done for a delivery.
  function followUpInfo(order) {
    var f = order.followUp || {};
    return {
      reminders: f.reminders || 0, lastReminderAt: f.lastReminderAt || null,
      contacts: f.contacts || 0, lastContactAt: f.lastContactAt || null,
      heldAt: f.heldAt || null
    };
  }

  function sendStaffReminder(state, actor, orderId, now) {
    var t = overdueTarget(state, actor, orderId, now);
    if (t.fail) return t.fail;
    var o = t.order;
    var f = followUpInfo(o);
    if (f.lastReminderAt != null && now - f.lastReminderAt < FOLLOWUP_GAP_MIN * 60000) {
      return { ok: false, reason: 'reminder_too_soon', lastAt: f.lastReminderAt, retryAt: f.lastReminderAt + FOLLOWUP_GAP_MIN * 60000 };
    }
    var fu = ensureFollowUp(o);
    fu.reminders = f.reminders + 1;
    fu.lastReminderAt = now;
    var n = addNotification(state, o, 'staff_reminder', o.orderId + ':staff:' + fu.reminders, now, null);
    log(state, now, 'followup_reminder', t.actor, o.orderReference, 'SUCCESS',
      'Staff sent reminder #' + fu.reminders + ' to unit ' + o.residentUnit + ' for ' + o.orderReference);
    return { ok: true, order: o, notification: n };
  }

  function recordContact(state, actor, orderId, now) {
    var t = overdueTarget(state, actor, orderId, now);
    if (t.fail) return t.fail;
    var o = t.order;
    var f = followUpInfo(o);
    if (f.lastContactAt != null && now - f.lastContactAt < FOLLOWUP_GAP_MIN * 60000) {
      return { ok: false, reason: 'contact_too_soon', lastAt: f.lastContactAt, retryAt: f.lastContactAt + FOLLOWUP_GAP_MIN * 60000 };
    }
    var fu = ensureFollowUp(o);
    fu.contacts = f.contacts + 1;
    fu.lastContactAt = now;
    log(state, now, 'followup_contact', t.actor, o.orderReference, 'SUCCESS',
      'Staff contacted unit ' + o.residentUnit + ' about ' + o.orderReference + ' (contact #' + fu.contacts + ')');
    return { ok: true, order: o };
  }

  function recordHolding(state, actor, orderId, now) {
    var t = overdueTarget(state, actor, orderId, now);
    if (t.fail) return t.fail;
    var o = t.order;
    if (followUpInfo(o).heldAt != null) return { ok: false, reason: 'already_in_holding', lastAt: followUpInfo(o).heldAt };
    ensureFollowUp(o).heldAt = now;
    log(state, now, 'followup_holding', t.actor, o.orderReference, 'SUCCESS',
      o.orderReference + ' (unit ' + o.residentUnit + ') moved to the holding area');
    return { ok: true, order: o };
  }

  // Staff only, overdue deliveries only, and only when staff choose to. Nothing is ever disposed of by a timer.
  function disposeDelivery(state, actor, orderId, now) {
    var t = overdueTarget(state, actor, orderId, now);
    if (t.fail) return t.fail;
    var o = t.order;
    o.status = DISPOSED;
    o.disposedTime = now;
    o.disposedBy = t.actor.userId;
    Object.keys(state.verifications || {}).forEach(function (uid) {     // a half-finished code check can no longer complete
      if (state.verifications[uid].orderId === o.orderId) delete state.verifications[uid];
    });
    addNotification(state, o, 'disposed', o.orderId + ':disposed', now, null);
    log(state, now, 'disposed', t.actor, o.orderReference, 'SUCCESS',
      o.orderReference + ' (unit ' + o.residentUnit + ') marked as disposed by ' + t.actor.username);
    return { ok: true, order: o };
  }

  // ---------------------------------------------------------------------------------------------
  // Usability test log (staff only; for the team's before/after evidence)
  // ---------------------------------------------------------------------------------------------
  function addTest(state, actor, input) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    input = input || {};
    var participant = String(input.participant || '').trim();
    if (!participant) return { ok: false, reason: 'participant_required' };
    var seconds = Number(input.seconds);
    if (!isFinite(seconds) || seconds < 0) return { ok: false, reason: 'bad_seconds' };
    var row = { participant: participant, condition: input.condition === 'with' ? 'with' : 'without', correct: !!input.correct, seconds: seconds };
    state.tests.push(row);
    return { ok: true, row: row };
  }

  function clearTests(state, actor) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    state.tests = [];
    return { ok: true };
  }

  function testSummary(state) {
    function summarise(cond) {
      var rows = state.tests.filter(function (t) { return t.condition === cond; });
      var correct = rows.filter(function (t) { return t.correct; }).length;
      var total = rows.reduce(function (s, t) { return s + t.seconds; }, 0);
      return {
        n: rows.length,
        correct: correct,
        correctPct: rows.length ? Math.round((correct / rows.length) * 100) : null,
        avgSeconds: rows.length ? Math.round((total / rows.length) * 10) / 10 : null
      };
    }
    return { without: summarise('without'), with: summarise('with') };
  }

  function csvCell(v) {
    v = String(v);
    if (/^[=+\-@]/.test(v)) v = "'" + v;                       // stop spreadsheets running it as a formula
    if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function testsToCsv(state) {
    var lines = ['participant,condition,correct_handoff,seconds'];
    state.tests.forEach(function (t) {
      lines.push([csvCell(t.participant), t.condition, t.correct ? 'yes' : 'no', t.seconds].join(','));
    });
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------------------------
  // Demonstration tools
  // ---------------------------------------------------------------------------------------------
  function resetOrdersAndLog(state) {
    state.orders = [];
    state.audit = [];
    state.nextOrderId = 1;
    state.nextLogId = 1;
    state.notifications = [];
    state.nextNotifId = 1;
    state.verifications = {};
    state.failStreak = 0;
  }

  // Sample dataset. `actor` may be null for the automatic first-visit seed.
  function seed(state, actor, now, rng) {
    var t = now - (state.offsetMs || 0);       // real time; also resets the demo clock
    state.offsetMs = 0;
    resetOrdersAndLog(state);
    var staff = ACCOUNTS[0];
    var MIN = 60000;

    var o0 = makeOrder(state, staff.userId, 'FS-0999', 'A-12-03', 'Left at counter', t - 55 * MIN, rng);
    log(state, o0.arrivalTime, 'delivery_registered', staff, o0.orderReference, 'SUCCESS', 'Delivery FS-0999 registered for unit A-12-03');
    o0.status = COLLECTED;
    o0.collectionTime = t - 40 * MIN;
    o0.codeUsed = true;
    o0.collectedBy = 'Resident of unit A-12-03';
    o0.confirmedBy = staff.userId;
    log(state, o0.collectionTime, 'collected', staff, o0.orderReference, 'SUCCESS', 'FS-0999 collected by Resident of unit A-12-03');

    [['FS-1001', 'A-12-03', 'Left at counter', 18], ['FS-1002', 'A-12-05', '', 12], ['FS-1003', 'A-12-03', 'Cold drink', 4]].forEach(function (d) {
      var o = makeOrder(state, staff.userId, d[0], d[1], d[2], t - d[3] * MIN, rng);
      log(state, o.arrivalTime, 'delivery_registered', staff, o.orderReference, 'SUCCESS', 'Delivery ' + d[0] + ' registered for unit ' + d[1]);
    });
    syncNotifications(state, t);              // reminders and overdue notices that are already due in the sample data
    log(state, t, 'demo_loaded', actor, null, 'SUCCESS', 'Sample demo data loaded');
  }

  function loadDemo(state, actor, now, rng) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    seed(state, g.actor, now, rng);
    return { ok: true };
  }

  // Reset = no orders, no activity log, demo clock back to real time, overdue limit back to 15 min.
  // Demo accounts and saved test results are NOT touched.
  function resetDemo(state, actor, now) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    var t = now - (state.offsetMs || 0);
    resetOrdersAndLog(state);
    state.offsetMs = 0;
    state.settings.overdueMinutes = DEFAULT_OVERDUE_MIN;
    log(state, t, 'demo_reset', g.actor, null, 'SUCCESS', 'Demo data reset');
    return { ok: true };
  }

  function advanceClock(state, actor, minutes, now) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    var m = Number(minutes);
    if (!isFinite(m) || Math.floor(m) !== m || m < 1 || m > 600) return { ok: false, reason: 'bad_minutes' };
    state.offsetMs = (state.offsetMs || 0) + m * 60000;
    log(state, now + m * 60000, 'demo_clock', g.actor, null, 'SUCCESS', 'Demo clock moved ahead ' + m + ' min');
    syncNotifications(state, now + m * 60000);
    return { ok: true };
  }

  function setOverdueMinutes(state, actor, minutes, now) {
    var g = guard(actor, STAFF);
    if (g.fail) return g.fail;
    var m = Number(minutes);
    if (!isFinite(m) || Math.floor(m) !== m || m < 1 || m > 240) return { ok: false, reason: 'bad_minutes' };
    state.settings.overdueMinutes = m;
    log(state, now, 'demo_threshold', g.actor, null, 'SUCCESS', 'Overdue limit set to ' + m + ' min');
    syncNotifications(state, now);
    return { ok: true };
  }

  return {
    STAFF: STAFF, RESIDENT: RESIDENT, PENDING: PENDING, COLLECTED: COLLECTED, DISPOSED: DISPOSED, OVERDUE: OVERDUE,
    STATUS_LABELS: STATUS_LABELS, FOLLOWUP_GAP_MIN: FOLLOWUP_GAP_MIN,
    DEFAULT_OVERDUE_MIN: DEFAULT_OVERDUE_MIN,
    demoLogins: demoLogins, validUnits: validUnits, residentDirectory: residentDirectory, accountProblems: accountProblems, getUserById: getUserById,
    newState: newState, normalizeState: normalizeState, seed: seed,
    login: login, logout: logout, recordAccessDenied: recordAccessDenied,
    registerDelivery: registerDelivery, verifyCode: verifyCode, cancelVerification: cancelVerification,
    completeCollection: completeCollection, createDelegation: createDelegation, activeDelegation: activeDelegation,
    waitingMinutes: waitingMinutes, isOverdue: isOverdue, deliveryStatus: deliveryStatus, deadlineTime: deadlineTime,
    reminderMinutes: reminderMinutes, summary: summary, queue: queue,
    syncNotifications: syncNotifications, residentNotifications: residentNotifications,
    sendStaffReminder: sendStaffReminder, recordContact: recordContact, recordHolding: recordHolding,
    disposeDelivery: disposeDelivery, followUpInfo: followUpInfo,
    residentOrders: residentOrders, getActivityLog: getActivityLog, eventCategory: eventCategory, eventLabel: eventLabel, findOrder: findOrder,
    addTest: addTest, clearTests: clearTests, testSummary: testSummary, testsToCsv: testsToCsv,
    loadDemo: loadDemo, resetDemo: resetDemo, advanceClock: advanceClock, setOverdueMinutes: setOverdueMinutes
  };
});
