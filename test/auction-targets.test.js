const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine');

function fixture() {
  const o = {
    id: 'sale', kind: 'auction', price: 0, capacity: 50, groupSize: 1,
    venueQuote: { flatFee: 425.25, perParticipant: 0, minimumSpend: 0, minimumParticipants: 0 }, deposit: { amount: 0 },
    fixedCosts: [{ id: 'items', amount: 75.5, paidUpfront: true }],
    perParticipantCosts: [{ id: 'food', amount: 12.4 }],
    scenarioParticipants: { conservative: 0, middle: 10, optimistic: 55 },
    scenarioProceeds: { conservative: 0, middle: 900.25 },
  };
  const s = {
    settings: { fundraisingTarget: 1000 }, evidence: {},
    scenarioSettings: { conservative: { costContingencyPct: 10 }, middle: { otherRevenue: 600, extraRevenuePerParticipant: 20 } },
    sponsorships: [
      { type: 'cash', status: 'collected', amount: 100 },
      { type: 'cash', status: 'committed', amount: 45 },
      { type: 'cash', status: 'hoped', amount: 2000 },
      { type: 'cash', status: 'collected', amount: 3000, optionId: 'other' },
      { type: 'inKind', status: 'committed', amount: 25.5, replacesCostId: 'items' },
    ],
    options: [o],
  };
  return { s, o };
}

test('free auction targets use written sponsors and exact costs before assumed bid income', () => {
  const { s, o } = fixture();
  const before = structuredClone(s);
  const [low, likely, high] = E.auctionTargets(s, o);
  // $425.25 venue + $124 meals + $50 items after donation + $17.40 cushion − $145 sponsors.
  assert.equal(likely.coverCosts, 471.65);
  assert.equal(likely.reachGoal, 1471.65);
  assert.equal(likely.proceeds, 900.25);
  assert.equal(low.guests, 0);
  assert.equal(low.proceeds, 0);
  assert.equal(high.proceeds, null);
  assert.deepEqual([high.requested, high.guests], [55, 50]);
  assert.deepEqual(s, before);
  o.scenarioProceeds.middle = 999999;
  assert.equal(E.auctionTargets(s, o)[1].reachGoal, 1471.65);
});

test('paid tickets keep actual receipts and a ticket surplus cannot imply negative bids are needed', () => {
  const { s, o } = fixture();
  s.evidence = { paidRegistrations: { sale: 4 }, paidCashReceived: { sale: 80.20 } };
  o.price = 200;
  const [low, likely] = E.auctionTargets(s, o);
  assert.equal(low.issue, 'belowPaid');
  assert.equal(low.coverCosts, undefined);
  assert.equal(likely.coverCosts, 0);
  // 4 already paid $80.20 in total, and 6 new full-price tickets bring $1,200.
  assert.equal(likely.reachGoal, 191.45);
  delete s.settings.fundraisingTarget;
  assert.equal(E.auctionTargets(s, o)[1].reachGoal, null);
  o.price = 500;
  s.settings.fundraisingTarget = 100;
  assert.equal(E.auctionTargets(s, o)[1].reachGoal, 0);
});

test('auction targets withhold missing inputs and conflicts after whole-table rounding and capacity', () => {
  const { s, o } = fixture();
  s.evidence = { paidRegistrations: { sale: 10 }, paidCashReceived: {} };
  o.groupSize = 8; o.wholeGroupsOnly = true;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'belowPaid'); // 10 -> 8
  o.scenarioParticipants.middle = 16;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'missingReceipts');
  s.evidence.paidCashReceived.sale = 0;
  assert.equal(E.auctionTargets(s, o)[1].issue, null);
  o.capacity = 8;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'belowPaid');
  o.capacity = null;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'capacity');
  o.capacity = 48;
  o.scenarioParticipants.middle = '';
  assert.equal(E.auctionTargets(s, o)[1].issue, 'missingTurnout');
  o.scenarioParticipants.middle = 16;
  o.price = null;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'missingPrice');
  o.price = 0;
  o.fixedCosts[0].amount = null;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'missingCost');
  o.fixedCosts[0].amount = 0;
  o.venueQuote.minimumSpend = null;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'missingQuote');
  o.venueQuote.minimumSpend = 0;
  s.evidence.paidCashReceived.sale = 200;
  s.evidence.paidRegistrations.sale = 0;
  assert.equal(E.auctionTargets(s, o)[1].issue, 'cashWithoutPaid');
});

test('changing fundraiser kind excludes hidden auction proceeds while preserving them if the auction is restored', () => {
  const { s, o } = fixture();
  o.scenarioProceeds.conservative = 1000;
  for (const kind of ['product', 'ticketed', 'golf_shotgun', 'generic']) {
    o.kind = kind;
    assert.deepEqual(E.auctionTargets(s, o), []);
    assert.equal(E.scenarioContext(s, o, 'middle').otherRevenue, 600);
    assert.equal(E.decide(s, o).proceedsLow, 0);
    assert.equal(E.decide(s, o).conditional, null);
  }
  o.kind = 'auction';
  assert.equal(E.scenarioContext(s, o, 'middle').otherRevenue, 1500.25);
  assert.equal(E.decide(s, o).proceedsLow, 1000);
});
