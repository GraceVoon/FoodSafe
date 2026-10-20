/*
 * FoodSafe - handoff logic (no UI, no network).
 * Works in the browser (window.FoodSafe) and in Node (require) so it can be tested.
 * All functions take `now` (ms since epoch) so time can be simulated in the demo and in tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FoodSafe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_ATTEMPTS = 3;
  var MIN_DELEGATION_MIN = 5;
  var MAX_DELEGATION_MIN = 240;

  function newState() {
    return {
      orders: [],
      audit: [],
      tests: [],
      nextId: 1,
      offsetMs: 0, // simulated clock offset for the demo
      settings: { overdueMinutes: 15, delegationMinutes: 30 }
    };
  }

  function log(state, now, type, text, orderId) {
    state.audit.unshift({ at: now, type: type, text: text, orderId: orderId || null });
    if (state.audit.length > 200) state.audit.length = 200;
  }

  function randomCode(rng) {
    rng = rng || Math.random;
    return String(Math.floor(rng() * 9000) + 1000);
  }

  // A code must be unique among all codes that can still be used right now.
  function uniqueCode(state, rng) {
    var used = {};
    state.orders.forEach(function (o) {
      if (o.status !== 'waiting') return;
      used[o.code] = true;
      (o.delegations || []).forEach(function (d) { used[d.code] = true; });
    });
    for (var i = 0; i < 200; i++) {
      var c = randomCode(rng);
      if (!used[c]) return c;
    }
    throw new Error('Could not generate a free code');
  }

  function normUnit(u) {
    return String(u == null ? '' : u).trim().toUpperCase();
  }

  function findOrder(state, orderId) {
    for (var i = 0; i < state.orders.length; i++) {
      if (state.orders[i].id === orderId) return state.orders[i];
    }
    return null;
  }

  // ---- Staff: register a delivery that arrived at the shared waiting area ----
  function registerOrder(state, input, now, rng) {
    var unit = normUnit(input && input.unit);
    if (!unit) return { ok: false, reason: 'unit_required' };
    var order = {
      id: state.nextId++,
      unit: unit,
      platform: (input.platform || 'Other').trim() || 'Other',
      ref: String(input.ref || '').trim(),
      arrivedAt: now,
      code: uniqueCode(state, rng),
      status: 'waiting',
      attempts: 0,
      locked: false,
      delegations: [],
      collectedAt: null,
      collectedBy: null
    };
    state.orders.push(order);
    log(state, now, 'registered', 'Food for ' + unit + ' (' + order.platform + ') logged at waiting area', order.id);
    return { ok: true, order: order };
  }

  // ---- Resident: authorise someone else for a limited time ----
  function createDelegation(state, orderId, name, minutes, now, rng) {
    var order = findOrder(state, orderId);
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== 'waiting') return { ok: false, reason: 'already_collected' };
    name = String(name || '').trim();
    if (!name) return { ok: false, reason: 'name_required' };
    minutes = Number(minutes);
    if (!isFinite(minutes) || minutes < MIN_DELEGATION_MIN || minutes > MAX_DELEGATION_MIN) {
      return { ok: false, reason: 'bad_duration' };
    }
    // Only one active delegation at a time: a new one cancels the old one.
    order.delegations.forEach(function (d) { d.revoked = true; });
    var d = { name: name, code: uniqueCode(state, rng), createdAt: now, expiresAt: now + minutes * 60000, revoked: false };
    order.delegations.push(d);
    log(state, now, 'delegated', order.unit + ' authorised ' + name + ' for ' + minutes + ' min', order.id);
    return { ok: true, delegation: d };
  }

  function activeDelegation(order, now) {
    for (var i = order.delegations.length - 1; i >= 0; i--) {
      var d = order.delegations[i];
      if (!d.revoked && d.expiresAt > now) return d;
    }
    return null;
  }

  // ---- Staff: verify the code before handing the food over ----
  function verifyCollection(state, orderId, code, now) {
    var order = findOrder(state, orderId);
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status === 'collected') return { ok: false, reason: 'already_collected', order: order };
    if (order.locked) return { ok: false, reason: 'locked', order: order };

    code = String(code == null ? '' : code).trim();

    if (code && code === order.code) {
      order.status = 'collected';
      order.collectedAt = now;
      order.collectedBy = 'Resident (unit ' + order.unit + ')';
      log(state, now, 'collected', 'Food for ' + order.unit + ' collected by resident', order.id);
      return { ok: true, order: order, by: 'resident' };
    }

    for (var i = 0; i < order.delegations.length; i++) {
      var d = order.delegations[i];
      if (code && code === d.code) {
        if (d.revoked) return failAttempt(state, order, now, 'delegation_cancelled');
        if (d.expiresAt <= now) return failAttempt(state, order, now, 'delegation_expired');
        order.status = 'collected';
        order.collectedAt = now;
        order.collectedBy = d.name + ' (authorised by unit ' + order.unit + ')';
        log(state, now, 'collected', 'Food for ' + order.unit + ' collected by ' + d.name + ' (authorised)', order.id);
        return { ok: true, order: order, by: 'delegate', delegateName: d.name };
      }
    }

    return failAttempt(state, order, now, 'wrong_code');
  }

  function failAttempt(state, order, now, reason) {
    order.attempts += 1;
    var left = Math.max(0, MAX_ATTEMPTS - order.attempts);
    if (order.attempts >= MAX_ATTEMPTS) {
      order.locked = true;
      log(state, now, 'locked', 'Order for ' + order.unit + ' locked after ' + MAX_ATTEMPTS + ' failed code attempts', order.id);
    } else {
      log(state, now, 'failed', 'Failed code attempt for ' + order.unit + ' (' + reason + ')', order.id);
    }
    return { ok: false, reason: reason, attemptsLeft: left, locked: order.locked, order: order };
  }

  // Staff checks the person's identity/unit some other way, then unlocks.
  function unlockOrder(state, orderId, now) {
    var order = findOrder(state, orderId);
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== 'waiting') return { ok: false, reason: 'already_collected' };
    order.locked = false;
    order.attempts = 0;
    log(state, now, 'unlocked', 'Order for ' + order.unit + ' unlocked by staff after manual check', order.id);
    return { ok: true, order: order };
  }

  // ---- Waiting time and alerts ----
  function waitingMinutes(order, now) {
    var end = order.status === 'collected' && order.collectedAt ? order.collectedAt : now;
    return Math.max(0, Math.floor((end - order.arrivedAt) / 60000));
  }

  function isOverdue(order, now, thresholdMin) {
    return order.status === 'waiting' && waitingMinutes(order, now) >= thresholdMin;
  }

  function overdueOrders(state, now) {
    return state.orders.filter(function (o) {
      return isOverdue(o, now, state.settings.overdueMinutes);
    });
  }

  // ---- Usability test log (for the before/after evidence) ----
  function addTest(state, input) {
    var participant = String(input && input.participant || '').trim();
    if (!participant) return { ok: false, reason: 'participant_required' };
    var condition = input.condition === 'with' ? 'with' : 'without';
    var seconds = Number(input.seconds);
    if (!isFinite(seconds) || seconds < 0) return { ok: false, reason: 'bad_seconds' };
    var row = { participant: participant, condition: condition, correct: !!input.correct, seconds: seconds };
    state.tests.push(row);
    return { ok: true, row: row };
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

  function testsToCsv(state) {
    var lines = ['participant,condition,correct_handoff,seconds'];
    state.tests.forEach(function (t) {
      lines.push([csvCell(t.participant), t.condition, t.correct ? 'yes' : 'no', t.seconds].join(','));
    });
    return lines.join('\n');
  }

  function csvCell(v) {
    v = String(v);
    // Quote cells with commas/quotes/newlines; also defuse spreadsheet formulas.
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  // ---- Demo data (clearly simulated) ----
  function loadDemo(state, now, rng) {
    state.orders = [];
    state.audit = [];
    state.nextId = 1;
    var minutesAgo = [4, 12, 18];
    var demo = [
      { unit: 'A-12-03', platform: 'GrabFood', ref: 'GF-4821' },
      { unit: 'B-05-11', platform: 'foodpanda', ref: 'FP-9034' },
      { unit: 'A-08-02', platform: 'GrabFood', ref: 'GF-4790' }
    ];
    demo.forEach(function (d, i) {
      registerOrder(state, d, now - minutesAgo[i] * 60000, rng);
    });
    // Keep the audit order chronological for the demo (oldest registered first -> newest on top).
    state.audit.reverse();
    return state;
  }

  return {
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    newState: newState,
    registerOrder: registerOrder,
    createDelegation: createDelegation,
    activeDelegation: activeDelegation,
    verifyCollection: verifyCollection,
    unlockOrder: unlockOrder,
    waitingMinutes: waitingMinutes,
    isOverdue: isOverdue,
    overdueOrders: overdueOrders,
    findOrder: findOrder,
    addTest: addTest,
    testSummary: testSummary,
    testsToCsv: testsToCsv,
    loadDemo: loadDemo,
    normUnit: normUnit
  };
});
