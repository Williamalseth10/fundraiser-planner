// Exercise the app's real public event listeners and route renderers with isolated browser boundaries.
// Browser smoke tests separately exercise focus, actual layout, print media, and clickable controls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../src/engine.js');
const source = (name) => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const MAIN = 'bfp-plan-v1';
const { DEMO_AUCTION } = require('./fixtures/plans.js');

function openPlanner(records = new Map(), initialHash = '#home', clock = Date) {
  const elements = new Map(), events = new Map(), windowEvents = new Map();
  let focusedPath = null;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {innerHTML: '', textContent: '', dataset: {}, querySelector: () => null});
    return elements.get(id);
  };
  const appElement = element('app');
  appElement.querySelector = (selector) => {
    const field = /^\[data-path="([^"]+)"\]$/.exec(selector);
    if (!field || !appElement.innerHTML.includes(`data-path="${field[1]}"`)) return null;
    return {focus() { focusedPath = field[1]; }, scrollIntoView() {}};
  };
  const localStorage = {getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value)};
  const nav = Object.fromEntries([...source('index.src.html').matchAll(/data-nav="([^"]+)"/g)].map(([, name]) => [name, {
    dataset: {nav: name}, classList: {toggle() {}}, setAttribute() {}, removeAttribute() {},
  }]));
  const document = {
    getElementById: element, querySelectorAll: (selector) => selector === '[data-nav]' ? Object.values(nav) : [],
    addEventListener: (type, listener) => events.set(type, listener),
  };
  let hash = initialHash, copied = '';
  const location = {get hash() { return hash; }, set hash(value) { hash = '#' + value.replace(/^#/, ''); }};
  const window = {BFEngine: E, localStorage, isSecureContext: true, addEventListener: (type, listener) => windowEvents.set(type, listener), scrollTo() {}};
  const navigator = {clipboard: {writeText: async (text) => { copied = text; }}};
  class FileReader {
    readAsText(file) { this.result = file.contents; this.onload(); }
  }
  const context = vm.createContext({window, localStorage, document, navigator, location, console, FileReader, Date: clock, setTimeout() {}});
  vm.runInContext(source('accuracy.js'), context);
  vm.runInContext(source('club-history.js'), context);
  vm.runInContext(source('board-questions.js'), context);
  vm.runInContext(source('club-recommendation.js'), context);
  vm.runInContext(source('event-ideas.js'), context);
  vm.runInContext(source('event-ideas-ui.js'), context);
  vm.runInContext(source('blank-plan.js'), context);
  vm.runInContext(source('app.js'), context);

  return {
    html: () => element('app').innerHTML, copied: () => copied, hash: () => hash, focused: () => focusedPath, element, nav,
    visit(route) {
      location.hash = route;
      windowEvents.get('hashchange')();
    },
    change(path, type, value) {
      events.get('change')({target: {dataset: {path, type}, value, checked: value === true}});
    },
    signal(id, checked = true) {
      events.get('change')({target: {dataset: {ideaSignal: id}, checked}});
    },
    openBackup(plan, action = 'import-json') {
      const oldHash = hash;
      events.get('change')({target: {dataset: {action}, files: [{contents: JSON.stringify(plan)}]}});
      if (hash !== oldHash) windowEvents.get('hashchange')();
    },
    button(action, data = {}) {
      const button = {dataset: {action, ...data}, tagName: 'BUTTON', textContent: '', closest: () => button};
      return () => {
        const oldHash = hash;
        events.get('click')({target: button});
        if (hash !== oldHash) windowEvents.get('hashchange')();
      };
    },
  };
}

test('first visits and saved deep links open the fundraiser chooser without saving or creating a practice plan', () => {
  for (const route of ['#home', '#step-event', '#step-costs', '#decision', '#results', '#research']) {
    const records = new Map(), app = openPlanner(records, route);
    assert.match(app.html(), /id="new-plan-kind"/, route);
    assert.match(app.html(), /data-action="start-blank"/, route);
    assert.match(app.html(), /data-action="choose-backup"/, route);
    assert.doesNotMatch(app.html(), /practice|example|data-demo|Continue my plan/i, route);
    for (const name of ['wizard', 'results', 'research']) assert.equal(app.nav[name].hidden, true, route);
    assert.equal(app.element('demo-banner').hidden, true, route);
    app.button('toggle-save')();
    assert.doesNotMatch(app.element('save-line').textContent, /example|practice/i, route);
    assert.equal(records.size, 0, route);
  }
  const guide = openPlanner(new Map(), '#guide');
  assert.match(guide.html(), /<h1/);
  assert.doesNotMatch(guide.html(), /data-action="(?:load-demo|start-demo)"|Try a golf example|practice with/i);
  assert.doesNotMatch(source('index.src.html'), /data-action="(?:load-demo|start-demo)"/);
});

test('ideas can start an empty auction, then add a different idea without replacing the plan', () => {
  const records = new Map(), app = openPlanner(records);
  assert.match(app.html(), /href="#ideas">Help me choose/);
  app.visit('#ideas');
  assert.match(app.html(), /<h1[^>]*>Find a fundraiser/);
  app.signal('donations');
  assert.match(app.element('event-idea-matches').innerHTML, /data-kind="auction">Start a plan/);
  app.button('choose-event-idea', {kind:'product'})();
  assert.equal(records.size, 0);
  app.signal('donations', false);
  assert.doesNotMatch(app.element('event-idea-matches').innerHTML, /data-kind="auction"/);
  app.signal('donations');
  app.button('choose-event-idea', {kind:'auction'})();
  assert.equal(app.hash(), '#step-event');
  const first = JSON.parse(records.get(MAIN));
  assert.equal(first.options[0].kind, 'auction');
  assert.equal(first.options[0].price, null);
  assert.equal(first.options[0].scenarioProceeds?.middle ?? null, null);
  assert.equal(first.options[0].scenarioParticipants.middle, null);
  app.change('eventName', 'text', 'Booster auction');
  app.change('options.0.price', 'number', 25);
  app.change('evidence.paidCashReceived.opt1', 'number', 125);
  app.visit('#home');
  assert.match(app.html(), /href="#ideas">Find another fundraiser/);
  app.visit('#ideas');
  const before = records.get(MAIN);
  app.signal('donations');
  assert.match(app.element('event-idea-matches').innerHTML, /Already in your plan/);
  app.button('choose-event-idea', {kind:'auction'})();
  app.signal('supplier');
  assert.match(app.element('event-idea-matches').innerHTML, /data-kind="product">Add to my plan/);
  assert.equal(records.get(MAIN), before);
  app.button('choose-event-idea', {kind:'product'})();
  const updated = JSON.parse(records.get(MAIN)), second = updated.options.pop();
  assert.equal(app.hash(), '#step-quote/' + second.id);
  assert.match(app.html(), /Preorder sale/);
  assert.equal(second.kind, 'product');
  assert.equal(second.price, null);
  assert.equal(second.groupSize, 1);
  assert.deepEqual(second.scenarioParticipants, {conservative:null, middle:null, optimistic:null});
  assert.deepEqual(updated, JSON.parse(before));
  assert.equal(records.has(MAIN + '-backup'), false);
});

test('direct entry into ideas preserves historical plans and uses the existing confirmed replacement path', () => {
  const records = new Map([[MAIN,JSON.stringify(DEMO_AUCTION)]]);
  const app = openPlanner(records, '#ideas');
  const original = records.get(MAIN);
  app.signal('supplier');
  const start = app.button('choose-event-idea', {kind:'product'});
  start();
  assert.equal(app.hash(), '#ideas');
  assert.equal(records.get(MAIN), original);
  start();
  assert.equal(app.hash(), '#step-event');
  assert.equal(JSON.parse(records.get(MAIN)).isDemo, false);
  assert.deepEqual(JSON.parse(records.get(MAIN + '-backup')), JSON.parse(original));
});

test('a gated link to the first step can start the real plan and returning users resume their last wizard step', () => {
  const records = new Map(), app = openPlanner(records, '#step-event');
  app.element('new-plan-kind').value = 'golf_tee_times';
  app.button('start-blank')();
  assert.match(app.html(), /id="step-title"/);
  assert.deepEqual(JSON.parse(records.get(MAIN)).options[0].scenarioParticipants, {
    conservative: null, middle: null, optimistic: null,
  });
  app.visit('#step-prices');
  assert.match(app.html(), /id="step-title"/);
  app.visit('#decision');
  assert.match(app.html(), /Likely scenario net<\/dt><dd[^>]*>Needs input/);
  const resumed = openPlanner(records);
  assert.match(resumed.html(), /href="#step-prices">Continue my plan/);
  assert.match(resumed.html(), /href="#decision">See my results/);
  assert.equal(resumed.nav.wizard.href, '#step-prices');
  assert.equal(resumed.nav.results.hidden, false);
});

test('a returning club can start an empty auction with confirmation and restore the exact original golf plan', () => {
  const fixture = require('./fixtures/golf-control-fictional.json');
  const records = new Map([[MAIN, JSON.stringify(fixture)]]);
  const home = openPlanner(records, '#step-costs');
  home.visit('#home');
  assert.match(home.html(), /href="#step-costs">Continue my plan/);
  assert.match(home.html(), /<details[^>]*>\s*<summary>Start another plan/);
  const before = records.get(MAIN);
  home.element('new-plan-kind').value = 'auction';
  const start = home.button('start-blank');
  start();
  assert.equal(home.hash(), '#home');
  assert.equal(records.get(MAIN), before);
  start();
  assert.equal(home.hash(), '#step-event');
  assert.deepEqual(JSON.parse(records.get(MAIN + '-backup')), JSON.parse(before));
  const saved = JSON.parse(records.get(MAIN));
  assert.equal(saved.isDemo, false);
  assert.equal(saved.options[0].kind, 'auction');
  const reopened = openPlanner(records, '#decision');
  assert.match(reopened.html(), /Likely scenario net<\/dt><dd[^>]*>Needs input/);
  assert.equal(reopened.element('demo-banner').hidden, true);
  const restore = reopened.button('restore-backup');
  restore();
  assert.equal(JSON.parse(records.get(MAIN)).eventName, saved.eventName);
  restore();
  assert.deepEqual(JSON.parse(records.get(MAIN)), JSON.parse(before));
  assert.deepEqual(JSON.parse(records.get(MAIN + '-backup')), saved);
});

test('opening a historical auction backup from Home lands in the plan and keeps fictional warnings on every result', () => {
  const records = new Map(), app = openPlanner(records);
  app.openBackup(DEMO_AUCTION);
  assert.equal(app.hash(), '#step-event');
  assert.equal(JSON.parse(records.get(MAIN)).isDemo, true);
  assert.equal(records.has(MAIN + '-backup'), false);
  assert.equal(app.element('demo-banner').hidden, false);
  app.visit('#home');
  assert.match(app.html(), /data-action="start-blank"/);
  assert.match(app.html(), /<details[^>]*>\s*<summary>Earlier saved plan/);
  assert.doesNotMatch(app.html(), /<h1>[^<]*Fictional|See my results/);
  app.visit('#decision');
  assert.match(app.html(), /\$1,200/);
  assert.match(app.html(), /href="#results"/);
  app.button('copy-brief')();
  assert.match(app.copied(), /FICTIONAL EXAMPLE/);
  app.visit('#results');
  assert.match(app.html(), /\$2,300/);
  app.button('copy-memo')();
  assert.match(app.copied(), /\$2,300/);
  assert.match(app.copied(), /fictional/i);
});

test('the brief’s missing-input links open the right step for the right fundraiser', () => {
  const cases = [
    ['quote', 'capacity', (o) => { o.capacity = 0; }],
    ['quote', 'venueQuote.minimumSpend', (o) => { o.venueQuote.minimumSpend = null; }],
    ['quote', 'deposit.creditedTowardBill', (o) => { o.deposit = {amount: 1000}; }],
    ['quote', 'deposit.refundable', (o) => { o.deposit = {amount: 1000, creditedTowardBill: false}; }],
    ['prices', 'price', (o) => { o.price = null; }],
    ['costs', 'fixedCosts.1.amount', (o) => { o.fixedCosts[1].amount = null; }],
    ['evidence', 'paidCashReceived', (_, p) => { delete p.evidence.paidCashReceived.auction; }],
    ['evidence', 'paidRegistrations', (_, p) => { p.evidence.paidRegistrations.auction = 0; }],
    ['scenarios', 'scenarioParticipants.middle', (o) => { o.scenarioParticipants.middle = null; }],
    ['scenarios', 'scenarioParticipants.conservative', (o) => { o.scenarioParticipants.conservative = 0; }],
    ['scenarios', 'scenarioParticipants.optimistic', (o) => { o.scenarioParticipants.optimistic = 42; }],
    ['scenarios', 'scenarioProceeds.middle', (o) => { o.scenarioProceeds.middle = null; }],
  ];
  for (const [step, field, edit] of cases) {
    const p = structuredClone(DEMO_AUCTION);
    const option = p.options[0];
    p.options.unshift({...structuredClone(option), id: 'other', name: 'Another auction'});
    edit(option, p);
    const app = openPlanner(new Map([[MAIN, JSON.stringify(p)]]), '#decision');
    const card = app.html().split('<article class="club-option">')[2].split('</article>')[0];
    const link = card.match(/<b>Next step<\/b> · <a href="([^"]+)">/);
    assert.ok(link, 'the next-step instruction should be an actionable link');
    assert.equal(link[1], '#step-' + step + '/auction/' + field);
    app.visit(link[1]);
    assert.match(app.html(), /id="step-title"/);
    if (step === 'evidence') {
      assert.equal(app.focused(), 'evidence.' + field + '.auction', 'focus the matching row in the shared table');
    } else {
      assert.match(app.html(), /aria-selected="true" data-action="tab" data-i="1"/);
      assert.equal(app.focused(), 'options.1.' + field);
    }
  }
});

test('recommendation links resolve the specific unchecked source or volunteer input on first load', () => {
  const clock = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-18T12:00:00'])); }
  };
  for (const [step, field, edit] of [
    ['quote', 'quoteVerified', (o) => { o.quoteVerified = false; }],
    ['costs', 'costsVerified', (o) => { o.costsVerified = false; }],
    ['volunteers', 'volunteerHours', (o) => { o.volunteerHours = null; }],
    ['volunteers', 'volunteerHoursAvailable', (_, p) => { p.volunteerHoursAvailable = null; }],
  ]) {
    const p = structuredClone(require('./fixtures/golf-control-fictional.json'));
    p.options[0].contract = {quoteDate: '2026-11-13', quoteExpires: '2026-12-01', quoteSource: 'Fictional quote'};
    p.criteria = {minNet: 3000, maxLoss: 10000, decideBy: '2026-11-22'};
    edit(p.options[0], p);
    const records = new Map([[MAIN, JSON.stringify(p)]]);
    const app = openPlanner(records, '#decision', clock);
    const card = app.html().split('id="club-choice"')[1].split('</section>')[0];
    const link = card.match(/<b>Next step<\/b> · <a href="([^"]+)">/);
    assert.ok(link, 'the headline should link its specific next action');
    assert.equal(link[1], `#step-${step}/golf/${field}`);
    const reopened = openPlanner(records, link[1], clock);
    assert.equal(reopened.focused(), field === 'volunteerHoursAvailable' ? field : 'options.0.' + field);
    assert.deepEqual(JSON.parse(records.get(MAIN)), p);
  }
});

