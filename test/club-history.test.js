const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../src/club-history.js');
const E = require('../src/engine.js');
const { DEMO_AUCTION } = require('./fixtures/plans.js');

const today = '2026-11-18';
const golf = (patch = {}) => ({id:'past1', eventDate:'2024-09-23', weeks:4, paid:10, final:0,
  name:'Fall scramble', price:145, source:'Club registration export', comparable:true, ...patch});
const sale = (patch = {}) => ({id:'result1', eventDate:'2025-10-08', outcome:'sold', bid:280, fees:9.22,
  comparable:true, source:'Settlement sheet', ...patch});
const lot = (patch = {}) => ({id:'lot1', name:'Local lessons', estimatedNet:180, comps:[], ...patch});

test('golf compares checked, sourced, past checkpoints at the same stage and keeps final turnout and offers separate', () => {
  const records = [golf(), golf({id:'2',weeks:3}), golf({id:'3',eventDate:'2028-01-01'}), golf({id:'4',comparable:false}),
    golf({id:'5',source:'  '}), golf({id:'6',fictional:true}), golf({id:'7',paid:null}), golf({id:'8',paid:0, final:null})];
  const o = {id:'g1',kind:'golf_shotgun',clubHistoryResearch:{golfWeeks:4,golfAsOf:today,golf:records}};
  const s = {evidence:{paidRegistrations:{g1:12},namedHighIntent:{g1:75}}};
  const before = JSON.stringify(s);
  const report = C.golfComparison(s,o,today);
  assert.deepEqual(report.matches.map((x) => [x.record.id,x.difference,x.record.final]),[['past1',2,0],['8',12,null]]);
  assert.equal(report.paid,12); assert.equal(report.weeks,4); assert.equal(JSON.stringify(s),before);
  assert.match(C.golfComparison(s,o,'2026-11-19').issue,/Confirm the weeks/);
  o.kind='auction'; assert.deepEqual(C.golfComparison(s,o,today).matches,[]);
  o.kind='golf_tee_times'; o.clubHistoryResearch.golfWeeks=null;
  assert.match(C.golfComparison(s,o,today).issue,/Enter how many weeks/);
  o.clubHistoryResearch.golfWeeks=0; s.evidence.paidRegistrations.g1=null;
  assert.match(C.golfComparison(s,o,today).issue,/current paid golfer count/);
  s.evidence.paidRegistrations.g1=0; assert.equal(C.golfComparison(s,o,today).paid,0);
});

test('sale observations include unsold results and never supply an unknown fee or a missing winning bid', () => {
  const comps=[sale(),sale({id:'2',outcome:'unsold',bid:null,fees:12}),sale({id:'3',fees:null}),
    sale({id:'4',outcome:'unsold',bid:75}),sale({id:'5',eventDate:'2027-03-01'}),sale({id:'6',outcome:''}),
    sale({id:'7',comparable:false}),sale({id:'8',fictional:true}),sale({id:'9',bid:null}),sale({id:'10',source:''})];
  const r=lot({comps});
  assert.deepEqual(C.lotBids({},r,today).map((b)=>[b.record.id,b.gross,b.net]),
    [['result1',280,270.78],['2',0,-12],['3',280,null]]);
  assert.deepEqual(C.lotBids({}, {...r,fictional:true}, today),[]);
});

test('a sale can have many observations and still contributes its organizer estimate only once when marked included', () => {
  const s={isDemo:false};
  const o={kind:'auction',scenarioProceeds:{middle:650},clubHistoryResearch:{lots:[
    lot({donated:true,includedInLikely:true,comps:[sale(),sale({id:'2'})]}),
    lot({id:'3',estimatedNet:0,includedInLikely:true}),lot({id:'4',estimatedNet:null,includedInLikely:true}),
    lot({id:'5',estimatedNet:300,includedInLikely:false}),lot({id:'6',fictional:true,estimatedNet:9000,includedInLikely:true})
  ]}};
  const before=JSON.stringify(o), inventory=C.auctionInventory(s,o);
  assert.equal(inventory.lots.length,4); assert.equal(inventory.includedCount,3);
  assert.equal(inventory.knownIncludedCount,2); assert.equal(inventory.unknownIncludedCount,1);
  assert.equal(inventory.includedTotal,180); assert.equal(inventory.lots[0].donated,true);
  assert.equal(JSON.stringify(o),before); o.kind='ticketed'; assert.equal(C.auctionInventory(s,o).lots.length,0);
});

test('older data, blank amounts and actual zeros round-trip; malformed or duplicate records are refused', () => {
  assert.ok(C.valid(undefined)); assert.ok(C.valid({})); assert.ok(C.valid({golfWeeks:0,golfAsOf:today,golf:[golf()],lots:[lot({comps:[sale()]})]}));
  assert.ok(C.valid({lots:[lot({estimatedNet:null,comps:[sale({fees:0,bid:null})]})]}));
  for (const record of [{golfWeeks:-1},{golf:[golf({paid:1.5})]},{golf:[golf({eventDate:'2025-02-29'})]},
    {lots:[lot({estimatedNet:1e-10})]},{lots:[lot({estimatedNet:'0'})]},{lots:[lot({donated:1})]},{lots:[lot({comps:[sale({bid:-10})]})]},
    {lots:[lot({comps:[sale({fees:2.333})]})]},{golf:[golf(),golf()]},{lots:[lot({comps:[sale({id:'lot1'})]})]},
    {lots:Array(101).fill(lot())}, {golf:[golf({source:[]})]}]) assert.equal(C.valid(record), false);
});

test('the Research editor, backup validator and board text use the same option records, while calculated money stays untouched', () => {
  const context=vm.createContext({window:{BFEngine:E,BFClubHistory:C},document:{getElementById:()=>null},console});
  vm.runInContext(fs.readFileSync('src/blank-plan.js','utf8'),context);
  let src=fs.readFileSync('src/app.js','utf8').split("  document.addEventListener('change', onChange);")[0];
  src+='\nwindow.historyTest={setPlan:p=>{state=p;}, validatePlan, clubEvidenceLines,clubEvidenceEditor,editClubEvidence,researchLines};})();';
  vm.runInContext(src,context);
  const ui=context.window.historyTest, s=structuredClone(DEMO_AUCTION), o=s.options[0]; s.isDemo=false; ui.setPlan(s);
  const before=E.decide(s,o);
  const action=(recordAction)=>({dataset:{recordAction}});
  assert.ok(ui.editClubEvidence(action('add-lot'),0,0)); assert.ok(ui.editClubEvidence(action('add-comp'),0,0));
  const liveLot=o.clubHistoryResearch.lots[0];Object.assign(liveLot,{name:'<Bid>',estimatedNet:180});
  Object.assign(liveLot.comps[0],sale({name:'Older package'}));
  assert.deepEqual(Array.from(ui.validatePlan(JSON.parse(JSON.stringify(s)))),[]);
  assert.match(ui.clubEvidenceEditor(o,0),/&lt;Bid&gt;/);
  assert.match(ui.clubEvidenceEditor(o,0),/After fees: \$270.78/);
  assert.match(ui.researchLines(o).join(' '), /1 comparable past result, including 0 unsold/);
  assert.deepEqual(E.decide(s,o),before);
  liveLot.comps[0].bid='280'; assert.match(ui.validatePlan(s).join(' '),/club checkpoints or auction lots/);
});
