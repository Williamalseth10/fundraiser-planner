const test = require('node:test');
const assert = require('node:assert/strict');
const { BLANK_STATE } = require('../src/blank-plan.js');
const Q = require('../src/board-questions.js');

const today = '2026-11-18';
function fixture() {
  const state = structuredClone(BLANK_STATE);
  function option(id, kind) {
    return {
      ...structuredClone(state.options[0]), id, name: id, kind,
      capacity: 80, price: 500, groupPrice: 1000, groupShare: 1,
      venueQuote: { flatFee: 200, perParticipant: 20, minimumParticipants: 8, minimumSpend: 0 },
      deposit: { amount: 300, creditedTowardBill: true, refundable: false },
      scenarioParticipants: { conservative: 8, middle: 8, optimistic: 60 }, quoteVerified: true, costsVerified: true,
    };
  }
  const tee = option('Tee', 'golf_tee_times'), shot = option('Shotgun', 'golf_shotgun');
  shot.venueQuote.minimumParticipants = 20;
  shot.deposit.amount = 800;
  state.options = [tee, shot];
  state.criteria = { minNet: 350, decideBy: '2026-11-18' };
  state.evidence = { paidRegistrations: { Tee: 8, Shotgun: 8 }, paidCashReceived: { Tee: 650.25, Shotgun: 650.25 } };
  state.sponsorships = [
    { type: 'cash', amount: 100.50, status: 'committed', optionId: 'Shotgun' },
    { type: 'cash', amount: 20, status: 'collected' },
    { type: 'cash', amount: 2300, status: 'hoped' },
  ];
  return { state, tee, shot, golf: () => Q.golfQuestion(state, tee, shot, today) };
}

test('shotgun threshold uses exact option-specific net after quoted minimums and actual receipts', () => {
  const { state, golf } = fixture(), original = structuredClone(state);
  const q = golf();
  // Tee = 650.25 + 20 - 360. Shotgun = 650.25 + 20 + 100.50 - the $800 floor.
  assert.deepEqual([q.paid, q.receipts, q.teeNet, q.shotgunNet], [8, 650.25, 310.25, -29.25]);
  assert.deepEqual([q.shotgunCostDifference, q.match, q.reachMinimum], [440, 339.50, 379.25]);
  assert.deepEqual([q.upfront.required, q.upfront.cashInHand, q.upfront.gap], [800, 670.25, 129.75]);
  assert.deepEqual(state, original);
  state.sponsorships[0].amount = 500;
  assert.equal(golf().match, 0);
  assert.equal(golf().reachMinimum, 0);
  state.criteria.minNet = null;
  assert.equal(golf().reachMinimum, null);
});

test('golf deadlines preserve labels, unknowns, expiry, and the board decision date separately', () => {
  const { shot, golf } = fixture();
  shot.contract = { quoteDate: '2026-11-01', depositDue: today, cancelBy: '2026-11-14', quoteExpires: '2026-12-03' };
  const [teeDates, shotDates] = golf().timing;
  assert.ok(teeDates.dates.every((r) => r.state === 'unknown'));
  const events = Object.fromEntries(shotDates.dates.map((r) => [r.key, [r.date, r.state]]));
  assert.deepEqual(events, { quoteExpires: ['2026-12-03','upcoming'], depositDue: [today,'today'], headcountDue: [null,'unknown'], cancelBy: ['2026-11-14','passed'] });
  assert.equal(shotDates.board.state, 'today');
  assert.equal(golf().issue, null);
  shot.contract.quoteExpires = '2026-11-17';
  assert.equal(golf().issue, 'expiredQuote');
  assert.equal(golf().match, undefined);
});

test('golf withholds thresholds for missing costs, incompatible attendance, or non-transferable receipts', () => {
  for (const [mutate, reason] of [
    [(s, t) => { t.quoteVerified = false; }, 'verifyCosts'],
    [(s, t) => { t.venueQuote.minimumSpend = null; }, 'missingQuote'],
    [(s, t) => { delete t.deposit.refundable; }, 'depositTerms'],
    [(s, t) => { t.contract = { quoteDate: '2026-11-19' }; }, 'futureQuote'],
    [(s) => { s.sponsorships[0].amount = null; }, 'sponsorAmount'],
    [(s, t) => { t.capacity = 4; }, 'unusableCount'],
    [(s) => { s.evidence.paidRegistrations.Tee = 5; }, 'unusableCount'],
    [(s) => { delete s.evidence.paidRegistrations.Tee; }, 'paidCount'],
    [(s) => { delete s.evidence.paidCashReceived.Tee; }, 'receipts'],
    [(s) => { s.evidence.paidRegistrations.Tee = 4; }, 'differentCounts'],
    [(s) => { s.evidence.paidCashReceived.Tee += 0.01; }, 'differentReceipts'],
  ]) {
    const { state, tee, golf } = fixture();
    mutate(state, tee);
    assert.equal(golf().issue, reason);
    assert.equal(golf().match, undefined);
  }
  const { state, golf } = fixture();
  state.evidence = { paidRegistrations: { Tee: 0, Shotgun: 0 }, paidCashReceived: {} };
  assert.equal(golf().paid, 0);
  state.evidence.paidCashReceived.Shotgun = 1;
  assert.equal(golf().issue, 'receipts');
});

