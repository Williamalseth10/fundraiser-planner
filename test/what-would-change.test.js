// "What would need to change?" and the contract-date checklist (DECISION_LOG rows 77-79). All data is fictional.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const E = require('../src/engine.js');
const D = require('../src/demo-data.js');
const clone = (x) => JSON.parse(JSON.stringify(x));
const control = () => clone(require('./fixtures/golf-control-fictional.json'));

test('control case: scenario nets, cash, break-even and goal match the hand-checked figures', () => {
  const s = control(), o = s.options[0];
  const net = (k) => E.project(o, o.scenarioParticipants[k], E.scenarioContext(s, o, k)).net;
  assert.equal(net('conservative'), 1640);
  assert.equal(net('middle'), 5020);
  assert.equal(net('optimistic'), 7200);
  const d = E.decide(s, o);
  assert.equal(d.exposure.cashNeededBeforeEvent, 1800);
  assert.equal(d.exposure.cashInHand, 5000);
  assert.equal(d.breakEven.participants, 32);
  assert.equal(d.targetNeeded.participants, 72);
  // the credited $1,000 deposit is part of the $4,320 course bill, never a separate expense
  const p72 = E.project(o, 72, E.scenarioContext(s, o, 'middle'));
  assert.equal(p72.expenses.separateDepositFee, 0);
  assert.equal(p72.expenses.venue, 4320);
  assert.equal(p72.expenses.total, 5480);
});

test('what would change at the conservative scenario keeps its collected-only rule and separates break-even from the goal', () => {
  const s = control(), o = s.options[0];
  const w = E.whatWouldChange(s, o, { scenario: 'conservative', participants: 48 });
  assert.equal(w.net, 1640);
  assert.deepEqual(w.basis.statuses, ['collected']);
  assert.equal(w.basis.leftOut, 1000); // $500 committed and $500 hoped are left out, as the scenario says
  assert.equal(w.sponsorship.toBreakEven, 0);
  assert.equal(w.sponsorship.toGoal, 3360);
  assert.equal(w.headcount.moreHelps, true);
  assert.equal(w.headcount.toGoal, 80);          // above the 72-player minimum each player adds $125 - $65: 60 x 80 + 200 = 5,000
  assert.equal(w.headcount.nextParticipants, 52);
  assert.equal(w.headcount.nextChange, 480);     // below the 72-player minimum, 4 more players add 4 x ($125 - $5)
});

test('hoped-for sponsorship never closes a firm gap, even in the optimistic scenario', () => {
  const s = control(), o = s.options[0];
  const w = E.whatWouldChange(s, o, { scenario: 'optimistic', participants: 100 });
  assert.deepEqual(w.basis.statuses, ['collected', 'committed']);
  assert.equal(w.net, 6700); // the scenario's $7,200 minus the $500 hoped-for sponsor
  assert.equal(w.basis.hopedSponsorship, 500);
  s.sponsorships.push({ id: 'big', label: 'Huge hope', amount: 99999, status: 'hoped', type: 'cash', optionId: '' });
  s.settings.fundraisingTarget = 20000;
  const w2 = E.whatWouldChange(s, o, { participants: 100 });
  assert.equal(w2.net, 6700);
  assert.equal(w2.sponsorship.toGoal, 13300);
  assert.equal(w2.goal.reachableWithinCapacity, false);
  assert.equal(w2.goal.bestOnChart.participants, 100);
  assert.equal(w2.goal.sponsorshipAtBest, 13300);
  assert.equal(w2.headcount.toGoal, null); // capacity is full: no headcount answer
});

test('a requested headcount is never rounded up, and the rounding is reported', () => {
  const s = control(), o = s.options[0];
  const w = E.whatWouldChange(s, o, { participants: 50 });
  assert.equal(w.basis.participants, 48);
  assert.ok(w.basis.flags.includes('rounded_down_to_whole_groups'));
  const over = E.whatWouldChange(s, o, { participants: 130 });
  assert.equal(over.basis.participants, 100);
  assert.ok(over.basis.flags.includes('over_capacity'));
});

