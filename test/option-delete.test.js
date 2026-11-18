// Deleting an option must never make the saved plan unreadable (DECISION_LOG row 86). Runs the app's own validatePlan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../src/engine.js');
const { DEMO_STATE } = require('./fixtures/plans.js');
function app() {
  const context = vm.createContext({ window: { BFEngine: E }, console });
  vm.runInContext(fs.readFileSync('src/blank-plan.js', 'utf8'), context);
  let src = fs.readFileSync(process.env.APP_SOURCE || 'src/app.js', 'utf8');
  src = src.slice(0, src.indexOf("  document.addEventListener('change', onChange);"));
  src += '\n window.testUI={validatePlan};})();';
  vm.runInContext(src, context);
  return { ui: context.window.testUI, demo: JSON.parse(JSON.stringify(DEMO_STATE)) };
}
test('a plan whose deleted option left survey, payment and offer entries is still valid, and those entries count for nothing', () => {
  const { ui, demo } = app();
  const before = JSON.parse(JSON.stringify(demo));
  demo.options = demo.options.filter((o) => o.id !== 'alt'); // as the Remove button does
  demo.sponsorships.push({ id: 'sx', label: 'Tied to the removed option (fictional)', amount: 999, status: 'collected', type: 'cash', optionId: 'alt' });
  const problems = ui.validatePlan(demo);
  assert.equal(problems.length, 0, Array.from(problems).join(' '));
  // money for the remaining options is exactly what it was: leftover entries and the orphan sponsor count nowhere
  for (const o of demo.options) {
    const b = before.options.find((x) => x.id === o.id);
    assert.deepEqual(E.decide(demo, o).exposure, E.decide(before, b).exposure);
    assert.equal(E.decide(demo, o).paid, E.decide(before, b).paid);
  }
});
test('unsafe or non-numeric leftovers are still refused', () => {
  const { ui, demo } = app();
  demo.evidence.paidRegistrations['<b>x</b>'] = 3;
  assert.ok(ui.validatePlan(demo).length > 0);
  const d2 = app().demo; d2.evidence.namedHighIntent.alt = 'lots';
  assert.ok(d2 && app().ui.validatePlan(d2).length > 0);
  const d3 = app().demo; d3.sponsorships[0].optionId = 'bad id!';
  assert.ok(app().ui.validatePlan(d3).length > 0);
});
