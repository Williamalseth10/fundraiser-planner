const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../src/engine.js');
const { BLANK_STATE } = require('../src/blank-plan.js');
const { DEMO_STATE, DEMO_GALA, DEMO_AUCTION } = require('./fixtures/plans.js');

test('the published app contains the blank plan and none of the historical fixture plans', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(page.includes('root.BFPlan = api'));
  for (const fixture of [DEMO_STATE, DEMO_GALA, DEMO_AUCTION]) {
    assert.ok(!page.includes(fixture.eventName), fixture.eventName);
  }
});

test('a new plan requires entered prices and quote amounts before showing net, including deliberate zero', () => {
  const plan = structuredClone(BLANK_STATE);
  const option = plan.options[0];
  assert.equal(plan.isDemo, false);
  assert.equal(option.capacity, null);
  assert.equal(option.price, null);
  assert.equal(option.volunteerHours, null);
  assert.equal(option.cancellationOwed, null);
  const quoteKeys = ['flatFee', 'perParticipant', 'minimumParticipants', 'minimumSpend'];
  for (const key of quoteKeys) assert.equal(option.venueQuote[key], null);
  assert.equal(option.deposit.amount, null);
  assert.deepEqual(option.scenarioParticipants, { conservative: null, middle: null, optimistic: null });

  option.capacity = 40;
  option.scenarioParticipants = { conservative: 8, middle: 16, optimistic: 24 };
  function checkNeedsInput(issue) {
    const brief = E.decisionBrief(plan, option);
    for (const result of Object.values(brief.cases)) {
      assert.equal(result.issue, issue);
      assert.equal(result.net, null);
      assert.equal(result.firmNet, null);
    }
    assert.equal(brief.atPaidOnly.net, null);
    assert.equal(brief.breakEven.participants, null);
  }

  checkNeedsInput('missingPrice');
  option.price = 0;
  for (const key of quoteKeys) {
    checkNeedsInput('missingQuote');
    option.venueQuote[key] = 0;
  }
  checkNeedsInput('missingQuote');
  option.deposit.amount = 0;
  const ready = E.decisionBrief(plan, option);
  for (const result of Object.values(ready.cases)) {
    assert.equal(result.issue, null);
    assert.equal(result.net, 0);
    assert.equal(result.firmNet, 0);
  }
});