test('a stale next-step link cannot open a different fundraiser for editing', () => {
  const records = new Map([[MAIN, JSON.stringify(DEMO_AUCTION)]]);
  const app = openPlanner(records, '#step-prices/removed-option');
  assert.match(app.html(), /Booster club decision brief/);
  assert.doesNotMatch(app.html(), /data-path="options\.0\.price"/);
  assert.match(app.element('status').textContent, /no longer in this plan/);
});

test('the auction brief and its copied board text distinguish a missing bid estimate from an explicit zero', () => {
  const plan = structuredClone(DEMO_AUCTION);
  const records = new Map();
  const showWithBids = (amount) => {
    plan.options[0].scenarioProceeds.middle = amount;
    records.set(MAIN, JSON.stringify(plan));
    const app = openPlanner(records, '#decision');
    app.button('copy-brief')();
    return app;
  };
  const missing = showWithBids(null);
  assert.match(missing.html(), /Likely scenario net<\/dt><dd[^>]*>Needs input/);
  assert.match(missing.copied(), /Likely scenario net: Needs input/);
  assert.match(missing.copied(), /\$300 in net bids to cover costs/);
  const zero = showWithBids(0);
  assert.match(zero.html(), /Likely scenario net<\/dt><dd[^>]*>−\$300/);
  assert.match(zero.copied(), /Likely scenario net: −\$300/);
  assert.match(zero.copied(), /Your bid estimate is \$0/);
});

