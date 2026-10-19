/*
 * Booster Fundraiser Planner — deterministic financial engine.
 *
 * Pure functions only: no DOM, no randomness, no network, no AI.
 * All money is handled internally in integer cents to avoid floating-point drift,
 * and returned in dollars rounded to the cent.
 *
 * Works in the browser (window.BFEngine) and in Node (require('./engine.js')).
 */
(function (root) {
  'use strict';

  const SPONSOR_STATUSES = ['collected', 'committed', 'hoped'];

  const c = (dollars) => Math.round((Number(dollars) || 0) * 100); // to cents
  const d = (cents) => Math.round(cents) / 100;                    // to dollars
  const nonNeg = (x) => Math.max(0, Number(x) || 0);
  const int = (x) => Math.max(0, Math.floor(Number(x) || 0));

  /** Step between feasible participant counts (1, or group size when whole groups are required). */
  function participantStep(option) {
    const g = int(option.groupSize) || 1;
    return option.wholeGroupsOnly && g > 1 ? g : 1;
  }

  /** Largest feasible participant count (capacity rounded down to whole groups if required). */
  function maxFeasible(option) {
    const cap = int(option.capacity);
    const step = participantStep(option);
    return Math.floor(cap / step) * step;
  }

  /** Every participant count the organizer could actually end up with: 0, step, 2*step ... maxFeasible. */
  function feasibleCounts(option) {
    const out = [];
    const step = participantStep(option);
    const max = maxFeasible(option);
    for (let n = 0; n <= max; n += step) out.push(n);
    return out;
  }

  /**
   * Turn a requested participant count into a feasible one, and say what was changed.
   * Never rounds up: rounding up would invent participants.
   */
  function normalizeParticipants(option, requested) {
    const raw = Number(requested) || 0;
    const flags = [];
    let n = Math.max(0, Math.floor(raw));
    if (raw < 0) flags.push('negative_input_set_to_zero');
    const max = maxFeasible(option);
    if (n > max) {
      flags.push('over_capacity');
      n = max;
    }
    const step = participantStep(option);
    if (n % step !== 0) {
      flags.push('rounded_down_to_whole_groups');
      n = Math.floor(n / step) * step;
    }
    return { requested: raw, participants: n, flags };
  }

  /**
   * Venue / course bill for n participants under the quote structure:
   *   bill = max(flatFee + perParticipant * max(n, minimumParticipants), minimumSpend)
   * A deposit that is credited toward the bill is NOT added; it is just part of this bill paid early.
   * A non-refundable deposit sets a floor on the bill (you lose it even if the bill would be smaller).
   * A deposit that is NOT credited is a separate fee and is added elsewhere.
   */
  function venueBillCents(option, n) {
    const q = option.venueQuote || {};
    const billedHeads = Math.max(n, int(q.minimumParticipants));
    let bill = c(q.flatFee) + c(q.perParticipant) * billedHeads;
    bill = Math.max(bill, c(q.minimumSpend));
    const dep = option.deposit || {};
    const depC = c(dep.amount);
    if (depC > 0 && dep.creditedTowardBill && !dep.refundable) bill = Math.max(bill, depC);
    const unminimized = c(q.flatFee) + c(q.perParticipant) * n;
    return { bill, billedHeads, minimumApplied: bill > unminimized };
  }

  /** Separate (not credited) deposit fee, in cents. Refundable non-credited deposits are not an expense. */
  function separateDepositFeeCents(option) {
    const dep = option.deposit || {};
    if (!c(dep.amount) || dep.creditedTowardBill || dep.refundable) return 0;
    return c(dep.amount);
  }

  /**
   * Apply counted in-kind donations. An in-kind donation only reduces a budgeted fixed cost it genuinely
   * replaces (replacesCostId), capped at that cost line. Anything else is shown but never counted as cash.
   */
  function applyInKind(option, sponsorships, statuses) {
    const lines = (option.fixedCosts || []).map((l) => ({ ...l, cents: c(l.amount), reducedBy: 0 }));
    const applied = [];
    const notCounted = [];
    for (const s of sponsorships || []) {
      if (s.type !== 'inKind') continue;
      if (s.optionId && s.optionId !== option.id) continue;
      const counted = statuses.includes(s.status);
      const target = lines.find((l) => l.id && l.id === s.replacesCostId);
      if (!counted) { notCounted.push({ id: s.id, label: s.label, reason: 'status_not_counted_in_this_scenario' }); continue; }
      if (!target) { notCounted.push({ id: s.id, label: s.label, reason: 'does_not_replace_a_budgeted_cost' }); continue; }
      const room = target.cents - target.reducedBy;
      const use = Math.min(room, c(s.amount));
      target.reducedBy += use;
      applied.push({ id: s.id, label: s.label, replaces: target.label, reducedBy: d(use), excessNotCounted: d(c(s.amount) - use) });
    }
    return { lines, applied, notCounted };
  }

  function sponsorshipCashCents(option, sponsorships, statuses) {
    const byStatus = { collected: 0, committed: 0, hoped: 0 };
    for (const s of sponsorships || []) {
      if (s.type === 'inKind') continue;
      if (s.optionId && s.optionId !== option.id) continue;
      if (byStatus[s.status] === undefined) continue;
      byStatus[s.status] += c(s.amount);
    }
    const counted = statuses.reduce((sum, st) => sum + (byStatus[st] || 0), 0);
    return { counted, byStatus };
  }

  /**
   * Registration revenue with optional foursome bundle pricing.
   * foursomeShare (0..1) is an organizer assumption: the share of participants who register as full foursomes.
   * Foursome players are rounded DOWN to whole foursomes; everyone else pays the individual price.
   * A blank foursomePrice means 4 x individual price (no discount), so the share has no effect.
   */
  function registrationCents(option, n) {
    const indiv = c(option.price);
    const fp = option.foursomePrice == null || option.foursomePrice === '' ? indiv * 4 : c(option.foursomePrice);
    const share = Math.min(1, nonNeg(option.foursomeShare));
    const foursomes = Math.floor((n * share) / 4);
    const singles = n - foursomes * 4;
    return { total: foursomes * fp + singles * indiv, foursomes, singles };
  }

  /**
   * Full deterministic projection for one option at one participant count.
   * ctx: { sponsorships, statuses, extraRevenuePerParticipant, otherRevenue, paidRegistrations }
   */
  function project(option, requestedParticipants, ctx = {}) {
    const statuses = ctx.statuses || ['collected', 'committed'];
    const norm = normalizeParticipants(option, requestedParticipants);
    const n = norm.participants;

    const reg = registrationCents(option, n);
    const registration = reg.total;
    const extras = c(ctx.extraRevenuePerParticipant) * n;
    const other = c(ctx.otherRevenue);
    const sp = sponsorshipCashCents(option, ctx.sponsorships, statuses);
    const revenue = registration + extras + other + sp.counted;

    const venue = venueBillCents(option, n);
    const perHeadRate = (option.perParticipantCosts || []).reduce((s, l) => s + c(l.amount), 0);
    const perHead = perHeadRate * n;
    const ik = applyInKind(option, ctx.sponsorships, statuses);
    const fixed = ik.lines.reduce((s, l) => s + (l.cents - l.reducedBy), 0);
    const depositFee = separateDepositFeeCents(option);
    // Optional contingency on estimated (non-venue) costs. The venue quote is contractual, so it is not padded.
    const contingency = Math.round((perHead + fixed) * nonNeg(ctx.costContingencyPct) / 100);
    const expenses = venue.bill + perHead + fixed + depositFee + contingency;

    const net = revenue - expenses;

    // Upfront cash: what must be paid before the event, vs. cash actually in hand now.
    const dep = c((option.deposit || {}).amount);
    const upfrontFixed = ik.lines.filter((l) => l.paidUpfront).reduce((s, l) => s + (l.cents - l.reducedBy), 0);
    const upfront = dep + upfrontFixed;
    const paidRegs = Math.min(int(ctx.paidRegistrations), maxFeasible(option));
    const inHand = sp.byStatus.collected + c(option.price) * paidRegs;

    return {
      participants: n,
      requested: norm.requested,
      flags: norm.flags,
      revenue: {
        registration: d(registration), foursomes: reg.foursomes, singles: reg.singles, extras: d(extras), other: d(other),
        sponsorshipCash: d(sp.counted), total: d(revenue),
      },
      sponsorshipByStatus: { collected: d(sp.byStatus.collected), committed: d(sp.byStatus.committed), hoped: d(sp.byStatus.hoped) },
      expenses: {
        venue: d(venue.bill), venueBilledParticipants: venue.billedHeads, venueMinimumApplied: venue.minimumApplied,
        perParticipant: d(perHead), fixed: d(fixed), separateDepositFee: d(depositFee), contingency: d(contingency), total: d(expenses),
      },
      inKind: { applied: ik.applied, notCounted: ik.notCounted },
      net: d(net),
      upfront: { required: d(upfront), cashInHand: d(inHand), gap: d(Math.max(0, upfront - inHand)) },
      volunteerHours: nonNeg(option.volunteerHours),
    };
  }

  /**
   * Smallest feasible participant count whose net >= target, found by checking every feasible count
   * (not a single formula, because minimums and group sizes make costs nonlinear).
   */
  function participantsNeeded(option, target, ctx = {}) {
    const counts = feasibleCounts(option);
    const goal = c(target);
    let found = null;
    let dipsAfter = false;
    for (const n of counts) {
      const net = c(project(option, n, ctx).net);
      if (found === null && net >= goal) found = n;
      else if (found !== null && net < goal) { dipsAfter = true; break; }
    }
    const atCapacity = project(option, maxFeasible(option), ctx);
    return {
      target: d(goal),
      participants: found,
      reachableWithinCapacity: found !== null,
      maxFeasible: maxFeasible(option),
      netAtCapacity: atCapacity.net,
      nonMonotonic: dipsAfter,
    };
  }

  /** Net at every feasible count — for charts and for showing what a shortfall does. */
  function netCurve(option, ctx = {}) {
    return feasibleCounts(option).map((n) => ({ participants: n, net: project(option, n, ctx).net }));
  }

  /**
   * One-at-a-time sensitivity around a base case. Each test is a plain, labeled change;
   * results are ranked by size of the effect on net proceeds.
   */
  function sensitivity(option, baseParticipants, ctx = {}) {
    const base = project(option, baseParticipants, ctx);
    const tests = [
      { key: 'attendance_minus_25', label: 'Attendance 25% lower', run: () => project(option, Math.floor(base.participants * 0.75), ctx) },
      { key: 'price_minus_10', label: 'Registration prices 10% lower', run: () => project({ ...option, price: nonNeg(option.price) * 0.9,
          foursomePrice: option.foursomePrice == null || option.foursomePrice === '' ? option.foursomePrice : nonNeg(option.foursomePrice) * 0.9 }, base.participants, ctx) },
      { key: 'per_head_plus_10', label: 'Venue + per-person costs 10% higher', run: () => project({
          ...option,
          venueQuote: { ...(option.venueQuote || {}), perParticipant: nonNeg((option.venueQuote || {}).perParticipant) * 1.1 },
          perParticipantCosts: (option.perParticipantCosts || []).map((l) => ({ ...l, amount: nonNeg(l.amount) * 1.1 })),
        }, base.participants, ctx) },
      { key: 'sponsors_collected_only', label: 'Only already-collected sponsorship arrives', run: () => project(option, base.participants, { ...ctx, statuses: ['collected'] }) },
      { key: 'no_extras', label: 'No add-on revenue (raffle, mulligans, etc.)', run: () => project(option, base.participants, { ...ctx, extraRevenuePerParticipant: 0, otherRevenue: 0 }) },
    ];
    return {
      baseNet: base.net,
      results: tests
        .map((t) => { const r = t.run(); return { key: t.key, label: t.label, net: r.net, change: d(c(r.net) - c(base.net)) }; })
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
    };
  }

  /**
   * Worst-case exposure: nobody registers and only already-collected sponsorship arrives.
   * contractualFloor = what the venue contract alone would cost at zero participants (incl. non-refundable deposit).
   */
  function worstCase(option, sponsorships) {
    const r = project(option, 0, { sponsorships, statuses: ['collected'] });
    return { netIfNobodyRegisters: r.net, contractualFloor: d(c(r.expenses.venue) + c(r.expenses.separateDepositFee)) };
  }

  /** Round a headline figure to avoid false precision (exact values stay in the detail table). */
  function roundHeadline(x) {
    const n = Number(x) || 0;
    const step = Math.abs(n) >= 2000 ? 100 : 50;
    return Math.round(n / step) * step;
  }

  /** Build the scenario context for an option from app state. */
  function scenarioContext(state, option, scenarioKey) {
    const sc = (state.scenarioSettings || {})[scenarioKey] || {};
    return {
      sponsorships: state.sponsorships || [],
      statuses: sc.statuses || ['collected', 'committed'],
      extraRevenuePerParticipant: sc.extraRevenuePerParticipant || 0,
      otherRevenue: sc.otherRevenue || 0,
      costContingencyPct: sc.costContingencyPct || 0,
      paidRegistrations: ((state.evidence || {}).paidRegistrations || {})[option.id] || 0,
    };
  }

  /**
   * Rule-based decision status (deterministic, every rule visible). It never says "go";
   * the strongest result is "supported by current evidence".
   */
  function decide(state, option) {
    const ev = state.evidence || {};
    const target = nonNeg((state.settings || {}).fundraisingTarget);
    const consCtx = scenarioContext(state, option, 'conservative');
    const cons = project(option, (option.scenarioParticipants || {}).conservative, consCtx);
    // Break-even uses only sponsorship that is collected or committed in writing.
    const firmCtx = { ...consCtx, statuses: ['collected', 'committed'] };
    const be = participantsNeeded(option, 0, firmCtx);
    const tg = participantsNeeded(option, target, firmCtx);
    const paid = int((ev.paidRegistrations || {})[option.id]);
    const named = int((ev.namedHighIntent || {})[option.id]);
    const definitely = int((ev.surveyDefinitelyAtPrice || {})[option.id]);
    const responses = int(ev.surveyResponses);

    const missing = [];
    if (!option.quoteVerified) missing.push('Written venue/course quote (price, minimums, deposit terms, cancellation terms) has not been verified.');
    if (!option.costsVerified) missing.push('Other cost lines (food, prizes, carts, insurance, printing) are estimates, not quotes.');
    if (responses === 0) missing.push('No survey responses entered yet.');
    if (paid === 0) missing.push('No paid registrations or deposits from participants yet.');
    if (state.volunteerHoursAvailable == null || state.volunteerHoursAvailable === '') missing.push('Volunteer hours actually available are unknown.');
    else if (nonNeg(option.volunteerHours) > nonNeg(state.volunteerHoursAvailable)) missing.push(`Estimated volunteer need (${nonNeg(option.volunteerHours)} h) exceeds hours available (${nonNeg(state.volunteerHoursAvailable)} h).`);

    const reasons = [];
    let status;
    if (!be.reachableWithinCapacity) {
      status = 'not_viable_as_configured';
      reasons.push(`Even at full capacity (${be.maxFeasible}) the event loses $${Math.abs(be.netAtCapacity).toFixed(2)} with only collected/committed sponsorship.`);
    } else if (!option.quoteVerified || (responses === 0 && paid === 0)) {
      status = 'not_enough_evidence';
      reasons.push('Key costs or demand have not been checked against real quotes or real supporter responses.');
    } else if (be.participants > paid + named) {
      status = 'not_enough_evidence';
      reasons.push(`Break-even needs ${be.participants} participants; paid registrations (${paid}) plus named high-intent leads (${named}) total ${paid + named}. Anonymous "definitely" answers (${definitely}) are shown but not counted toward this check.`);
    } else if (cons.net < 0) {
      status = 'high_risk';
      reasons.push(`The conservative scenario loses $${Math.abs(cons.net).toFixed(2)}.`);
    } else {
      status = 'supported_by_current_evidence';
      reasons.push(`Break-even (${be.participants}) is at or below paid registrations + named high-intent leads (${paid + named}), and the conservative scenario nets $${cons.net.toFixed(2)}.`);
    }
    if (target > 0 && !tg.reachableWithinCapacity) reasons.push(`The $${target.toLocaleString('en-US')} target is not reachable even at full capacity with only collected/committed sponsorship (max ≈ $${Math.round(tg.netAtCapacity).toLocaleString('en-US')}).`);

    return { status, reasons, missing, breakEven: be, targetNeeded: tg, conservative: cons, paid, named, definitely, responses, worst: worstCase(option, state.sponsorships) };
  }

  const STATUS_LABELS = {
    not_enough_evidence: 'Not enough evidence to decide yet',
    not_viable_as_configured: 'Not viable as currently configured',
    high_risk: 'High financial risk',
    supported_by_current_evidence: 'Supported by current evidence (not a guarantee)',
  };

  const api = {
    SPONSOR_STATUSES, STATUS_LABELS,
    participantStep, maxFeasible, feasibleCounts, normalizeParticipants,
    registrationCents, worstCase, roundHeadline,
    project, participantsNeeded, netCurve, sensitivity, scenarioContext, decide,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
