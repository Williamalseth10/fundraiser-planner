// Research records, Batch 1 and its correction (DECISION_LOG rows 84-85). All data is FICTIONAL.
// The "analogue" records below imitate the shapes of real research (a duo-priced community scramble, an AI-indexed
// listing, a celebrity package, a future event with a capacity, an old event with reported participation) with
// made-up names, places, prices and URLs. They are not real market data.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const D = require('./fixtures/plans.js');
const clone = (x) => JSON.parse(JSON.stringify(x));
const example = () => clone(require('../docs/research-example-fictional.json'));

// A REAL-looking plan (isDemo false) holding fictional analogues, the way an organizer's own plan would hold records.
// Kept in test/fixtures/research-analogues-fictional.json so the browser test uses exactly the same records.
const analoguePlan = () => clone(require('./fixtures/research-analogues-fictional.json'));

test('provenance is explicit: a source or URL never promotes an estimate, and older records are not upgraded', () => {
  const s = analoguePlan();
  assert.equal(E.researchKind(s, s.research.audiences.find((x) => x.id === 'a_est')), 'estimate'); // has a source, still an estimate
  assert.equal(E.researchKind(s, s.research.comparables.find((x) => x.id === 'c_ai')), 'observation');
  assert.equal(E.researchVerification(s.research.comparables.find((x) => x.id === 'c_ai')), 'unchecked'); // URL, but not opened
  // a record saved by 08fed6b (no provenance, has a URL) stays "not recorded", never "sourced" or "checked"
  const legacy = { id: 'old', name: 'Old record', sourceUrl: 'https://example.org/old', source: 'flyer' };
  assert.equal(E.researchKind(s, legacy), 'unrecorded');
  assert.equal(E.researchVerification(legacy), 'unchecked');
  assert.equal(E.researchVerification({ verification: 'trust me' }), 'unchecked');
  assert.equal(E.researchVerification({ verification: 'checked' }), 'checked');
  // an example plan is fictional throughout
  const ex = example();
  assert.ok(ex.research.comparables.every((c) => E.researchKind(ex, c) === 'fictional'));
  assert.equal(E.researchKind(s, { provenance: 'fictional' }), 'fictional');
  assert.equal(E.researchKind(s, { fictional: true, provenance: 'observation' }), 'fictional');
});

test('real plan: fictional records never mix into real summaries ($150 real + $10 fictional is not a $10-$150 range)', () => {
  const s = analoguePlan(), o = s.options[0];
  const c = E.comparableSummary(s, o);
  assert.ok(!('range' in c) && !('min' in c) && !('max' in c));
  assert.ok(!c.observations.some((x) => x.id === 'c_fic' || x.priceSingle === 10));
  assert.deepEqual(c.fictional, [{ id: 'c_fic', name: 'FICTIONAL ten-dollar demo' }]);
  assert.ok(c.notes.some((n) => /1 fictional record is listed separately/.test(n)));
  assert.equal(c.reportedResults, 1); // only the 2022 report; the fictional "500" is not counted
  const a = E.audienceSummary(s);
  assert.equal(a.units.find((u) => u.unit === 'people').reachSum, 180); // 150 + 30; the fictional 9,999 left out
  assert.equal(a.fictionalLeftOut, 1);
  const people = a.units.find((u) => u.unit === 'people');
  assert.equal(people.observations, 1); assert.equal(people.estimates, 1); assert.equal(people.unchecked, 1);
});

test('no combined price range: every observation keeps its own price basis, date, tier, inclusions, fees and status', () => {
  const s = analoguePlan(), o = s.options[0];
  const by = Object.fromEntries(E.comparableSummary(s, o).observations.map((x) => [x.id, x]));
  assert.deepEqual([by.c_duo.priceSingle, by.c_duo.priceGroup, by.c_duo.groupSize, by.c_duo.groupPriceBasis], [160, 300, 2, 'advertised']);
  assert.deepEqual([by.c_derived.priceSingle, by.c_derived.priceGroup, by.c_derived.groupPriceBasis], [null, 600, 'derived']); // never an advertised foursome
  assert.equal(by.c_celebrity.priceSingle, null); // no individual offer is derived from a group package
  assert.equal(by.c_duo.feesKnown, false); assert.equal(by.c_duo.feesPerPerson, null); // unknown, not $0
  assert.equal(by.c_duo.verification, 'conflicting');
  assert.equal(by.c_duo.pricingTier, 'unknown');
  assert.match(by.c_ai.included, /dinner wording unresolved/);
  assert.equal(by.c_future.advertisedCapacity, 144); assert.equal(by.c_future.reportedParticipation, null); // a limit, not attendance
  assert.equal(by.c_2022.reportedParticipation, 90); assert.equal(by.c_2022.priceSingle, null);
  assert.deepEqual([by.c_2022.year, by.c_duo.year, by.c_future.year], ['2022', '2026', '2027']);
  for (const x of Object.values(by)) assert.ok(!('perPerson' in x) && !('perPersonEquivalent' in x)); // no group "equivalent" posing as a ticket
});

test('the notes name what differs: years, tiers, unknown fees, unchecked or conflicting, partial comparisons, derived totals', () => {
  const s = analoguePlan();
  const n = E.comparableSummary(s, s.options[0]).notes.join(' | ');
  assert.match(n, /different years \(2022, 2026, 2027\)/);
  assert.match(n, /Pricing tiers differ or are not recorded/);
  assert.match(n, /Required fees unknown for 6 of 7/);
  assert.match(n, /6 of 7 not checked against the source, or conflicting/);
  assert.match(n, /only partly comparable, not comparable, or not judged yet/);
  assert.match(n, /group totals are your own arithmetic or of unknown basis/);
  assert.match(n, /not proof of demand, and none of this is a recommended price/);
});

