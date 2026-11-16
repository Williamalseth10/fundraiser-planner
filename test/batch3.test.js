// Batch 3: "Ready to commit?" (DECISION_LOG row 90). Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const D = require('../src/demo-data.js');
const clone = (x) => JSON.parse(JSON.stringify(x));
const control = () => clone(require('./fixtures/golf-control-fictional.json'));
const TODAY = '2026-11-16';
const crit = (r, key) => r.criteria.find((x) => x.key === key);

test('criteria: blank means unknown (never met); 0 is a deliberate value', () => {
  const s = control(), o = s.options[0];
  let r = E.readiness(s, o, TODAY);
  assert.equal(crit(r, 'minNet').result, 'unknown');
  assert.equal(crit(r, 'maxLoss').result, 'unknown');
  assert.equal(crit(r, 'decideBy').result, 'unknown');
  s.criteria = { minNet: '', maxLoss: null, decideBy: '' };
  r = E.readiness(s, o, TODAY);
  assert.deepEqual(['minNet', 'maxLoss', 'decideBy'].map((k) => crit(r, k).result), ['unknown', 'unknown', 'unknown']);
  // 0 is real: a likely net of $5,020 meets a $0 minimum; a $0 loss limit is exceeded by the $5,120 cancellation exposure
  s.criteria = { minNet: 0, maxLoss: 0 };
  r = E.readiness(s, o, TODAY);
  assert.equal(crit(r, 'minNet').result, 'met'); assert.equal(crit(r, 'minNet').threshold, 0);
  assert.equal(crit(r, 'maxLoss').result, 'unmet'); assert.equal(crit(r, 'maxLoss').threshold, 0);
  // nothing in the plan is defaulted or written
  assert.deepEqual(s.criteria, { minNet: 0, maxLoss: 0 });
});

test('minimum net: firm money at the likely number, exact boundary to the cent', () => {
  const s = control(), o = s.options[0];
  const likely = E.project(o, o.scenarioParticipants.middle, E.firmContext(s, o));
  s.criteria = { minNet: likely.net };
  let m = crit(E.readiness(s, o, TODAY), 'minNet');
  assert.equal(m.result, 'met'); assert.equal(m.value, likely.net); assert.equal(m.participants, likely.participants);
  s.criteria = { minNet: likely.net + 0.01 };
  m = crit(E.readiness(s, o, TODAY), 'minNet');
  assert.equal(m.result, 'unmet');
  // the low number is shown beside it, not deciding
  const low = E.project(o, o.scenarioParticipants.conservative, E.firmContext(s, o));
  assert.equal(m.lowValue, low.net); assert.equal(m.lowMeets, false);
  // firm basis: hoped-for sponsorship and assumed add-ons are not in it
  s.scenarioSettings.middle.extraRevenuePerParticipant = 50;
  assert.equal(crit(E.readiness(s, o, TODAY), 'minNet').value, likely.net);
});

test('maximum loss: cancellation and low turnout are named separately; exact boundary; unknown terms stay unknown', () => {
  const s = control(), o = s.options[0];
  const dec = E.decide(s, o);
  s.criteria = { maxLoss: dec.exposure.lossIfCanceled };
  let l = crit(E.readiness(s, o, TODAY), 'maxLoss');
  assert.equal(l.parts[0].key, 'cancel'); assert.equal(l.parts[0].loss, dec.exposure.lossIfCanceled); assert.equal(l.parts[0].result, 'met');
  assert.equal(l.parts[1].key, 'lowTurnout'); assert.equal(l.parts[1].loss, dec.exposure.worstOnChartLoss);
  assert.equal(l.result, 'met');
  s.criteria = { maxLoss: dec.exposure.lossIfCanceled - 0.01 };
  l = crit(E.readiness(s, o, TODAY), 'maxLoss');
  assert.equal(l.parts[0].result, 'unmet'); assert.equal(l.result, 'unmet');
  // missing cancellation terms: that exposure is unknown, never $0
  o.cancellationOwed = null;
  s.criteria = { maxLoss: 100000 };
  const r = E.readiness(s, o, TODAY);
  l = crit(r, 'maxLoss');
  assert.equal(l.parts[0].loss, null); assert.equal(l.parts[0].result, 'unknown');
  assert.equal(l.parts[1].result, 'met');
  assert.equal(l.result, 'unknown');
  assert.ok(r.actions.includes('quote'));
  // low turnout over the limit is unmet even when cancellation is unknown
  o.price = 10; o.groupPrice = null; o.scenarioParticipants.middle = 100;
  s.evidence.paidRegistrations.golf = 0; s.evidence.paidCashReceived = {};
  s.criteria = { maxLoss: 1 };
  l = crit(E.readiness(s, o, TODAY), 'maxLoss');
  assert.equal(l.parts[1].result, 'unmet'); assert.ok(l.parts[1].net < 0); assert.equal(l.result, 'unmet');
});

