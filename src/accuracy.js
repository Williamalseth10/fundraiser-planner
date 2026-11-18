// A dated forecast and its eventual result use the same four accounting categories.
// All comparisons are in integer cents, with equal weight per completed event.
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.BFEngine;
  const categories = ['ticketSales', 'sponsorship', 'other', 'costs'];
  const cents = (n) => Math.round(n * 100);
  const amount = (n) => typeof n === 'number' && Number.isFinite(n) &&
    Math.abs(n) <= Math.floor(Number.MAX_SAFE_INTEGER / 400) && Number(n.toFixed(2)) === n;
  const empty = (v) => v == null || v === '';
  const object = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const validPart = (key, n) => amount(n) && (key === 'other' || n >= 0);
  const id = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
  const named = (v) => typeof v === 'string' && !!v.trim() && v.length <= 160;

  function combined(parts) {
    if (!object(parts) || !categories.every((key) => validPart(key, parts[key]))) return null;
    const net = (cents(parts.ticketSales) + cents(parts.sponsorship) + cents(parts.other) - cents(parts.costs)) / 100;
    return amount(net) ? net : null;
  }

  // Components use exactly the likely projection underlying the club decision brief.
  function breakdown(plan, option, likely) {
    if (!likely || likely.issue || !amount(likely.net)) return null;
    const row = E.project(option, likely.participants, E.scenarioContext(plan, option, 'middle'));
    const parts = {
      ticketSales: row.revenue.registration, sponsorship: row.revenue.sponsorshipCash,
      other: (cents(row.revenue.extras) + cents(row.revenue.other)) / 100, costs: row.expenses.total,
    };
    return combined(parts) === likely.net ? parts : null;
  }

  function actual(record) {
    const fromParts = combined(record.actualAmounts);
    const stated = amount(record.actualNet) ? record.actualNet : null;
    const conflict = stated != null && fromParts != null && cents(stated) !== cents(fromParts);
    return { net: conflict ? null : stated ?? fromParts, fromParts, conflict };
  }

  function validDraft(draft) {
    return object(draft) && (empty(draft.eventDate) || E.isCalendarDate(draft.eventDate)) &&
      (empty(draft.boardNet) || amount(draft.boardNet)) &&
      (draft.preDecision == null || typeof draft.preDecision === 'boolean') &&
      (empty(draft.priorId) || id(draft.priorId));
  }

  function validRecord(record) {
    const f = record.forecast, a = record.actualAmounts;
    if (record.fromPriorPlan != null && typeof record.fromPriorPlan !== 'boolean') return false;
    if (a != null && (!object(a) || !categories.every((k) => empty(a[k]) || validPart(k, a[k])))) return false;
    if (!empty(record.finalizedOn) && (!E.isCalendarDate(record.finalizedOn) || !E.isCalendarDate(record.eventDate) ||
        record.finalizedOn < record.eventDate || !record.source || !record.source.trim() || actual(record).net == null)) return false;
    if (f == null) return true;
    if (!object(f) || !record.captured || !E.isCalendarDate(record.estimatedOn) ||
        combined(f.amounts) == null || combined(f.amounts) !== record.estimatedNet ||
        typeof f.eventName !== 'string' || f.eventName.length > 160 || typeof f.preDecision !== 'boolean' || !(f.boardNet === null || amount(f.boardNet)) ||
        !(f.eventDate === null || E.isCalendarDate(f.eventDate)) ||
        (f.preDecision && (!f.eventDate || f.eventDate <= record.estimatedOn || f.eventDate !== record.eventDate ||
          !named(f.eventName) || f.eventName !== record.name))) return false;
    const b = f.prior;
    return b === null || (object(b) && id(b.id) && b.id !== record.id && b.kind === record.kind && named(b.name) &&
      E.isCalendarDate(b.eventDate) && E.isCalendarDate(b.finalizedOn) && b.eventDate <= b.finalizedOn &&
      b.finalizedOn <= record.estimatedOn && b.eventDate < record.estimatedOn && amount(b.net));
  }

  function complete(record, today) {
    return !record.fictional && E.isCalendarDate(record.eventDate) && E.isCalendarDate(record.finalizedOn) &&
      record.eventDate <= record.finalizedOn && record.finalizedOn <= today && E.isCalendarDate(today) &&
      typeof record.source === 'string' && !!record.source.trim() && actual(record).net != null;
  }

  // An option can be renamed or removed later. The occurrence stays identified by its
  // frozen club event name and day, independent of the option or its current format.
  const eventKey = (r) => named(r.name) && E.isCalendarDate(r.eventDate)
    ? r.eventDate + '/' + r.name.trim().toLowerCase().replace(/\s+/g, ' ') : null;

  // Only finished, named events can compete for an occurrence. The board may save
  // several alternatives under one event name before selecting which one to run.
  function completedOccurrences(records, today) {
    const counts = new Map();
    for (const r of records) {
      const key = eventKey(r);
      if (key && complete(r, today) && validRecord(r)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function priorOptions(history, kind, capturedOn) {
    const counts = completedOccurrences(history, capturedOn);
    return history.filter((r) => r.kind === kind && r.eventDate < capturedOn && complete(r, capturedOn) && validRecord(r) &&
      counts.get(eventKey(r)) === 1).sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  }

  function snapshot(plan, option, likely, draft, today) {
    if (!validDraft(draft) || !E.isCalendarDate(today)) return { issue: 'draft' };
    const amounts = breakdown(plan, option, likely);
    if (!amounts) return { issue: 'amounts' };
    const eventName = String(plan.eventName || option.name || '').trim().slice(0, 160);
    if (draft.preDecision && (!draft.eventDate || draft.eventDate <= today || !eventName)) return { issue: 'date' };
    const history = plan.research && plan.research.clubHistory || [];
    let prior = null;
    if (draft.priorId) {
      const earlier = priorOptions(history, option.kind || 'generic', today).find((r) => r.id === draft.priorId);
      if (!earlier || plan.isDemo) return { issue: 'prior' };
      prior = { id: earlier.id, kind: earlier.kind, name: earlier.name, eventDate: earlier.eventDate,
        finalizedOn: earlier.finalizedOn, net: actual(earlier).net };
    }
    return { forecast: { eventName, eventDate: draft.eventDate || null, preDecision: !!draft.preDecision,
      boardNet: empty(draft.boardNet) ? null : draft.boardNet, prior, amounts } };
  }

  function score(history, today, fictionalPlan) {
    const counts = completedOccurrences(history, today);
    const sums = { planner: 0n, board: 0n, prior: 0n };
    const high = { planner: 0, board: 0, prior: 0 };
    let measured = 0, matched = 0, plannerSum = 0n, plannerHigh = 0, duplicate = 0;
    for (const r of fictionalPlan ? [] : history) {
      if (!r.forecast || !r.forecast.preDecision || !complete(r, today) || !validRecord(r)) continue;
      if (counts.get(eventKey(r)) !== 1) { duplicate++; continue; }
      const net = actual(r).net, diff = cents(r.estimatedNet) - cents(net);
      measured++; plannerSum += BigInt(Math.abs(diff)); if (diff > 0) plannerHigh++;
      if (!amount(r.forecast.boardNet) || !r.forecast.prior) continue;
      matched++;
      const estimates = { planner: r.estimatedNet, board: r.forecast.boardNet, prior: r.forecast.prior.net };
      for (const [method, estimate] of Object.entries(estimates)) {
        const gap = cents(estimate) - cents(net);
        sums[method] += BigInt(Math.abs(gap));
        if (gap > 0) high[method]++;
      }
    }
    const mean = (sum, n) => n ? Number((sum + BigInt(Math.floor(n / 2))) / BigInt(n)) / 100 : null;
    const metrics = (sum, count, over) => ({ count, meanAbsoluteMiss: mean(sum, count), overestimates: over });
    return { planner: metrics(plannerSum, measured, plannerHigh), matched, duplicate,
      methods: Object.fromEntries(Object.keys(sums).map((k) => [k, metrics(sums[k], matched, high[k])])) };
  }

  function carryForward(sourcePlan, targetPlan, today) {
    if (sourcePlan.isDemo || targetPlan.isDemo) return [];
    const source = sourcePlan.research && sourcePlan.research.clubHistory || [];
    const dest = targetPlan.research || {};
    // An import only appends. Reserve every existing id and every finalized event,
    // including a ledger dated ahead of this device. Keep other proposals intact.
    const keys = new Set((dest.clubHistory || []).filter((r) => r.finalizedOn && !r.fictional).map(eventKey));
    const ids = new Set(['audiences', 'comparables', 'links', 'clubHistory'].flatMap((k) => (dest[k] || []).map((r) => r.id)));
    const occurrences = completedOccurrences(source, today);
    return source.filter((r) => complete(r, today) && validRecord(r) && occurrences.get(eventKey(r)) === 1 &&
      !keys.has(eventKey(r)) && !ids.has(r.id)).map((r) => ({ ...r, fromPriorPlan: true }));
  }

  function differences(r) {
    const rows = {};
    for (const k of categories) {
      const result = r.actualAmounts && r.actualAmounts[k];
      const estimate = r.forecast && r.forecast.amounts[k];
      rows[k] = validPart(k, result) && validPart(k, estimate) ? (cents(result) - cents(estimate)) / 100 : null;
    }
    return rows;
  }
  const api = { categories, amount, actual, combined, breakdown, validDraft, validRecord, priorOptions, snapshot, score, differences, carryForward };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFAccuracy = api;
})(typeof window !== 'undefined' ? window : globalThis);
