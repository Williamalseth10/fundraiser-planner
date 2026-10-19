// Regression tests for the ChatGPT review of b7c6f3b (= GitHub e924fd6). See DECISION_LOG.md rows 50-59.
// Engine-level findings are tested here; app-level findings (F2, F3, F4, F5 card, F9, F10) are in test/ui_smoke.py.
// All numbers are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

// Reviewer's shared fixture: capacity 20, $100, $1,000 flat venue fee, 10/10/20 headcounts, verified, 10 paid with $1,000 received.
const fixture = () => {
  const o = {
    id: 'golf', kind: 'golf_tee_times', capacity: 20, price: 100, groupSize: 1, wholeGroupsOnly: false,
    venueQuote: { flatFee: 1000, perParticipant: 0, minimumParticipants: 0, minimumSpend: 0 },
    deposit: { amount: 0, creditedTowardBill: true, refundable: false },
    perParticipantCosts: [], fixedCosts: [], volunteerHours: 0, quoteVerified: true, costsVerified: true, cancellationOwed: 0,
    scenarioParticipants: { conservative: 10, middle: 10, optimistic: 20 },
  };
  const sc = () => ({ statuses: ['collected', 'committed'], extraRevenuePerParticipant: 0, otherRevenue: 0, costContingencyPct: 0 });
  const s = {
    options: [o], settings: { fundraisingTarget: 0 }, sponsorships: [], volunteerHoursAvailable: 10,
    snapshot: { format: 'Synthetic scramble', dateWindow: 'Synthetic date', locationArea: 'Synthetic area', included: 'Synthetic lunch', beneficiary: 'Synthetic booster club' },
    scenarioSettings: { conservative: { label: 'Conservative', ...sc() }, middle: { label: 'Middle', ...sc() }, optimistic: { label: 'Optimistic', ...sc() } },
    evidence: { surveyResponses: 10, paidRegistrations: { golf: 10 }, paidCashReceived: { golf: 1000 }, namedHighIntent: { golf: 0 }, surveyDefinitelyAtPrice: { golf: 0 }, surveyProbablyAtPrice: { golf: 0 }, offerTerms: {} },
  };
  return { s, o };
};
const ctxOf = (s, o, k = 'conservative') => E.scenarioContext(s, o, k);

// ---- F1: tickets already paid keep the money actually received ----
test('F1: raising the price does not reprice tickets that were already paid for', () => {
  const { s, o } = fixture(); o.price = 50; s.evidence.paidCashReceived.golf = 500; // ten $50 tickets
  o.price = 100;                                                                    // new offer
  const r = E.project(o, 10, ctxOf(s, o));
  assert.equal(r.revenue.registration, 500);
  assert.equal(r.net, -500);
  const d = E.decide(s, o);
  assert.equal(d.breakEven.participants, 15);   // 10 paid ($500) + 5 new at $100
  assert.notEqual(d.status, 'supported_by_current_evidence');
});
test('F1: new sales on top of paid tickets use the current offer', () => {
  const { s, o } = fixture(); s.evidence.paidCashReceived.golf = 500; // 10 paid, $500 actually received
  assert.equal(E.project(o, 14, ctxOf(s, o)).revenue.registration, 500 + 4 * 100);
});
test('F1: if the amount received is unknown, paid tickets are valued at the current price but the result is not the strongest', () => {
  const { s, o } = fixture(); s.evidence.paidCashReceived = {};
  const d = E.decide(s, o);
  assert.equal(d.conservative.revenue.registration, 1000);
  assert.ok(d.missing.some((m) => /amount actually received/.test(m)));
  assert.notEqual(d.status, 'supported_by_current_evidence');
});

// ---- F5: the main cash figure uses firm money only ----
test('F5: a hoped-for in-kind gift does not erase the firm upfront cash requirement', () => {
  const { s, o } = fixture(); o.venueQuote.flatFee = 0;
  o.fixedCosts = [{ id: 'prizes', label: 'Prizes', amount: 1000, paidUpfront: true }];
  s.evidence.paidRegistrations.golf = 1; s.evidence.paidCashReceived.golf = 100;
  s.sponsorships = [{ id: 'maybe', type: 'inKind', status: 'hoped', amount: 1000, replacesCostId: 'prizes' }];
  s.scenarioSettings.middle.statuses.push('hoped');
  const d = E.decide(s, o);
  assert.equal(d.firm.upfront.required, 1000);
  assert.equal(d.firm.upfront.gap, 900);
});

