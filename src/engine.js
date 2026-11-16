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
  const SCENARIO_KEYS = ['conservative', 'middle', 'optimistic'];

  const c = (dollars) => Math.round((Number(dollars) || 0) * 100); // to cents
  // Money the organizer enters (prices, quotes, costs, sponsorship, assumptions). A negative or non-numeric
  // entry is treated as 0: it can never become income, a refund or a negative cost.
  const ci = (dollars) => c(Math.max(0, Number(dollars) || 0));
  const d = (cents) => Math.round(cents) / 100;                    // to dollars
  const nonNeg = (x) => Math.max(0, Number(x) || 0);
  const int = (x) => Math.max(0, Math.floor(Number(x) || 0));
  // Dollars for sentences shown to people: $2,740.00 (same thousands separator as the rest of the page).
  const usd = (x) => { const n = Number(x) || 0; return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

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
   * Venue or supplier bill for n units (players, guests or items) under the quote structure:
   *   bill = max(flatFee + perParticipant * max(n, minimumParticipants), minimumSpend)
   * A deposit that is credited toward the bill is NOT added; it is just part of this bill paid early.
   * A non-refundable deposit sets a floor on the bill (you lose it even if the bill would be smaller).
   * A deposit that is NOT credited is a separate fee and is added elsewhere.
   */
  function venueBillCents(option, n) {
    const q = option.venueQuote || {};
    const billedHeads = Math.max(n, int(q.minimumParticipants));
    let bill = ci(q.flatFee) + ci(q.perParticipant) * billedHeads;
    bill = Math.max(bill, ci(q.minimumSpend));
    const dep = option.deposit || {};
    const depC = ci(dep.amount);
    if (depC > 0 && dep.creditedTowardBill && !dep.refundable) bill = Math.max(bill, depC);
    const unminimized = ci(q.flatFee) + ci(q.perParticipant) * n;
    return { bill, billedHeads, minimumApplied: bill > unminimized };
  }

  /** Separate (not credited) deposit fee, in cents. Refundable non-credited deposits are not an expense. */
  function separateDepositFeeCents(option) {
    const dep = option.deposit || {};
    if (!ci(dep.amount) || dep.creditedTowardBill || dep.refundable) return 0;
    return ci(dep.amount);
  }

  /**
   * Apply counted in-kind donations. An in-kind donation only reduces a budgeted fixed cost it genuinely
   * replaces (replacesCostId), capped at that cost line. Anything else is shown but never counted as cash.
   */
  function applyInKind(option, sponsorships, statuses) {
    const lines = (option.fixedCosts || []).map((l) => ({ ...l, cents: ci(l.amount), reducedBy: 0 }));
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
      const use = Math.min(room, ci(s.amount));
      target.reducedBy += use;
      applied.push({ id: s.id, label: s.label, replaces: target.label, reducedBy: d(use), excessNotCounted: d(ci(s.amount) - use) });
    }
    return { lines, applied, notCounted };
  }

  function sponsorshipCashCents(option, sponsorships, statuses) {
    const byStatus = { collected: 0, committed: 0, hoped: 0 };
    for (const s of sponsorships || []) {
      if (s.type === 'inKind') continue;
      if (s.optionId && s.optionId !== option.id) continue;
      if (byStatus[s.status] === undefined) continue;
      byStatus[s.status] += ci(s.amount);
    }
    const counted = statuses.reduce((sum, st) => sum + (byStatus[st] || 0), 0);
    return { counted, byStatus };
  }

  /**
   * Registration revenue with optional group pricing (a golf foursome, a table of 8 at a gala, a team at a 5K).
   * Group size = option.groupSize. groupShare (0..1) is an organizer assumption: the share of participants who buy as a full group.
   * Group buyers are rounded DOWN to whole groups; everyone else pays the individual price.
   * A blank groupPrice means groupSize x individual price (no discount), so the share has no effect.
   * Older plans used foursomePrice / foursomeShare; those are still read.
   */
  function registrationCents(option, n) {
    const indiv = ci(option.price);
    const size = Math.max(1, int(option.groupSize) || 1);
    const gpRaw = option.groupPrice !== undefined ? option.groupPrice : option.foursomePrice;
    const shareRaw = option.groupShare !== undefined ? option.groupShare : option.foursomeShare;
    if (size < 2) return { total: indiv * n, groups: 0, singles: n, foursomes: 0 };
    const gp = gpRaw == null || gpRaw === '' ? indiv * size : ci(gpRaw);
    const share = Math.min(1, nonNeg(shareRaw));
    const groups = Math.floor((n * share) / size);
    const singles = n - groups * size;
    return { total: groups * gp + singles * indiv, groups, singles, foursomes: groups };
  }

  /**
   * Full deterministic projection for one option at one participant count.
   * ctx: { sponsorships, statuses, extraRevenuePerParticipant, otherRevenue, paidRegistrations }
   */
  function project(option, requestedParticipants, ctx = {}) {
    const statuses = ctx.statuses || ['collected', 'committed'];
    const norm = normalizeParticipants(option, requestedParticipants);
    const n = norm.participants;

    // Tickets already paid for bring in what was actually received, whatever today's price is.
    // Only sales beyond them use the current offer. If the amount received isn't entered, paid tickets are
    // valued at the current offer and decide() flags it (see the "amount actually received" open item).
    const paidSoFar = int(ctx.paidRegistrations);
    const paidCashKnown = paidSoFar > 0 && ctx.paidRegistrationCash != null && ctx.paidRegistrationCash !== '';
    const reg = paidCashKnown ? registrationCents(option, Math.max(0, n - paidSoFar)) : registrationCents(option, n);
    const registration = (paidCashKnown ? ci(ctx.paidRegistrationCash) : 0) + reg.total;
    if (paidCashKnown && n < paidSoFar) norm.flags.push('fewer_than_already_paid');
    const extras = ci(ctx.extraRevenuePerParticipant) * n;
    const other = ci(ctx.otherRevenue);
    const sp = sponsorshipCashCents(option, ctx.sponsorships, statuses);
    const revenue = registration + extras + other + sp.counted;

    const venue = venueBillCents(option, n);
    const perHeadRate = (option.perParticipantCosts || []).reduce((s, l) => s + ci(l.amount), 0);
    const perHead = perHeadRate * n;
    const ik = applyInKind(option, ctx.sponsorships, statuses);
    const fixed = ik.lines.reduce((s, l) => s + (l.cents - l.reducedBy), 0);
    const depositFee = separateDepositFeeCents(option);
    // Optional contingency on estimated (non-venue) costs. The venue quote is contractual, so it is not padded.
    const contingency = Math.round((perHead + fixed) * nonNeg(ctx.costContingencyPct) / 100);
    const expenses = venue.bill + perHead + fixed + depositFee + contingency;

    const net = revenue - expenses;

    // Upfront cash: what must be paid before the event, vs. cash actually in hand now.
    const dep = ci((option.deposit || {}).amount);
    const upfrontFixed = ik.lines.filter((l) => l.paidUpfront).reduce((s, l) => s + (l.cents - l.reducedBy), 0);
    const upfront = dep + upfrontFixed;
    // Cash in hand = collected sponsorship + registration money actually received (entered by the organizer).
    // Never price x paid headcount: group deals, discounts and price changes make that wrong.
    // If people have paid but the amount isn't entered, their money is left out and flagged, so the gap errs high.
    const paidRegs = int(ctx.paidRegistrations);
    const cashKnown = ctx.paidRegistrationCash != null && ctx.paidRegistrationCash !== '';
    const regCash = cashKnown ? ci(ctx.paidRegistrationCash) : 0;
    const inHand = sp.byStatus.collected + regCash;

    return {
      participants: n,
      requested: norm.requested,
      flags: norm.flags,
      revenue: {
        registration: d(registration), groups: reg.groups, foursomes: reg.groups, singles: reg.singles, extras: d(extras), other: d(other),
        sponsorshipCash: d(sp.counted), total: d(revenue),
      },
      sponsorshipByStatus: { collected: d(sp.byStatus.collected), committed: d(sp.byStatus.committed), hoped: d(sp.byStatus.hoped) },
      expenses: {
        venue: d(venue.bill), venueBilledParticipants: venue.billedHeads, venueMinimumApplied: venue.minimumApplied,
        perParticipant: d(perHead), fixed: d(fixed), separateDepositFee: d(depositFee), contingency: d(contingency), total: d(expenses),
      },
      inKind: { applied: ik.applied, notCounted: ik.notCounted },
      net: d(net),
      upfront: { required: d(upfront), cashInHand: d(inHand), registrationCash: cashKnown ? d(regCash) : null, registrationCashUnknown: paidRegs > 0 && !cashKnown, gap: d(Math.max(0, upfront - inHand)) },
      volunteerHours: nonNeg(option.volunteerHours),
    };
  }

  /**
   * Smallest feasible participant count whose net >= target, found by checking every feasible count
   * (not a single formula, because minimums and group sizes make costs nonlinear).
   */
  // Headcounts below the number already paid for can't happen, so break-even and the chart start there.
  const possibleCounts = (option, ctx) => { const paid = int(ctx.paidRegistrations); return feasibleCounts(option).filter((n, i, all) => n >= paid || (i === all.length - 1)); };

  function participantsNeeded(option, target, ctx = {}) {
    const counts = possibleCounts(option, ctx);
    const goal = c(target);
    let found = null;
    let dipsAt = null;
    for (const n of counts) {
      const net = c(project(option, n, ctx).net);
      if (found === null && net >= goal) found = n;
      else if (found !== null && net < goal) { dipsAt = n; break; }
    }
    const atCapacity = project(option, maxFeasible(option), ctx);
    return {
      target: d(goal),
      participants: found,
      reachableWithinCapacity: found !== null,
      maxFeasible: maxFeasible(option),
      netAtCapacity: atCapacity.net,
      nonMonotonic: dipsAt !== null,
      dipsAt, // first feasible count above `participants` where net falls below the target again (null if never)
    };
  }

  /** Net at every feasible count — for charts and for showing what a shortfall does. */
  function netCurve(option, ctx = {}) {
    return possibleCounts(option, ctx).map((n) => ({ participants: n, net: project(option, n, ctx).net }));
  }

  /**
   * One-at-a-time sensitivity around a base case. Each test is a plain, labeled change;
   * results are ranked by size of the effect on net proceeds.
   */
  function sensitivity(option, baseParticipants, ctx = {}) {
    const base = project(option, baseParticipants, ctx);
    const tests = [
      { key: 'attendance_minus_25', label: 'Turnout or sales 25% lower', run: () => project(option, Math.floor(base.participants * 0.75), ctx) },
      { key: 'price_minus_10', label: 'Registration prices 10% lower', run: () => project({ ...option, price: nonNeg(option.price) * 0.9,
          groupPrice: (() => { const g = option.groupPrice !== undefined ? option.groupPrice : option.foursomePrice; return g == null || g === '' ? g : nonNeg(g) * 0.9; })() }, base.participants, ctx) },
      { key: 'per_head_plus_10', label: 'Venue + per-person costs 10% higher', run: () => project({
          ...option,
          venueQuote: { ...(option.venueQuote || {}), perParticipant: nonNeg((option.venueQuote || {}).perParticipant) * 1.1 },
          perParticipantCosts: (option.perParticipantCosts || []).map((l) => ({ ...l, amount: nonNeg(l.amount) * 1.1 })),
        }, base.participants, ctx) },
      { key: 'sponsors_collected_only', label: 'Only already-collected sponsorship arrives', run: () => project(option, base.participants, { ...ctx, statuses: ['collected'] }) },
      { key: 'no_extras', label: 'No add-on, auction or raffle income', run: () => project(option, base.participants, { ...ctx, extraRevenuePerParticipant: 0, otherRevenue: 0 }) },
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

  /**
   * Cancellation exposure, only when the organizer has copied the amount off the quote.
   * owedToVenue = what the venue says you owe after its cancellation deadline (organizer includes any forfeited deposit).
   * alreadySpent = fixed costs marked "paid before the event" (after collected in-kind), which are usually not recoverable.
   * Sponsorship is not netted: sponsors may expect refunds if the event is canceled.
   */
  function cancellationExposure(option, sponsorships) {
    if (option.cancellationOwed == null || option.cancellationOwed === '') return null;
    const ik = applyInKind(option, sponsorships, ['collected']);
    const spent = ik.lines.filter((l) => l.paidUpfront).reduce((s, l) => s + (l.cents - l.reducedBy), 0);
    const owed = ci(option.cancellationOwed);
    return { owedToVenue: d(owed), alreadySpent: d(spent), total: d(owed + spent) };
  }

  /** Round a headline figure to avoid false precision (exact values stay in the detail table). */
  function roundHeadline(x) {
    const n = Number(x) || 0;
    const step = Math.abs(n) >= 2000 ? 100 : 50;
    return Math.round(n / step) * step;
  }

  /**
   * The offer supporters were asked about: what a "yes" in the survey was a yes TO.
   * Survey answers only support the decision for the same offer. Money values are in cents.
   */
  function offerTerms(option, snapshot) {
    const size = Math.max(1, int(option.groupSize) || 1);
    const gpRaw = option.groupPrice !== undefined ? option.groupPrice : option.foursomePrice;
    const sn = snapshot || {};
    const txt = (v) => String(v == null ? '' : v).trim();
    return {
      kind: option.kind || '',
      price: c(option.price),
      groupSize: size,
      groupPrice: size > 1 ? (gpRaw == null || gpRaw === '' ? c(option.price) * size : c(gpRaw)) : null,
      format: txt(sn.format), date: txt(sn.dateWindow), place: txt(sn.locationArea), included: txt(sn.included), supports: txt(sn.beneficiary),
    };
  }
  const TERM_LABELS = { kind: 'kind of event', price: 'price', groupSize: 'group size', groupPrice: 'group price', format: 'event description', date: 'date', place: 'location', included: 'what the price includes', supports: 'what the money supports' };

  /**
   * Are this option's survey answers about the offer as it stands now?
   *  none       - no survey answers for this option
   *  current    - answers were recorded against the same terms
   *  stale      - terms changed since (lists what changed)
   *  unrecorded - answers exist but nobody recorded what they were for (older plans)
   */
  function evidenceStatus(state, option) {
    const ev = state.evidence || {};
    const surveyCount = int((ev.namedHighIntent || {})[option.id]) + int((ev.surveyDefinitelyAtPrice || {})[option.id]) + int((ev.surveyProbablyAtPrice || {})[option.id]);
    if (!surveyCount) return { state: 'none', changed: [] };
    const rec = (ev.offerTerms || {})[option.id];
    if (!rec) return { state: 'unrecorded', changed: [] };
    const now = offerTerms(option, state.snapshot);
    // Terms recorded by an older version may lack newer keys (e.g. "supports"); those keys are not compared.
    const changed = Object.keys(TERM_LABELS).filter((k) => k in rec && String(rec[k] ?? '') !== String(now[k] ?? '')).map((k) => TERM_LABELS[k]);
    return { state: changed.length ? 'stale' : 'current', changed, recorded: rec, now };
  }

  /**
   * The single FIRM-MONEY basis used everywhere a "firm" number is shown (break-even, target, chart, cash card):
   * the conservative scenario's costs (incl. its contingency), ticket money, and only collected/committed sponsorship
   * and in-kind. No add-ons, other income or auction/raffle estimates.
   */
  function firmContext(state, option) {
    return { ...scenarioContext(state, option, 'conservative'), statuses: ['collected', 'committed'], extraRevenuePerParticipant: 0, otherRevenue: 0 };
  }

  /** Build the scenario context for an option from app state. */
  function scenarioContext(state, option, scenarioKey) {
    const sc = (state.scenarioSettings || {})[scenarioKey] || {};
    return {
      sponsorships: state.sponsorships || [],
      statuses: sc.statuses || ['collected', 'committed'],
      extraRevenuePerParticipant: sc.extraRevenuePerParticipant || 0,
      // Plan-wide other income plus this option's own entry for the scenario (e.g., the organizer's auction or raffle figure).
      otherRevenue: (Number(sc.otherRevenue) || 0) + (Number(((option.scenarioProceeds || {})[scenarioKey])) || 0),
      costContingencyPct: sc.costContingencyPct || 0,
      paidRegistrations: ((state.evidence || {}).paidRegistrations || {})[option.id] || 0,
      paidRegistrationCash: (((state.evidence || {}).paidCashReceived || {})[option.id] ?? null),
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
    const proceedsLow = Number(((option.scenarioProceeds || {}).conservative)) || 0;
    // FIRM break-even: ticket/registration money plus collected or committed sponsorship. Nothing assumed:
    // no per-person add-ons, no "other income", no auction or raffle estimates.
    const firmCtx = firmContext(state, option);
    const firm = project(option, (option.scenarioParticipants || {}).conservative, firmCtx);
    const be = participantsNeeded(option, 0, firmCtx);
    const tg = participantsNeeded(option, target, firmCtx);
    // CONDITIONAL break-even: the same, plus the organizer's own low-case assumptions. Reported, never relied on.
    const assumed = { addOns: nonNeg(consCtx.extraRevenuePerParticipant), other: Math.max(0, (Number(consCtx.otherRevenue) || 0) - proceedsLow), auction: proceedsLow };
    const uses = [];
    if (assumed.addOns > 0) uses.push('add-ons');
    if (assumed.other > 0) uses.push('other income');
    if (assumed.auction > 0) uses.push('auction or raffle money');
    const conditional = uses.length ? { ...participantsNeeded(option, 0, { ...firmCtx, extraRevenuePerParticipant: assumed.addOns, otherRevenue: assumed.other + assumed.auction }), uses, assumed } : null;

    const paid = int((ev.paidRegistrations || {})[option.id]);
    const named = int((ev.namedHighIntent || {})[option.id]);
    const definitely = int((ev.surveyDefinitelyAtPrice || {})[option.id]);
    const responses = int(ev.surveyResponses);
    const evidence = evidenceStatus(state, option);
    // Survey answers only count toward the support check if they were collected for the offer as it stands now.
    const namedCounted = evidence.state === 'current' ? named : 0;

    const missing = [];
    if (!option.quoteVerified) missing.push('Written venue or supplier quote (price, minimums, deposit terms, cancellation terms) has not been verified.');
    if (!option.costsVerified) missing.push('Other costs (food, prizes, supplies, insurance, printing) are estimates, not quotes.');
    if (responses === 0) missing.push('No survey responses entered yet.');
    if (evidence.state === 'stale') missing.push(`Survey answers were collected for different terms (${evidence.changed.join(', ')} changed since). Re-ask supporters about the current offer, or confirm the answers still apply.`);
    if (evidence.state === 'unrecorded') missing.push('Survey answers are entered, but not which price and terms they were for. Confirm them on the "What did supporters say?" step.');
    if (paid === 0) missing.push('No paid sign-ups, tickets or orders yet.');
    if (paid > 0 && consCtx.paidRegistrationCash == null) missing.push('People have paid, but the amount actually received is not entered, so it is left out of cash in hand.');
    if (firm.upfront.gap > 0 && !option.upfrontFundingConfirmed) missing.push(`You'd need $${firm.upfront.gap.toLocaleString('en-US')} more cash before the event than you have now (deposit and bills due in advance). Confirm how the club will cover it.`);
    if (option.cancellationOwed == null || option.cancellationOwed === '') missing.push('What you would owe if you cancel after the deadline on the quote has not been entered.');
    if (paid > maxFeasible(option)) missing.push(`${paid} people or items are already paid for, but the capacity entered is ${maxFeasible(option)}. Check the capacity and the paid count.`);
    if (state.volunteerHoursAvailable == null || state.volunteerHoursAvailable === '') missing.push('Volunteer hours actually available are unknown.');
    else if (nonNeg(option.volunteerHours) > nonNeg(state.volunteerHoursAvailable)) missing.push(`Estimated volunteer need (${nonNeg(option.volunteerHours)} h) exceeds hours available (${nonNeg(state.volunteerHoursAvailable)} h).`);

    const worst = worstCase(option, state.sponsorships);
    const cancel = cancellationExposure(option, state.sponsorships);
    const reasons = [];
    let status;
    const assumedWords = (u) => u.join(', ').replace(/, ([^,]*)$/, ' and $1');
    // Selling one more costs more than it brings in (e.g. free admission with a per-guest charge).
    if (!be.reachableWithinCapacity && conditional && conditional.reachableWithinCapacity) {
      status = 'high_risk';
      reasons.push(`Tickets and firm sponsorship can't cover costs even at full capacity (${be.maxFeasible}). It works only if your low-case estimates for ${assumedWords(conditional.uses)} actually arrive${conditional.participants > 0 ? `, with at least ${conditional.participants} paying` : ''}. Those are assumptions, not commitments.`);
    } else if (!be.reachableWithinCapacity) {
      status = 'not_viable_as_configured';
      reasons.push(`Even at full capacity (${be.maxFeasible}) the event loses ${usd(Math.abs(be.netAtCapacity))} with only collected/committed sponsorship${conditional ? `, and your low-case ${assumedWords(conditional.uses)} don't close the gap` : ''}.`);
    } else if (!option.quoteVerified || (responses === 0 && paid === 0)) {
      status = 'not_enough_evidence';
      reasons.push('Key costs or demand have not been checked against real quotes or real supporter responses.');
    } else if (be.participants > paid + namedCounted) {
      status = 'not_enough_evidence';
      reasons.push(`Break-even needs ${be.participants} participants; paid registrations (${paid}) plus named “yes” answers for the current offer (${namedCounted}) total ${paid + namedCounted}.${named > namedCounted ? ` ${named} named answers aren't counted because they were for different or unrecorded terms.` : ''} Anonymous “yes” answers (${definitely}) are shown but not counted toward this check.`);
    } else if (be.nonMonotonic) {
      status = 'high_risk';
      // Why it dips, from the margins just before the dip: singles and full groups are judged separately (row 82).
      const m = pricingMargins(option, Math.max(0, be.dipsAt - participantStep(option)));
      const one = option.kind === 'product' ? 'item' : 'person';
      // Each kind's real added cost (row 83): a single adds singleCost, a full group adds groupCost.
      const why = m.loses === 'all' ? (m.groupsUsed
          ? `: every extra sale costs more than it pays (${m.singlesUsed ? `a single ${one} at ${usd(m.price)} adds ${usd(m.singleCost)} in costs; ` : ''}a full group of ${m.groupSize} at ${usd(m.groupPrice)} adds ${usd(m.groupCost)})`
          : `: each extra ${one} costs more than they pay (price ${usd(m.price)}, cost ${usd(m.singleCost)} each)`)
        : m.loses === 'group' ? `: a full group of ${m.groupSize} at ${usd(m.groupPrice)} costs more than it pays (it adds ${usd(m.groupCost)} in costs), while a single ${one} at ${usd(m.price)} still covers its cost`
          : m.loses === 'single' ? `: a single ${one} at ${usd(m.price)} costs more than it pays (it adds ${usd(m.singleCost)} in costs), while a full group of ${m.groupSize} at ${usd(m.groupPrice)} still covers its cost`
            : ', because of group pricing or a minimum';
      reasons.push(`Costs are covered at ${be.participants}, but money left falls below zero again at ${be.dipsAt}${why}. Check the chart before relying on a single break-even number.`);
    } else if (cons.net < 0) {
      status = 'high_risk';
      reasons.push(`The conservative scenario loses ${usd(Math.abs(cons.net))}.`);
    } else if (firm.net < 0) {
      // The low case only looks positive because of assumed add-ons, other income or auction money.
      status = 'high_risk';
      reasons.push(`At your low number (${firm.participants}), firm money alone loses ${usd(Math.abs(firm.net))}. The low case shows ${usd(cons.net)} only because it counts your assumed ${assumedWords(uses)}, which nobody has promised.`);
    } else {
      status = missing.length ? 'supported_with_open_items' : 'supported_by_current_evidence';
      reasons.push(`The break-even headcount (${be.participants}) is at or below paid registrations plus named “yes” answers (${paid + namedCounted}). Named answers are not revenue. Using the conservative turnout you entered, that scenario nets ${usd(cons.net)}. This is not a prediction.`);
      if (missing.length) reasons.push(`${missing.length} item${missing.length > 1 ? 's below still need' : ' below still needs'} checking before anyone signs.`);
    }
    if (be.reachableWithinCapacity && conditional && conditional.participants !== be.participants) reasons.push(`With your low-case ${assumedWords(conditional.uses)}, break-even would be ${conditional.participants}${conditional.reachableWithinCapacity ? '' : ' (not reachable)'}. That depends on assumptions, so the firm number above is the one to rely on.`);
    // Only when the event can at least break even; otherwise the "loses money even at capacity" reason already says more.
    if (target > 0 && be.reachableWithinCapacity && !tg.reachableWithinCapacity) reasons.push(`The $${target.toLocaleString('en-US')} target is not reachable even at full capacity with only collected/committed sponsorship (the most it could raise is $${Math.round(tg.netAtCapacity).toLocaleString('en-US')}).`);

    // The plain answers to "how much cash do we need first?" and "what could we lose?", under the terms entered.
    // largestLoss compares only two cases (nothing sells / cancel after the deadline). It is NOT a maximum: holding the
    // event can lose more, e.g. when each sale costs more than it brings in. worstOnChart is the lowest point of the
    // firm-money chart (same basis as break-even), so the results can say so instead of implying the two cases bound it.
    const lossIfNobodyComes = Math.max(0, -worst.netIfNobodyRegisters);
    const lossIfCanceled = cancel ? cancel.total : null;
    const worstOnChart = netCurve(option, firmCtx).reduce((lo, p) => (p.net < lo.net ? p : lo), { participants: 0, net: Infinity });
    const exposure = {
      cashNeededBeforeEvent: firm.upfront.required, cashInHand: firm.upfront.cashInHand, shortBeforeEvent: firm.upfront.gap,
      lossIfNobodyComes, lossIfCanceled, cancellationKnown: !!cancel,
      largestLoss: Math.max(lossIfNobodyComes, lossIfCanceled || 0),
      worstOnChart: { participants: worstOnChart.participants, net: worstOnChart.net },
      worstOnChartLoss: Math.max(0, -worstOnChart.net),
    };

    return {
      status, reasons, missing, exposure, breakEven: be, targetNeeded: tg, conservative: cons, firm, paid, named, namedCounted, definitely, responses, evidence,
      worst, cancel, proceedsLow, conditional,
      beWithLowProceeds: conditional, // kept for older callers
    };
  }

  /** Price for one full group, in cents: the group price entered, or group size x the single price when it is blank. */
  function groupPriceCents(option) {
    const size = Math.max(1, int(option.groupSize) || 1);
    const gp = option.groupPrice !== undefined ? option.groupPrice : option.foursomePrice;
    return gp == null || gp === '' ? ci(option.price) * size : ci(gp);
  }
  // A real group deal: a group price that differs from size x the single price. A blank or equal one is "no deal".
  function hasGroupDeal(option, gp) {
    const size = Math.max(1, int(option.groupSize) || 1);
    return size > 1 && gp != null && gp !== '' && ci(gp) !== ci(option.price) * size;
  }

  /**
   * The price fields a typed-in hypothetical price gives the option. Used for BOTH the preview and
   * "Use … in my plan", so the two can never disagree (row 82). Group settings (size, whole groups, share) are never
   * touched. The group price is:
   *   typed       - the organizer typed one;
   *   kept        - box left blank and the option has a group deal: the deal is kept exactly as it is (never dropped silently);
   *   none        - box left blank and there is no deal: a group pays group size x the new price;
   *   not_grouped - group size 1: the stored group price is left exactly as it was (it has no effect on the money).
   */
  function hypotheticalPrice(option, typed) {
    const size = Math.max(1, int(option.groupSize) || 1);
    const gpNow = option.groupPrice !== undefined ? option.groupPrice : option.foursomePrice;
    const price = d(ci(typed && typed.price));
    const tg = typed ? typed.groupPrice : null;
    if (size < 2) return { price, groupPrice: gpNow === undefined ? null : gpNow, groupPriceSource: 'not_grouped' };
    if (tg != null && tg !== '' && Number.isFinite(Number(tg)) && Number(tg) >= 0) return { price, groupPrice: d(ci(tg)), groupPriceSource: 'typed' };
    if (hasGroupDeal(option, gpNow)) return { price, groupPrice: d(ci(gpNow)), groupPriceSource: 'kept' };
    return { price, groupPrice: null, groupPriceSource: 'none' };
  }

  /**
   * What one more sale brings in against what it costs, at participant count n, measured separately for
   *   - one single ticket:  venue bill at n+1 minus venue bill at n, plus one set of per-person costs;
   *   - one full group:     venue bill at n+groupSize minus venue bill at n, plus groupSize sets of per-person costs.
   * Each uses the actual venue-bill difference (venueBillCents), so a minimum headcount, a minimum bill total or a
   * non-refundable deposit floor is respected exactly, including when the sale crosses the minimum part-way
   * (row 83: at 70 with a 72 minimum, a foursome adds 2 players' worth of course charge, not 0 and not 4).
   * With mixed pricing one kind can lose money while the other covers its cost, so the answer is 'all' only when every
   * kind of sale that can happen loses money:   none | single | group | all
   */
  function pricingMargins(option, n) {
    const size = Math.max(1, int(option.groupSize) || 1);
    const share = Math.min(1, nonNeg(option.groupShare !== undefined ? option.groupShare : option.foursomeShare));
    const other = (option.perParticipantCosts || []).reduce((s, l) => s + ci(l.amount), 0);
    const minimum = int((option.venueQuote || {}).minimumParticipants);
    const perHeadCharge = ci((option.venueQuote || {}).perParticipant);
    const at = int(n);
    const billAt = venueBillCents(option, at).bill;
    const singleVenue = venueBillCents(option, at + 1).bill - billAt;
    const singleCost = singleVenue + other;
    const single = ci(option.price) - singleCost;
    const groupsUsed = size > 1 && share > 0;
    const groupVenue = size > 1 ? venueBillCents(option, at + size).bill - billAt : null;
    const groupCost = size > 1 ? groupVenue + other * size : null;
    const group = size > 1 ? groupPriceCents(option) - groupCost : null;
    // With every buyer in a group and whole groups only, nobody ever pays the single price.
    const singlesUsed = !(groupsUsed && share >= 1 && option.wholeGroupsOnly);
    const singleLoses = singlesUsed && single < 0, groupLoses = groupsUsed && group < 0;
    const loses = (singleLoses || !singlesUsed) && (groupLoses || !groupsUsed) && (singleLoses || groupLoses) ? 'all' : singleLoses ? 'single' : groupLoses ? 'group' : 'none';
    return {
      price: d(ci(option.price)), minimum, otherPerPerson: d(other),
      singleCost: d(singleCost), singleVenue: d(singleVenue), singleMargin: d(single), singleUnderMinimum: singleVenue < perHeadCharge,
      groupSize: size, groupShare: share, groupsUsed, singlesUsed, groupPrice: size > 1 ? d(groupPriceCents(option)) : null,
      groupCost: groupCost == null ? null : d(groupCost), groupVenue: groupVenue == null ? null : d(groupVenue),
      groupMargin: group == null ? null : d(group), groupUnderMinimum: size > 1 && groupVenue < perHeadCharge * size,
      costPerUnit: d(singleCost), belowMinimum: singleVenue < perHeadCharge, // older field names: the single-ticket figures
      loses,
    };
  }

  /**
   * "What would need to change?" for one option at ONE headcount the organizer picks.
   * Everything is on the firm-money basis (firmContext: ticket money, collected + committed sponsorship, the conservative
   * cost cushion; no add-ons, other income or auction estimates), so it lines up with break-even and the chart.
   * Nothing here changes the plan. Every answer is a hypothetical with its assumptions stated:
   *  - sponsorship gaps are exact, because firm sponsorship adds the same amount at every headcount;
   *  - headcount answers are offered only when a higher feasible count actually raises firm net (never when each extra
   *    person or item makes the result worse);
   *  - price comparisons use prices the organizer types in and keep the SAME headcount: they say nothing about whether
   *    that many people would still come at the other price. Tickets already paid keep the money actually received.
   * req: { participants, scenario?, prices: [{ price, groupPrice }] } (a blank groupPrice means group size x price, no discount)
   * With `scenario` ('conservative' | 'middle' | 'optimistic') the answer uses that scenario's cost cushion and only the
   * FIRM part of the sponsorship it counts (so "conservative, collected only" stays collected only, and hoped-for money is
   * never counted). Without it, the firm-money basis of break-even is used.
   */
  function whatWouldChange(state, option, req = {}) {
    let firmCtx = firmContext(state, option);
    if (SCENARIO_KEYS.includes(req.scenario)) {
      const sc = scenarioContext(state, option, req.scenario);
      firmCtx = { ...sc, statuses: sc.statuses.filter((s) => s === 'collected' || s === 'committed'), extraRevenuePerParticipant: 0, otherRevenue: 0 };
    }
    const target = nonNeg((state.settings || {}).fundraisingTarget);
    const goalC = c(target);
    const at = project(option, req.participants, firmCtx);
    const n = at.participants;
    const netC = c(at.net);
    const curve = netCurve(option, firmCtx);
    const best = curve.reduce((hi, p) => (p.net > hi.net ? p : hi), curve[0] || { participants: 0, net: at.net });
    const above = curve.filter((p) => p.participants > n);
    const bestAbove = above.reduce((hi, p) => (!hi || p.net > hi.net ? p : hi), null);
    const step = participantStep(option);
    const next = n + step <= maxFeasible(option) ? project(option, n + step, firmCtx) : null;
    const reachAbove = (goal) => { const p = above.find((q) => c(q.net) >= goal); return p ? p.participants : null; };
    const moreHelps = !!bestAbove && c(bestAbove.net) > netC;
    const tg = participantsNeeded(option, target, firmCtx);
    const be = participantsNeeded(option, 0, firmCtx);
    const sp = sponsorshipCashCents(option, firmCtx.sponsorships, firmCtx.statuses);
    const size = Math.max(1, int(option.groupSize) || 1);
    const gpNow = option.groupPrice !== undefined ? option.groupPrice : option.foursomePrice;
    const priceFor = (typed) => {
      // The SAME option the plan would hold after "Use … in my plan" (hypotheticalPrice), so preview and apply agree.
      const hyp = hypotheticalPrice(option, typed);
      const alt = { ...option, price: hyp.price, groupPrice: hyp.groupPrice, foursomePrice: undefined };
      const r = project(alt, n, firmCtx), rc = c(r.net);
      const beA = participantsNeeded(alt, 0, firmCtx), tgA = participantsNeeded(alt, target, firmCtx);
      const nx = n + step <= maxFeasible(alt) ? project(alt, n + step, firmCtx) : null;
      return {
        price: hyp.price, groupPrice: size > 1 ? d(groupPriceCents(alt)) : null, groupPriceSource: hyp.groupPriceSource,
        apply: { price: hyp.price, groupPrice: hyp.groupPrice },
        participants: r.participants, net: d(rc), changeFromCurrent: d(rc - netC),
        nextParticipants: nx ? nx.participants : null, nextChange: nx ? d(c(nx.net) - rc) : null,
        sponsorshipToBreakEven: d(Math.max(0, -rc)), sponsorshipToGoal: target > 0 ? d(Math.max(0, goalC - rc)) : null,
        breakEven: beA.reachableWithinCapacity ? beA.participants : null, breakEvenDipsAt: beA.dipsAt,
        goalParticipants: target > 0 && tgA.reachableWithinCapacity ? tgA.participants : null,
        margins: pricingMargins(alt, n),
      };
    };
    const prices = (req.prices || []).filter((p) => p && p.price !== '' && p.price != null && Number.isFinite(Number(p.price)) && Number(p.price) >= 0)
      .map((p) => priceFor(p));
    return {
      basis: {
        requested: at.requested, participants: n, flags: at.flags, maxFeasible: maxFeasible(option), step,
        scenario: SCENARIO_KEYS.includes(req.scenario) ? req.scenario : null,
        statuses: firmCtx.statuses.slice(), firmSponsorship: d(sp.counted), hopedSponsorship: d(sp.byStatus.hoped),
        leftOut: d(Object.entries(sp.byStatus).filter(([k]) => !firmCtx.statuses.includes(k)).reduce((s, [, v]) => s + v, 0)),
        leftOutByStatus: Object.fromEntries(Object.entries(sp.byStatus).filter(([k, v]) => !firmCtx.statuses.includes(k) && v > 0).map(([k, v]) => [k, d(v)])),
        minimumParticipants: int((option.venueQuote || {}).minimumParticipants),
        costCushionPct: nonNeg(firmCtx.costContingencyPct), paid: int(firmCtx.paidRegistrations),
        paidCash: firmCtx.paidRegistrationCash == null || firmCtx.paidRegistrationCash === '' ? null : d(ci(firmCtx.paidRegistrationCash)),
        price: d(ci(option.price)), groupPrice: size > 1 ? d(groupPriceCents(option)) : null, groupSize: size,
        groupShare: Math.min(1, nonNeg(option.groupShare !== undefined ? option.groupShare : option.foursomeShare)), wholeGroupsOnly: !!option.wholeGroupsOnly,
        groupPriceIsDeal: hasGroupDeal(option, gpNow),
      },
      margins: pricingMargins(option, n),
      net: d(netC), revenue: at.revenue.total, expenses: at.expenses.total, venueMinimumApplied: at.expenses.venueMinimumApplied,
      target,
      sponsorship: { toBreakEven: d(Math.max(0, -netC)), toGoal: target > 0 ? d(Math.max(0, goalC - netC)) : null },
      headcount: {
        moreHelps, nextParticipants: next ? next.participants : null, nextChange: next ? d(c(next.net) - netC) : null,
        toBreakEven: netC >= 0 ? null : reachAbove(0), toGoal: target > 0 && netC < goalC ? reachAbove(goalC) : null,
        breakEvenBelow: netC < 0 && be.reachableWithinCapacity && be.participants < n ? be.participants : null,
      },
      goal: {
        reachableWithinCapacity: tg.reachableWithinCapacity, participants: tg.participants,
        bestOnChart: { participants: best.participants, net: best.net },
        sponsorshipAtBest: target > 0 ? d(Math.max(0, goalC - c(best.net))) : null,
      },
      breakEvenReachable: be.reachableWithinCapacity,
      prices,
    };
  }

  /**
   * The same three questions for every option, side by side, each at its OWN likely (middle) number on the firm-money
   * basis: does firm money reach the goal there, how much cash is needed first, the two-case loss and the chart's low
   * point, and volunteer hours. A comparison, not a recommendation.
   */
  function compareOptions(state) {
    const target = nonNeg((state.settings || {}).fundraisingTarget);
    return (state.options || []).map((o) => {
      const dec = decide(state, o);
      const likely = project(o, (o.scenarioParticipants || {}).middle, firmContext(state, o));
      return {
        id: o.id, name: o.name, status: dec.status, likelyParticipants: likely.participants, firmNetLikely: likely.net,
        meetsGoalAtLikely: target > 0 ? c(likely.net) >= c(target) : null, goalReachableWithinCapacity: dec.targetNeeded.reachableWithinCapacity,
        cashNeededBeforeEvent: dec.exposure.cashNeededBeforeEvent, largestLoss: dec.exposure.largestLoss, cancellationKnown: dec.exposure.cancellationKnown,
        worstOnChartLoss: dec.exposure.worstOnChartLoss, volunteerHours: nonNeg(o.volunteerHours),
      };
    });
  }

  // ---------- contract dates (calendar dates only; they never change the money) ----------
  // Dates are stored as the YYYY-MM-DD text a date box gives, and compared as calendar days. Never through
  // Date.toISOString(), which is UTC and can move a date by a day in the evening (US) or morning (Asia/Pacific).
  const CONTRACT_DATES = [
    ['quoteExpires', 'Quote expires'],
    ['depositDue', 'Deposit due'],
    ['headcountDue', 'Final guaranteed headcount due'],
    ['cancelBy', 'Last day to cancel under the quote’s terms'],
  ];
  const CONTRACT_TEXT = ['quoteSource', 'cancellationNotes', 'weatherNotes'];
  function isCalendarDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, dd] = s.split('-').map(Number);
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || dd < 1) return false;
    return dd <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function daysBetween(fromYMD, toYMD) {
    const u = (s) => { const [y, m, dd] = s.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
    return Math.round((u(toYMD) - u(fromYMD)) / 86400000);
  }
  /**
   * The contract checklist for one option, relative to the calendar date `todayYMD` (passed in, so this stays pure).
   * Each date is 'unknown', 'upcoming', 'today' or 'passed'. The amount owed on cancellation is reported separately from
   * the cancellation date: one is money, the other is a deadline, and either can be unknown.
   */
  function contractChecklist(option, todayYMD) {
    const k = option.contract && typeof option.contract === 'object' ? option.contract : {};
    const today = isCalendarDate(todayYMD) ? todayYMD : null;
    const dates = CONTRACT_DATES.map(([key, label]) => {
      const v = isCalendarDate(k[key]) ? k[key] : null;
      if (!v) return { key, label, date: null, state: 'unknown', days: null };
      const days = today ? daysBetween(today, v) : null;
      return { key, label, date: v, state: days == null ? 'upcoming' : days < 0 ? 'passed' : days === 0 ? 'today' : 'upcoming', days };
    });
    const t = (x) => (typeof x === 'string' ? x.trim() : '');
    const owed = option.cancellationOwed == null || option.cancellationOwed === '' ? null : d(ci(option.cancellationOwed));
    const unresolved = dates.filter((x) => x.state === 'unknown').map((x) => x.label);
    if (owed == null) unresolved.push('Amount owed if you cancel');
    if (!t(k.quoteSource)) unresolved.push('Quote reference or source');
    return {
      quoteDate: isCalendarDate(k.quoteDate) ? k.quoteDate : null,
      dates, cancellationOwed: owed,
      quoteSource: t(k.quoteSource), cancellationNotes: t(k.cancellationNotes), weatherNotes: t(k.weatherNotes),
      passed: dates.filter((x) => x.state === 'passed' || x.state === 'today').map((x) => x.label),
      unresolved,
    };
  }

  // ---------- research records (Batch 1, rows 84-85) ----------
  // Research is what the organizer found out. These functions only summarize it: they never read or change the money
  // model, the evidence counts or the scenarios, and they never forecast attendance, convert units or suggest a price.
  const RESEARCH_UNITS = ['people', 'households', 'businesses', 'organizations', 'other'];
  const AUDIENCE_CATEGORIES = ['parents', 'alumni', 'businesses', 'golfers', 'community', 'staff', 'other'];
  // Where a record comes from (provenance) and whether anyone has checked it (verification) are separate, explicit
  // choices (row 85). Typing a source or a URL never changes either one.
  const PROVENANCES = ['observation', 'estimate', 'fictional'];
  const VERIFICATIONS = ['unchecked', 'checked', 'conflicting'];
  const knownNum = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) && Number(x) >= 0;
  const researchOf = (state) => {
    const r = state && state.research && typeof state.research === 'object' ? state.research : {};
    const arr = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
    return { audiences: arr(r.audiences), comparables: arr(r.comparables), links: arr(r.links) };
  };

  /**
   * Provenance of a record: 'fictional' (an example plan, or marked fictional), 'observation', 'estimate', or
   * 'unrecorded' for records saved before provenance existed. An older record is never promoted because it has a
   * source or a link: it stays 'unrecorded' until the organizer chooses.
   */
  function researchKind(state, record) {
    if ((state && state.isDemo) || (record && (record.fictional === true || record.provenance === 'fictional'))) return 'fictional';
    if (record && (record.provenance === 'observation' || record.provenance === 'estimate')) return record.provenance;
    return 'unrecorded';
  }
  /** Verification: 'checked' only if the organizer chose it. Missing or unknown values read as 'unchecked'. */
  function researchVerification(record) {
    return record && VERIFICATIONS.includes(record.verification) ? record.verification : 'unchecked';
  }
  // In a real plan, fictional records are listed but never counted with real ones. In an example plan everything is
  // fictional, so everything is summarized together and labeled fictional.
  const countsInSummary = (state, rec) => !!(state && state.isDemo) || researchKind(state, rec) !== 'fictional';

  /**
   * Audience worksheet totals, PER COUNTING UNIT (never across units: households are not people, businesses are not
   * golfers). A total is a sum of the organizer's records, not unique people: if any group in the unit is marked as
   * overlapping another IN THE SAME UNIT, the total says so. Unknown values are counted as unknown, never as 0.
   * Fictional records in a real plan are left out and counted separately. Each total says how many of its groups are
   * estimates and how many are unchecked.
   */
  function audienceSummary(state) {
    const all = researchOf(state).audiences;
    const audiences = all.filter((a) => countsInSummary(state, a));
    const ids = new Set(audiences.map((a) => a.id));
    const unitOf = (a) => (RESEARCH_UNITS.includes(a.unit) ? a.unit : 'other');
    const byUnit = new Map();
    const warnings = [];
    for (const a of audiences) {
      const unit = unitOf(a);
      if (!byUnit.has(unit)) byUnit.set(unit, { unit, groups: 0, reachKnown: 0, reachUnknown: 0, reachSum: 0, contactedSum: 0, contactedKnown: 0, respondedSum: 0, respondedKnown: 0, overlapping: [], estimates: 0, observations: 0, unrecorded: 0, fictional: 0, unchecked: 0, conflicting: 0 });
      const u = byUnit.get(unit);
      u.groups += 1;
      const k = researchKind(state, a); u[{ estimate: 'estimates', observation: 'observations', unrecorded: 'unrecorded', fictional: 'fictional' }[k]] += 1;
      const v = researchVerification(a); if (v === 'unchecked') u.unchecked += 1; if (v === 'conflicting') u.conflicting += 1;
      if (knownNum(a.reach)) { u.reachKnown += 1; u.reachSum += Math.floor(Number(a.reach)); } else u.reachUnknown += 1;
      if (knownNum(a.contacted)) { u.contactedKnown += 1; u.contactedSum += Math.floor(Number(a.contacted)); }
      if (knownNum(a.responded)) { u.respondedKnown += 1; u.respondedSum += Math.floor(Number(a.responded)); }
      const sameUnit = (x) => { const o = audiences.find((y) => y.id === x); return o && unitOf(o) === unit; };
      if ((Array.isArray(a.overlapsWith) ? a.overlapsWith : []).some((x) => ids.has(x) && x !== a.id && sameUnit(x))) u.overlapping.push(a.id);
      const name = a.name || 'An audience group';
      if (knownNum(a.reach) && knownNum(a.contacted) && Number(a.contacted) > Number(a.reach)) warnings.push(`${name}: more contacted (${Math.floor(Number(a.contacted))}) than the estimated reach (${Math.floor(Number(a.reach))}). Check both numbers.`);
      if (knownNum(a.contacted) && knownNum(a.responded) && Number(a.responded) > Number(a.contacted)) warnings.push(`${name}: more responses (${Math.floor(Number(a.responded))}) than people contacted (${Math.floor(Number(a.contacted))}). Check both numbers.`);
    }
    for (const a of audiences) for (const b of (Array.isArray(a.overlapsWith) ? a.overlapsWith : [])) {
      const other = audiences.find((x) => x.id === b && x.id !== a.id);
      if (!other) continue;
      if (unitOf(a) !== unitOf(other)) {
        const [x, y] = [a, other].sort((p, q) => String(p.id).localeCompare(String(q.id)));
        warnings.push(`${x.name || 'A group'} (${unitOf(x)}) and ${y.name || 'a group'} (${unitOf(y)}) overlap but are counted in different units, so they can't be combined at all.`);
      } else { const u = byUnit.get(unitOf(other)); if (u && !u.overlapping.includes(other.id)) u.overlapping.push(other.id); }
    }
    const units = [...byUnit.values()].map((u) => ({ ...u, reachSum: u.reachKnown ? u.reachSum : null, contactedSum: u.contactedKnown ? u.contactedSum : null,
      respondedSum: u.respondedKnown ? u.respondedSum : null, unique: false, overlaps: u.overlapping.length > 0 }));
    return { units, groups: audiences.length, unitCount: units.length, warnings: [...new Set(warnings)], fictionalLeftOut: all.length - audiences.length };
  }

  /**
   * Similar events linked to one option, as a side-by-side list of observations (row 85). There is deliberately NO
   * combined price range: a safe one would need package contents, admission basis, pricing tier, event year and
   * verification to match, which free-text records can't establish. Each observation carries its own price as
   * advertised, admission unit, date, tier, inclusions, fee status, provenance, verification and source. Notes say
   * what differs across the list. Fictional records in a real plan are listed separately and never mixed in.
   * Group prices stay group prices: no per-person "equivalent" is ever shown as an advertised individual ticket.
   */
  function comparableSummary(state, option) {
    const all = researchOf(state).comparables.filter((c) => Array.isArray(c.optionIds) && c.optionIds.includes(option.id));
    const linked = all.filter((c) => countsInSummary(state, c));
    const fictional = all.filter((c) => !countsInSummary(state, c)).map((c) => ({ id: c.id, name: c.name || 'An event' }));
    const year = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 4) : null);
    const observations = linked.map((c) => ({
      id: c.id, name: c.name || 'An event', provenance: researchKind(state, c), verification: researchVerification(c),
      eventDate: typeof c.eventDate === 'string' && c.eventDate ? c.eventDate : null, year: year(c.eventDate), checkedDate: typeof c.checkedDate === 'string' && c.checkedDate ? c.checkedDate : null,
      priceSingle: knownNum(c.priceSingle) ? d(ci(c.priceSingle)) : null,
      priceGroup: knownNum(c.priceGroup) ? d(ci(c.priceGroup)) : null, groupSize: knownNum(c.groupSize) ? Math.floor(Number(c.groupSize)) : null,
      groupPriceBasis: ['advertised', 'derived'].includes(c.groupPriceBasis) ? c.groupPriceBasis : 'unknown',
      pricingTier: ['early', 'regular', 'single'].includes(c.pricingTier) ? c.pricingTier : 'unknown',
      feesKnown: knownNum(c.feesPerPerson), feesPerPerson: knownNum(c.feesPerPerson) ? d(ci(c.feesPerPerson)) : null,
      included: typeof c.included === 'string' ? c.included.trim() : '', comparability: ['close', 'partial', 'not'].includes(c.comparability) ? c.comparability : 'unknown',
      advertisedCapacity: knownNum(c.advertisedCapacity) ? Math.floor(Number(c.advertisedCapacity)) : null,
      reportedParticipation: knownNum(c.resultAttendance) ? Math.floor(Number(c.resultAttendance)) : null, reportedInWriting: !!c.resultVerified,
    }));
    const notes = [];
    if (!all.length) notes.push('No similar events linked to this option.');
    const years = [...new Set(observations.map((o) => o.year).filter(Boolean))].sort();
    if (years.length > 1) notes.push(`These come from different years (${years.join(', ')}): prices and packages may have changed.`);
    if (observations.some((o) => !o.year)) notes.push('Some events have no date recorded.');
    const tiers = new Set(observations.filter((o) => o.priceSingle != null || o.priceGroup != null).map((o) => o.pricingTier));
    if (tiers.size > 1 || tiers.has('unknown')) notes.push('Pricing tiers differ or are not recorded (early-bird, regular or only price).');
    const fu = observations.filter((o) => !o.feesKnown).length; if (fu) notes.push(`Required fees unknown for ${fu} of ${observations.length}.`);
    const nc = observations.filter((o) => o.verification !== 'checked').length; if (nc) notes.push(`${nc} of ${observations.length} not checked against the source, or conflicting.`);
    if (observations.some((o) => o.comparability !== 'close')) notes.push('Some are marked only partly comparable, not comparable, or not judged yet.');
    if (observations.some((o) => o.priceGroup != null && o.groupPriceBasis !== 'advertised')) notes.push('Some group totals are your own arithmetic or of unknown basis, not advertised offers.');
    if (fictional.length) notes.push(`${fictional.length} fictional record${fictional.length === 1 ? ' is' : 's are'} listed separately and not compared with real ones.`);
    if (observations.length) notes.push('Advertised prices are not proof of demand, and none of this is a recommended price.');
    return {
      optionId: option.id, linked: observations.length, observations, fictional, notes,
      reportedResults: observations.filter((o) => o.reportedParticipation != null).length,
      checked: observations.filter((o) => o.verification === 'checked').length,
    };
  }

  /** References that point at nothing: deleted options, deleted research records, an overlap with a removed group. */
  function researchProblems(state) {
    const { audiences, comparables, links } = researchOf(state);
    const optionIds = new Set((state.options || []).map((o) => o.id));
    const recIds = new Set(audiences.map((a) => a.id).concat(comparables.map((c) => c.id)));
    const audIds = new Set(audiences.map((a) => a.id));
    const out = [];
    const recs = audiences.map((a) => ['audience', a]).concat(comparables.map((c) => ['comparable', c]));
    for (const [kind, r] of recs) {
      for (const id of (Array.isArray(r.optionIds) ? r.optionIds : [])) if (!optionIds.has(id)) out.push({ kind, recordId: r.id, field: 'optionIds', missingId: id, text: `${r.name || 'A record'} is linked to an option that no longer exists.` });
      if (kind === 'audience') for (const id of (Array.isArray(r.overlapsWith) ? r.overlapsWith : [])) if (!audIds.has(id)) out.push({ kind, recordId: r.id, field: 'overlapsWith', missingId: id, text: `${r.name || 'An audience group'} is marked as overlapping a group that was removed.` });
    }
    for (const l of links) {
      if (!optionIds.has(l.optionId)) out.push({ kind: 'link', recordId: l.id, field: 'optionId', missingId: l.optionId, text: 'An assumption note refers to an option that no longer exists.' });
      for (const id of (Array.isArray(l.researchIds) ? l.researchIds : [])) if (!recIds.has(id)) out.push({ kind: 'link', recordId: l.id, field: 'researchIds', missingId: id, text: 'An assumption note cites a research record that was removed.' });
    }
    return out;
  }

  // ---------- Batch 2: interest by offer, capacity shortcuts, same-turnout comparison (row 87) ----------
  // All of these only read the plan and reuse project(): no new money rules, no forecasts, no probabilities.

  /**
   * One option's evidence, stage by stage, never added together: who was sent the survey and who answered (the whole
   * survey), interest in this option (named "yes", anonymous "yes", "maybe"), paid sign-ups and money actually received.
   * Interest counts belong to the offer they were collected for: named "yes" counts toward the decision only when the
   * offer is current. Past rounds (kept when an offer changed) are listed, never summed with current answers.
   */
  function interestFunnel(state, option) {
    const ev = (state && state.evidence) || {};
    const n = (k) => { const v = (ev[k] || {})[option.id]; return knownNum(v) ? Math.floor(Number(v)) : 0; };
    const cash = (ev.paidCashReceived || {})[option.id];
    const st = evidenceStatus(state, option);
    const rounds = Array.isArray((ev.offerHistory || {})[option.id]) ? ev.offerHistory[option.id].filter((r) => r && typeof r === 'object') : [];
    const named = n('namedHighIntent');
    return {
      contacted: knownNum(ev.surveyContacted) ? Math.floor(Number(ev.surveyContacted)) : null,
      responses: knownNum(ev.surveyResponses) ? Math.floor(Number(ev.surveyResponses)) : null,
      named, anonymousYes: n('surveyDefinitelyAtPrice'), maybe: n('surveyProbablyAtPrice'),
      namedCounted: st.state === 'current' ? named : 0,
      paid: n('paidRegistrations'), cashReceived: cash == null || cash === '' || !knownNum(cash) ? null : d(ci(cash)),
      offerState: st.state, offerChanged: st.changed, terms: st.recorded || null,
      pastRounds: rounds.map((r) => ({
        id: r.id, archivedOn: typeof r.archivedOn === 'string' ? r.archivedOn : null, terms: r.terms && typeof r.terms === 'object' ? r.terms : null,
        named: knownNum(r.named) ? Math.floor(Number(r.named)) : 0, anonymousYes: knownNum(r.definitely) ? Math.floor(Number(r.definitely)) : 0,
        maybe: knownNum(r.probably) ? Math.floor(Number(r.probably)) : 0,
        responses: knownNum(r.surveyResponses) ? Math.floor(Number(r.surveyResponses)) : null, contacted: knownNum(r.surveyContacted) ? Math.floor(Number(r.surveyContacted)) : null,
      })),
    };
  }

  /**
   * 50%, 75% and 100% of the capacity entered, as previews for one scenario. Each is rounded DOWN to whole groups when
   * required and never above capacity (normalizeParticipants), then run through project() with that scenario's own
   * assumptions, and through the firm-money basis. Venue minimums, deposit floors, group pricing and money already
   * received are handled by project(). A shortcut below the number already paid is marked and must not be applied.
   * These are arithmetic on capacity, not evidence that this many will come.
   */
  function capacityShortcuts(state, option, scenarioKey) {
    const k = SCENARIO_KEYS.includes(scenarioKey) ? scenarioKey : 'middle';
    const cap = int(option.capacity), max = maxFeasible(option);
    if (!max) return { available: false, scenario: k, rows: [] };
    const ctx = scenarioContext(state, option, k), firm = firmContext(state, option);
    const paid = int(ctx.paidRegistrations);
    const current = int((option.scenarioParticipants || {})[k]);
    const rows = [50, 75, 100].map((pct) => {
      const requested = Math.floor((cap * pct) / 100);
      const norm = normalizeParticipants(option, requested);
      const nn = norm.participants;
      const p = project(option, nn, ctx), f = project(option, nn, firm);
      return {
        pct, requested, participants: nn, flags: norm.flags,
        revenue: p.revenue.total, expenses: p.expenses.total, net: p.net, firmNet: f.net,
        cashNeeded: p.upfront.required, cashInHand: p.upfront.cashInHand, cashShort: p.upfront.gap,
        venueMinimumApplied: p.expenses.venueMinimumApplied, belowPaid: nn < paid, isCurrent: nn === current,
      };
    });
    return { available: true, scenario: k, paid, capacity: cap, maxFeasible: max, current, rows };
  }

  // What one participant is, per kind of fundraiser. Two options can be compared at "the same turnout" only when they
  // count the same thing: 48 guests and 48 items are not the same turnout (row 88).
  const UNIT_OF_KIND = { golf_tee_times: 'players', golf_shotgun: 'players', participation: 'participants', ticketed: 'guests', auction: 'guests', product: 'items', generic: 'people' };
  const unitOf = (o) => UNIT_OF_KIND[o && o.kind] || 'people';

  /**
   * Two options (for example tee times and a shotgun start) at the SAME requested number of participants, on the
   * firm-money basis. Each is rounded to its own whole groups. Reports the extra documented cost of the costlier one,
   * the extra firm sponsorship that would make its firm net match the other's at that number, and the smallest number
   * of ADDITIONAL paying participants on the costlier option that would do it (an exact scan of its own chart, so group
   * pricing, minimums and deposit floors are handled), or that it can't be recovered within capacity.
   * It assumes nothing about one format attracting more people or a higher price: that would be the organizer's
   * assumption, kept out of these numbers.
   * Withheld or limited (row 88):
   *  - comparable:false, reason 'units': the options count different things (guests vs items); no figures at all.
   *  - reason 'belowPaid': either side would be below the number already paid (including a capacity below it); the
   *    figures and project()'s own warnings are kept, recovery figures are null. Money received is never changed.
   *  - reason 'equalCosts': recovery figures are null (not applicable); the firm-money difference is still reported.
   */
  function compareAtSameTurnout(state, a, b, requested) {
    const units = { a: unitOf(a), b: unitOf(b) };
    if (units.a !== units.b) return { comparable: false, reason: 'units', units, aName: a.name, bName: b.name };
    const side = (o) => {
      const ctx = firmContext(state, o), norm = normalizeParticipants(o, requested), p = project(o, norm.participants, ctx);
      const paid = int(ctx.paidRegistrations), max = maxFeasible(o);
      return {
        o, ctx, id: o.id, name: o.name, requested: norm.requested, participants: p.participants,
        flags: Array.from(new Set([...(p.flags || []), ...(norm.flags || [])])), // project()'s warnings are kept
        paid, belowPaid: p.participants < paid, capacityBelowPaid: max < paid, maxFeasible: max,
        revenue: p.revenue.total, expenses: p.expenses.total, net: p.net,
        costs: { venue: p.expenses.venue, perParticipant: p.expenses.perParticipant, fixed: p.expenses.fixed, separateDepositFee: p.expenses.separateDepositFee, contingency: p.expenses.contingency },
        venueMinimumApplied: p.expenses.venueMinimumApplied, cashNeeded: p.upfront.required, quoteVerified: !!o.quoteVerified, costsVerified: !!o.costsVerified,
      };
    };
    const A = side(a), B = side(b);
    const strip = (x) => { const { o, ctx, ...rest } = x; return rest; };
    const ea = c(A.expenses), eb = c(B.expenses);
    const base = { comparable: true, units, a: strip(A), b: strip(B), sameCount: A.participants === B.participants,
      extraCost: d(Math.abs(eb - ea)), netDifference: d(Math.abs(c(A.net) - c(B.net))),
      higherNetId: c(A.net) === c(B.net) ? null : (c(A.net) > c(B.net) ? A.id : B.id) };
    const notApplicable = { sponsorshipToCover: null, playersToCover: null, recoverable: null, recoveryApplicable: false };
    const costlierId = ea === eb ? null : (ea < eb ? B.id : A.id);
    if (A.belowPaid || B.belowPaid) return { ...base, ...notApplicable, reason: 'belowPaid', costlierId };
    if (ea === eb) return { ...base, ...notApplicable, reason: 'equalCosts', costlierId: null };
    const [X, Y] = ea < eb ? [A, B] : [B, A]; // X costs less; Y costs more
    const target = c(X.net), gap = target - c(Y.net);
    let players = 0, recoverable = true;
    if (gap > 0) {
      const above = netCurve(Y.o, Y.ctx).filter((pt) => pt.participants > Y.participants);
      const hit = above.find((pt) => c(pt.net) >= target);
      if (hit) players = hit.participants - Y.participants; else { players = null; recoverable = false; }
    }
    return {
      ...base, reason: null, recoveryApplicable: true, costlierId: Y.id, cheaperId: X.id,
      extraRevenue: d(c(Y.revenue) - c(X.revenue)),
      netGap: d(Math.max(0, gap)), sponsorshipToCover: d(Math.max(0, gap)),
      playersToCover: players, recoverable, maxFeasibleCostlier: maxFeasible(Y.o),
    };
  }

  const STATUS_LABELS = {
    not_enough_evidence: 'Not enough evidence to decide yet',
    not_viable_as_configured: 'Not viable as currently configured',
    high_risk: 'High financial risk',
    supported_with_open_items: 'Numbers hold up so far, but open items remain',
    supported_by_current_evidence: 'Supported by current evidence (not a guarantee)',
  };

  const api = {
    SPONSOR_STATUSES, STATUS_LABELS,
    participantStep, maxFeasible, feasibleCounts, normalizeParticipants,
    registrationCents, worstCase, cancellationExposure, roundHeadline,
    project, participantsNeeded, netCurve, sensitivity, scenarioContext, firmContext, decide, offerTerms, evidenceStatus,
    whatWouldChange, compareOptions, hypotheticalPrice, pricingMargins,
    interestFunnel, capacityShortcuts, compareAtSameTurnout, unitOf,
    audienceSummary, comparableSummary, researchProblems, researchKind, researchVerification, RESEARCH_UNITS, AUDIENCE_CATEGORIES, PROVENANCES, VERIFICATIONS, contractChecklist, isCalendarDate, daysBetween, CONTRACT_DATES, CONTRACT_TEXT,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
