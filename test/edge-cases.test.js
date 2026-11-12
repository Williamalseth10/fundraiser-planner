// Edge cases found while finishing the planner for first real use (DECISION_LOG.md rows 61 onward).
// Each test was written to fail on 9143a07 before the fix, unless marked "guard" (a rule that already held).
// All numbers are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const sc = (extra = {}) => ({ label: 'x', statuses: ['collected', 'committed'], extraRevenuePerParticipant: 0, otherRevenue: 0, costContingencyPct: 0, ...extra });
const base = (extra = {}) => ({
  id: 'a', name: 'A', kind: 'golf_tee_times', capacity: 40, groupSize: 1, wholeGroupsOnly: false, price: 100, groupPrice: null, groupShare: 0,
  venueQuote: { flatFee: 0, perParticipant: 50, minimumParticipants: 0, minimumSpend: 0 },
  deposit: { amount: 0, creditedTowardBill: true, refundable: false },
  perParticipantCosts: [], fixedCosts: [{ id: 'p', label: 'Prizes', amount: 500, paidUpfront: true }],
  volunteerHours: 0, cancellationOwed: 0, quoteVerified: true, costsVerified: true,
  scenarioParticipants: { conservative: 5, middle: 20, optimistic: 30 }, ...extra,
});
const stateFor = (o, ev = {}, conservative = {}) => {
  const s = {
    settings: { fundraisingTarget: 0 }, volunteerHoursAvailable: 100, snapshot: {}, sponsorships: [], options: [o],
    scenarioSettings: { conservative: sc(conservative), middle: sc(), optimistic: sc() },
    evidence: { surveyResponses: 10, paidRegistrations: { a: 2 }, paidCashReceived: { a: 200 }, namedHighIntent: { a: 10 }, ...ev },
  };
  s.evidence.offerTerms = { a: E.offerTerms(o, s.snapshot) };
  return s;
};

test('assumed add-ons cannot rescue the low case: firm money losing at the low number is high risk', () => {
  // Low number 5: firm money = 2 paid ($200) + 3 x $100 = $500 revenue; costs 5 x $50 + $500 = $750 -> firm net -$250.
  // With a $200/person add-on assumption the conservative scenario shows +$750. Before the fix: "Numbers hold up so far".
  const o = base();
  const d = E.decide(stateFor(o, {}, { extraRevenuePerParticipant: 200 }), o);
  assert.equal(d.firm.net, -250);
  assert.equal(d.conservative.net, 750);
  assert.equal(d.status, 'high_risk');
  assert.ok(d.reasons.some((r) => /firm money alone/i.test(r) && /add-ons/.test(r)), d.reasons.join(' | '));
});

test('guard: without assumptions the same low case is still high risk (conservative net < 0)', () => {
  const o = base();
  assert.equal(E.decide(stateFor(o), o).status, 'high_risk');
});

test('net falling again above break-even names the headcount and the cause when each extra person costs more than they pay', () => {
  // Free admission, $50 per guest: the 12 paid tickets ($1,200 received) cover costs at 12, then each extra guest loses $50.
  const o = base({ kind: 'ticketed', price: 0, scenarioParticipants: { conservative: 12, middle: 14, optimistic: 20 } });
  const d = E.decide(stateFor(o, { paidRegistrations: { a: 12 }, paidCashReceived: { a: 1200 }, namedHighIntent: {} }), o);
  assert.equal(d.status, 'high_risk');
  assert.equal(d.breakEven.dipsAt, 15);
  const r = d.reasons.join(' ');
  assert.match(r, /15/);
  assert.match(r, /costs more than/);
  assert.doesNotMatch(r, /usually because of group pricing/);
});

test('more people already paid than the capacity entered is flagged for checking', () => {
  const o = base({ capacity: 5 });
  const d = E.decide(stateFor(o, { paidRegistrations: { a: 12 }, paidCashReceived: { a: 1200 } }), o);
  assert.ok(d.missing.some((m) => /12 .*paid.*capacity.*5/i.test(m)), d.missing.join(' | '));
  assert.notEqual(d.status, 'supported_by_current_evidence');
});