// ---- F6: an unfunded upfront gap is an open item until the club records how it's covered ----
test('F6: a $900 upfront gap keeps the strongest status from showing until covered', () => {
  const { s, o } = fixture(); o.deposit.amount = 1000; o.cancellationOwed = 1000;
  s.evidence.paidRegistrations.golf = 1; s.evidence.paidCashReceived.golf = 100;
  s.evidence.namedHighIntent.golf = 9; s.evidence.offerTerms.golf = E.offerTerms(o, s.snapshot);
  const d = E.decide(s, o);
  assert.equal(d.conservative.upfront.gap, 900);
  assert.equal(d.status, 'supported_with_open_items');
  assert.ok(d.missing.some((m) => /\$900/.test(m)));
  o.upfrontFundingConfirmed = true;            // treasurer confirms the club can cover it
  assert.equal(E.decide(s, o).status, 'supported_by_current_evidence');
});

// ---- F7: one firm-money basis for break-even, chart and markers ----
test('F7: the firm chart uses the same cost basis as the firm break-even', () => {
  const { s, o } = fixture(); o.venueQuote.flatFee = 0;
  o.fixedCosts = [{ id: 'fee', label: 'Fee', amount: 1000, paidUpfront: false }];
  s.evidence.paidRegistrations.golf = 0; s.evidence.paidCashReceived = {};
  s.scenarioSettings.conservative.costContingencyPct = 10; s.scenarioSettings.middle.costContingencyPct = 0;
  const d = E.decide(s, o);
  assert.equal(d.breakEven.participants, 11);
  const curve = E.netCurve(o, E.firmContext(s, o));
  assert.equal(curve.find((p) => p.participants === 10).net, -100);
  assert.equal(curve.find((p) => p.participants === 11).net, 0);
});

// ---- F8: the beneficiary is part of the offer ----
test('F8: changing who the money supports makes survey answers stale', () => {
  const { s, o } = fixture(); s.evidence.namedHighIntent.golf = 9;
  s.evidence.offerTerms.golf = E.offerTerms(o, s.snapshot);
  s.snapshot.beneficiary = 'A different beneficiary from the one in the survey';
  const st = E.evidenceStatus(s, o);
  assert.equal(st.state, 'stale');
  assert.ok(st.changed.includes('what the money supports'));
});
test('F8: answers recorded before the beneficiary was tracked do not suddenly go stale', () => {
  const { s, o } = fixture(); s.evidence.namedHighIntent.golf = 9;
  const old = E.offerTerms(o, s.snapshot); delete old.supports; // terms saved by the previous version
  s.evidence.offerTerms.golf = old;
  assert.equal(E.evidenceStatus(s, o).state, 'current');
});

test('F1 follow-up: break-even and the chart never consider fewer people than have already paid', () => {
  const { s, o } = fixture(); o.capacity = 72; o.groupSize = 4; o.wholeGroupsOnly = true; o.price = 150;
  o.venueQuote = { flatFee: 0, perParticipant: 60, minimumParticipants: 0, minimumSpend: 0 };
  o.perParticipantCosts = [{ id: 'meal', label: 'Meal', amount: 20 }];
  o.fixedCosts = [{ id: 'p', label: 'Prizes', amount: 400, paidUpfront: true }, { id: 'q', label: 'Printing', amount: 100, paidUpfront: false }];
  s.evidence.paidRegistrations.golf = 4; s.evidence.paidCashReceived.golf = 600;
  const d = E.decide(s, o);
  assert.equal(d.breakEven.participants, 8);        // same as before paid tickets were tracked separately
  assert.equal(d.breakEven.nonMonotonic, false);
  assert.ok(E.netCurve(o, E.firmContext(s, o)).every((p) => p.participants >= 4));
});