test('a positive golf estimate makes the club’s two failed spending limits visible on the decision brief and in the board copy', () => {
  const plan = structuredClone(require('./fixtures/golf-control-fictional.json'));
  plan.criteria = {minNet: 8000, maxLoss: 0};
  plan.options[0].upfrontFundingConfirmed = true;
  const app = openPlanner(new Map([[MAIN, JSON.stringify(plan)]]), '#decision');
  app.button('copy-brief')();
  const copied = app.copied();
  const visible = app.html().split('<details')[0].replace(/<[^>]+>/g, ' ');
  for (const text of [visible, copied]) {
    assert.match(text, /\$8,000/, 'the club must be told its own minimum');
    assert.match(text, /\$5,020/, 'show what the likely firm case raises');
    assert.match(text, /\$0\b/, 'the club must be told it allows no loss');
    assert.match(text, /\$5,120/, 'show the cancellation exposure exceeding the limit');
    assert.match(text, /below|exceed|short of|unmet|not met|misses|doesn.t meet|over (?:the|your|its)/i, 'state the limits are missed');
  }
});

test('when auction bidding reverses which option raises more, the brief names each leader with its dollar basis', () => {
  const plan = structuredClone(require('./fixtures/golf-control-fictional.json'));
  const auction = structuredClone(DEMO_AUCTION);
  const [golf] = plan.options, [night] = auction.options;
  golf.name = 'Golf outing';
  night.name = 'Silent auction';
  night.costsVerified = true;
  night.scenarioProceeds.middle = 7000;
  night.scenarioProceeds.optimistic = 8000;
  plan.options.push(night);
  plan.sponsorships = plan.sponsorships.map((s) => ({...s, optionId: golf.id})).concat(auction.sponsorships);
  plan.evidence.paidRegistrations[night.id] = 10;
  plan.evidence.paidCashReceived[night.id] = 200;
  plan.evidence.namedHighIntent[night.id] = 40;
  plan.evidence.offerTerms[night.id] = E.offerTerms(night, plan.snapshot);
  const app = openPlanner(new Map([[MAIN, JSON.stringify(plan)]]), '#decision');
  app.button('copy-brief')();
  for (const text of [app.html().replace(/<[^>]+>/g, ' '), app.copied()]) {
    assert.match(text, /likely scenario settings[^.\n]*Silent auction[^.\n]*\$6,700/i);
    assert.match(text, /adds \$7,000 in estimated income/);
    assert.match(text, /Comparison net at likely turnout, before applying club limits[^.\n]*Golf outing[^.\n]*\$5,020/i);
  }
});

