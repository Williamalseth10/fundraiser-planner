'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const { recommendEvents } = require('../src/club-recommendation.js');
const fixture = require('./fixtures/golf-control-fictional.json');
const today = '2026-11-18';

function plan() {
  const s = structuredClone(fixture);
  s.criteria = { minNet: 3000, maxLoss: 10000, decideBy: '2026-11-22' };
  s.options[0].name = 'Golf day';
  s.options[0].contract = { quoteDate: '2026-11-13', quoteExpires: '2026-12-01', quoteSource: 'Club test quote' };
  return s;
}
function extra(s, id = 'two', name = 'Second offer') {
  const o = structuredClone(s.options[0]);
  o.id = id;
  o.name = name;
  s.options.push(o);
  for (const map of Object.values(s.evidence)) {
    if (map && typeof map === 'object' && Object.hasOwn(map, 'golf')) map[id] = structuredClone(map.golf);
  }
  return o;
}
function outcome(s) { return recommendEvents(s, today); }
function held(s, expected, words) {
  const r = outcome(s);
  assert.equal(r.status, expected);
  assert.equal(r.options[0].rank, null);
  assert.match(r.reason + ' ' + r.next, words);
}

test('single supported offer shows firm money, distinct paid and named counts, and the downside to an assumed turnout', () => {
  const s = plan(), copy = structuredClone(s);
  const r = outcome(s);
  assert.equal(r.status, 'shortlist');
  assert.deepEqual([r.options[0].rank, r.options[0].firmNet], [1, 5020]);
  assert.match(r.reason, /32 paid.*40 additional named/);
  assert.match(r.reason, /low count of 48.*\$2,140.*\$3,000/);
  assert.deepEqual(s, copy);
  const rows = s.options.map((o) => ({brief: E.decisionBrief(s, o), ready: E.readiness(s, o, today)}));
  assert.deepEqual(recommendEvents(s, today, rows), r);
});

test('compares dollars at each eligible event’s own turnout and handles ties without a forced winner', () => {
  const s = plan();
  const b = extra(s);
  b.fixedCosts[0].amount -= 100;
  let r = outcome(s);
  assert.deepEqual(r.options.map((o) => o.rank), [2, 1]);
  assert.match(r.title, /Second offer/);
  assert.match(r.reason, /\$5,120/);
  extra(s, 'three', 'Third offer').fixedCosts[0].amount -= 100;
  r = outcome(s);
  assert.equal(r.status, 'tie');
  assert.deepEqual(r.options.map((o) => o.rank), [3, 1, 1]);
  assert.match(r.title, /Second offer and Third offer/);
});

test('a stronger unquoted alternative is unranked and the overall choice stays open', () => {
  const s = plan();
  const b = extra(s);
  b.fixedCosts[0].amount = 0;
  b.quoteVerified = false;
  const r = outcome(s);
  assert.equal(r.status, 'conditional');
  assert.deepEqual(r.options.map((o) => o.rank), [1, null]);
  assert.match(r.reason, /incomplete for Second offer/);
  assert.match(r.next, /written terms and costs/);
});

test('open or stale offer interest, anonymous interest and high turnout assumptions cannot earn a rank', () => {
  for (const change of ['stale','unrecorded','anonymous']) {
    const s = plan();
    if (change === 'stale') s.options[0].price++;
    if (change === 'unrecorded') delete s.evidence.offerTerms;
    if (change === 'anonymous') {
      s.evidence.namedHighIntent.golf = 0;
      s.evidence.surveyDefinitelyAtPrice.golf = 9999;
    }
    held(s, 'needsInput', /32 paid and 0 additional named/);
  }
});

