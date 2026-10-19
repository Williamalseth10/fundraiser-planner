// Regression tests for the independent audit of commit e68f4e3 (see DECISION_LOG.md rows 42-49).
// Controls 1-6 are copied from the audit's own suite. The rest encode the product rules we adopted:
//   - cash in hand uses money actually received, never price x headcount
//   - survey evidence only supports the offer (price, format, terms) it was collected for
//   - break-even counts firm money only; assumption-dependent results are reported separately
// All numbers are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const base = (extra = {}) => ({
  id: 'golf', kind: 'golf_tee_times', capacity: 100, price: 100, groupSize: 1, wholeGroupsOnly: false,
  venueQuote: { flatFee: 500, perParticipant: 0, minimumParticipants: 0, minimumSpend: 0 },
  deposit: { amount: 0, creditedTowardBill: true, refundable: false },
  fixedCosts: [], perParticipantCosts: [], volunteerHours: 20,
  quoteVerified: true, costsVerified: true, cancellationOwed: 500,
  scenarioParticipants: { conservative: 10, middle: 20, optimistic: 30 }, ...extra,
});
const stateFor = (o, extra = {}) => ({
  options: [o], settings: { fundraisingTarget: 0 }, sponsorships: [], snapshot: {},
  scenarioSettings: { conservative: { statuses: ['collected', 'committed'], extraRevenuePerParticipant: 0, otherRevenue: 0, costContingencyPct: 0 } },
  evidence: { surveyResponses: 10, paidRegistrations: { golf: 5 }, namedHighIntent: { golf: 0 }, surveyDefinitelyAtPrice: { golf: 5 } },
  volunteerHoursAvailable: 50, ...extra,
});
// Record that the survey answers were collected for the option's terms as they stand right now.
const recordTerms = (s, o) => { s.evidence.offerTerms = { ...(s.evidence.offerTerms || {}), [o.id]: E.offerTerms(o, s.snapshot) }; return s; };

// ---- audit controls (unchanged) ----
test('control: simple revenue minus fixed quote', () => { assert.equal(E.project(base(), 10).net, 500); });
test('control: credited deposit is not double-counted as expense', () => {
  const r = E.project(base({ deposit: { amount: 200, creditedTowardBill: true, refundable: false } }), 10);
  assert.equal(r.expenses.total, 500); assert.equal(r.upfront.required, 200);
});
test('control: minimum billed headcount remains binding', () => {
  assert.equal(E.project(base({ venueQuote: { perParticipant: 50, minimumParticipants: 12 } }), 10).expenses.venue, 600);
});
test('control: excess participants are capped and flagged', () => {
  const r = E.project(base({ capacity: 10 }), 1000);
  assert.equal(r.participants, 10); assert.ok(r.flags.includes('over_capacity'));
});
test('control: in-kind replacement is capped and never cash', () => {
  const r = E.project(base({ fixedCosts: [{ id: 'prize', label: 'Prize', amount: 300 }] }), 10,
    { sponsorships: [{ id: 'gift', type: 'inKind', amount: 500, status: 'collected', replacesCostId: 'prize' }] });
  assert.equal(r.expenses.fixed, 0); assert.equal(r.revenue.sponsorshipCash, 0); assert.equal(r.inKind.applied[0].reducedBy, 300);
});
test('control: hoped-for cash excluded by default', () => {
  assert.equal(E.project(base(), 5, { sponsorships: [{ type: 'cash', status: 'hoped', amount: 500 }] }).net, 0);
});