test('starting an auction creates a real plan with individual guests and empty estimates', () => {
  const records = new Map(), app = openPlanner(records);
  app.element('new-plan-kind').value = 'auction';
  app.button('start-blank')();
  const saved = JSON.parse(records.get(MAIN));
  assert.equal(saved.isDemo, false);
  assert.equal(saved.options[0].kind, 'auction');
  assert.equal(saved.options[0].groupSize, 1);
  assert.equal(saved.options[0].wholeGroupsOnly, false);
  assert.equal(saved.options[0].scenarioParticipants.middle, null);
  assert.equal(saved.options[0].scenarioProceeds?.middle ?? null, null);
  const results = openPlanner(records, '#decision');
  assert.match(results.html(), /Likely scenario net<\/dt><dd[^>]*>Needs input/);
});

test('full analysis and the copied board summary flag missing money on the affected option and accept deliberate zero', () => {
  const base = require('./fixtures/golf-control-fictional.json');
  const cases = [
    [o => { o.price = null; }, 'Enter the admission or sale price. Use 0 for free entry.'],
    [o => { o.venueQuote.minimumSpend = null; }, 'Complete the venue or supplier quote.'],
    [o => { o.fixedCosts.push({id: 'open', label: 'Open cost', amount: null}); }, 'Complete the costs for this option.'],
  ];
  function output(plan) {
    const app = openPlanner(new Map([[MAIN, JSON.stringify(plan)]]), '#results');
    app.button('copy-memo')();
    return [app.html(), app.copied()];
  }
  const blank = structuredClone(require('../src/blank-plan.js').BLANK_STATE);
  blank.options[0].kind = 'auction';
  const [blankScreen] = output(blank);
  assert.match(blankScreen, /Incomplete estimate/);
  assert.doesNotMatch(blankScreen, /sponsorship alone would cover costs/i);
  for (const [clear, next] of cases) {
    const plan = structuredClone(base);
    clear(plan.options[0]);
    const [screen, memo] = output(plan);
    const note = 'Incomplete estimate. ' + next + ' The detailed figures treat missing amounts as zero until you enter them.';
    assert.ok(screen.includes(note));
    assert.ok(memo.includes(note));
    assert.match(memo, /\*\*Status: Incomplete estimate\*\*/);
    assert.match(screen, /id="wi-title"/);
    const [firstOption, ...otherOptions] = memo.split('\n## ').slice(1);
    assert.ok(firstOption.includes(note));
    for (const section of otherOptions) assert.ok(!section.includes(note));
  }
  const zero = structuredClone(base);
  Object.assign(zero.options[0], { price: 0, fixedCosts: [{id: 'free', label: 'Donated', amount: 0}] });
  zero.options[0].venueQuote.minimumSpend = 0;
  const [screen, memo] = output(zero);
  assert.doesNotMatch(screen, /Incomplete estimate/);
  assert.doesNotMatch(memo, /Incomplete estimate/);
});

