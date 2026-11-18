const {test} = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const A = require('../src/accuracy.js');
const {DEMO_AUCTION} = require('./fixtures/plans.js');

const today = '2025-07-01';
function baseline() {
  return {id:'last', kind:'auction', name:'Previous spring auction', optionId:'old',
    actualNet:-40.01, eventDate:'2024-04-01', finalizedOn:'2024-04-10', source:'Final ledger', fictional:false, captured:false};
}
function plan() {
  const p = structuredClone(DEMO_AUCTION);
  p.isDemo = false; p.eventName = 'Spring auction';
  p.research = {clubHistory:[baseline()]};
  return p;
}
function freeze(p, drafts = {}) {
  const option = p.options[0], likely = E.decisionBrief(p,option).cases.middle;
  const s = A.snapshot(p,option,likely,{eventDate:'2025-06-10',preDecision:true,boardNet:0,priorId:'last',...drafts},'2025-04-01');
  assert.ok(s.forecast, s.issue);
  return {id:'spring',kind:option.kind, optionId:option.id, captured:true, fictional:false, estimatedOn:'2025-04-01',
    estimatedNet:likely.net, name:s.forecast.eventName, eventDate:s.forecast.eventDate, forecast:s.forecast,
    source:'Final ledger',finalizedOn:'2025-06-12',actualNet:60};
}

test('auction snapshot freezes an additive model breakdown, a club estimate and a prior comparable known at decision time', () => {
  const p = plan(), o = p.options[0], r = freeze(p);
  const projection = E.project(o, o.scenarioParticipants.middle, E.scenarioContext(p,o,'middle'));
  assert.equal(r.forecast.amounts.ticketSales,projection.revenue.registration);
  assert.equal(r.forecast.amounts.sponsorship,projection.revenue.sponsorshipCash);
  assert.equal(r.forecast.amounts.other,projection.revenue.extras + projection.revenue.other);
  assert.ok(r.forecast.amounts.other >= o.scenarioProceeds.middle);
  assert.equal(r.forecast.amounts.costs,projection.expenses.total);
  assert.equal(A.combined(r.forecast.amounts),r.estimatedNet);
  assert.equal(r.forecast.boardNet,0);
  assert.equal(r.forecast.prior.net,-40.01);
  o.price = 0; o.scenarioProceeds.middle = 0; p.research.clubHistory[0].actualNet = 999999;
  assert.equal(r.forecast.prior.net,-40.01);
  assert.equal(A.combined(r.forecast.amounts), projection.net);
  assert.ok(A.validRecord(JSON.parse(JSON.stringify(r))));
});

test('forecast inputs refuse a same-day or missing pre-decision date, unmeasured projections and unavailable prior events', () => {
  const p = plan(), o = p.options[0], likely = E.decisionBrief(p,o).cases.middle;
  const s = (d, l = likely) => A.snapshot(p,o,l,d,'2025-04-01');
  for (const date of [null,'2025-04-01','2025-03-31']) assert.equal(s({eventDate:date,preDecision:true}).issue,'date');
  assert.equal(s({boardNet:'0'}).issue,'draft');
  assert.equal(s({}, {...likely,issue:'missingBid'}).issue,'amounts');
  assert.equal(s({}).forecast.boardNet,null);
  assert.equal(s({}).forecast.preDecision,false);
  for (const changes of [{fictional:true},{kind:'product'},{actualNet:null},{source:''},{name:''},
    {finalizedOn:null},{finalizedOn:'2025-04-02'},{eventDate:'2025-04-01',finalizedOn:'2025-04-01'}]) {
    p.research.clubHistory = [{...baseline(),...changes}];
    assert.equal(s({priorId:'last'}).issue,'prior');
  }
  p.research.clubHistory=[baseline(),{...baseline(),id:'second'}];
  assert.equal(s({priorId:'last'}).issue,'prior');
});