test('negative margin: never suggests more sales, and 50 items stay 50 with individual-item settings', () => {
  const s = clone(D.BLANK_STATE), o = s.options[0];
  Object.assign(o, { kind: 'product', price: 10, capacity: 100, groupSize: 1, wholeGroupsOnly: false, groupPrice: null, groupShare: 0 });
  o.venueQuote.perParticipant = 15;
  s.scenarioSettings.conservative.costContingencyPct = 0;
  const w = E.whatWouldChange(s, o, { participants: 50 });
  assert.equal(w.basis.participants, 50);
  assert.equal(w.net, -250);
  assert.equal(w.headcount.moreHelps, false);
  assert.equal(w.headcount.toBreakEven, null);
  assert.equal(w.headcount.nextChange, -5);
  assert.equal(w.sponsorship.toBreakEven, 250);
  assert.equal(E.whatWouldChange(s, o, { participants: 100 }).net, -500);
  // a typed-in comparison price below cost is flagged as losing money on each extra item
  const [p8, p20] = E.whatWouldChange(s, o, { participants: 50, prices: [{ price: 8 }, { price: 20 }] }).prices;
  assert.equal(p8.margins.loses, 'all');
  assert.equal(p8.net, -350);
  assert.equal(p20.margins.loses, 'none');
  assert.equal(p20.net, 250);
  // the inherited golf grouping (row 76) is visible as rounding, never silent
  const g = { ...o, groupSize: 4, wholeGroupsOnly: true };
  const wg = E.whatWouldChange(s, g, { participants: 50 });
  assert.equal(wg.basis.participants, 48);
  assert.ok(wg.basis.flags.includes('rounded_down_to_whole_groups'));
});

test('zero price with a per-guest charge: more guests lower the result and break-even sits below the count', () => {
  const s = clone(D.BLANK_STATE), o = s.options[0];
  Object.assign(o, { kind: 'ticketed', price: 0, capacity: 120, groupSize: 1, wholeGroupsOnly: false });
  o.venueQuote.perParticipant = 12;
  s.scenarioSettings.conservative.costContingencyPct = 0;
  s.sponsorships = [{ id: 'a', label: 'Firm', amount: 600, status: 'committed', type: 'cash', optionId: '' }];
  const w = E.whatWouldChange(s, o, { participants: 80, prices: [{ price: 0 }] });
  assert.equal(w.net, 600 - 960);
  assert.equal(w.headcount.moreHelps, false);
  assert.equal(w.headcount.toBreakEven, null);
  assert.equal(w.headcount.breakEvenBelow, 0);
  assert.equal(w.prices[0].margins.loses, 'all');
});

test('price comparison keeps paid tickets at the money received and leaves the plan untouched', () => {
  const s = control(), o = s.options[0];
  const before = JSON.stringify(s);
  const w = E.whatWouldChange(s, o, { participants: 48, prices: [{ price: 0 }, { price: 150, groupPrice: 560 }, { price: 110 }, { price: -5 }, { price: 'x' }] });
  assert.equal(JSON.stringify(s), before);
  assert.equal(w.prices.length, 3); // negative and non-numeric prices are ignored, not treated as 0
  const [free, p150, p110] = w.prices;
  // $4,000 received from the 32 who paid + $0 for 16 more + $1,500 firm sponsorship - $5,360 costs
  assert.equal(free.net, 4000 + 1500 - 5360);
  // 16 new players at 50% group share: 2 foursomes at $560 + 8 singles at $150
  assert.equal(p150.net, 4000 + 2 * 560 + 8 * 150 + 1500 - 5360);
  assert.equal(p150.groupPriceSource, 'typed');
  assert.equal(p110.groupPrice, 440);
  assert.equal(p110.groupPriceSource, 'none'); // $500 was exactly 4 x $125: no deal to keep
  assert.equal(p110.goalParticipants, 88);
});