test('pre-decision capture through the Research UI survives final accounts, reopening and a separate plan import', () => {
  let now = '2026-01-15T16:00:00Z';
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  }
  const plan = structuredClone(DEMO_AUCTION);
  plan.isDemo = false; plan.eventName = 'Test spring auction';
  plan.research = {clubHistory: [{id:'prior', optionId:'other', kind:'auction', name:'Test prior auction',
    captured:false, fictional:false, eventDate:'2025-09-10', actualNet:-15.55, source:'Test ledger', finalizedOn:'2025-09-11'}]};
  const records = new Map([[MAIN, JSON.stringify(plan)]]);
  const app = openPlanner(records, '#research', Clock);
  assert.match(app.html(), /Board’s independent estimate of net proceeds/);
  const draft = 'options.0.forecastDraft.';
  app.change(draft+'eventDate','date','2026-03-01');
  app.change(draft+'preDecision','bool',true);
  app.change(draft+'boardNet','outcomeNet','0');
  app.change(draft+'priorId',undefined,'prior');
  app.button('capture-club-result',{i:'0'})();
  const captured = JSON.parse(records.get(MAIN)).research.clubHistory[1];
  assert.equal(captured.forecast.prior.net,-15.55);
  assert.equal(captured.forecast.boardNet,0);
  assert.equal(captured.estimatedOn,'2026-01-15');
  assert.match(app.html(), /Event and date locked at capture/);
  const final='research.clubHistory.1.';
  app.change(final+'actualNet','outcomeNet','9.75');
  app.change(final+'source',undefined,'Test treasurer ledger');
  app.button('confirm-club-actuals',{j:'1'})();
  assert.match(app.element('status').textContent,/elapsed event date/);
  now = '2026-03-05T16:00:00Z';
  for (const [key,v] of Object.entries({ticketSales:20,sponsorship:0,other:-0.25,costs:10})) {
    app.change(final+'actualAmounts.'+key,key==='other'?'outcomeNet':'outcomePositive',String(v));
  }
  app.button('confirm-club-actuals',{j:'1'})();
  assert.match(app.html(),/same 1 event/);
  assert.match(app.html(),/Net from all four actual amounts: \$9.75/);
  app.change(final+'actualAmounts.costs','outcomePositive','9');
  app.visit('#research');
  assert.match(app.html(),/disagree with the reported final net/);
  assert.equal(JSON.parse(records.get(MAIN)).research.clubHistory[1].finalizedOn,undefined);
  app.change(final+'actualAmounts.costs','outcomePositive','10');
  app.button('confirm-club-actuals',{j:'1'})();
  const portable=JSON.parse(records.get(MAIN));
  assert.deepEqual(portable.research.clubHistory[1].forecast,captured.forecast);
  const nextPlan={...plan,eventName:'Next event',research:{}}, fresh=new Map([[MAIN,JSON.stringify(nextPlan)]]);
  const other=openPlanner(fresh,'#research',Clock);
  other.openBackup(portable,'import-club-outcomes');
  assert.match(other.element('status').textContent,/2 completed event record/);
  const after=fresh.get(MAIN), merged=JSON.parse(after);
  assert.equal(merged.eventName,nextPlan.eventName);
  assert.deepEqual(merged.evidence,nextPlan.evidence);
  assert.ok(merged.research.clubHistory.every((r)=>r.fromPriorPlan));
  other.openBackup(portable,'import-club-outcomes');
  assert.equal(fresh.get(MAIN),after);
  assert.match(openPlanner(fresh,'#research',Clock).html(),/same 1 event/);
  const bad=structuredClone(portable);
  bad.research.clubHistory[1].forecast.amounts.costs+=1;
  other.openBackup(bad);
  assert.match(other.element('status').textContent,/Could not import/);
  assert.equal(fresh.get(MAIN),after);
});