test('negative money typed or imported is treated as zero, never as income or a refund', () => {
  const o = base({ price: -50, fixedCosts: [{ id: 'p', label: 'Prizes', amount: -500, paidUpfront: true }],
    venueQuote: { flatFee: -100, perParticipant: -50, minimumParticipants: -3, minimumSpend: -10 }, deposit: { amount: -200, creditedTowardBill: false, refundable: false } });
  const r = E.project(o, 10, { sponsorships: [{ id: 's', label: 's', amount: -1000, status: 'collected', type: 'cash' }], extraRevenuePerParticipant: -5, otherRevenue: -100 });
  assert.equal(r.revenue.total, 0);
  assert.equal(r.expenses.total, 0);
  assert.equal(r.upfront.required, 0);
  assert.equal(r.upfront.cashInHand, 0);
});

test('guard: text and blank values in money fields count as zero; capacity given as text still works', () => {
  const o = base({ price: 'abc', capacity: '20', venueQuote: { perParticipant: null }, fixedCosts: [] });
  assert.equal(E.project(o, 5, {}).net, 0);
  assert.equal(E.maxFeasible(o), 20);
});

test('guard: unusual group sizes (3 with whole groups, capacity not a multiple) round down and never invent people', () => {
  const o = base({ groupSize: 3, wholeGroupsOnly: true, capacity: 10 });
  assert.deepEqual(E.feasibleCounts(o), [0, 3, 6, 9]);
  assert.deepEqual(E.normalizeParticipants(o, 10), { requested: 10, participants: 9, flags: ['over_capacity'] });
  assert.equal(E.participantStep(base({ groupSize: 0, wholeGroupsOnly: true })), 1);
});

test('guard: deposits. Credited non-refundable = bill floor; separate non-refundable = extra cost; refundable = cash out, not a cost', () => {
  const at0 = (deposit) => { const o = base({ deposit }); const p = E.project(o, 0, {}); return [E.worstCase(o, []).contractualFloor, p.expenses.total, p.upfront.required]; };
  assert.deepEqual(at0({ amount: 1000, creditedTowardBill: true, refundable: false }), [1000, 1500, 1500]);
  assert.deepEqual(at0({ amount: 1000, creditedTowardBill: true, refundable: true }), [0, 500, 1500]);
  assert.deepEqual(at0({ amount: 1000, creditedTowardBill: false, refundable: false }), [1000, 1500, 1500]);
  assert.deepEqual(at0({ amount: 1000, creditedTowardBill: false, refundable: true }), [0, 500, 1500]);
});

test('guard: two in-kind gifts for the same cost never reduce it below zero', () => {
  const sp = [{ id: 's1', label: 'k1', amount: 800, status: 'committed', type: 'inKind', replacesCostId: 'p' },
    { id: 's2', label: 'k2', amount: 300, status: 'committed', type: 'inKind', replacesCostId: 'p' }];
  const r = E.project(base(), 10, { sponsorships: sp, statuses: ['collected', 'committed'] });
  assert.equal(r.expenses.fixed, 0);
  assert.equal(r.revenue.total, 1000); // in-kind is never revenue
});

test('free-admission auction that works only with auction money is high risk, and the reason reads plainly', () => {
  const o = base({ kind: 'auction', price: 0, scenarioProceeds: { conservative: 3000, middle: 5000, optimistic: 8000 } });
  const d = E.decide(stateFor(o, { paidRegistrations: {}, paidCashReceived: {}, namedHighIntent: {} }), o);
  assert.equal(d.status, 'high_risk');
  const r = d.reasons[0];
  assert.doesNotMatch(r, /money come in/);
  assert.doesNotMatch(r, /with 0 paying/);
  assert.match(r, /auction or raffle money/);
});

