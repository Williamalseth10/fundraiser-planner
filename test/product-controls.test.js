const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../src/engine.js');
function appFixture() {
  const context = vm.createContext({window:{BFEngine:E}, console});
  vm.runInContext(fs.readFileSync('src/demo-data.js','utf8'),context);
  let src=fs.readFileSync(process.env.APP_SOURCE || 'src/app.js','utf8');
  src=src.slice(0,src.indexOf("  document.addEventListener('change', onChange);"));
  src += '\n window.testUI={setPlan:p=>{state=p;},quote:stepQuote,prices:stepPrices,individual:typeof useIndividualItems === "function" ? useIndividualItems : undefined};})();';
  vm.runInContext(src,context);
  const plan=JSON.parse(JSON.stringify(context.window.BFDemo.BLANK_STATE));
  plan.options[0].kind='product';
  context.window.testUI.setPlan(plan);
  return {ui:context.window.testUI,plan};
}
test('product controls expose inherited grouping so a seller can count individual items',()=>{
 const {ui,plan}=appFixture();
 assert.match(ui.quote(),/Check inherited group settings/);
 assert.match(ui.quote(),/data-action="individual-items"/);
 ui.individual(plan.options[0]);
 assert.doesNotMatch(ui.quote(),/Check inherited group settings/);
 assert.equal(plan.options[0].wholeGroupsOnly,false);
 assert.equal(plan.options[0].quoteVerified,false);
 const o=plan.options[0]; o.price=10; o.venueQuote.perParticipant=15; o.capacity=100;
 assert.equal(E.normalizeParticipants(o,50).participants,50);
});

test('individual-item correction preserves costs and invalidates previous group offer evidence',()=>{
 const {ui,plan}=appFixture(), o=plan.options[0];
 o.price=10; o.capacity=100; o.venueQuote.perParticipant=15;
 o.quoteVerified=true; o.groupPrice=30; o.groupShare=0.5;
 plan.evidence.namedHighIntent={opt1:1}; plan.evidence.surveyResponses=1;
 plan.evidence.offerTerms={opt1:E.offerTerms(o,plan.snapshot)};
 const quote=JSON.stringify(o.venueQuote);
 ui.individual(o);
 assert.equal(JSON.stringify(o.venueQuote),quote);
 assert.equal(o.price,10); assert.equal(o.groupPrice,null); assert.equal(o.groupShare,0);
 assert.equal(E.evidenceStatus(plan,o).state,'stale');
 assert.equal(o.quoteVerified,false);
});