test('the decision brief, copied brief and full board memo give the same evidence-based event choice', () => {
  const clock = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-18T12:00:00'])); }
  };
  const plan = structuredClone(require('./fixtures/golf-control-fictional.json'));
  const option = plan.options[0];
  option.name = 'Club golf offer';
  option.contract = {quoteDate: '2026-11-13', quoteExpires: '2026-12-01', quoteSource: 'Club test quote'};
  plan.criteria = {minNet: 3000, maxLoss: 10000, decideBy: '2026-11-22'};
  const app = openPlanner(new Map([[MAIN, JSON.stringify(plan)]]), '#decision', clock);
  const title = 'Take Club golf offer to the board for review';
  assert.ok(app.html().includes(title));
  app.button('copy-brief')();
  assert.ok(app.copied().includes(title));
  app.visit('#results');
  app.button('copy-memo')();
  assert.ok(app.copied().includes(title));
  assert.ok(app.copied().includes('32 paid'));
  plan.options[0].quoteVerified = false;
  const missing = openPlanner(new Map([[MAIN, JSON.stringify(plan)]]), '#decision', clock);
  assert.match(missing.html(), /Gather evidence before choosing/);
  assert.ok(!missing.html().includes(title));
});

test('import preserves older plans with omitted checkboxes and rejects mistyped financial flags before replacing a saved plan', () => {
  const records = new Map(), app = openPlanner(records);
  const s = structuredClone(require('./fixtures/golf-control-fictional.json'));
  const flags = (p) => {
    const o = p.options[0];
    return [[p,'isDemo'], [o,'quoteVerified'], [o,'costsVerified'], [o,'upfrontFundingConfirmed'],
      [o,'wholeGroupsOnly'], [o.deposit,'refundable'], [o.deposit,'creditedTowardBill'], [o.fixedCosts[0],'paidUpfront']];
  };
  for (const [object,key] of flags(s)) delete object[key];
  s.options[0].futureClubField = 'keep this';
  app.openBackup(s);
  const before = records.get(MAIN);
  assert.equal(JSON.parse(before).options[0].futureClubField, 'keep this');
  for (let i = 0; i < flags(s).length; i++) {
    const incoming = structuredClone(s), [object,key] = flags(incoming)[i];
    object[key] = 'false';
    incoming.eventName = 'Fictional replacement';
    app.openBackup(incoming);
    assert.equal(records.get(MAIN), before, key);
  }
});

