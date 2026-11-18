'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { signals, suggestIdeas } = require('../src/event-ideas.js');
const ui = require('../src/event-ideas-ui.js');

test('resource-free or budget-only selections leave the shortlist empty', () => {
  for (const input of [undefined, [], ['limitCash'], ['unknown'], 'venue']) {
    assert.deepEqual(suggestIdeas(input), []);
  }
  assert.match(ui.renderMatches({ selected: ['limitCash'] }), /supplier willing to fill preorders/);
  assert.doesNotMatch(ui.render(), /data-action="choose-event-idea"/);
});

test('each resource maps to a supported event kind and gives a concrete next check', () => {
  const cases = [
    ['donations', 'auction', /offered items/, /bidders/],
    ['bidders', 'auction', /interested bidders/, /items pledged/],
    ['golfers', 'golf_tee_times', /interested golfers/, /written|quotes/],
    ['course', 'golf_tee_times', /written course quote/, /register/],
    ['venue', 'ticketed', /possible place/, /food minimum/],
    ['supplier', 'product', /fill preorders/, /minimum order/],
    ['walkLead', 'participation', /volunteer/, /route permission/]
  ];
  for (const [resource, kind, reason, next] of cases) {
    const [idea] = suggestIdeas([resource]);
    assert.equal(idea.kind, kind);
    assert.match(idea.reasons.join(' '), reason);
    assert.match(idea.next, next);
    assert.equal(idea.cashCheck, '');
    const cautious = suggestIdeas([resource, 'limitCash']);
    assert.equal(cautious[0].kind, kind);
    assert.ok(cautious[0].cashCheck);
  }
});

test('a room alone does not imply auction items or interested bidders', () => {
  assert.deepEqual(suggestIdeas(['venue']).map((m) => m.kind), ['ticketed']);
  const ideas = suggestIdeas(['bidders', 'donations', 'venue']);
  assert.deepEqual(ideas.map((m) => m.kind), ['auction', 'ticketed']);
  assert.equal(ideas[0].reasons.length, 3);
  assert.match(ideas[0].next, /unsold lots/);
});

test('ties, duplicate inputs and the three-idea limit are deterministic', () => {
  const all = signals.map((s) => s.id);
  const matches = suggestIdeas(all);
  assert.equal(matches.length, 3);
  assert.deepEqual(matches, suggestIdeas(new Set([...all].reverse())));
  assert.deepEqual(matches, suggestIdeas([...all, ...all, 'unknown']));
  assert.deepEqual(matches.map((m) => m.kind), ['auction', 'golf_tee_times', 'product']);
  assert.equal(Object.hasOwn(matches[0], 'profit'), false);
});

test('the finder renders accessible, optional choices with a distinct explicit start or add action', () => {
  const settings = { selected: new Set(['donations']), existingKinds: ['ticketed'] };
  const first = ui.render(settings);
  assert.match(first, /data-idea-signal="donations" checked/);
  assert.doesNotMatch(first, /data-idea-signal="venue" checked/);
  assert.match(first, /<legend>/);
  assert.match(first, /id="event-idea-matches" aria-live="polite"/);
  assert.match(first, /data-action="choose-event-idea" data-kind="auction">Start a plan/);
  assert.match(ui.renderMatches({ ...settings, hasPlan: true }), /data-kind="auction">Add to my plan/);
  const present = ui.renderMatches({ ...settings, hasPlan: true, existingKinds: ['auction'] });
  assert.match(present, /Already in your plan/);
  assert.doesNotMatch(present, /data-action="choose-event-idea"/);
  assert.doesNotMatch(first + present, /\$|data-bind|data-path/);
  const untrusted = ui.render({ selected: ['donations', '<b>custom</b>'], existingKinds: ['<b>custom</b>'] });
  assert.doesNotMatch(untrusted, /custom/);
});