test('mixed pricing: only full groups lose money, and the margins say which (row 82)', () => {
  const s = control(), o = s.options[0];
  // at 76 players the 72-player minimum is passed, so each player costs $60 + $5
  const [p] = E.whatWouldChange(s, o, { participants: 76, prices: [{ price: 125, groupPrice: 200 }] }).prices;
  assert.equal(p.margins.loses, 'group');
  assert.equal(p.margins.costPerUnit, 65);
  assert.equal(p.margins.singleMargin, 60);     // a single player still covers their cost
  assert.equal(p.margins.groupMargin, -60);     // a $200 foursome costs 4 x $65 = $260
  assert.equal(p.margins.belowMinimum, false);
  // the exact next step: 4 more players, with the 50% group guess, change firm money by this much
  const at = (n, alt) => E.project(alt, n, E.firmContext(s, alt)).net;
  const alt = { ...o, price: 125, groupPrice: 200 };
  assert.equal(p.nextChange, at(80, alt) - at(76, alt));
  // singles below cost but a group premium above it: only singles lose
  const [q] = E.whatWouldChange(s, o, { participants: 76, prices: [{ price: 60, groupPrice: 300 }] }).prices;
  assert.equal(q.margins.loses, 'single');
  // both below cost: everything loses
  const [r] = E.whatWouldChange(s, o, { participants: 76, prices: [{ price: 60, groupPrice: 200 }] }).prices;
  assert.equal(r.margins.loses, 'all');
  // nobody assumed to buy as a group: a cheap group price is irrelevant, and singles decide
  const o0 = { ...o, groupShare: 0 };
  assert.equal(E.whatWouldChange(s, o0, { participants: 76, prices: [{ price: 125, groupPrice: 200 }] }).prices[0].margins.loses, 'none');
});

test('below a venue minimum an extra player costs only the other per-person costs', () => {
  const s = control(), o = s.options[0];
  const m = E.pricingMargins(o, 48);            // the 72-player course minimum is already billed
  assert.equal(m.belowMinimum, true);
  assert.equal(m.costPerUnit, 5);
  assert.equal(E.pricingMargins(o, 72).costPerUnit, 65);
  // a minimum BILL TOTAL works the same way: $3,000 covers 50 players at $60 (players come in foursomes)
  const spend = { ...o, venueQuote: { ...o.venueQuote, minimumParticipants: 0, minimumSpend: 3000 }, deposit: { amount: 0, creditedTowardBill: true, refundable: true } };
  assert.equal(E.pricingMargins(spend, 44).costPerUnit, 5);   // 44 -> 48: still inside the $3,000
  assert.equal(E.pricingMargins(spend, 48).costPerUnit, 35);  // 48 -> 52 crosses it: bill $3,000 -> $3,120, $30 each + $5
  assert.equal(E.pricingMargins(spend, 52).costPerUnit, 65);
  // and a non-refundable credited deposit that sets a floor on the bill: $1,000 covers 16 players at $60
  const floor = { ...o, venueQuote: { ...o.venueQuote, minimumParticipants: 0 } };
  assert.equal(E.pricingMargins(floor, 8).costPerUnit, 5);
  assert.equal(E.pricingMargins(floor, 20).costPerUnit, 65);
});

test('the dip reason in decide() names which kind of sale loses money, never a blanket rule', () => {
  // 80% of players come in a $100 foursome (4 x $65 = $260 cost, so each foursome loses $160); singles pay $125 and
  // cover their $65, but not enough of them to make up for it. Nobody has paid yet; the 40 named answers are recorded
  // for this exact offer. (At a 50% share the singles outweigh the foursomes and net never dips: that is the point.)
  const s = control(), o = s.options[0];
  Object.assign(o, { price: 125, groupPrice: 100, groupShare: 0.8, wholeGroupsOnly: true });
  o.venueQuote.minimumParticipants = 0;
  s.evidence.paidRegistrations = { golf: 0 }; s.evidence.paidCashReceived = {};
  s.evidence.offerTerms = { golf: E.offerTerms(o, s.snapshot) };
  const d = E.decide(s, o);
  const curve = E.netCurve(o, E.firmContext(s, o));
  assert.ok(d.breakEven.nonMonotonic, JSON.stringify(curve.slice(0, 12)));
  assert.equal(d.breakEven.participants, 4);
  assert.equal(d.breakEven.dipsAt, 40);
  assert.equal(d.status, 'high_risk');
  const dip = d.reasons.find((r) => /falls below zero again/.test(r));
  assert.ok(dip, d.reasons.join(' | '));
  assert.doesNotMatch(dip, /each extra person costs more than they pay/);
  assert.match(dip, /a full group of 4 at \$100\.00 costs more than it pays \(cost \$65\.00 each\), while a single person at \$125\.00 still covers its cost/);
  // when every buyer is in a whole group there are no singles: then it is "every extra sale", stated with the group price
  const all = E.pricingMargins({ ...o, groupShare: 1 }, 40);
  assert.equal(all.singlesUsed, false);
  assert.equal(all.loses, 'all');
  // and the old sentence still appears when every sale loses money
  const p = clone(D.BLANK_STATE), x = p.options[0];
  Object.assign(x, { kind: 'ticketed', price: 0, capacity: 120, groupSize: 1, wholeGroupsOnly: false });
  x.venueQuote.perParticipant = 12; x.quoteVerified = true;
  p.sponsorships = [{ id: 'a', label: 'Firm', amount: 600, status: 'committed', type: 'cash', optionId: '' }];
  p.evidence.paidRegistrations = { opt1: 10 }; p.evidence.paidCashReceived = { opt1: 0 }; p.evidence.surveyResponses = 5;
  const dx = E.decide(p, x);
  assert.match(dx.reasons.join(' '), /each extra person costs more than they pay \(price \$0\.00, cost \$12\.00 each\)/);
});