test('actual variance preserves blanks, zeros, losses and an expense overrun; conflicting ledger net stays unresolved', () => {
  const r = freeze(plan());
  const parts=r.forecast.amounts;
  r.actualNet=null;
  r.actualAmounts={ticketSales:parts.ticketSales + 30.25, sponsorship:0, other:null, costs:parts.costs + 10.15};
  assert.equal(A.actual(r).net,null);
  assert.deepEqual(A.differences(r),{ticketSales:30.25,sponsorship:-parts.sponsorship,other:null,costs:10.15});
  r.actualAmounts.other=-100;
  const computed = A.combined(r.actualAmounts);
  assert.ok(Number.isFinite(computed));
  assert.equal(A.actual(r).net,computed);
  r.actualNet=computed+1;
  assert.deepEqual(A.actual(r),{net:null,fromParts:computed,conflict:true});
  assert.equal(A.score([r],today,false).planner.count,0);
  assert.equal(A.combined({ticketSales:null,sponsorship:0,other:0,costs:0}),null);
  assert.equal(A.combined({ticketSales:0,sponsorship:0,other:0,costs:0}),0);
});

test('mean dollar error, overestimates and matched methods use the same pre-event estimates and confirmed events', () => {
  const p = plan(), a=freeze(p), b=freeze(p), c=freeze(p,{boardNet:null,priorId:null});
  a.actualNet = a.estimatedNet-7.14;
  b.id='summer'; b.name=b.forecast.eventName='Summer auction'; b.actualNet=b.estimatedNet+2.14;
  c.id='spring2'; c.name=c.forecast.eventName='Winter auction'; c.actualNet=c.estimatedNet;
  const scores=A.score([a,b,c],today,false);
  assert.deepEqual(scores.planner,{count:3,meanAbsoluteMiss:3.09,overestimates:1});
  assert.equal(scores.matched,2);
  assert.deepEqual(scores.methods.planner,{count:2,meanAbsoluteMiss:4.64,overestimates:1});
  for (const [k,net] of [['prior',-40.01],['board',0]]) {
    assert.equal(scores.methods[k].count,2);
    assert.equal(scores.methods[k].meanAbsoluteMiss,Math.round((Math.abs(net-a.actualNet)+Math.abs(net-b.actualNet))*50)/100);
    assert.equal(scores.methods[k].overestimates,0);
  }
});

test('retrospectives, fictional plans, same-day captures, duplicate occurrences and incomplete records cannot improve the score', () => {
  const r=freeze(plan());
  for (const mutate of [
    (x)=>{x.forecast=null;},(x)=>{x.captured=false;},(x)=>{x.forecast.preDecision=false;},
    (x)=>{x.fictional=true;},(x)=>{x.estimatedOn=x.eventDate;},(x)=>{x.actualNet=null;},
    (x)=>{x.forecast.eventDate='2025-06-15';},(x)=>{x.finalizedOn=null;},(x)=>{x.source=' ';},
    (x)=>{x.finalizedOn='2025-08-01';},(x)=>{x.forecast.prior.finalizedOn='2025-05-01';}
  ]) {
    const x=structuredClone(r);mutate(x);
    assert.equal(A.score([x],today,false).planner.count,0);
  }
  const second={...r,id:'other-option',optionId:'other'};
  assert.equal(A.score([r,second],today,false).duplicate,2);
  assert.equal(A.score([r,second],today,false).planner.count,0);
  assert.equal(A.score([r],today,true).planner.count,0);
  assert.equal(A.score([r],today,false).planner.count,1);
  assert.equal(A.score([],today,false).planner.meanAbsoluteMiss,null);
});

