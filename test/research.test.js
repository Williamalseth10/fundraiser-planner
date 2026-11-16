// Research records, Batch 1 (DECISION_LOG row 84). All data is fictional.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const D = require('../src/demo-data.js');
const clone = (x) => JSON.parse(JSON.stringify(x));
const example = () => clone(require('../docs/research-example-fictional.json'));
const noResearch = () => { const s = example(); delete s.research; return s; };

test('audience totals are per counting unit, never summed across units, and say they are not unique people', () => {
  const a = E.audienceSummary(example());
  assert.deepEqual(a.units.map((u) => u.unit).sort(), ['businesses', 'households', 'people']);
  const people = a.units.find((u) => u.unit === 'people');
  assert.equal(people.reachSum, 180);          // the league's unknown size is NOT counted as 0 and NOT added
  assert.equal(people.reachUnknown, 1);
  assert.equal(people.unique, false);
  assert.equal(people.overlaps, true);         // parents and league members overlap
  assert.deepEqual(people.overlapping.sort(), ['aud_league', 'aud_parents']);
  // households and businesses stay in their own units: no "480 people" anywhere
  assert.equal(a.units.find((u) => u.unit === 'households').reachSum, 300);
  assert.equal(a.units.find((u) => u.unit === 'households').overlaps, false); // its overlap is with a PEOPLE group: warned, not "lower"
  assert.equal(a.units.find((u) => u.unit === 'businesses').reachSum, 40);
  assert.ok(!('total' in a) && !('uniquePeople' in a));
  // an overlap across units is called out once, not combined
  assert.equal(a.warnings.filter((w) => /different units/.test(w)).length, 1);
});

test('unknown stays unknown; zero stays zero', () => {
  const s = example();
  const b = s.research.audiences.find((x) => x.id === 'aud_business');
  assert.equal(E.audienceSummary(s).units.find((u) => u.unit === 'businesses').respondedSum, null); // unknown, not 0
  b.responded = 0;
  assert.equal(E.audienceSummary(s).units.find((u) => u.unit === 'businesses').respondedSum, 0);    // a real zero
  const lg = s.research.audiences.find((x) => x.id === 'aud_league');
  lg.reach = 0;
  const people = E.audienceSummary(s).units.find((u) => u.unit === 'people');
  assert.equal(people.reachUnknown, 0);
  assert.equal(people.reachKnown, 2);
  assert.equal(people.reachSum, 180);
});

test('impossible funnels are flagged, never corrected', () => {
  const s = example();
  const p = s.research.audiences.find((x) => x.id === 'aud_parents');
  p.contacted = 200; p.responded = 250;
  const w = E.audienceSummary(s).warnings.join(' ');
  assert.match(w, /more contacted \(200\) than the estimated reach \(180\)/);
  assert.match(w, /more responses \(250\) than people contacted \(200\)/);
  assert.equal(p.reach, 180); // unchanged
});

test('comparable price range: only close, priced, fee-known events, per person including fees; sample size and limits always given', () => {
  const s = example(), o = s.options[0];
  const c = E.comparableSummary(s, o);
  assert.equal(c.linked, 4);
  assert.equal(c.n, 2);
  assert.deepEqual(c.range, { min: 125, max: 155 });   // $150 + $5 fee, $125 + $0
  assert.deepEqual(c.excluded.map((x) => [x.id, x.reason]), [
    ['cmp_nine', 'marked only partly comparable'],
    ['cmp_country', 'required fees unknown (enter 0 if there are none)'],
  ]);
  assert.ok(c.limitations.some((l) => /Small sample: 2 events/.test(l)));
  assert.ok(c.limitations.some((l) => /Mixes early-bird and regular/.test(l)));
  assert.deepEqual(c.groups.map((g) => [g.id, g.perPerson]), [['cmp_rotary', 145], ['cmp_pta', 120]]); // $560/4 + $5; $480/4
  assert.ok(!Object.keys(c).some((k) => /recommend|suggest|market/i.test(k)));
});

test('a range needs two close comparisons; one, or a different unit, gives no range', () => {
  const s = example(), o = s.options[0];
  s.research.comparables.find((x) => x.id === 'cmp_pta').comparability = 'partial';
  const c = E.comparableSummary(s, o);
  assert.equal(c.n, 1);
  assert.equal(c.range, null);
  assert.ok(c.limitations.some((l) => /needs at least two/.test(l)));
  // an event linked to another option is not used for this one
  s.research.comparables.forEach((x) => { x.optionIds = ['someone-else']; });
  const none = E.comparableSummary(s, o);
  assert.equal(none.linked, 0);
  assert.equal(none.range, null);
  assert.ok(none.limitations.some((l) => /No similar events/.test(l)));
});