function auctionFixture() {
  const { state, tee: o } = fixture();
  o.kind = 'auction'; state.options = [o]; o.scenarioProceeds = { middle: 380.25 };
  o.clubHistoryResearch = { lots: [
    { id: 'concert', name: 'Concert seats', donated: true, includedInLikely: true, estimatedNet: 210.25,
      comps: [{ id: 'sold', name: 'Past sale', source: 'Club settlement', eventDate: '2025-11-18', outcome: 'sold', comparable: true, bid: 232.25, fees: 22 }] },
    { id: 'supper', name: 'Supper', donated: false, includedInLikely: true, estimatedNet: 170 },
    { id: 'unconfirmed', name: 'Potential donation', donated: true, includedInLikely: false, estimatedNet: 800 },
    { id: 'fiction', name: 'Practice', fictional: true, donated: true, includedInLikely: true, estimatedNet: 500 },
  ] };
  return { state, o, auction: () => Q.auctionQuestion(state, o, today) };
}
test('auction loss removes just one explicitly counted after-fee estimate and uses the likely scenario and board minimum', () => {
  const { state, o, auction } = auctionFixture();
  state.scenarioSettings.middle.otherRevenue = 45;
  state.criteria.minNet = 370;
  const original = structuredClone(state);
  const q = auction();
  assert.deepEqual([q.names, q.lotNet, q.sources], [['Concert seats'], 210.25, [1]]);
  // $650.25 receipts + $20 sponsor + $380.25 after-fee bids + $45 other − $360.
  assert.deepEqual([q.likelyNet, q.after, q.vsMinimum], [735.50, 525.25, 155.25]);
  assert.deepEqual(state, original);
  state.criteria.minNet = 600;
  assert.equal(auction().vsMinimum, -74.75);
  state.criteria.minNet = null;
  assert.equal(auction().vsMinimum, null);
  o.clubHistoryResearch.lots[0].comps[0].fees = null;
  assert.deepEqual(auction().sources, [0]);
});

test('a tie removes one lot, zero is deliberate, and unconfirmed lots or an unreconciled manual bid total withhold the answer', () => {
  const { o, auction } = auctionFixture();
  const [concert, supper] = o.clubHistoryResearch.lots;
  supper.donated = true; supper.estimatedNet = 210.25; o.scenarioProceeds.middle = 420.50;
  const tie = auction();
  assert.deepEqual(tie.names, ['Concert seats', 'Supper']);
  assert.equal(tie.likelyNet - tie.after, 210.25);
  o.scenarioProceeds.middle = 421;
  assert.equal(auction().issue, 'reconcileLots');
  o.scenarioProceeds.middle = 220;
  assert.equal(auction().issue, 'reconcileLots');
  concert.estimatedNet = null;
  assert.equal(auction().issue, 'unknownLotValue');
  concert.estimatedNet = supper.estimatedNet = o.scenarioProceeds.middle = 0;
  assert.equal(auction().issue, null);
  assert.equal(auction().after, auction().likelyNet);
  concert.includedInLikely = supper.includedInLikely = false;
  assert.equal(auction().issue, 'noIncludedDonation');
});

test('auction honors missing receipts, unknown vs zero turnout, and capacity/whole-group limits', () => {
  const { state, o, auction } = auctionFixture();
  o.scenarioParticipants.middle = null;
  assert.equal(auction().issue, 'missingTurnout');
  o.scenarioParticipants.middle = 5;
  assert.equal(auction().issue, 'unusableCount');
  o.scenarioParticipants.middle = 9;
  assert.deepEqual([auction().requested, auction().participants], [9, 8]);
  state.evidence.paidCashReceived.Tee = null;
  assert.equal(auction().issue, 'receipts');
  delete state.evidence.paidRegistrations.Tee;
  assert.equal(auction().issue, 'paidCount');
  state.evidence.paidRegistrations.Tee = 0;
  o.scenarioParticipants.middle = 0;
  assert.equal(auction().participants, 0);
  o.venueQuote.flatFee = null;
  assert.equal(auction().issue, 'missingQuote');
});