test('checks input completeness, exact feasible counts and the order of cases before reporting net', () => {
  for (const [mutate, words] of [
    [(s) => { s.options[0].scenarioParticipants.middle = ''; }, /turnout assumption is missing/],
    [(s) => { s.options[0].scenarioParticipants.conservative = 0; }, /below the paid count/],
    [(s) => { s.options[0].scenarioParticipants.middle = 73; }, /whole groups/],
    [(s) => { s.options[0].scenarioParticipants.optimistic = 120; }, /capacity/],
    [(s) => { s.options[0].scenarioParticipants.optimistic = 68; }, /out of order/],
    [(s) => { s.evidence.paidRegistrations.golf = 31; }, /part of a group/],
    [(s) => { delete s.evidence.paidCashReceived; }, /actual receipts/],
    [(s) => { s.options[0].perParticipantCosts[0].amount = null; }, /expense/],
    [(s) => { s.options[0].costsVerified = false; }, /costs still need checking/],
    [(s) => { delete s.criteria.minNet; }, /minimum proceeds/],
    [(s) => { delete s.options[0].cancellationOwed; }, /owed on cancellation/],
    [(s) => { s.volunteerHoursAvailable = null; }, /Volunteer need or availability/],
  ]) {
    const s = plan();
    mutate(s);
    held(s, 'needsInput', words);
  }
});

test('recommends revising a failed proceeds, hours or cancellation-loss limit', () => {
  const s = plan();
  s.criteria.minNet = 5020.01;
  held(s, 'revise', /\$5,020.01/);
  s.criteria.minNet = 5020;
  s.volunteerHoursAvailable = 99;
  held(s, 'revise', /needs 100 volunteer hours/);
  s.volunteerHoursAvailable = 100;
  s.criteria.maxLoss = 100;
  held(s, 'revise', /Canceling under the quote/);
});

test('rejects a low-turnout loss above the limit even when canceling is covered', () => {
  const s = plan();
  const o = s.options[0];
  o.fixedCosts[0].amount = 1800;
  o.fixedCosts[0].paidUpfront = false;
  o.deposit.refundable = true;
  o.cancellationOwed = 0;
  s.criteria.maxLoss = 20;
  const parts = E.readiness(s,o,today).criteria[1].parts;
  assert.deepEqual(parts.map((p) => p.result), ['met', 'unmet']);
  held(s, 'revise', /Holding the event at a feasible turnout/);
});

test('a large written sponsorship can cover proceeds, but only actual cash or explicit funding covers the upfront gap', () => {
  const s = plan(), o = s.options[0];
  s.criteria.maxLoss = 15000;
  s.scenarioSettings.conservative.statuses = ['collected', 'committed'];
  o.fixedCosts[0].amount = 8000;
  s.sponsorships[1].amount = 12000;
  held(s, 'needsInput', /upfront bills exceed cash in hand by \$4,000/);
  o.upfrontFundingConfirmed = true;
  const r = outcome(s);
  assert.equal(r.status, 'shortlist');
  assert.match(r.reason, /confirmed funding for its \$4,000 upfront gap/);
});

test('past dates, today’s deadline and a board meeting after the quote expires require action', () => {
  for (const expires of ['2026-11-17', today, '2026-11-20']) {
    const s = plan();
    s.options[0].contract.quoteExpires = expires;
    held(s, 'needsInput', /Quote expires/);
  }
  const s = plan();
  s.criteria.decideBy = '2026-11-17';
  held(s, 'needsInput', /board’s decision date has passed/);
  s.criteria.decideBy = today;
  s.options[0].contract.quoteDate = '2026-11-19';
  held(s, 'needsInput', /quote is dated in the future/);
});

test('auction bids and hoped-for sponsors never lift an option’s firm rank', () => {
  const s = plan(), o = extra(s, 'auction', 'Auction');
  o.kind = 'auction';
  s.evidence.offerTerms[o.id] = E.offerTerms(o, s.snapshot);
  o.scenarioProceeds = {conservative: 200000, middle: 500000, optimistic: 1000000};
  o.fixedCosts[0].amount += 100;
  s.sponsorships.push({id: 'wish', label:'Unconfirmed', status:'hoped', type:'cash', amount:700000, optionId:o.id});
  const r = outcome(s);
  assert.deepEqual(r.options.map((x) => x.rank), [1,2]);
  assert.equal(r.options[1].firmNet, 4920);
  assert.match(r.title, /Golf day/);
});

