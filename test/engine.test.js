// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

// Simple, hand-checkable fixture. All numbers are synthetic.
const base = () => ({
  id: 'opt',
  capacity: 72,
  groupSize: 4,
  wholeGroupsOnly: true,
  price: 150,
  venueQuote: { flatFee: 0, perParticipant: 60, minimumParticipants: 0, minimumSpend: 0 },
  perParticipantCosts: [{ id: 'meal', label: 'Meal', amount: 20 }],
  fixedCosts: [
    { id: 'prizes', label: 'Prizes', amount: 400, paidUpfront: true },
    { id: 'print', label: 'Printing', amount: 100, paidUpfront: false },
  ],
  deposit: { amount: 0, creditedTowardBill: true, refundable: false },
  volunteerHours: 40,
});
const ctx = (extra = {}) => ({ sponsorships: [], statuses: ['collected', 'committed'], ...extra });

test('zero attendance: no revenue, fixed costs still owed', () => {
  const r = E.project(base(), 0, ctx());
  assert.equal(r.revenue.total, 0);
  assert.equal(r.expenses.total, 500);
  assert.equal(r.net, -500);
});

test('linear case matches hand calculation', () => {
  // 40 * (150 - 60 - 20) - 500 = 2300
  const r = E.project(base(), 40, ctx());
  assert.equal(r.net, 2300);
});

test('break-even scans feasible counts (whole foursomes)', () => {
  // need 70n >= 500 -> n >= 7.14 -> first multiple of 4 is 8
  const be = E.participantsNeeded(base(), 0, ctx());
  assert.equal(be.participants, 8);
  assert.equal(be.reachableWithinCapacity, true);
});

test('minimum player guarantee: billed for minimum when attendance is below it', () => {
  const o = base();
  o.venueQuote.minimumParticipants = 48;
  const r = E.project(o, 20, ctx());
  assert.equal(r.expenses.venue, 48 * 60);
  assert.equal(r.expenses.venueMinimumApplied, true);
  // 20*150 - (2880 + 400 + 500) = -780
  assert.equal(r.net, -780);
  const above = E.project(o, 52, ctx());
  assert.equal(above.expenses.venue, 52 * 60);
  assert.equal(above.expenses.venueMinimumApplied, false);
});

test('minimum spend (shotgun buyout style) creates a nonlinear break-even', () => {
  const o = base();
  o.venueQuote = { flatFee: 0, perParticipant: 0, minimumParticipants: 0, minimumSpend: 6000 };
  // revenue - meal: 130n; costs 6000 + 500 -> n >= 50 -> 52 (whole groups)
  const be = E.participantsNeeded(o, 0, ctx());
  assert.equal(be.participants, 52);
  // a naive formula using average per-head venue cost would be wrong; check net at 48 is negative
  assert.ok(E.project(o, 48, ctx()).net < 0);
});

test('capacity limit: requested above capacity is clamped and flagged', () => {
  const r = E.project(base(), 100, ctx());
  assert.equal(r.participants, 72);
  assert.ok(r.flags.includes('over_capacity'));
});

test('target beyond capacity is reported as unreachable', () => {
  const t = E.participantsNeeded(base(), 100000, ctx());
  assert.equal(t.participants, null);
  assert.equal(t.reachableWithinCapacity, false);
  assert.equal(t.maxFeasible, 72);
});

test('group size: capacity and counts round DOWN to whole groups, never up', () => {
  const o = base();
  o.capacity = 70;
  assert.equal(E.maxFeasible(o), 68);
  const r = E.project(o, 39, ctx());
  assert.equal(r.participants, 36);
  assert.ok(r.flags.includes('rounded_down_to_whole_groups'));
});

test('sponsorship statuses are kept separate; hoped-for is excluded unless chosen', () => {
  const sponsorships = [
    { id: 'a', amount: 1000, status: 'collected', type: 'cash' },
    { id: 'b', amount: 2000, status: 'committed', type: 'cash' },
    { id: 'c', amount: 5000, status: 'hoped', type: 'cash' },
  ];
  const firm = E.project(base(), 0, ctx({ sponsorships }));
  assert.equal(firm.revenue.sponsorshipCash, 3000);
  assert.deepEqual(firm.sponsorshipByStatus, { collected: 1000, committed: 2000, hoped: 5000 });
  const only = E.project(base(), 0, ctx({ sponsorships, statuses: ['collected'] }));
  assert.equal(only.revenue.sponsorshipCash, 1000);
  const all = E.project(base(), 0, ctx({ sponsorships, statuses: ['collected', 'committed', 'hoped'] }));
  assert.equal(all.revenue.sponsorshipCash, 8000);
});