test('the copied decision brief and board memo use the same reconciled auction and shotgun figures as the screen', () => {
  const auction = structuredClone(DEMO_AUCTION);
  auction.criteria = { minNet: 500 };
  auction.options[0].clubHistoryResearch = { lots: [
    { id: 'seats', name: 'Tickets <front>', donated: true, includedInLikely: true, estimatedNet: 900 },
    { id: 'gear', name: 'Gear', donated: true, includedInLikely: true, estimatedNet: 600 },
  ] };
  const golf = structuredClone(require('./fixtures/plans.js').DEMO_STATE);
  golf.options = golf.options.slice(0, 2);
  golf.options.forEach((o) => { o.quoteVerified = true; o.costsVerified = true; });
  golf.evidence.paidRegistrations = { tee: 8, shotgun: 8 };
  golf.evidence.paidCashReceived = { tee: 970.25, shotgun: 970.25 };
  for (const [plan, output] of [[auction, '$200 below the $500 board minimum'], [golf, 'At 8 paid golfers and $970.25 in ticket receipts']]) {
    plan.evidence.offerTerms = Object.fromEntries(plan.options.map((o) => [o.id, E.offerTerms(o, plan.snapshot)]));
    const records = new Map([[MAIN, JSON.stringify(plan)]]);
    const app = openPlanner(records, '#decision');
    assert.ok(app.html().includes(output));
    if (plan === auction) assert.ok(app.html().includes('Tickets &lt;front&gt;'));
    app.button('copy-brief')();
    assert.ok(app.copied().includes(output));
    app.visit('#results');
    app.button('copy-memo')();
    assert.ok(app.copied().includes(output));
    assert.deepEqual(JSON.parse(records.get(MAIN)), plan);
  }
});

test('deposit answers round-trip from an older backup and incomplete terms stay out of all board figures', () => {
  const clock = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-18T12:00:00'])); }
  };
  const s = structuredClone(require('./fixtures/golf-control-fictional.json')), o = s.options[0];
  o.deposit = {amount: 1000};
  o.contract = {quoteDate: '2026-11-13', quoteExpires: '2026-12-01', quoteSource: 'Club test quote'};
  s.criteria = {minNet: 3000, maxLoss: 10000, decideBy: '2026-11-22'};
  const records = new Map(), app = openPlanner(records, '#home', clock);
  app.openBackup(s);
  app.visit('#step-quote/golf');
  assert.equal((app.html().match(/value="" selected>Not confirmed/g) || []).length, 2);
  const path = 'options.0.deposit.';
  app.change(path + 'creditedTowardBill', 'optionalBool', 'false');
  app.visit('#decision');
  assert.equal(JSON.parse(records.get(MAIN)).options[0].deposit.creditedTowardBill, false);
  assert.match(app.html(), /Gather evidence before choosing/);
  assert.match(app.html(), /href="#step-quote\/golf\/deposit\.refundable"/);
  app.button('copy-brief')();
  assert.doesNotMatch(app.copied(), /\$4,020|\$5,020/);
  app.visit('#results');
  assert.doesNotMatch(app.html(), /\$4,020|\$5,020/);
  app.button('copy-memo')();
  assert.match(app.copied(), /deposit terms/i);
  assert.doesNotMatch(app.copied(), /\$4,020|\$5,020/);
  app.visit('#step-quote/golf');
  app.change(path + 'refundable', 'optionalBool', 'false');
  app.change('options.0.quoteVerified', 'bool', true);
  app.visit('#decision');
  assert.deepEqual(JSON.parse(records.get(MAIN)).options[0].deposit, {amount: 1000, creditedTowardBill: false, refundable: false});
  const reopened = openPlanner(records, '#decision', clock);
  assert.match(reopened.html(), /\$4,020/);
  reopened.visit('#step-quote/golf');
  reopened.change(path + 'creditedTowardBill', 'optionalBool', 'true');
  reopened.change('options.0.quoteVerified', 'bool', true);
  reopened.visit('#decision');
  assert.match(reopened.html(), /\$5,020/);
  reopened.visit('#step-quote/golf');
  reopened.change(path + 'refundable', 'optionalBool', '');
  reopened.visit('#step-quote/golf');
  assert.equal(JSON.parse(records.get(MAIN)).options[0].deposit.refundable, null);
  reopened.change(path + 'amount', 'number', 0);
  reopened.visit('#step-quote/golf');
  assert.doesNotMatch(reopened.html(), /data-type="optionalBool"/);
  assert.deepEqual(JSON.parse(records.get(MAIN)).evidence, s.evidence);
});

