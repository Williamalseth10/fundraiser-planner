// Dated club records use only the club's own before-event estimate and after-event accounting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../src/engine.js');
const { DEMO_GALA } = require('./fixtures/plans.js');

function example() {
  const context = vm.createContext({ window: { BFEngine: E, BFAccuracy: require('../src/accuracy.js') }, document: {getElementById: () => null}, console });
  vm.runInContext(fs.readFileSync('src/blank-plan.js', 'utf8'), context);
  let src = fs.readFileSync('src/app.js', 'utf8');
  src = src.slice(0, src.indexOf("  document.addEventListener('change', onChange);"));
  src += '\nwindow.testUI={setPlan:p=>{state=p;},createClubResult,clubOutcomeCard,researchLines,validatePlan};})();';
  vm.runInContext(src, context);
  const api = context.window.testUI, s = structuredClone(DEMO_GALA);
  api.setPlan(s);
  return { api, s, o:s.options[0] };
}

test('signed net and turnout differences require a dated original estimate and an elapsed event', () => {
  const rec={estimatedOn:'2024-04-01', eventDate:'2024-06-01', estimatedNet:0, actualNet:-19.73, estimatedCount:40, actualCount:35};
  const diff=(r)=>E.clubOutcomeDifference(r,'2024-06-02');
  assert.deepEqual(diff(rec),{issue:null,count:-5,net:-19.73});
  assert.equal(diff({...rec, actualCount:0,estimatedCount:0}).count,0);
  assert.equal(diff({...rec, actualNet:null}).net,null);
  assert.equal(diff({...rec, estimatedNet:-2,actualNet:-1.05}).net,0.95);
  for(const [edit,issue] of [[{eventDate:null},'datesMissing'],[{estimatedOn:'2024-06-02'},'estimateAfterEvent'],[{eventDate:'2024-07-01'},'futureEvent']]){
    assert.deepEqual(diff({...rec,...edit}),{issue,count:null,net:null});
  }
});

test('saving a likely case keeps its original amount, as-of date, format and unit through edits and backup', () => {
  const {api,s,o}=example();
  const original=E.project(o,o.scenarioParticipants.middle,E.scenarioContext(s,o,'middle'));
  assert.equal(api.createClubResult(o,true),true);
  const record=s.research.clubHistory[0];
  assert.equal(record.estimatedNet,original.net);
  assert.equal(record.estimatedCount,original.participants);
  assert.ok(E.isCalendarDate(record.estimatedOn));
  assert.equal(record.actualNet,null);
  assert.equal(record.kind,'auction');
  assert.ok(record.fictional);
  o.price+=1000; o.scenarioParticipants.middle=0;
  assert.equal(record.estimatedNet,original.net);
  record.actualNet=-17.23; record.actualCount=38;
  assert.equal(api.validatePlan(JSON.parse(JSON.stringify(s))).length,0);
  const card=api.clubOutcomeCard(record,0);
  assert.doesNotMatch(card,/data-path="research.clubHistory.0.estimatedNet"/);
  assert.match(card,/Actual guests/);
  assert.match(api.researchLines(o).join(' '),/Club outcome record:/);
  s.isDemo=false;
  assert.doesNotMatch(api.researchLines(o).join(' '),/Club outcome record:/);
  record.fictional=false; o.kind='product';
  assert.doesNotMatch(api.researchLines(o).join(' '),/Club outcome record:/);
  assert.match(api.clubOutcomeCard(record,0),/original format differs/);
  s.options.splice(0,1);
  assert.equal(api.validatePlan(s).length,0);
  assert.match(api.clubOutcomeCard(record,0),/original option removed/);
});

test('manual past event stays blank until filled and imported records reject invalid amounts, times and units', () => {
  const {api,s,o}=example();
  api.createClubResult(o,false);
  const r=s.research.clubHistory[0];
  assert.equal(r.estimatedCount,null); assert.equal(r.estimatedNet,null);
  assert.equal(r.actualCount,null); assert.equal(r.actualNet,null);
  assert.match(api.clubOutcomeCard(r,0),/Originally estimated net/);
  const before=E.decide(s,o);
  r.actualCount=100; r.actualNet=10000; r.name='<strong>Test</strong>';
  assert.deepEqual(E.decide(s,o),before);
  assert.match(api.clubOutcomeCard(r,0),/&lt;strong&gt;Test&lt;\/strong&gt;/);
  for(const patch of [{actualCount:1.5},{actualCount:-3},{actualNet:'42'},{actualNet:1.234},{actualNet:1e22},{eventDate:'2025-02-31'},{kind:'players'},{captured:true}]){
    const imported=JSON.parse(JSON.stringify(s));Object.assign(imported.research.clubHistory[0],patch);
    assert.ok(api.validatePlan(imported).length>0,JSON.stringify(patch));
  }
});

test('a snapshot cannot turn missing turnout, auction proceeds or ticket receipts into a measured forecast',()=>{
  const {api,s,o}=example();
  delete o.scenarioProceeds.middle;
  assert.equal(api.createClubResult(o,true),false);
  o.scenarioProceeds.middle=0;
  assert.equal(api.createClubResult(o,true),true);
  o.scenarioParticipants.middle=null;
  assert.equal(api.createClubResult(o,true),false);
  o.scenarioParticipants.middle=50;
  s.evidence.paidRegistrations[o.id]=2; s.evidence.paidCashReceived={[o.id]:null};
  assert.equal(api.createClubResult(o,true),false);
  assert.equal(s.research.clubHistory.length,1);
});