test('sponsorship shortfall: event that only works with hoped-for money', () => {
  const o = base();
  o.venueQuote.minimumSpend = 8000;
  const sponsorships = [{ id: 'h', amount: 4000, status: 'hoped', type: 'cash' }];
  const withHope = E.participantsNeeded(o, 0, ctx({ sponsorships, statuses: ['collected', 'committed', 'hoped'] }));
  const firm = E.participantsNeeded(o, 0, ctx({ sponsorships }));
  assert.ok(withHope.participants < firm.participants);
  // firm: venue floor 8000 => net at 72 = 72*150 - 8000 - 72*20 - 500 = 860 -> reachable but late
  assert.equal(E.project(o, 72, ctx({ sponsorships })).net, 860);
});

test('credited deposit is NOT an extra expense, but IS upfront cash', () => {
  const o = base();
  o.deposit = { amount: 500, creditedTowardBill: true, refundable: false };
  const r = E.project(o, 40, ctx());
  assert.equal(r.net, 2300); // same as no-deposit case
  assert.equal(r.expenses.separateDepositFee, 0);
  assert.equal(r.upfront.required, 500 + 400); // deposit + prizes paid upfront
});

test('non-credited, non-refundable deposit is an additional expense', () => {
  const o = base();
  o.deposit = { amount: 500, creditedTowardBill: false, refundable: false };
  const r = E.project(o, 40, ctx());
  assert.equal(r.net, 1800);
  assert.equal(r.expenses.separateDepositFee, 500);
});

test('non-refundable credited deposit sets a floor on the venue bill at low attendance', () => {
  const o = base();
  o.deposit = { amount: 1000, creditedTowardBill: true, refundable: false };
  const r = E.project(o, 4, ctx()); // venue would be 240, but 1000 is lost
  assert.equal(r.expenses.venue, 1000);
  const r2 = E.project({ ...o, deposit: { ...o.deposit, refundable: true } }, 4, ctx());
  assert.equal(r2.expenses.venue, 240);
});

test('in-kind donation is never cash; it only reduces the cost line it replaces, capped', () => {
  const sponsorships = [
    { id: 'k1', label: 'Donated prizes', amount: 600, status: 'committed', type: 'inKind', replacesCostId: 'prizes' },
    { id: 'k2', label: 'Gift baskets (no budget line)', amount: 300, status: 'committed', type: 'inKind' },
  ];
  const r = E.project(base(), 0, ctx({ sponsorships }));
  assert.equal(r.revenue.total, 0);           // nothing added as revenue
  assert.equal(r.expenses.fixed, 100);        // prizes 400 fully replaced, printing remains
  assert.equal(r.inKind.applied[0].excessNotCounted, 200);
  assert.equal(r.inKind.notCounted[0].reason, 'does_not_replace_a_budgeted_cost');
  assert.equal(r.upfront.required, 0);        // upfront prize purchase no longer needed
});

test('hoped-for in-kind does not reduce costs in a firm scenario', () => {
  const sponsorships = [{ id: 'k', amount: 400, status: 'hoped', type: 'inKind', replacesCostId: 'prizes' }];
  const r = E.project(base(), 0, ctx({ sponsorships }));
  assert.equal(r.expenses.fixed, 500);
});

test('cash in hand counts only collected sponsorship and paid registrations', () => {
  const sponsorships = [
    { id: 'a', amount: 300, status: 'collected', type: 'cash' },
    { id: 'b', amount: 900, status: 'committed', type: 'cash' },
  ];
  const r = E.project(base(), 40, ctx({ sponsorships, paidRegistrations: 2 }));
  assert.equal(r.upfront.cashInHand, 300 + 2 * 150);
  assert.equal(r.upfront.required, 400);
  assert.equal(r.upfront.gap, 0);
});

