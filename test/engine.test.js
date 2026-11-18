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

function clubExample() {
  const option = {
    ...base(), kind: 'auction', groupSize: 1, wholeGroupsOnly: false, capacity: 100,
    quoteVerified: true, costsVerified: true,
    scenarioParticipants: { conservative: 20, middle: 40, optimistic: 80 },
    scenarioProceeds: { conservative: 0, middle: 700, optimistic: 1500 },
  };
  const state = {
    options: [option], snapshot: {},
    evidence: { paidRegistrations: { opt: 4 }, paidCashReceived: { opt: 300 }, namedHighIntent: { opt: 36 }, offerTerms: { opt: E.offerTerms(option, {}) } },
    sponsorships: [{ status: 'collected', amount: 50 }, { status: 'committed', amount: 200 }, { status: 'hoped', amount: 1000 }],
    scenarioSettings: { middle: { statuses: ['collected', 'committed', 'hoped'], extraRevenuePerParticipant: 5 } },
  };
  return { state, option };
}

test('decision brief measures the unpaid sales gap and keeps receipts, written support and estimated bids on their respective bases', () => {
  const { state, option } = clubExample();
  const before = JSON.stringify(state);
  const b = E.decisionBrief(state, option);
  // Middle tickets = $300 actually paid + 36 x $150. Costs = $500 + 40 x $80.
  assert.equal(b.cases.middle.firmNet, 2250);
  assert.equal(b.cases.middle.net, 4150); // adds $700 bids, $1,000 hoped sponsorship and 40 x $5
  assert.equal(b.cases.middle.salesStillNeeded, 36);
  assert.equal(b.namedAtCurrentOffer, 36);
  assert.deepEqual(b.atPaidOnly, { participants: 4, net: -270, issue: null });
  assert.deepEqual(b.breakEven, { participants: 8, additionalPaid: 4, dipsAt: null, issue: null });
  assert.equal(JSON.stringify(state), before);
  option.price = 175;
  const changed = E.decisionBrief(state, option);
  assert.equal(changed.atPaidOnly.net, -270);
  assert.equal(changed.namedAtCurrentOffer, 0);
  assert.equal(changed.cases.middle.salesStillNeeded, 36);
});

test('decision brief withholds missing or physically inconsistent cases and preserves valid zero and capping', () => {
  const { state, option } = clubExample();
  option.scenarioParticipants = { conservative: '', middle: 3, optimistic: 120 };
  let b = E.decisionBrief(state, option);
  assert.equal(b.cases.conservative.issue, 'missing');
  assert.equal(b.cases.conservative.net, null);
  assert.equal(b.cases.middle.issue, 'belowPaid');
  assert.equal(b.cases.middle.firmNet, null);
  assert.equal(b.cases.optimistic.participants, 100);
  assert.deepEqual(b.cases.optimistic.flags, ['over_capacity']);
  state.evidence.paidCashReceived.opt = null;
  b = E.decisionBrief(state, option);
  assert.equal(b.paidCashMissing, true);
  assert.equal(b.cases.optimistic.net, null);
  assert.equal(b.atPaidOnly.issue, 'paidCashMissing');
  assert.equal(b.breakEven.participants, null);
  state.evidence.paidCashReceived.opt = 0;
  option.groupSize = 3; option.wholeGroupsOnly = true;
  b = E.decisionBrief(state, option);
  assert.equal(b.cases.optimistic.issue, null);
  assert.equal(b.atPaidOnly.issue, 'partialGroup');
  option.capacity = 3;
  assert.equal(E.decisionBrief(state, option).breakEven.issue, 'capacityBelowPaid');
  state.evidence.paidRegistrations.opt = 0;
  option.scenarioParticipants.middle = 0;
  assert.equal(E.decisionBrief(state, option).cases.middle.net, 1450); // $250 firm + $1,000 hoped + $700 bids - $500
  state.evidence.paidCashReceived.opt = 100;
  assert.equal(E.decisionBrief(state, option).cases.middle.issue, 'cashWithoutPaid');
  option.capacity = 0;
  assert.equal(E.decisionBrief(state, option).breakEven.issue, 'noCapacity');
});

