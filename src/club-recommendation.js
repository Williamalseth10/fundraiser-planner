// A shortlist of the club's own options using the existing financial and readiness rules.
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.BFEngine;
  const keys = ['conservative', 'middle', 'optimistic'];
  const dollar = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const money = (n) => dollar.format(n);
  const gap = (reason, next, edit) => ({ status: 'needsInput', reason, next, ...(edit && { edit }) });
  const revise = (reason, next) => ({ status: 'revise', reason, next });

  const missingFigures = {
    noCapacity: ['Capacity is unknown or zero.', 'Confirm the maximum the venue or supplier can accommodate.'],
    capacityBelowPaid: ['The capacity cannot accommodate the recorded paid count.', 'Reconcile capacity and payments with the club’s records.'],
    paidCashMissing: ['The club recorded paid sales without the amount received.', 'Enter the actual receipts for those sales.'],
    cashWithoutPaid: ['Ticket or order money is recorded with no paid sales.', 'Reconcile the paid count and receipts.'],
    missingPrice: ['The selling price is missing.', 'Enter the price the club would actually offer.'],
    depositTerms: ['The deposit terms are incomplete.', 'Check the written quote and record whether the deposit counts toward the final bill and whether it is refundable.'],
    missingQuote: ['Some quote amounts are unknown.', 'Enter the quoted charges, minimums and deposit. Use zero only for a confirmed zero.'],
    missingCost: ['At least one expense has no amount.', 'Fill in the missing expense from the quote or supplier.'],
    missing: ['At least one turnout assumption is missing.', 'Enter the club’s low, likely and high counts.'],
    belowPaid: ['A turnout assumption falls below the paid count.', 'Check the turnout entries against the paid count.'],
    missingBid: ['At least one auction case lacks an estimate of net bidding proceeds.', 'Enter the low, likely and high bid estimates after selling fees.'],
  };

  function checkTiming(option, today, decideBy) {
    if (!E.isCalendarDate(today)) return gap('The contract dates could not be checked against today.', 'Reopen the planner with the correct local date.');
    if (decideBy && decideBy < today) return gap('The board’s decision date has passed.', 'Confirm the board’s new decision date and recheck the offer.');
    const checklist = E.contractChecklist(option, today);
    if (checklist.quoteDate && checklist.quoteDate > today) return gap('The recorded quote is dated in the future.', 'Check the date on the written offer.');
    const upcoming = checklist.dates.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
    const deadline = upcoming.find((d) => d.date <= today || (decideBy && d.date < decideBy));
    if (deadline) return gap(`The contract lists “${deadline.label}” on ${deadline.date}, ${deadline.date < today ? 'which has passed' : deadline.date === today ? 'which is today' : 'before the board’s decision date'}.`, 'Confirm current terms and the board’s timing with the supplier before shortlisting.');
    return null;
  }

  function assess(option, brief, ready, today) {
    const { conservative: low, middle, optimistic: high } = brief.cases;
    const [minimum, loss, hours, deadline] = ready.criteria;
    const issue = keys.map((key) => brief.cases[key].issue).find(Boolean);
    if (issue) return gap(...(missingFigures[issue] || ['One of the scenario figures needs review.', 'Check the flagged inputs in the event figures.']));
    const adjusted = keys.find((key) => brief.cases[key].requested !== brief.cases[key].participants);
    if (adjusted) {
      return gap('A turnout count changes when capacity or whole groups are applied.', 'Enter feasible whole counts for all three cases, then compare again.',
        { step: 'scenarios', field: 'scenarioParticipants.' + adjusted });
    }
    if (low.participants > middle.participants || middle.participants > high.participants) {
      return gap('The turnout assumptions are out of order.', 'Check that low ≤ likely ≤ high.',
        { step: 'scenarios', field: 'scenarioParticipants.' + (low.participants > middle.participants ? 'conservative' : 'optimistic') });
    }
    if (option.quoteVerified !== true || option.costsVerified !== true) {
      const edit = option.quoteVerified !== true ? { step: 'quote', field: 'quoteVerified' } : { step: 'costs', field: 'costsVerified' };
      return gap('The quote or other costs still need checking.', 'Verify the written terms and costs for this option.', edit);
    }
    const timing = checkTiming(option, today, deadline.date);
    if (timing) return timing;
    if (minimum.result === 'unknown' || loss.threshold == null) return gap('The club’s minimum proceeds or acceptable loss is missing.', 'Agree on both amounts in the club limits.');
    if (loss.parts.some((part) => part.result === 'unmet')) {
      const part = loss.parts.find((p) => p.result === 'unmet');
      const exposure = part.key === 'cancel' ? 'Canceling under the quote' : 'Holding the event at a feasible turnout';
      return revise(`${exposure} could lose ${money(part.loss)}, above the club’s ${money(loss.threshold)} limit.`, 'Negotiate the terms or reduce the exposed costs and compare again.');
    }
    if (loss.result !== 'met') return gap('The possible loss cannot be checked against the club’s limit.', 'Confirm the amount owed on cancellation and check the feasible turnout range.');
    if (minimum.result === 'unmet' || middle.firmNet <= 0) return revise(`The comparison net at the likely turnout is ${money(middle.firmNet)} after the low-case cost cushion. The club’s minimum is ${money(minimum.threshold)}.`, 'Test a lower cost or secure additional firm revenue to generate a surplus that meets the club minimum.');
    if (hours.result === 'unmet') return revise(`The event needs ${hours.need} volunteer hours and the club has ${hours.available}.`, 'Reduce the work or confirm more volunteer hours.');
    if (hours.result === 'unknown') return gap('Volunteer need or availability is missing.', 'Enter hours needed for this option and hours the club can provide.',
      { step: 'volunteers', field: hours.need == null ? 'volunteerHours' : 'volunteerHoursAvailable' });
    if (ready.cash.short > 0 && option.upfrontFundingConfirmed !== true) return gap(`The upfront bills exceed cash in hand by ${money(ready.cash.short)}.`, 'Identify and confirm funding for the upfront gap. A written sponsor pledge is separate from cash received.',
      { step: 'quote', field: 'upfrontFundingConfirmed' });
    if (brief.atPaidOnly.issue === 'partialGroup') return gap('The paid count includes part of a group on a whole-group offer.', 'Reconcile the paid count and group terms without adding unpaid people to complete a group.');
    if (middle.participants > brief.paid + brief.namedAtCurrentOffer) {
      const stale = ['stale', 'unrecorded'].includes(ready.attendance.evidenceState);
      return gap(`The likely count of ${middle.participants} ${brief.unit} has ${brief.paid} paid and ${brief.namedAtCurrentOffer} additional named expressions of interest at the current offer.`, stale ? 'Reconfirm named interest at the current price and terms, then revisit the turnout assumption.' : 'Check demand at this price or revise the likely count using club records.');
    }
    if (ready.status === 'high_risk' || ready.status === 'not_viable_as_configured') {
      return revise(low.firmNet < 0 ? `The low case loses ${money(-low.firmNet)} on sales and firm sponsorship.` : 'The financial analysis flags a loss or an unreliable break-even point.', 'Review the loss and break-even details, then test a different price, cost or event size.');
    }
    if (!['supported_by_current_evidence', 'supported_with_open_items'].includes(ready.status)) return gap('The financial analysis still calls for evidence of demand or break-even coverage.', 'Check paid sales and named interest at the current offer against the break-even count.');
    const cash = ready.cash.short > 0 ? ` The club confirmed funding for its ${money(ready.cash.short)} upfront gap.` : '';
    const downside = minimum.lowMeets === false ? ` At the low count of ${low.participants}, firm net falls to ${money(low.firmNet)}, below the club’s ${money(minimum.threshold)} minimum.` : '';
    const next = ready.contract.unresolved.length ? 'Confirm any unrecorded contract deadlines, then take the quote, receipts and turnout assumptions to the board.' : 'Take the quote, receipts and turnout assumptions to the board.';
    return { status: 'eligible', reason: `At ${middle.participants} ${brief.unit}, the comparison net is ${money(middle.firmNet)} using sales, collected or written sponsorship, and the low-case cost cushion. ${brief.paid} paid. ${brief.namedAtCurrentOffer} additional named expressions of interest at the current offer. Both loss checks and volunteer hours fit the club’s limits.${cash}${downside}`, next: `${next} Recheck the ranking if turnout, terms, sponsorship or staffing changes.` };
  }

  // Pass a local YYYY-MM-DD date. Optional precomputed rows reuse the brief and readiness calculations
  // for each option in plan order from this same call site. Ranking compares net dollars at each option’s own turnout.
  function recommendEvents(state, today, precomputed) {
    const options = (state.options || []).map((option, i) => {
      const prior = precomputed && precomputed[i];
      const brief = prior && prior.brief || E.decisionBrief(state, option);
      const ready = prior && prior.ready || E.readiness(state, option, today);
      const assessment = assess(option, brief, ready, today);
      return { id: option.id, name: option.name || 'Unnamed option', rank: null, firmNet: brief.cases.middle.firmNet, ...assessment, brief };
    });
    const eligible = options.filter((o) => o.status === 'eligible');
    const pending = options.filter((o) => o.status === 'needsInput');
    const comparison = E.compareClubEstimates(eligible.map((o) => o.brief));
    // The single-option case needs no comparison. The engine handles exact-cent ties across two or more.
    const leaders = eligible.length === 1 ? eligible : comparison.leaderIndices.map((i) => eligible[i]);
    for (const row of options) delete row.brief;
    const summary = (status, title, reason, next) => ({ status, title, reason, next, options });
    if (state.isDemo) {
      for (const o of options) { o.status = 'practice'; o.next = 'Use the club’s own records to evaluate a real event.'; }
      return summary('practice', 'Practice plan', 'These options contain fictional numbers.', 'Start a club plan to get a recommendation from your own evidence.');
    }
    if (!options.length) return summary('needsInput', 'Add an event to compare', 'A recommendation starts with one of the club’s own ideas.', 'Choose an event type and enter its details.');
    if (!leaders.length) {
      const first = pending[0] || options[0];
      return summary(pending.length ? 'needsInput' : 'revise', pending.length ? 'Gather evidence before choosing' : 'Revise the options before deciding', `${first.name} — ${first.reason}`, first.next);
    }
    for (const o of eligible) o.rank = 1 + eligible.filter((other) => Math.round(other.firmNet * 100) > Math.round(o.firmNet * 100)).length;
    const names = leaders.map((o) => o.name).join(' and ');
    const tie = leaders.length > 1;
    const title = pending.length ? 'Keep the overall choice open' : tie ? `Take ${names} to the board together` : `Take ${names} to the board for review`;
    const reason = tie ? `These options tie at a comparison net of ${money(leaders[0].firmNet)} at their respective likely turnouts.` : eligible.length > 1 ? `Of the options meeting the club’s checks, ${names} has the highest comparison net at its likely turnout, ${money(leaders[0].firmNet)}. Each event uses its own turnout assumption.` : pending.length ? `${names} meets the current checks. ${leaders[0].reason}` : leaders[0].reason;
    const pendingText = pending.length ? ` Comparison is incomplete for ${pending.map((o) => o.name).join(', ')}. The overall choice is open.` : '';
    const next = pending.length ? `For ${pending[0].name}, ${pending[0].next.charAt(0).toLowerCase() + pending[0].next.slice(1)}` : tie ? 'Compare the upfront cash, downside and volunteer hours before the board selects between them.' : leaders[0].next;
    return summary(pending.length ? 'conditional' : tie ? 'tie' : 'shortlist', title, reason + pendingText, next);
  }

  const api = { recommendEvents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFRecommendations = api;
})(typeof window !== 'undefined' ? window : globalThis);