test('price below per-person cost: never breaks even, reported honestly', () => {
  const o = base();
  o.price = 70; // below 80 per-person cost
  const be = E.participantsNeeded(o, 0, ctx());
  assert.equal(be.participants, null);
  assert.ok(be.netAtCapacity < 0);
});

test('cents arithmetic is exact for awkward prices', () => {
  const o = base();
  o.price = 0.1; o.venueQuote.perParticipant = 0; o.perParticipantCosts = []; o.fixedCosts = [];
  o.wholeGroupsOnly = false;
  assert.equal(E.project(o, 3, ctx()).net, 0.3);
});

test('decision: missing evidence yields "not enough evidence"', () => {
  const o = { ...base(), scenarioParticipants: { conservative: 24, middle: 40, optimistic: 60 } };
  const state = { settings: { fundraisingTarget: 2000 }, sponsorships: [], evidence: {}, scenarioSettings: {} };
  const dcs = E.decide(state, o);
  assert.equal(dcs.status, 'not_enough_evidence');
  assert.ok(dcs.missing.length >= 3);
});

test('decision: unreachable break-even yields "not viable as configured"', () => {
  const o = { ...base(), price: 50, scenarioParticipants: { conservative: 24 } };
  const dcs = E.decide({ settings: {}, sponsorships: [], evidence: {} }, o);
  assert.equal(dcs.status, 'not_viable_as_configured');
});

test('decision: strongest result requires verified quote AND firm demand covering break-even', () => {
  const o = { ...base(), quoteVerified: true, costsVerified: true, scenarioParticipants: { conservative: 24 } };
  const state = {
    settings: {}, sponsorships: [], volunteerHoursAvailable: 100,
    evidence: { surveyResponses: 30, paidRegistrations: { opt: 4 }, namedHighIntent: { opt: 4 }, surveyDefinitelyAtPrice: { opt: 20 } },
  };
  assert.equal(E.decide(state, o).status, 'supported_by_current_evidence');
  state.evidence.namedHighIntent.opt = 2; // 4 + 2 < 8 needed; 20 anonymous "definitely" do NOT rescue it
  assert.equal(E.decide(state, o).status, 'not_enough_evidence');
});

test('sensitivity is ranked by absolute effect and is deterministic', () => {
  const s1 = E.sensitivity(base(), 40, ctx());
  const s2 = E.sensitivity(base(), 40, ctx());
  assert.deepEqual(s1, s2);
  for (let i = 1; i < s1.results.length; i++) {
    assert.ok(Math.abs(s1.results[i - 1].change) >= Math.abs(s1.results[i].change));
  }
  // 40 * 0.75 = 30, rounded DOWN to whole foursomes = 28 -> 12 fewer * $70 margin = -840
  assert.equal(s1.results[0].key, 'attendance_minus_25');
  assert.equal(s1.results[0].change, -840);
});

test('foursome bundle pricing: blank price = 4x individual, discount applies to whole foursomes only', () => {
  const o = { ...base(), foursomeShare: 0.5 };
  assert.equal(E.project(o, 40, ctx()).revenue.registration, 6000); // no discount set
  o.foursomePrice = 500; // $125/player inside a foursome
  const r = E.project(o, 40, ctx()); // 20 foursome players (5 teams) + 20 singles
  assert.equal(r.revenue.registration, 5 * 500 + 20 * 150);
  assert.equal(r.revenue.foursomes, 5);
  const odd = E.project({ ...o, wholeGroupsOnly: false }, 10, ctx()); // 5 players -> 1 whole foursome
  assert.equal(odd.revenue.registration, 500 + 6 * 150);
});

test('cost contingency pads estimated costs only, never the contractual venue quote', () => {
  const r = E.project(base(), 40, ctx({ costContingencyPct: 10 }));
  // per-person 800 + fixed 500 = 1300 -> 130 contingency; venue 2400 untouched
  assert.equal(r.expenses.contingency, 130);
  assert.equal(r.expenses.venue, 2400);
  assert.equal(r.net, 2300 - 130);
});