test('club comparison requires usable scenarios, checked costs and current evidence before identifying the highest middle-case firm net', () => {
  const { state, option } = clubExample();
  const first = E.decisionBrief(state, option);
  const compare = () => E.compareClubEstimates([first, E.decisionBrief(state, option)]);
  option.scenarioProceeds.middle = 100000;
  assert.deepEqual(compare(), { reason: 'tie', leaderIndices: [0, 1], firmLeaderNet: 2250, scenarioLeaderIndices: [1], scenarioLeaderNet: 103450 });
  option.fixedCosts[0].amount += 0.01;
  assert.deepEqual(compare(), { reason: 'compared', leaderIndices: [0], firmLeaderNet: 2250, scenarioLeaderIndices: [1], scenarioLeaderNet: 103449.99 });
  state.evidence.surveyProbablyAtPrice = { opt: 90 };
  option.price = 160; // existing named answers are stale
  assert.deepEqual(compare(), { reason: 'turnoutEvidence', leaderIndices: [], firmLeaderNet: null, scenarioLeaderIndices: [], scenarioLeaderNet: null });
  state.evidence.offerTerms.opt = E.offerTerms(option, {});
  assert.deepEqual(compare(), { reason: 'compared', leaderIndices: [1], firmLeaderNet: 2609.99, scenarioLeaderIndices: [1], scenarioLeaderNet: 103809.99 });
  option.costsVerified = false;
  assert.equal(compare().reason, 'quoteOrCosts');
  option.scenarioParticipants.conservative = 60;
  assert.equal(compare().reason, 'scenarioOrder');
  option.scenarioParticipants.optimistic = null;
  assert.equal(compare().reason, 'incomplete');
  assert.equal(E.compareClubEstimates([first]).reason, 'single');
});

test('golf and auction can lead on different bases, tie for full scenario net, or both lose money', () => {
  const { state, option } = clubExample();
  const golf = { ...option, kind: 'golf_shotgun', fixedCosts: [{ amount: 1000 }] };
  const auction = { ...option, kind: 'auction', fixedCosts: [{ amount: 2000 }] };
  function brief(o) {
    state.evidence.offerTerms.opt = E.offerTerms(o, {});
    return E.decisionBrief(state, o);
  }
  const compare = () => E.compareClubEstimates([brief(golf), brief(auction)]);
  auction.scenarioProceeds.middle = 1200;
  let result = compare();
  assert.deepEqual(result.leaderIndices, [0]);
  assert.deepEqual(result.scenarioLeaderIndices, [1]);
  assert.equal(result.firmLeaderNet, 1750);
  assert.equal(result.scenarioLeaderNet, 3150);
  auction.scenarioProceeds.middle = 1000;
  result = compare();
  assert.deepEqual(result.scenarioLeaderIndices, [0, 1]);
  assert.equal(result.scenarioLeaderNet, 2950);
  golf.fixedCosts[0].amount += 4000;
  auction.fixedCosts[0].amount += 4000;
  result = compare();
  assert.equal(result.firmLeaderNet, -2250);
  assert.equal(result.scenarioLeaderNet, -1050);
  assert.deepEqual(result.leaderIndices, [0]);
  assert.deepEqual(result.scenarioLeaderIndices, [0, 1]);
});

test('missing cost, admission, quote or deposit withholds a decision estimate; explicit zeros are usable', () => {
  const { state, option } = clubExample();
  const real = (property, key, issue) => {
    const value = property[key];
    property[key] = '';
    const incomplete = E.decisionBrief(state, option);
    assert.deepEqual([incomplete.cases.middle.net, incomplete.cases.middle.firmNet, incomplete.cases.middle.issue], [null, null, issue]);
    assert.equal(incomplete.breakEven.issue, issue);
    property[key] = 0;
    assert.equal(E.decisionBrief(state, option).cases.middle.issue, null);
    property[key] = value;
  };
  real(option, 'price', 'missingPrice');
  real(option.perParticipantCosts[0], 'amount', 'missingCost');
  real(option.fixedCosts[1], 'amount', 'missingCost');
  for (const key of ['flatFee', 'perParticipant', 'minimumSpend', 'minimumParticipants']) real(option.venueQuote, key, 'missingQuote');
  real(option.deposit, 'amount', 'missingQuote');
});

test('an unentered auction bid estimate leaves scenario net unknown and keeps the firm comparison basis available', () => {
  const { state, option } = clubExample();
  const complete = E.decisionBrief(state, option);
  for (const absent of ['', null, undefined]) {
    option.scenarioProceeds.middle = absent;
    const b = E.decisionBrief(state, option);
    assert.equal(b.cases.middle.issue, 'missingBid');
    assert.equal(b.cases.middle.net, null);
    assert.equal(b.cases.middle.firmNet, 2250);
    assert.equal(b.breakEven.participants, 8);
    assert.equal(E.compareClubEstimates([complete, b]).reason, 'incomplete');
  }
  option.scenarioProceeds.middle = 0;
  assert.equal(E.decisionBrief(state, option).cases.middle.net, 3450);
});

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