// ---- F1: cash actually received ----
test('F1: a paid $500 foursome leaves a $50 gap on a $550 deposit when the $500 received is entered', () => {
  const o = base({ price: 150, groupSize: 4, groupPrice: 500, groupShare: 1, venueQuote: { flatFee: 1000 }, deposit: { amount: 550, creditedTowardBill: true, refundable: false } });
  const r = E.project(o, 4, { paidRegistrations: 4, paidRegistrationCash: 500 });
  assert.equal(r.revenue.registration, 500);
  assert.equal(r.upfront.cashInHand, 500);
  assert.equal(r.upfront.gap, 50);
});
test('F1: paid sign-ups with no amount entered are not turned into cash by multiplying the price', () => {
  const o = base({ price: 150, deposit: { amount: 550, creditedTowardBill: true, refundable: false } });
  const r = E.project(o, 4, { paidRegistrations: 4, sponsorships: [{ type: 'cash', status: 'collected', amount: 100 }] });
  assert.equal(r.upfront.cashInHand, 100);           // sponsorship only
  assert.equal(r.upfront.registrationCashUnknown, true);
  assert.equal(r.upfront.gap, 450);
});
test('F1: changing a future price does not revalue money already received', () => {
  const o = base({ price: 150, deposit: { amount: 550, creditedTowardBill: true, refundable: false } });
  const before = E.project(o, 4, { paidRegistrations: 4, paidRegistrationCash: 600 }).upfront.cashInHand;
  const after = E.project({ ...o, price: 90 }, 4, { paidRegistrations: 4, paidRegistrationCash: 600 }).upfront.cashInHand;
  assert.equal(before, 600); assert.equal(after, 600);
});
test('F1: scenarioContext passes the recorded amount received', () => {
  const o = base();
  const s = stateFor(o, { evidence: { paidRegistrations: { golf: 2 }, paidCashReceived: { golf: 180 } } });
  assert.equal(E.scenarioContext(s, o, 'conservative').paidRegistrationCash, 180);
});

// ---- F2: evidence belongs to the offer it was collected for ----
test('F2: raising the price after collecting answers does not upgrade the decision', () => {
  const o = base({ price: 50, venueQuote: { flatFee: 1000 } });
  const s = recordTerms(stateFor(o, { evidence: { surveyResponses: 10, paidRegistrations: { golf: 0 }, namedHighIntent: { golf: 10 } } }), o);
  assert.equal(E.decide(s, o).status, 'not_enough_evidence');   // break-even 20 > 10 named
  o.price = 100;                                                // break-even becomes 10, but nobody agreed to $100
  const d = E.decide(s, o);
  assert.notEqual(d.status, 'supported_by_current_evidence');
  assert.equal(d.evidence.state, 'stale');
  assert.ok(d.evidence.changed.includes('price'));
  assert.equal(d.namedCounted, 0);
  assert.ok(d.missing.some((m) => /re-ask|different/i.test(m)));
});
test('F2: after re-asking at the new price, the answers count again', () => {
  const o = base({ price: 100, venueQuote: { flatFee: 1000 } });
  const s = recordTerms(stateFor(o, { evidence: { surveyResponses: 10, paidRegistrations: { golf: 0 }, namedHighIntent: { golf: 10 } } }), o);
  const d = E.decide(s, o);
  assert.equal(d.evidence.state, 'current');
  assert.equal(d.namedCounted, 10);
  // Numbers clear the bar on named answers, but nobody has paid yet, so it's not the strongest result.
  assert.equal(d.status, 'supported_with_open_items');
  s.evidence.paidRegistrations.golf = 1; s.evidence.paidCashReceived = { golf: 100 };
  assert.equal(E.decide(s, o).status, 'supported_by_current_evidence');
});
test('F2: answers with no recorded terms are not counted toward the support check', () => {
  const o = base({ price: 100, venueQuote: { flatFee: 1000 } });
  const s = stateFor(o, { evidence: { surveyResponses: 10, paidRegistrations: { golf: 0 }, namedHighIntent: { golf: 10 } } });
  const d = E.decide(s, o);
  assert.equal(d.evidence.state, 'unrecorded');
  assert.notEqual(d.status, 'supported_by_current_evidence');
});
test('F2: a change to the event details (date) also makes answers stale; paid sign-ups still count', () => {
  const o = base({ price: 100, venueQuote: { flatFee: 1000 } });
  const s = recordTerms(stateFor(o, { snapshot: { dateWindow: 'May 3' }, evidence: { surveyResponses: 10, paidRegistrations: { golf: 4 }, namedHighIntent: { golf: 10 } } }), o);
  s.snapshot.dateWindow = 'June 14';
  const d = E.decide(s, o);
  assert.equal(d.evidence.state, 'stale');
  assert.ok(d.evidence.changed.includes('date'));
  assert.equal(d.paid, 4);
  assert.equal(d.namedCounted, 0);
});
test('F2: the group price is part of the offer', () => {
  const o = base({ price: 100, groupSize: 4, groupPrice: 360, groupShare: 0.5 });
  const s = recordTerms(stateFor(o, { evidence: { surveyResponses: 5, namedHighIntent: { golf: 8 } } }), o);
  o.groupPrice = 400;
  assert.ok(E.decide(s, o).evidence.changed.includes('group price'));
});

