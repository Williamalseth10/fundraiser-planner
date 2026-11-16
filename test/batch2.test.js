// Batch 2: interest by offer, capacity shortcuts, same-turnout comparison (DECISION_LOG row 87). All data is FICTIONAL.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const D = require('../src/demo-data.js');
const clone = (x) => JSON.parse(JSON.stringify(x));
const control = () => clone(require('./fixtures/golf-control-fictional.json'));
const cents = (x) => Math.round(x * 100);

test('interest funnel keeps every stage separate; unknown stays unknown; named counts only for the current offer', () => {
  const s = control(), o = s.options[0];
  const f = E.interestFunnel(s, o);
  assert.equal(f.contacted, null);          // never entered: unknown, not 0
  assert.equal(f.responses, 60);
  assert.deepEqual([f.named, f.anonymousYes, f.maybe, f.paid, f.cashReceived], [40, 0, 20, 32, 4000]);
  assert.equal(f.offerState, 'current');
  assert.equal(f.namedCounted, 40);
  assert.ok(!('interested' in f) && !('total' in f)); // no stage sum
  s.evidence.surveyContacted = 0;
  assert.equal(E.interestFunnel(s, o).contacted, 0); // a real zero
  o.price = 150;                                      // the offer changed
  const g = E.interestFunnel(s, o);
  assert.equal(g.offerState, 'stale');
  assert.equal(g.named, 40);                          // answers are kept...
  assert.equal(g.namedCounted, 0);                    // ...but no longer count
  assert.deepEqual([g.paid, g.cashReceived], [32, 4000]); // payments untouched
});

test('past rounds are listed with their own offer, never added to current answers', () => {
  const s = control(), o = s.options[0];
  s.evidence.offerHistory = { golf: [{ id: 'r1', archivedOn: '2026-10-01', terms: { kind: 'golf_shotgun', price: 11000, groupSize: 4, groupPrice: 44000 }, named: 25, definitely: 5, probably: 9, surveyResponses: 50, surveyContacted: 200 }] };
  const f = E.interestFunnel(s, o);
  assert.equal(f.pastRounds.length, 1);
  assert.deepEqual([f.pastRounds[0].named, f.pastRounds[0].anonymousYes, f.pastRounds[0].maybe, f.pastRounds[0].contacted], [25, 5, 9, 200]);
  assert.equal(f.pastRounds[0].terms.price, 11000);
  assert.equal(f.named, 40);                          // not 65
  assert.equal(E.decide(s, o).namedCounted, 40);      // the decision uses current-offer answers only
  const without = control();
  assert.deepEqual(E.decide(s, o), E.decide(without, without.options[0])); // history changes no result
});

test('capacity shortcuts: whole groups rounded down, never above capacity; each row equals project() for that scenario', () => {
  const s = control(), o = s.options[0]; // capacity 100, foursomes only, 72-player minimum, $1,000 credited deposit
  const sc = E.capacityShortcuts(s, o, 'middle');
  assert.equal(sc.available, true);
  assert.deepEqual(sc.rows.map((r) => [r.pct, r.requested, r.participants]), [[50, 50, 48], [75, 75, 72], [100, 100, 100]]);
  assert.ok(sc.rows[0].flags.includes('rounded_down_to_whole_groups'));
  assert.equal(sc.rows[0].venueMinimumApplied, true);  // 48 players still pay the 72-player minimum
  const ctx = E.scenarioContext(s, o, 'middle'), firm = E.firmContext(s, o);
  for (const r of sc.rows) {
    const p = E.project(o, r.participants, ctx), f = E.project(o, r.participants, firm);
    assert.deepEqual([r.revenue, r.expenses, r.net, r.cashNeeded, r.cashShort], [p.revenue.total, p.expenses.total, p.net, p.upfront.required, p.upfront.gap]);
    assert.equal(r.firmNet, f.net);
  }
  assert.equal(sc.rows[1].net, 5020);                   // the hand-checked middle case at 72
  assert.equal(sc.rows[1].isCurrent, true);
  // a different scenario uses its own assumptions (conservative counts collected sponsorship only)
  assert.equal(E.capacityShortcuts(s, o, 'conservative').rows[1].net, 5020 - 500);
});

test('preview equals applied: putting a shortcut into a scenario gives exactly the previewed figures', () => {
  for (const k of ['conservative', 'middle', 'optimistic']) {
    const s = control(), o = s.options[0];
    for (const r of E.capacityShortcuts(s, o, k).rows) {
      const applied = clone(s); applied.options[0].scenarioParticipants[k] = r.participants; // what "Use N as …" does
      const ao = applied.options[0], p = E.project(ao, ao.scenarioParticipants[k], E.scenarioContext(applied, ao, k));
      assert.deepEqual([p.participants, p.revenue.total, p.expenses.total, p.net, p.upfront.gap], [r.participants, r.revenue, r.expenses, r.net, r.cashShort], `${k} ${r.pct}%`);
      assert.deepEqual(applied.evidence, s.evidence); // paid sign-ups, receipts and answers untouched
      assert.deepEqual(applied.sponsorships, s.sponsorships);
    }
  }
});

test('shortcuts below the number already paid are marked; zero capacity offers none; items count one by one', () => {
  const s = control(), o = s.options[0];
  o.capacity = 60; // 50% = 30 -> 28 foursome players, below the 32 already paid
  const sc = E.capacityShortcuts(s, o, 'middle');
  assert.equal(sc.rows[0].participants, 28);
  assert.equal(sc.rows[0].belowPaid, true);
  assert.equal(sc.rows[1].belowPaid, false);           // 45 -> 44
  o.capacity = 0;
  assert.deepEqual(E.capacityShortcuts(s, o, 'middle'), { available: false, scenario: 'middle', rows: [] });
  const g = clone(D.DEMO_GALA), dough = g.options[1];   // product sale: items, no groups
  assert.deepEqual(E.capacityShortcuts(g, dough, 'middle').rows.map((r) => r.participants), [1000, 1500, 2000]);
});

