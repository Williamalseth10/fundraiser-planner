const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const { DEMO_AUCTION } = require('./fixtures/plans.js');

test('auction practice: proceeds after fees change the event estimate while receipts, upfront gap and firm break-even stay separate', () => {
  const plan = JSON.parse(JSON.stringify(DEMO_AUCTION));
  const option = plan.options[0];
  assert.equal(plan.isDemo, true);
  assert.equal(option.kind, 'auction');
  assert.equal(E.researchProblems(plan).length, 0);
  // $20/ticket and $300 sponsorship, less a $750 venue, $450 other fixed and $8/guest.
  // Net bids of $300, $1,500 and $2,500 are the organizer's three separate estimates.
  for (const [key, expected] of [['conservative', -180], ['middle', 1200], ['optimistic', 2440]]) {
    const result = E.project(option, option.scenarioParticipants[key], E.scenarioContext(plan, option, key));
    assert.equal(result.net, expected);
  }
  // At 50 guests: $1,000 tickets + $300 sponsor - $1,600 costs = -$300 before bids.
  assert.equal(E.project(option, 50, E.firmContext(plan, option)).net, -300);
  const decision = E.decide(plan, option);
  assert.equal(decision.breakEven.participants, 75);
  assert.equal(decision.exposure.cashInHand, 500);
  assert.equal(decision.exposure.shortBeforeEvent, 100);
  // Entering a bigger bid estimate cannot pay the deposit or advance the firm break-even.
  option.scenarioProceeds.middle = 10000;
  const updated = E.decide(plan, option);
  assert.deepEqual(updated.breakEven, decision.breakEven);
  assert.deepEqual(updated.exposure, decision.exposure);
});