test('a "sold out" claim or a capacity never becomes demand: nothing is derived from them', () => {
  const s = example(), o = s.options[0];
  const nine = s.research.comparables.find((x) => x.id === 'cmp_nine');
  nine.comparability = 'close'; nine.feesPerPerson = 0; nine.resultNote = 'SOLD OUT, 200 players, limited to 50 teams';
  const before = E.decide(noResearch(), o);
  const c = E.comparableSummary(s, o);
  assert.equal(c.verifiedResults, 1); // only the PTA result was marked verified with a number
  assert.deepEqual(E.decide(s, s.options[0]), before);
});

test('research never changes money, statuses, evidence or what-if results', () => {
  const withR = example(), without = noResearch();
  const o1 = withR.options[0], o0 = without.options[0];
  for (const k of ['conservative', 'middle', 'optimistic']) {
    assert.deepEqual(E.project(o1, o1.scenarioParticipants[k], E.scenarioContext(withR, o1, k)), E.project(o0, o0.scenarioParticipants[k], E.scenarioContext(without, o0, k)));
  }
  assert.deepEqual(E.decide(withR, o1), E.decide(without, o0));
  assert.deepEqual(E.evidenceStatus(withR, o1), E.evidenceStatus(without, o0));
  assert.deepEqual(E.whatWouldChange(withR, o1, { scenario: 'conservative', participants: 48, prices: [{ price: 150 }] }), E.whatWouldChange(without, o0, { scenario: 'conservative', participants: 48, prices: [{ price: 150 }] }));
  assert.deepEqual(E.compareOptions(withR), E.compareOptions(without));
  // and the summaries do not write to the plan
  const snap = JSON.stringify(withR);
  E.audienceSummary(withR); E.comparableSummary(withR, o1); E.researchProblems(withR); E.researchKind(withR, withR.research.audiences[0]);
  assert.equal(JSON.stringify(withR), snap);
  // nothing in research reaches the survey evidence counts
  assert.deepEqual(withR.evidence, without.evidence);
});

test('broken references are reported, one by one', () => {
  const s = example();
  assert.deepEqual(E.researchProblems(s), []);
  s.research.audiences = s.research.audiences.filter((x) => x.id !== 'aud_league' && x.id !== 'aud_alumni'); // removed groups
  s.research.comparables = s.research.comparables.filter((x) => x.id !== 'cmp_rotary');   // removed event
  s.research.comparables[0].optionIds.push('deleted_option');                              // deleted option
  s.research.links.push({ id: 'lnk_x', optionId: 'gone', assumption: 'price', researchIds: [], note: '' });
  const p = E.researchProblems(s);
  const kinds = p.map((x) => `${x.kind}:${x.field}:${x.missingId}`).sort();
  // parents pointed at alumni as an overlap; the price note cited the Rotary event; the likely note cited the league
  assert.deepEqual(kinds, ['audience:overlapsWith:aud_alumni', 'comparable:optionIds:deleted_option', 'link:optionId:gone', 'link:researchIds:aud_league', 'link:researchIds:cmp_rotary'].sort());
});

test('kind of record: fictional example, sourced observation or organizer estimate', () => {
  const s = example();
  assert.equal(E.researchKind(s, s.research.audiences[0]), 'fictional'); // the example plan is marked made up
  s.isDemo = false;
  assert.equal(E.researchKind(s, s.research.audiences[0]), 'sourced');
  assert.equal(E.researchKind(s, s.research.audiences.find((x) => x.id === 'aud_business')), 'estimate');
  assert.equal(E.researchKind(s, s.research.comparables.find((x) => x.id === 'cmp_pta')), 'sourced'); // a printed flyer reference
  assert.equal(E.researchKind(s, { name: 'x', fictional: true }), 'fictional');
});

test('older plans without research work everywhere', () => {
  for (const s of [clone(D.DEMO_STATE), clone(D.DEMO_GALA), clone(D.BLANK_STATE)]) {
    assert.equal(E.audienceSummary(s).groups, 0);
    assert.deepEqual(E.researchProblems(s), []);
    s.options.forEach((o) => assert.equal(E.comparableSummary(s, o).linked, 0));
  }
  // malformed research inside a plan is ignored by the summaries rather than crashing them
  const s = clone(D.BLANK_STATE); s.research = { audiences: 'x', comparables: [null, 3], links: {} };
  assert.equal(E.audienceSummary(s).groups, 0);
  assert.equal(E.comparableSummary(s, s.options[0]).linked, 0);
});