test('deposit floor and minimum bill are inside the shortcut figures (no double counting of a credited deposit)', () => {
  const s = control(), o = s.options[0];
  o.venueQuote.minimumParticipants = 0; o.capacity = 40; // $1,000 non-refundable credited deposit floors the bill below 17 players
  const r = E.capacityShortcuts(s, o, 'middle').rows[0]; // 50% of 40 = 20 players
  assert.equal(r.participants, 20);
  assert.equal(E.project(o, 20, E.scenarioContext(s, o, 'middle')).expenses.separateDepositFee, 0);
  const small = clone(s); small.options[0].capacity = 24; // 50% = 12 players: bill is the $1,000 floor, not 12 x $60
  assert.equal(E.project(small.options[0], E.capacityShortcuts(small, small.options[0], 'middle').rows[0].participants, E.scenarioContext(small, small.options[0], 'middle')).expenses.venue, 1000);
});

// Tee times vs shotgun, fictional: same 48 players.
function teeVsShotgun() {
  const s = control();
  const sg = s.options[0]; // shotgun: $60/player, 72 minimum, $125 / $500 foursome
  const tee = clone(sg);
  Object.assign(tee, { id: 'tee', name: 'Tee times (fictional)', kind: 'golf_tee_times', capacity: 64 });
  tee.venueQuote = { flatFee: 0, perParticipant: 55, minimumParticipants: 0, minimumSpend: 0 };
  tee.deposit = { amount: 250, creditedTowardBill: true, refundable: true };
  tee.fixedCosts = [{ id: 'other', label: 'Prizes and signs', amount: 500, paidUpfront: true }];
  s.options = [tee, sg];
  s.evidence.paidRegistrations = { golf: 0, tee: 0 }; s.evidence.paidCashReceived = {};
  return s;
}

test('same turnout: extra cost, sponsorship to cover it, and extra paying golfers found by an exact scan', () => {
  const s = teeVsShotgun(), [tee, sg] = s.options;
  const r = E.compareAtSameTurnout(s, tee, sg, 48);
  assert.equal(r.a.participants, 48); assert.equal(r.b.participants, 48); assert.equal(r.sameCount, true);
  assert.equal(r.costlierId, 'golf');
  const pt = E.project(tee, 48, E.firmContext(s, tee)), ps = E.project(sg, 48, E.firmContext(s, sg));
  assert.equal(r.extraCost, (cents(ps.expenses.total) - cents(pt.expenses.total)) / 100);
  assert.equal(r.sponsorshipToCover, (cents(pt.net) - cents(ps.net)) / 100);
  assert.equal(ps.expenses.venueMinimumApplied, true);       // the shotgun pays its 72-player minimum at 48
  // the scan: the first count above 48 where the shotgun's firm net reaches the tee-time net at 48
  const need = 48 + r.playersToCover;
  assert.ok(E.project(sg, need, E.firmContext(s, sg)).net >= pt.net);
  assert.ok(E.project(sg, need - 4, E.firmContext(s, sg)).net < pt.net); // foursomes: the previous feasible count falls short
  assert.equal(need % 4, 0);
  assert.equal(r.recoverable, true);
  // nothing in the plan changed
  assert.deepEqual(s, teeVsShotgun());
});

test('same turnout: below a minimum, extra golfers cost only their per-person costs until the minimum is used up', () => {
  const s = teeVsShotgun(), [tee, sg] = s.options;
  const r = E.compareAtSameTurnout(s, tee, sg, 40);
  // the shotgun bill stays at 72 x $60 until 72 players, so each extra foursome adds $500 - 4 x $5 to its net
  const at = (n) => E.project(sg, n, E.firmContext(s, sg)).net;
  assert.equal(at(44) - at(40), 480);
  assert.equal(at(76) - at(72), 500 - 4 * 65);
  assert.ok(r.playersToCover > 0);
  assert.ok(at(40 + r.playersToCover) >= E.project(tee, 40, E.firmContext(s, tee)).net);
});

test('same turnout: group pricing is used, and an extra cost that more players can never recover is said to be so', () => {
  const s = teeVsShotgun(), [tee, sg] = s.options;
  sg.groupPrice = 200; sg.groupShare = 1; // every shotgun player in a $200 foursome: each foursome loses money
  const r = E.compareAtSameTurnout(s, tee, sg, 48);
  assert.equal(r.playersToCover, null);
  assert.equal(r.recoverable, false);
  assert.ok(r.sponsorshipToCover > 0);    // firm sponsorship is still a way to cover it
  const s2 = teeVsShotgun(); s2.options[1].capacity = 52; // too little room above 48 to close the gap
  const r2 = E.compareAtSameTurnout(s2, s2.options[0], s2.options[1], 48);
  assert.equal(r2.recoverable, false);
  assert.equal(r2.maxFeasibleCostlier, 52);
});

test('same turnout: each option rounds to its own whole groups; equal costs need nothing', () => {
  const s = teeVsShotgun(), [tee, sg] = s.options;
  tee.wholeGroupsOnly = false; tee.groupSize = 1;
  const r = E.compareAtSameTurnout(s, tee, sg, 50);
  assert.deepEqual([r.a.participants, r.b.participants, r.sameCount], [50, 48, false]);
  assert.ok(r.b.flags.includes('rounded_down_to_whole_groups'));
  const same = E.compareAtSameTurnout(s, sg, clone(sg), 48);
  assert.deepEqual([same.costlierId, same.extraCost, same.sponsorshipToCover, same.playersToCover], [null, 0, 0, 0]);
});
