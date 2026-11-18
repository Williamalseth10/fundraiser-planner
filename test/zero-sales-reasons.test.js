'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { BLANK_STATE } = require('../src/blank-plan.js');
const { decide } = require('../src/engine.js');

test('zero-sales explanation distinguishes missing amounts, true zero costs and costs covered by sponsors', () => {
  const plan = structuredClone(BLANK_STATE);
  const option = plan.options[0];
  option.kind = 'auction';
  const why = () => decide(plan, option).reasons.join(' ');
  assert.doesNotMatch(why(), /sponsorship would cover|costs left to cover at zero sales/i);

  Object.assign(option, { capacity: 100, price: 0 });
  option.venueQuote = { flatFee: 0, perParticipant: 0, minimumParticipants: 0, minimumSpend: 0 };
  option.deposit.amount = 0;
  assert.match(why(), /costs left to cover at zero sales are \$0\.00/i);
  assert.doesNotMatch(why(), /sponsorship would cover/i);

  option.fixedCosts = [{id: 'food', label: 'Food', amount: 100}];
  const sponsor = {id: 's', type: 'cash', amount: 120, status: 'hoped'};
  plan.sponsorships.push(sponsor);
  assert.doesNotMatch(why(), /sponsorship would cover/i);
  sponsor.status = 'committed';
  assert.match(why(), /\$120\.00 in collected or committed cash sponsorship would cover the \$110\.00 in costs at zero sales/i); // includes the 10% cost cushion
  option.venueQuote.minimumSpend = null;
  assert.doesNotMatch(why(), /sponsorship would cover|costs left to cover at zero sales/i);
});