// ---- F3: firm-money break-even vs. assumption-dependent results ----
test('F3: an assumed add-on per person does not lower the firm break-even, but is reported as conditional', () => {
  const o = base({ venueQuote: { flatFee: 1000 }, capacity: 20 });
  const s = stateFor(o); s.scenarioSettings.conservative.extraRevenuePerParticipant = 100;
  const d = E.decide(s, o);
  assert.equal(d.breakEven.participants, 10);
  assert.equal(d.conditional.participants, 5);
  assert.ok(d.conditional.uses.includes('add-ons'));
});
test('F3: unspecified other income does not create a zero-person firm break-even', () => {
  const o = base({ venueQuote: { flatFee: 1000 }, capacity: 20 });
  const s = stateFor(o, { evidence: { surveyResponses: 10, paidRegistrations: { golf: 0 }, namedHighIntent: { golf: 0 } } });
  s.scenarioSettings.conservative.otherRevenue = 1000;
  const d = E.decide(s, o);
  assert.equal(d.breakEven.participants, 10);
  assert.notEqual(d.status, 'supported_by_current_evidence');
});
test('F3: if only assumed income closes the gap, the result is high risk and names the assumption', () => {
  const o = base({ price: 20, venueQuote: { flatFee: 1000 }, capacity: 20 }); // 20 x $20 = $400 < $1,000
  const s = stateFor(o); s.scenarioSettings.conservative.otherRevenue = 800;
  const d = E.decide(s, o);
  assert.equal(d.breakEven.reachableWithinCapacity, false);
  assert.equal(d.status, 'high_risk');
  assert.ok(d.reasons.some((r) => /other income/.test(r)));
});
test('F3: the scenario itself still includes the assumptions (exploration is kept)', () => {
  const o = base({ venueQuote: { flatFee: 1000 } });
  const s = stateFor(o); s.scenarioSettings.conservative.extraRevenuePerParticipant = 10;
  assert.equal(E.project(o, 10, E.scenarioContext(s, o, 'conservative')).revenue.extras, 100);
});

// ---- found in the audit's own probe: net turns negative again above break-even ----
test('non-monotonic: if net drops below zero at a higher headcount, the result is not "supported"', () => {
  const o = base({ capacity: 8, price: 100, groupSize: 4, groupPrice: 100, groupShare: 1, venueQuote: { flatFee: 200 }, scenarioParticipants: { conservative: 3 } });
  // Updated 2026-10-19 (ChatGPT review F1): with 4 already paid, headcounts below 4 are impossible and are no longer scanned,
  // so the dip is now set up with named answers instead of paid ones. Same rule under test: a dip above break-even blocks "supported".
  const s = recordTerms(stateFor(o, { evidence: { surveyResponses: 8, paidRegistrations: { golf: 0 }, namedHighIntent: { golf: 4 } } }), o);
  const d = E.decide(s, o);
  assert.equal(d.breakEven.nonMonotonic, true);
  assert.notEqual(d.status, 'supported_by_current_evidence');
  assert.ok(d.reasons.some((r) => /drops below zero/i.test(r)));
});

// ---- readiness: numbers clearing the threshold is not the same as ready to sign ----
test('readiness: open items keep the strongest status from showing', () => {
  const o = base({ costsVerified: false, cancellationOwed: null });
  const s = recordTerms(stateFor(o, { volunteerHoursAvailable: 0 }), o);
  const d = E.decide(s, o);
  assert.equal(d.status, 'supported_with_open_items');
  assert.ok(d.missing.length >= 3);
  assert.match(E.STATUS_LABELS[d.status], /open items/i);
});