// Updated 2026-10-19 (audit F1, DECISION_LOG row 42): registration cash is the amount actually received,
// not price x paid headcount. Committed sponsorship is still excluded from cash in hand.
test('cash in hand counts only collected sponsorship and registration money actually received', () => {
  const sponsorships = [
    { id: 'a', amount: 300, status: 'collected', type: 'cash' },
    { id: 'b', amount: 900, status: 'committed', type: 'cash' },
  ];
  const r = E.project(base(), 40, ctx({ sponsorships, paidRegistrations: 2, paidRegistrationCash: 300 }));
  assert.equal(r.upfront.cashInHand, 300 + 300);
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

// Fixture updated 2026-10-19 (audit F1/F2 + readiness, DECISION_LOG rows 42-46): the strongest result now also needs the
// survey's offer terms recorded, the amount received entered, and the cancellation amount known. The rule under test is unchanged.
test('decision: strongest result requires verified quote AND firm demand covering break-even', () => {
  const o = { ...base(), quoteVerified: true, costsVerified: true, cancellationOwed: 0, scenarioParticipants: { conservative: 24 } };
  const state = {
    settings: {}, sponsorships: [], volunteerHoursAvailable: 100, snapshot: {},
    evidence: { surveyResponses: 30, paidRegistrations: { opt: 4 }, paidCashReceived: { opt: 600 }, namedHighIntent: { opt: 4 }, surveyDefinitelyAtPrice: { opt: 20 } },
  };
  state.evidence.offerTerms = { opt: E.offerTerms(o, state.snapshot) };
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

test('free-admission auction: high risk if the low auction estimate covers costs, not viable if it does not', () => {
  const o = { ...base(), id: 'free', price: 0, perParticipantCosts: [], venueQuote: { flatFee: 2000, perParticipant: 0, minimumParticipants: 0, minimumSpend: 0 },
    scenarioParticipants: { conservative: 40 }, scenarioProceeds: { conservative: 3000 } };
  const st = { settings: {}, sponsorships: [], evidence: {}, scenarioSettings: {} };
  const d = E.decide(st, o);
  assert.equal(d.breakEven.reachableWithinCapacity, false); // firm money alone never covers costs
  assert.equal(d.status, 'high_risk');                       // but the organizer's low auction figure would
  o.scenarioProceeds.conservative = 1000;                     // 1000 < 2000 + 500 fixed costs
  assert.equal(E.decide(st, o).status, 'not_viable_as_configured');
});

test('same-turnout scenario and comparison estimates reconcile exactly across income, sponsors and cost cushions', () => {
  const state = structuredClone(require('./fixtures/close-golf-offers-fictional.json'));
  const [a, b] = state.options;
  const result = (option) => E.decisionBrief(state, option);
  const check = (option) => {
    const brief = result(option), v = brief.likelyAdjustments, m = brief.cases.middle;
    const cents = (n) => Math.round(n * 100);
    const delta = cents(v.extraIncome) + cents(v.cashSponsorChange) + cents(v.inKindSavingsChange)
      + cents(v.comparisonCushion) - cents(v.scenarioCushion);
    assert.equal(cents(m.firmNet) + delta, cents(m.net));
    return v;
  };
  assert.equal(result(a).cases.middle.firmNet, 4150);
  assert.equal(result(b).cases.middle.net, 4180);
  assert.equal(result(b).cases.middle.firmNet, 4130);
  assert.deepEqual(check(b), {extraIncome: 0, cashSponsorChange: 0, inKindSavingsChange: 0, comparisonCushion: 50, scenarioCushion: 0});

  // The likely case can count fewer cash and in-kind promises while adding other income.
  state.sponsorships = [
    {type: 'cash', amount: 35.12, status: 'committed', optionId: b.id},
    {type: 'inKind', amount: 20.25, status: 'committed', optionId: b.id, replacesCostId: b.fixedCosts[0].id},
  ];
  const likely = state.scenarioSettings.middle;
  likely.statuses = ['collected'];
  likely.otherRevenue = 15.25;
  likely.extraRevenuePerParticipant = 0.50;
  likely.costContingencyPct = 5;
  assert.deepEqual(check(b), {extraIncome: 51.25, cashSponsorChange: -35.12, inKindSavingsChange: -20.25, comparisonCushion: 47.98, scenarioCushion: 25});
  check(a);
  b.scenarioParticipants.middle = null;
  assert.equal(result(b).likelyAdjustments, null);
  assert.equal(result(b).cases.middle.net, null);
});