test('a positive likely net with stale evidence is not read as supported attendance', () => {
  const s = control(), o = s.options[0];
  s.evidence.offerTerms = { golf: E.offerTerms(o, s.snapshot) };
  o.price = 150; // offer changed after the answers were collected
  s.criteria = { minNet: 1000 };
  const r = E.readiness(s, o, TODAY);
  assert.equal(crit(r, 'minNet').result, 'met');              // the scenario clears the threshold...
  assert.equal(r.attendance.evidenceState, 'stale');
  assert.equal(r.attendance.namedCounted, 0);                   // ...but the named answers no longer count
  assert.equal(r.attendance.coveredBy, 'notCovered');
  assert.ok(r.actions.includes('reconfirm'));
  assert.ok(r.missing.some((m) => /different terms/.test(m)));
});

test('firm sponsorship is not cash: committed money counts in firm net but not in cash in hand', () => {
  const s = control(), o = s.options[0];
  o.deposit.amount = 9000; // more due up front than is in hand
  const r = E.readiness(s, o, TODAY);
  assert.equal(r.cash.committedSponsorship, 500);
  assert.equal(r.cash.collectedSponsorship, 1000);
  assert.equal(r.cash.inHand, 1000 + 4000);                    // collected + money actually received; not the $500 promised
  assert.ok(r.cash.short > 0);
  assert.ok(r.actions.includes('cash'));
  o.upfrontFundingConfirmed = true;
  assert.ok(!E.readiness(s, o, TODAY).actions.includes('cash'));
});

test('volunteer hours: need vs available, no dollar value; blank is unknown', () => {
  const s = control(), o = s.options[0];
  s.settings.volunteerHourValue = 25;
  let v = crit(E.readiness(s, o, TODAY), 'volunteers');
  assert.deepEqual([v.result, v.need, v.available], ['met', 100, 120]);
  assert.equal(Object.keys(v).some((k) => /value|dollar|cost/i.test(k)), false);
  s.volunteerHoursAvailable = 80;
  let r = E.readiness(s, o, TODAY);
  assert.equal(crit(r, 'volunteers').result, 'unmet'); assert.ok(r.actions.includes('volunteers'));
  s.volunteerHoursAvailable = 100;
  assert.equal(crit(E.readiness(s, o, TODAY), 'volunteers').result, 'met'); // exact boundary
  s.volunteerHoursAvailable = null;
  assert.equal(crit(E.readiness(s, o, TODAY), 'volunteers').result, 'unknown');
  s.volunteerHoursAvailable = 0; o.volunteerHours = '';
  assert.equal(crit(E.readiness(s, o, TODAY), 'volunteers').result, 'unknown');
  o.volunteerHours = 0;
  assert.equal(crit(E.readiness(s, o, TODAY), 'volunteers').result, 'met');   // 0 needed, 0 available: deliberate
});

test('decision deadline is a timing fact: passed, today and upcoming change no other result', () => {
  const s = control(), o = s.options[0];
  s.criteria = { minNet: 1000, maxLoss: 6000 };
  const base = E.readiness(s, o, TODAY).criteria.filter((c) => c.key !== 'decideBy');
  for (const [date, timing, days] of [['2026-11-01', 'passed', -15], ['2026-11-16', 'today', 0], ['2026-11-17', 'upcoming', 1]]) {
    s.criteria.decideBy = date;
    const r = E.readiness(s, o, TODAY), dl = crit(r, 'decideBy');
    assert.deepEqual([dl.result, dl.timing, dl.days], ['timing', timing, days]);
    assert.deepEqual(r.criteria.filter((c) => c.key !== 'decideBy'), base);
    assert.equal(r.actions.includes('deadline'), timing !== 'upcoming');
    assert.equal(r.status, E.decide(s, o).status);
  }
  s.criteria.decideBy = '2026-02-30';
  assert.equal(crit(E.readiness(s, o, TODAY), 'decideBy').result, 'unknown');
  // calendar days, not time zones: one local day apart is one day
  s.criteria.decideBy = '2027-01-01';
  assert.equal(crit(E.readiness(s, o, '2026-12-31'), 'decideBy').days, 1);
});

test('product items and event participants each use their own unit and counts', () => {
  const g = clone(D.DEMO_GALA);
  const [gala, dough] = g.options;
  const rg = E.readiness(g, gala, TODAY), rd = E.readiness(g, dough, TODAY);
  assert.equal(rg.units, 'guests'); assert.equal(rd.units, 'items');
  assert.equal(rd.attendance.likely, E.project(dough, dough.scenarioParticipants.middle, E.firmContext(g, dough)).participants);
});

test('next actions: never approve or cancel; the board decides last; no change to the plan or the status', () => {
  const s = control(), before = clone(s);
  for (const o of s.options) {
    const r = E.readiness(s, o, TODAY);
    assert.equal(r.actions[r.actions.length - 1], 'board');
    assert.ok(!r.actions.some((a) => /approve|cancel|sign/i.test(a)));
    assert.equal(r.status, E.decide(s, o).status);
  }
  assert.deepEqual(s, before);
  // missing information alone never removes the "board" step or adds a cancel action
  const bare = clone(D.DEMO_STATE);
  bare.options.forEach((o) => { const r = E.readiness(bare, o, TODAY); assert.equal(r.actions.at(-1), 'board'); });
});