test('blank, demo and break-even-only plans produce no board shortlist', () => {
  const empty = recommendEvents({options:[]}, today);
  assert.equal(empty.status, 'needsInput');
  const s = plan();
  s.isDemo = true;
  assert.equal(outcome(s).status, 'practice');
  s.isDemo = false;
  s.criteria.maxLoss = 15000;
  s.criteria.minNet = 0;
  s.options[0].fixedCosts[0].amount += 5020;
  held(s, 'revise', /surplus/);
});

test('partial recorded offers cannot turn imported named answers into current evidence; older complete offers and paid counts still work', () => {
  const s = plan(), o = s.options[0], complete = s.evidence.offerTerms.golf;
  for (const terms of [{}, { price: complete.price }, { ...complete, price: null }]) {
    s.evidence.offerTerms.golf = terms;
    assert.equal(E.evidenceStatus(s, o).state, 'unrecorded');
    held(s, 'needsInput', /32 paid and 0 additional named/);
  }
  s.evidence.offerTerms.golf = { ...complete };
  delete s.evidence.offerTerms.golf.supports;
  assert.equal(E.evidenceStatus(s, o).state, 'current');
  assert.equal(outcome(s).status, 'shortlist');
  s.evidence.offerTerms.golf = {};
  s.evidence.paidRegistrations.golf = 72;
  s.evidence.paidCashReceived.golf = 9000;
  o.scenarioParticipants.conservative = 72;
  assert.equal(outcome(s).status, 'shortlist');
  assert.match(outcome(s).reason, /72 paid\. 0 additional named/);
});

test('a positive deposit with absent answers cannot choose the wrong offer or certify proceeds', () => {
  const s = plan(), a = s.options[0], b = extra(s);
  b.fixedCosts[0].amount += 500;
  a.deposit = {amount: 1000};
  const untouched = structuredClone(s);
  let r = outcome(s);
  assert.equal(r.status, 'conditional');
  assert.equal(r.title, 'Keep the overall choice open');
  assert.deepEqual(r.options.map((o) => [o.rank, o.firmNet]), [[null, null], [1, 4520]]);
  assert.match(r.next, /deposit/);
  assert.deepEqual(s, untouched);
  const brief = E.decisionBrief(s, a);
  assert.equal(brief.breakEven.issue, 'depositTerms');
  assert.ok(Object.values(brief.cases).every((c) => c.net === null && c.firmNet === null));
  const ready = E.readiness(s, a, today);
  assert.deepEqual([ready.criteria[0].value, ready.criteria[0].result, ready.criteria[1].result], [null, 'unknown', 'unknown']);
  assert.equal(ready.criteria[1].parts[0].loss, 5120);
  assert.equal(ready.criteria[1].parts[1].loss, null);
  s.criteria.maxLoss = 4000;
  assert.equal(E.readiness(s, a, today).criteria[1].result, 'unmet');
  s.criteria.maxLoss = 10000;

  a.deposit.creditedTowardBill = false;
  assert.equal(outcome(s).options[0].firmNet, null);
  a.deposit.refundable = false;
  r = outcome(s);
  assert.deepEqual(r.options.map((o) => [o.rank, o.firmNet]), [[2, 4020], [1, 4520]]);
  a.deposit.creditedTowardBill = true;
  r = outcome(s);
  assert.deepEqual(r.options.map((o) => [o.rank, o.firmNet]), [[1, 5020], [2, 4520]]);
  b.fixedCosts[0].amount -= 500;
  assert.equal(outcome(s).status, 'tie');
  a.deposit = {amount: 1000, refundable: true};
  assert.equal(outcome(s).options[0].firmNet, null);
  a.deposit.creditedTowardBill = false;
  assert.equal(outcome(s).status, 'tie');
  a.deposit = {amount: 0};
  assert.equal(outcome(s).status, 'tie');
});