test('optional records preserve legacy plans and import validation rejects malformed or inconsistent financial snapshots', () => {
  assert.equal(A.validRecord({captured:true,estimatedOn:'2025-01-01',estimatedNet:0}),true);
  const r=freeze(plan());
  for (const mutate of [
    (x)=>{x.forecast.amounts.ticketSales+=0.01;},(x)=>{x.forecast.amounts.costs=-1;},
    (x)=>{x.actualAmounts={ticketSales:'0'};},(x)=>{x.actualAmounts={sponsorship:-1};},
    (x)=>{x.forecast.boardNet='0';},(x)=>{x.forecast.eventName='Backfilled event';},
    (x)=>{x.forecast.prior.finalizedOn='2024-02-01';},(x)=>{x.forecast.prior.id=x.id;},
    (x)=>{x.forecast.prior.kind='product';},(x)=>{x.estimatedOn='2025-06-10';},
  ]) {
    const x=structuredClone(r); mutate(x); assert.equal(A.validRecord(x),false);
  }
});

test('carrying completed records between plans skips duplicates, unfinished and fictional results, and carries only outcomes', () => {
  const source=plan(), result=freeze(source), target=plan();
  source.research.clubHistory.push(result, {...result,id:'incomplete',name:'Future',finalizedOn:null});
  const moved=A.carryForward(source,target,today);
  assert.equal(moved.length,1); assert.equal(moved[0].id,result.id); assert.equal(moved[0].fromPriorPlan,true);
  assert.deepEqual(target.research.clubHistory,[baseline()]);
  target.research.clubHistory.push(...moved);
  assert.deepEqual(A.carryForward(source,target,today),[]);
  assert.deepEqual(A.carryForward({...source,isDemo:true},plan(),today),[]);
  assert.deepEqual(A.carryForward(source,{...plan(),isDemo:true},today),[]);
  assert.deepEqual(A.carryForward(source,{research:{clubHistory:[baseline()],audiences:[{id:result.id}]}},today),[]);
});

test('keeping an unchosen proposal preserves the one completed event in scoring, comparables and transfers', () => {
  const held = freeze(plan());
  held.actualNet = held.estimatedNet - 30;
  const alternative = {
    ...structuredClone(held), id: 'tee', optionId: 'tee', kind: 'golf_tee_times',
    actualNet: null, finalizedOn: null, source: '',
  };
  alternative.forecast.prior = null;
  const history = [alternative, held];
  const source = {research: {clubHistory: history}};
  const target = {research: {clubHistory: [alternative]}};
  const original = structuredClone({source, target});
  assert.ok(A.validRecord(alternative));
  assert.deepEqual(A.score(history, today, false).planner, {count: 1, meanAbsoluteMiss: 30, overestimates: 1});
  assert.equal(A.score(history, today, false).duplicate, 0);
  assert.deepEqual(A.priorOptions(history, held.kind, today).map((r) => r.id), [held.id]);
  const additions = A.carryForward(source, target, today);
  assert.deepEqual(additions.map((r) => r.id), [held.id]);
  assert.deepEqual({source, target}, original);
  target.research.clubHistory.push(...additions);
  assert.deepEqual(A.carryForward(source, target, today), []);
  assert.equal(A.score(target.research.clubHistory, today, false).planner.count, 1);
  const sameIdDraft = {...alternative, id: held.id};
  assert.deepEqual(A.carryForward(source, {research: {clubHistory: [sameIdDraft]}}, today), []);
});

test('two completed accounts for one occurrence remain unresolved across scoring, baselines and import', () => {
  const held = freeze(plan());
  const other = {...structuredClone(held), id: 'second', optionId: 'second', actualNet: 0};
  const source = {research: {clubHistory: [held, other]}};
  assert.equal(A.score(source.research.clubHistory, today, false).planner.count, 0);
  assert.equal(A.score(source.research.clubHistory, today, false).duplicate, 2);
  assert.deepEqual(A.priorOptions(source.research.clubHistory, held.kind, today), []);
  assert.deepEqual(A.carryForward(source, {}, today), []);
  assert.deepEqual(A.carryForward({research: {clubHistory: [held]}}, {research: {clubHistory: [other]}}, today), []);
});