test('new options leave each deposit answer unknown until the club selects it', () => {
  const records = new Map(), app = openPlanner(records);
  app.button('start-blank')();
  const s = JSON.parse(records.get(MAIN));
  assert.deepEqual(s.options[0].deposit, {amount: null, creditedTowardBill: null, refundable: null});
  app.visit('#step-quote');
  app.change('options.0.deposit.amount', 'number', 100);
  app.visit('#step-quote');
  assert.equal((app.html().match(/value="" selected>Not confirmed/g) || []).length, 2);
});

test('the board ranks the same dollar amounts shown first on each card and in the copy', () => {
  const plan = structuredClone(require('./fixtures/close-golf-offers-fictional.json'));
  const render = () => {
    const app = openPlanner(new Map([[MAIN, JSON.stringify(plan)]]), '#decision');
    app.button('copy-brief')();
    const html = app.html(), text = app.copied();
    app.visit('#results');
    app.button('copy-memo')();
    return {html, text, fullMemo: app.copied()};
  };
  const {html, text, fullMemo} = render();
  for (const output of [html, text]) {
    assert.match(output, /Take Offer A to the board for review/);
    assert.match(output, /Offer A has the highest comparison net at its likely turnout, \$4,150/);
    assert.match(output, /Comparison net at likely turnout: \$4,150/);
    assert.match(output, /Comparison net at likely turnout: \$4,130/);
    assert.match(output, /the cost cushion is \$0 instead of \$50 on non-venue costs/);
    assert.doesNotMatch(output, /estimated income|hoped-for sponsorship/i);
  }
  assert.match(fullMemo, /Comparison net at likely turnout: \$4,130/);
  assert.match(fullMemo, /the cost cushion is \$0 instead of \$50/);
  assert.match(html, /<strong>Comparison net at likely turnout: \$4,130<\/strong>[\s\S]+?Likely scenario net<\/dt><dd>\$4,180<\/dd>/);
  assert.match(text, /Comparison net at likely turnout: \$4,130[\s\S]+?Likely scenario net: \$4,180/);
  plan.scenarioSettings.middle.otherRevenue = 90.25;
  const mixed = render().text;
  assert.match(mixed, /adds \$90.25 in estimated income/);
  assert.match(mixed, /the cost cushion is \$0 instead of \$50/);
  assert.match(mixed, /Comparison net at likely turnout: \$4,130[\s\S]+?Likely scenario net: \$4,270.25/);
  plan.scenarioSettings.middle.costContingencyPct = 10;
  const incomeOnly = render().text;
  assert.match(incomeOnly, /adds \$90.25 in estimated income/);
  assert.doesNotMatch(incomeOnly, /the cost cushion is/);

  plan.scenarioSettings.middle.otherRevenue = 0;
  plan.options[0].venueQuote.flatFee += 20;
  const tie = render().text;
  assert.match(tie, /Take Offer A and Offer B to the board together/);
  assert.equal(tie.split('Comparison net at likely turnout: $4,130').length - 1, 2);
  assert.doesNotMatch(tie, /estimated income|With the likely scenario settings instead|the cost cushion is/);
  plan.options[1].price = null;
  const incomplete = render().text;
  assert.match(incomplete, /Comparison net at likely turnout: Needs input/);
  assert.doesNotMatch(incomplete, /With the likely scenario settings instead/);
});