test('one open item reads "1 item still needs checking"', () => {
  const o = base({ scenarioParticipants: { conservative: 12, middle: 20, optimistic: 30 } });
  const s = stateFor(o, { paidRegistrations: { a: 12 }, paidCashReceived: { a: 1200 } });
  s.volunteerHoursAvailable = null;
  const d = E.decide(s, o);
  assert.equal(d.status, 'supported_with_open_items');
  assert.ok(d.reasons.some((x) => /^1 item below still needs checking/.test(x)), d.reasons.join(' | '));
});

test('exposure summary: cash needed up front and the most that could be lost under the entered terms', () => {
  // Non-refundable credited deposit $1,000; prizes $500 paid in advance; cancellation owed $1,000.
  const o = base({ deposit: { amount: 1000, creditedTowardBill: true, refundable: false }, cancellationOwed: 1000 });
  const d = E.decide(stateFor(o, { paidRegistrations: {}, paidCashReceived: {} }), o);
  assert.equal(d.exposure.cashNeededBeforeEvent, 1500);
  // Nobody comes: bill floor $1,000 + prizes $500 = $1,500 lost. Canceling: $1,000 owed + $500 already spent = $1,500.
  assert.equal(d.exposure.lossIfNobodyComes, 1500);
  assert.equal(d.exposure.lossIfCanceled, 1500);
  assert.equal(d.exposure.largestLoss, 1500);
  // Unknown cancellation terms: the largest loss is marked incomplete rather than guessed.
  const o2 = base({ cancellationOwed: null });
  const d2 = E.decide(stateFor(o2, { paidRegistrations: {}, paidCashReceived: {} }), o2);
  assert.equal(d2.exposure.lossIfCanceled, null);
  assert.equal(d2.exposure.cancellationKnown, false);
});

test('an unreachable target is mentioned only when the event can break even (no "most it could raise is $-2,640")', () => {
  const notViable = base({ price: 10, scenarioParticipants: { conservative: 5, middle: 10, optimistic: 20 } });
  const s1 = stateFor(notViable, { paidRegistrations: {}, paidCashReceived: {} }); s1.settings.fundraisingTarget = 2000;
  const d1 = E.decide(s1, notViable);
  assert.equal(d1.status, 'not_viable_as_configured');
  assert.ok(!d1.reasons.some((r) => /most it could raise/.test(r)), d1.reasons.join(' | '));
  const viable = base({ scenarioParticipants: { conservative: 20, middle: 30, optimistic: 40 } });
  const s2 = stateFor(viable); s2.settings.fundraisingTarget = 100000;
  assert.ok(E.decide(s2, viable).reasons.some((r) => /target is not reachable.*most it could raise is \$1,500\)/.test(r)));
});

test('exposure names the worst point on the firm-money chart, so a $0 "nothing sells or cancel" case is never the only loss shown', () => {
  // Fictional review case: $10 price, $15 supplier cost per item, capacity 100, nothing else.
  const o = base({ kind: 'product', price: 10, capacity: 100, fixedCosts: [], cancellationOwed: 0,
    venueQuote: { flatFee: 0, perParticipant: 15, minimumParticipants: 0, minimumSpend: 0 },
    deposit: { amount: 0, creditedTowardBill: true, refundable: true }, scenarioParticipants: { conservative: 10, middle: 50, optimistic: 100 } });
  const d = E.decide(stateFor(o, { paidRegistrations: {}, paidCashReceived: {} }), o);
  assert.equal(d.status, 'high_risk');                       // the existing safeguard stays
  assert.equal(d.exposure.lossIfNobodyComes, 0);
  assert.equal(d.exposure.lossIfCanceled, 0);
  assert.deepEqual(d.exposure.worstOnChart, { participants: 100, net: -500 });
  assert.equal(d.exposure.worstOnChartLoss, 500);
});