test('preview and apply give identical money: one shared hypotheticalPrice for every kind of option (row 82)', () => {
  const s0 = control();
  const blankProduct = () => {
    const s = clone(D.BLANK_STATE), o = s.options[0];
    // a blank plan switched to a product sale keeps golf grouping (groups of 4, whole groups); add an inherited deal
    Object.assign(o, { kind: 'product', price: 10, capacity: 100, groupPrice: 30, groupShare: 0.5 });
    o.venueQuote.perParticipant = 6; s.scenarioSettings.conservative.costContingencyPct = 0;
    return s;
  };
  const cases = [
    ['product with inherited grouping and a $30 group deal', blankProduct(), [{ price: 12 }, { price: 12, groupPrice: 44 }, { price: 0 }]],
    ['product with groups of 4 and no deal', (() => { const s = blankProduct(); s.options[0].groupPrice = null; return s; })(), [{ price: 12 }]],
    ['product with individual items and a leftover group price', (() => { const s = blankProduct(); Object.assign(s.options[0], { groupSize: 1, wholeGroupsOnly: false }); return s; })(), [{ price: 12 }]],
    ['golf control, no deal', s0, [{ price: 150 }, { price: 150, groupPrice: 560 }, { price: 110 }]],
    ['golf with a $460 foursome deal', (() => { const s = control(); s.options[0].groupPrice = 460; return s; })(), [{ price: 150 }, { price: 140, groupPrice: 520 }]],
    ['gala tables of 8', clone(D.DEMO_GALA), [{ price: 90 }, { price: 90, groupPrice: 640 }]],
  ];
  for (const [label, s, prices] of cases) {
    const o = s.options[0];
    for (const req of [{ participants: 48 }, { participants: 50 }, { scenario: 'conservative' }, { scenario: 'optimistic' }]) {
      const r = { ...req, participants: req.participants ?? o.scenarioParticipants[req.scenario] };
      const w = E.whatWouldChange(s, o, { ...r, prices });
      w.prices.forEach((pr, k) => {
        const applied = { ...clone(o), price: pr.apply.price, groupPrice: pr.apply.groupPrice };
        const after = E.whatWouldChange({ ...s, options: [applied, ...s.options.slice(1)] }, applied, r);
        assert.equal(after.net, pr.net, `${label}, price ${JSON.stringify(prices[k])}, ${JSON.stringify(r)}`);
        assert.equal(after.basis.groupPrice, pr.groupPrice, label);
        for (const f of ['groupSize', 'wholeGroupsOnly', 'groupShare']) assert.equal(applied[f], o[f], `${label}: ${f} kept`);
      });
    }
  }
  // the reproduced case: the inherited $30 deal is kept and shown, not silently dropped
  const s = blankProduct(), o = s.options[0];
  const [p] = E.whatWouldChange(s, o, { participants: 48, prices: [{ price: 12 }] }).prices;
  assert.equal(p.groupPriceSource, 'kept');
  assert.equal(p.apply.groupPrice, 30);
  assert.equal(p.groupPrice, 30);
  assert.equal(p.net, 180);
  // with no grouping the stored group price is left exactly as it was
  const one = { ...o, groupSize: 1, wholeGroupsOnly: false };
  assert.deepEqual(E.hypotheticalPrice(one, { price: 12 }), { price: 12, groupPrice: 30, groupPriceSource: 'not_grouped' });
});