test('audience totals are per counting unit, never summed across units, and say they are not unique people', () => {
  const a = E.audienceSummary(example()); // an example plan: everything fictional, summarized together
  assert.deepEqual(a.units.map((u) => u.unit).sort(), ['businesses', 'households', 'people']);
  const people = a.units.find((u) => u.unit === 'people');
  assert.equal(people.reachSum, 180);
  assert.equal(people.reachUnknown, 1);
  assert.equal(people.overlaps, true);
  assert.equal(a.units.find((u) => u.unit === 'households').overlaps, false); // its overlap is with a people group: warned, not "lower"
  assert.equal(a.warnings.filter((w) => /different units/.test(w)).length, 1);
  assert.equal(a.fictionalLeftOut, 0);
});

test('unknown stays unknown; zero stays zero', () => {
  const s = example();
  const b = s.research.audiences.find((x) => x.id === 'aud_business');
  assert.equal(E.audienceSummary(s).units.find((u) => u.unit === 'businesses').respondedSum, null);
  b.responded = 0;
  assert.equal(E.audienceSummary(s).units.find((u) => u.unit === 'businesses').respondedSum, 0);
});

test('impossible funnels are flagged, never corrected', () => {
  const s = example();
  const p = s.research.audiences.find((x) => x.id === 'aud_parents');
  p.contacted = 200; p.responded = 250;
  const w = E.audienceSummary(s).warnings.join(' ');
  assert.match(w, /more contacted \(200\) than the estimated reach \(180\)/);
  assert.match(w, /more responses \(250\) than people contacted \(200\)/);
  assert.equal(p.reach, 180);
});

test('research never changes money, statuses, evidence or what-if results', () => {
  for (const withR of [example(), analoguePlan()]) {
    const without = clone(withR); delete without.research;
    const o1 = withR.options[0], o0 = without.options[0];
    for (const k of ['conservative', 'middle', 'optimistic']) {
      assert.deepEqual(E.project(o1, o1.scenarioParticipants[k], E.scenarioContext(withR, o1, k)), E.project(o0, o0.scenarioParticipants[k], E.scenarioContext(without, o0, k)));
    }
    assert.deepEqual(E.decide(withR, o1), E.decide(without, o0));
    assert.deepEqual(E.evidenceStatus(withR, o1), E.evidenceStatus(without, o0));
    assert.deepEqual(E.whatWouldChange(withR, o1, { scenario: 'conservative', participants: 48, prices: [{ price: 150 }] }), E.whatWouldChange(without, o0, { scenario: 'conservative', participants: 48, prices: [{ price: 150 }] }));
    assert.deepEqual(E.compareOptions(withR), E.compareOptions(without));
    const snap = JSON.stringify(withR);
    E.audienceSummary(withR); E.comparableSummary(withR, o1); E.researchProblems(withR);
    assert.equal(JSON.stringify(withR), snap);
    assert.deepEqual(withR.evidence, without.evidence); // reported participation never becomes paid registrations
  }
});

test('broken references are reported, one by one', () => {
  const s = example();
  assert.deepEqual(E.researchProblems(s), []);
  s.research.audiences = s.research.audiences.filter((x) => x.id !== 'aud_league' && x.id !== 'aud_alumni');
  s.research.comparables = s.research.comparables.filter((x) => x.id !== 'cmp_rotary');
  s.research.comparables[0].optionIds.push('deleted_option');
  s.research.links.push({ id: 'lnk_x', optionId: 'gone', assumption: 'price', researchIds: [], note: '' });
  const kinds = E.researchProblems(s).map((x) => `${x.kind}:${x.field}:${x.missingId}`).sort();
  assert.deepEqual(kinds, ['audience:overlapsWith:aud_alumni', 'comparable:optionIds:deleted_option', 'link:optionId:gone', 'link:researchIds:aud_league', 'link:researchIds:cmp_rotary'].sort());
});

test('older plans without research, and 08fed6b-era records, work everywhere', () => {
  for (const s of [clone(D.DEMO_STATE), clone(D.DEMO_GALA), clone(D.BLANK_STATE)]) {
    assert.equal(E.audienceSummary(s).groups, 0);
    assert.deepEqual(E.researchProblems(s), []);
    s.options.forEach((o) => assert.equal(E.comparableSummary(s, o).linked, 0));
  }
  const s = clone(D.BLANK_STATE); s.research = { audiences: 'x', comparables: [null, 3], links: {} };
  assert.equal(E.audienceSummary(s).groups, 0);
  assert.equal(E.comparableSummary(s, s.options[0]).linked, 0);
  // a record as saved by 08fed6b: no provenance or verification; listed, labeled unrecorded / not checked
  const old = clone(require('./fixtures/golf-control-fictional.json'));
  old.research = { audiences: [], links: [], comparables: [{ id: 'c', name: 'Old', optionIds: ['golf'], priceSingle: 120, feesPerPerson: 0, comparability: 'close', sourceUrl: 'https://example.org/x' }] };
  const [x] = E.comparableSummary(old, old.options[0]).observations;
  assert.deepEqual([x.provenance, x.verification], ['unrecorded', 'unchecked']);
});