test('worst case: nobody registers, only collected sponsorship', () => {
  const o = base();
  o.venueQuote.minimumParticipants = 48;
  o.deposit = { amount: 1000, creditedTowardBill: true, refundable: false };
  const sp = [{ id: 'a', amount: 500, status: 'collected', type: 'cash' }, { id: 'b', amount: 900, status: 'committed', type: 'cash' }];
  const w = E.worstCase(o, sp);
  assert.equal(w.contractualFloor, 48 * 60);
  assert.equal(w.netIfNobodyRegisters, 500 - 2880 - 500);
});

test('headline rounding avoids false precision', () => {
  assert.equal(E.roundHeadline(6123), 6100);
  assert.equal(E.roundHeadline(1234), 1250);
  assert.equal(E.roundHeadline(-777), -800);
});

test('cancellation exposure: only when entered; venue amount plus costs already paid in advance', () => {
  const o = base();
  assert.equal(E.cancellationExposure(o, []), null);
  o.cancellationOwed = 1500;
  const x = E.cancellationExposure(o, []);
  assert.equal(x.owedToVenue, 1500);
  assert.equal(x.alreadySpent, 400); // prizes paid upfront; printing is not
  assert.equal(x.total, 1900);
  const withInKind = E.cancellationExposure(o, [{ id: 'k', amount: 400, status: 'collected', type: 'inKind', replacesCostId: 'prizes' }]);
  assert.equal(withInKind.alreadySpent, 0);
});

test('decision lists missing cancellation terms until entered', () => {
  const o = { ...base(), scenarioParticipants: { conservative: 24 } };
  const st = { settings: {}, sponsorships: [], evidence: {} };
  assert.ok(E.decide(st, o).missing.some((m) => /owe if you cancel/.test(m)));
  o.cancellationOwed = 0;
  assert.ok(!E.decide(st, o).missing.some((m) => /owe if you cancel/.test(m)));
});

test('group pricing works for any group size (a table of 8 at a gala)', () => {
  const o = { ...base(), groupSize: 8, wholeGroupsOnly: false, price: 100, groupPrice: 700, groupShare: 0.5 };
  const r = E.project(o, 40, ctx()); // 20 buy as tables -> 2 tables of 8 (16), 24 single tickets
  assert.equal(r.revenue.groups, 2);
  assert.equal(r.revenue.registration, 2 * 700 + 24 * 100);
  const none = E.project({ ...o, groupSize: 1 }, 40, ctx());
  assert.equal(none.revenue.registration, 4000);
});

test('older plans with foursomePrice still compute the same', () => {
  const oldStyle = { ...base(), foursomePrice: 500, foursomeShare: 0.5 };
  const newStyle = { ...base(), groupPrice: 500, groupShare: 0.5 };
  assert.equal(E.project(oldStyle, 40, ctx()).net, E.project(newStyle, 40, ctx()).net);
});

test('per-option scenario proceeds (auction/raffle) are the organizer figure, added only to that option', () => {
  const o = { ...base(), id: 'auc', scenarioProceeds: { conservative: 1000, middle: 2500 }, scenarioParticipants: { conservative: 0, middle: 0 } };
  const st = { sponsorships: [], scenarioSettings: { conservative: { otherRevenue: 50 }, middle: {} }, evidence: {} };
  assert.equal(E.project(o, 0, E.scenarioContext(st, o, 'conservative')).revenue.other, 1050);
  assert.equal(E.project(o, 0, E.scenarioContext(st, o, 'middle')).revenue.other, 2500);
  assert.equal(E.project(o, 0, E.scenarioContext(st, o, 'optimistic')).revenue.other, 0);
});

test('break-even leaves out auction and raffle estimates (bids are not promised)', () => {
  const o = { ...base(), id: 'auc', scenarioParticipants: { conservative: 24 }, scenarioProceeds: { conservative: 100000 } };
  const st = { settings: {}, sponsorships: [], evidence: {}, scenarioSettings: {} };
  const d = E.decide(st, o);
  assert.equal(d.breakEven.participants, 8); // same as with no auction at all
  assert.equal(d.proceedsLow, 100000);
  assert.ok(d.conservative.net > 100000 - 1000); // the scenario itself still includes the organizer's figure
});