test('sponsorship tied to another option does not count for this one', () => {
  const s = control(), o = s.options[0];
  s.options.push({ ...clone(o), id: 'other', name: 'Other' });
  s.sponsorships[1].optionId = 'other';
  const w = E.whatWouldChange(s, o, { participants: 48 });
  assert.equal(w.basis.firmSponsorship, 1000);
  assert.equal(w.net, 2140 - 500);
});

test('compareOptions lines up cash, losses and volunteer hours per option on firm money', () => {
  const s = clone(D.DEMO_GALA);
  const rows = E.compareOptions(s);
  assert.equal(rows.length, 2);
  for (const [r, o] of rows.map((r, i) => [r, s.options[i]])) {
    const d = E.decide(s, o);
    assert.equal(r.cashNeededBeforeEvent, d.exposure.cashNeededBeforeEvent);
    assert.equal(r.largestLoss, d.exposure.largestLoss);
    assert.equal(r.firmNetLikely, E.project(o, o.scenarioParticipants.middle, E.firmContext(s, o)).net);
    assert.equal(r.volunteerHours, o.volunteerHours);
  }
  // auction estimates are not firm money: the gala's likely firm net is lower than its likely scenario net
  assert.ok(rows[0].firmNetLikely < E.project(s.options[0], 120, E.scenarioContext(s, s.options[0], 'middle')).net);
});

test('contract checklist: unknown stays unknown, deadline and amount owed are separate', () => {
  const o = control().options[0];
  let k = E.contractChecklist(o, '2026-11-14');
  assert.ok(k.dates.every((x) => x.state === 'unknown'));
  assert.equal(k.cancellationOwed, 4320);
  assert.ok(k.unresolved.includes('Last day to cancel under the quote’s terms'));
  assert.ok(!k.unresolved.includes('Amount owed if you cancel'));
  o.contract = { quoteDate: '2026-11-01', quoteExpires: '2026-11-13', depositDue: '2026-11-14', headcountDue: '2027-05-01', cancelBy: '2027-02-30', quoteSource: '  Email from course, Nov 1  ', cancellationNotes: 'Tiered', weatherNotes: '' };
  o.cancellationOwed = null;
  k = E.contractChecklist(o, '2026-11-14');
  const by = Object.fromEntries(k.dates.map((x) => [x.key, x]));
  assert.equal(by.quoteExpires.state, 'passed');
  assert.equal(by.quoteExpires.days, -1);
  assert.equal(by.depositDue.state, 'today');
  assert.equal(by.headcountDue.state, 'upcoming');
  assert.equal(by.headcountDue.days, 168);
  assert.equal(by.cancelBy.state, 'unknown'); // February 30th is not a date
  assert.equal(k.quoteSource, 'Email from course, Nov 1');
  assert.ok(k.unresolved.includes('Amount owed if you cancel'));
  assert.deepEqual(k.passed, ['Quote expires', 'Deposit due']);
  // dates never change the money
  const s = control(); s.options[0].contract = o.contract;
  assert.deepEqual(E.decide(s, s.options[0]).exposure, E.decide(control(), control().options[0]).exposure);
});

test('calendar dates are checked as calendar days, in any time zone', () => {
  assert.equal(E.isCalendarDate('2028-02-29'), true);
  assert.equal(E.isCalendarDate('2027-02-29'), false);
  assert.equal(E.isCalendarDate('2027-13-01'), false);
  assert.equal(E.isCalendarDate('2027-1-01'), false);
  assert.equal(E.isCalendarDate(20270101), false);
  const script = "const E=require('./src/engine.js');process.stdout.write(JSON.stringify([E.daysBetween('2026-03-07','2026-03-09'),E.daysBetween('2026-10-31','2026-11-02'),E.contractChecklist({contract:{depositDue:'2026-11-15'}},'2026-11-14').dates[1].days]))";
  for (const tz of ['UTC', 'America/Los_Angeles', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString();
    assert.equal(out, '[2,2,1]', tz); // DST changeovers included
  }
});
