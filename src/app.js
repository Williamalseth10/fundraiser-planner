/* Booster Fundraiser Planner — UI. All math lives in engine.js; this file only renders and edits state. */
(function () {
  'use strict';
  const E = window.BFEngine;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const SAVE_KEY = 'bfp-plan-v1';
  let state = clone(window.BFDemo.DEMO_STATE);
  let touched = false; // only save once the person has actually started a plan
  try { const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (saved && Array.isArray(saved.options) && saved.scenarioSettings) { state = saved; touched = true; } } catch (e) { /* storage unavailable: start from demo */ }
  function migrate(st) {
    (st.options || []).forEach((o) => {
      if (o.groupPrice === undefined && o.foursomePrice !== undefined) { o.groupPrice = o.foursomePrice; delete o.foursomePrice; }
      if (o.groupShare === undefined && o.foursomeShare !== undefined) { o.groupShare = o.foursomeShare; delete o.foursomeShare; }
    });
    return st;
  }
  state = migrate(state);
  function persist() { if (!touched) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  function hasSavedPlan() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function say(msg) { const el = document.getElementById('status'); if (el) { el.textContent = msg; el.hidden = !msg; } }
  // In-page two-click confirmation (browser confirm() dialogs are unavailable in some viewers).
  function armed(btn, label) {
    if (btn.dataset.armed === '1') { btn.dataset.armed = ''; return true; }
    const orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label || 'Click again to confirm';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = orig; }, 3500);
    return false;
  }
  let openOption = 0;

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (x) => {
    const n = Number(x) || 0;
    const s = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(n) % 1 ? 2 : 0 });
    return n < 0 ? '−' + s : s;
  };
  const SC = ['conservative', 'middle', 'optimistic'];
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
  }
  const num = (path, label, opts = {}) => {
    const v = getPath(state, path);
    return `<label class="f${opts.wide ? ' wide' : ''}"><span>${label}</span><input type="number" inputmode="decimal" step="${opts.step || 'any'}" min="0" data-path="${path}" data-type="number" value="${v == null ? '' : esc(v)}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}></label>`;
  };
  const pct = (path, label) => {
    const v = getPath(state, path);
    return `<label class="f"><span>${label}</span><input type="number" inputmode="decimal" step="any" min="0" max="100" data-path="${path}" data-type="pct" value="${v == null ? '' : esc(Math.round(v * 1000) / 10)}"></label>`;
  };
  const txt = (path, label, cls = '') => `<label class="f ${cls}"><span>${label}</span><input type="text" data-path="${path}" value="${esc(getPath(state, path))}"></label>`;
  const chk = (path, label) => `<label class="chk"><input type="checkbox" data-path="${path}" data-type="bool" ${getPath(state, path) ? 'checked' : ''}> ${label}</label>`;
  const selGrouped = (path, label, options) => {
    const v = getPath(state, path) || '';
    const groups = [...new Set(options.map((o) => o[2]))];
    return `<label class="f"><span>${label}</span><select data-path="${path}">${groups.map((g) => `<optgroup label="${esc(g)}">${options.filter((o) => o[2] === g).map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  };
  const sel = (path, label, options) => {
    const v = getPath(state, path) || '';
    return `<label class="f"><span>${label}</span><select data-path="${path}">${options.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  };

  // ---------- inputs ----------
  function costRows(i, key, withUpfront) {
    const rows = state.options[i][key];
    const product = T(state.options[i]).survey === 'buy';
    const upfront = product ? 'Paid before order money comes in?' : 'Paid before event day?';
    const kind = withUpfront ? 'One-time cost' : `Per-${T(state.options[i]).one} cost`;
    const nm = (r, j) => esc(r.label || `${kind} ${j + 1}`);
    return `<div class="table-wrap"><table class="edit"><thead><tr><th>Cost item</th><th>Amount ($)</th>${withUpfront ? `<th>${upfront}</th>` : ''}<th><span class="sr-only">Remove</span></th></tr></thead><tbody>
      ${rows.map((r, j) => `<tr>
        <td><input type="text" data-path="options.${i}.${key}.${j}.label" value="${esc(r.label)}" aria-label="${kind} ${j + 1} name"></td>
        <td><input type="number" inputmode="decimal" step="any" min="0" data-path="options.${i}.${key}.${j}.amount" data-type="number" value="${esc(r.amount)}" aria-label="${nm(r, j)} amount in dollars"></td>
        ${withUpfront ? `<td class="c"><input type="checkbox" data-path="options.${i}.${key}.${j}.paidUpfront" data-type="bool" ${r.paidUpfront ? 'checked' : ''} aria-label="${nm(r, j)}: ${upfront.toLowerCase().replace('?', '')}"></td>` : ''}
        <td><button class="link" data-action="del-row" data-i="${i}" data-key="${key}" data-j="${j}" aria-label="Remove ${nm(r, j)}">✕</button></td></tr>`).join('')}
      </tbody></table></div><button class="small" data-action="add-row" data-i="${i}" data-key="${key}">+ Add line</button>`;
  }

  // ---------- event types ----------
  // Each type only changes words, survey questions and checklists. The math is the same for all of them,
  // and no type carries default prices, costs or attendance numbers.
  const Q_COMMON = [
    'Deposit: how much, when is it due, does it count toward the final bill, and is it refundable (until what date)?',
    'Cancellation: what do we owe if we cancel, and by what date must we decide?',
    'Is sales tax included in the price or added on top? Is there a service charge or gratuity?',
    'Do you require event insurance or a certificate of insurance from us?',
  ];
  const Q_GOLF = [
    'What does the per-player rate include (cart, range balls, food)?',
    'Is there a minimum number of paid players or a minimum total spend? Is it binding if we fall short?',
    'For a shotgun start: what is the minimum, the buyout fee, and how many players fit?',
    'For regular tee times: how many tee times can we hold, and when must unfilled ones be released?',
    'Are food and drink minimums separate from golf fees?',
    'Rain or weather: who decides the course is unplayable, and is there a rain date or a credit instead of a refund?',
    'Can we bring our own prizes, sponsor signs and raffle? Any fees or restrictions?',
  ];
  const Q_VENUE = [
    'What does the per-guest price include (food, drinks, staff, setup, cleanup)?',
    'Is there a minimum guest count or a food-and-drink minimum? Is it binding if we fall short?',
    'When is the final headcount due, and can it go down after that? Do complimentary or sponsor guests count toward the food minimum even though they paid no ticket?',
    'Are tables, chairs, linens, AV and decorations included or extra? If we bring our own AV or entertainment, does the venue require its own vendor or add a fee? What do we owe if we run past the contracted end time?',
    'Can we bring outside food, drinks, decorations or entertainment? Is alcohol allowed, and who must serve it?',
  ];
  const Q_PARTICIPATION = [
    'What permits are needed (city, park, police, road closures), and what do they cost?',
    'Which bills are separate (park or venue, timing, shirts, medals)? Which have a minimum, and which orders can\'t be cut or returned after a certain date?',
    'When must shirt sizes and quantities be ordered, and are unused ones refundable?',
    'Weather: who decides to cancel, and is there a rain date? If we cancel, what do we still owe, and will we refund people who already paid?',
  ];
  const Q_SUPPLIER = [
    'What do we pay the supplier per item, including tax and shipping? That is our cost, not the retail price. Does it drop at higher quantities, and is profit on online sales figured differently from order-form sales?',
    'Is there a minimum order? Do we order before or after we collect sellers\' orders?',
    'Do orders ship to each buyer, or does the group receive them and hand them out? Can unsold items be returned, and who pays for the ones that don\'t sell?',
    'If the company offers a profit calculator or an "average items per seller", don\'t plan on it. Use counts from your own supporters.',
    'When do we have to pay the supplier, and when does the product arrive?',
    'Who collects the money from sellers, and how are missing payments handled?',
  ];
  const Q_AUCTION = [
    'Raffles: has the club confirmed it is allowed to run a raffle of this size under state rules?',
    'Auction items and any paddle raise: by what date are gifts promised in writing, and who keeps that list? A hoped-for bid is not firm money.',
    'Does an auctioneer or the bidding software charge a flat fee, a percentage of winning bids, or both?',
    'How will winners pay (card fees, checks), and what happens to unsold items?',
    'Is there a minimum guest count or food-and-drink minimum at the venue?',
  ];
  const golfType = (label) => ({ label, group: 'Participation events', one: 'player', many: 'players', venue: 'course', groupName: 'foursome', survey: 'golf', perHint: 'carts, lunch, player gifts not in the course quote', fixedHint: 'prizes, hole signs, printing, insurance', questions: Q_GOLF });
  const EVENT_TYPES = {
    golf_tee_times: golfType('Golf: regular tee times'),
    golf_shotgun: golfType('Golf: shotgun start'),
    participation: { label: 'Run, walk, tournament or other sign-up event', group: 'Participation events', one: 'participant', many: 'participants', venue: 'venue', groupName: 'team', survey: 'join', perHint: 'shirts, bibs, medals, timing per person', fixedHint: 'permits, course setup, awards, insurance', questions: Q_PARTICIPATION },
    ticketed: { label: 'Dinner, gala, trivia night or other ticketed event', group: 'Ticketed events', one: 'guest', many: 'guests', venue: 'venue', groupName: 'table', survey: 'attend', perHint: 'food and drinks per guest, favors', fixedHint: 'venue rental, decorations, entertainment, AV, insurance', questions: Q_VENUE },
    auction: { label: 'Auction or raffle night', group: 'Auctions & raffles', one: 'guest', many: 'guests', venue: 'venue', groupName: 'table', survey: 'attend', proceeds: true, perHint: 'food and drinks per guest', fixedHint: 'venue rental, bid sheets or auction software, raffle prizes you buy, decorations', questions: Q_AUCTION.concat(Q_VENUE) },
    product: { label: 'Product sale (cookie dough, wreaths, discount cards, spirit gear)', group: 'Product sales', one: 'item', many: 'items', venue: 'supplier', groupName: null, survey: 'buy', perHint: 'packaging or shipping per item not in the supplier price', fixedHint: 'order forms, delivery, storage, seller prizes', questions: Q_SUPPLIER },
    generic: { label: 'Other kind of event', group: 'Other', one: 'person', many: 'people', venue: 'venue', groupName: 'group', survey: 'attend', perHint: 'anything you pay per person', fixedHint: 'rental, supplies, printing, insurance', questions: Q_VENUE },
  };
  const T = (o) => EVENT_TYPES[(o && o.kind)] || EVENT_TYPES.generic;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const isGolf = (o) => T(o).survey === 'golf';
  const KIND_OPTIONS = Object.entries(EVENT_TYPES).map(([k, t]) => [k, t.label, t.group]);
  const questionsFor = (o) => Q_COMMON.concat(T(o).questions);

  const SIGNING_QUESTIONS = [
    'Who is allowed to sign the contract and hold the money: the club itself, or the school or district (often through the athletic director)?',
    'Does the school or district need to approve this fundraiser, and does it require insurance naming the district?',
    'If your plan counts on raffle income: has the club confirmed it is allowed to run a raffle of that size under state rules?',
    'For product sales: who keeps unsold items, and who is responsible for money sellers don\'t turn in?',
    'Is every number in this plan from a written quote or a real record, not a guess?',
  ];

  function anchors(o) {
    const ev = state.evidence;
    const paid = (ev.paidRegistrations || {})[o.id] || 0;
    const named = (ev.namedHighIntent || {})[o.id] || 0;
    const def = (ev.surveyDefinitelyAtPrice || {})[o.id] || 0;
    const prob = (ev.surveyProbablyAtPrice || {})[o.id] || 0;
    return `<p class="anchors"><b>Your evidence so far</b> (running totals, not forecasts):
      paid <b>${paid}</b> · plus named “yes” <b>${paid + named}</b> · plus anonymous “yes” <b>${paid + named + def}</b> · plus “maybe” <b>${paid + named + def + prob}</b> · capacity <b>${E.maxFeasible(o)}</b></p>`;
  }

  // ---------- per-option step bodies (wizard) ----------
  function optionTabs(note) {
    if (state.options.length < 2) return '';
    return `<div class="tabs" role="tablist" aria-label="Options">${state.options.map((o, i) => `<button class="tab ${i === openOption ? 'on' : ''}" role="tab" aria-selected="${i === openOption}" data-action="tab" data-i="${i}">${esc(o.name || 'Option ' + (i + 1))}</button>`).join('')}</div>${note ? `<p class="hint">${note}</p>` : ''}`;
  }
  const cur = () => { if (!state.options[openOption]) openOption = 0; return openOption; };

  function stepEvent() {
    return `<div class="fields">
      ${txt('eventName', 'What do you call this plan?', 'wide')}
      ${num('settings.fundraisingTarget', 'How much do you hope to raise, after costs? ($)')}
    </div>`;
  }

  function stepOptions() {
    return `<div class="optlist">${state.options.map((o, i) => `<div class="optrow">
        ${txt(`options.${i}.name`, `Option ${i + 1} name`, 'wide')}
        ${selGrouped(`options.${i}.kind`, 'Kind of fundraiser', KIND_OPTIONS)}
        <div class="optrow-actions"><button class="small" data-action="dup-option" data-i="${i}">Duplicate</button>
        ${state.options.length > 1 ? `<button class="small danger" data-action="del-option" data-i="${i}">Remove</button>` : ''}</div>
      </div>`).join('')}</div>
      <button class="small" data-action="add-option">+ Add another option</button>`;
  }

  function stepQuote() {
    const i = cur(), p = `options.${i}`, o = state.options[i], t = T(o);
    const product = t.survey === 'buy';
    return `${optionTabs('Fill this in for each option.')}
      ${product ? '<p class="hint">If sellers collect orders and money <b>before</b> you order from the supplier, the items you must pay for is usually 0 (unless the supplier has a minimum). If you must buy stock up front, enter that quantity: you pay for it whether it sells or not.</p>' : ''}
      <div class="fields">
        ${num(p + '.venueQuote.perParticipant', product ? 'Supplier cost per item, including tax and shipping ($)' : `${cap(t.venue)} charge per ${t.one}, including tax and service charges ($)`)}
        ${num(p + '.venueQuote.minimumParticipants', product ? 'Items you must pay for no matter how many sell: the supplier minimum or your pre-order (0 if none)' : `Minimum ${t.many} you must pay for (0 if none)`, { step: 1 })}
        ${num(p + '.venueQuote.flatFee', product ? 'Flat fee from the supplier ($, 0 if none)' : 'Flat fee, rental or buyout ($, 0 if none)')}
        ${num(p + '.venueQuote.minimumSpend', product ? 'Minimum order total ($, 0 if none)' : 'Minimum total spend, such as a food-and-drink minimum ($, 0 if none)')}
        ${num(p + '.capacity', product ? 'Most items you could realistically get and sell (the planner never counts more than this)' : `Most ${t.many} the ${t.venue} can take`, { step: 1 })}
        ${t.groupName ? num(p + '.groupSize', `${cap(t.groupName)} size (1 if ${t.many} only sign up one at a time)`, { step: 1 }) : ''}
      </div>
      ${t.groupName && Number(o.groupSize) > 1 ? `<div class="checks">${chk(p + '.wholeGroupsOnly', `${cap(t.many)} can only come as full ${t.groupName}s`)}</div>` : ''}
      <h3 class="sub">${product ? 'Deposit to the supplier' : 'Deposit'}</h3>
      <div class="fields">${num(p + '.deposit.amount', product ? 'Deposit paid before ordering ($, 0 if none)' : 'Deposit amount ($)')}</div>
      <div class="checks">${chk(p + '.deposit.creditedTowardBill', 'The deposit counts toward the final bill')}${chk(p + '.deposit.refundable', 'The deposit is refundable')}</div>
      <h3 class="sub">Cancellation</h3>
      <div class="fields">${num(p + '.cancellationOwed', product ? 'Total you would owe the supplier if you cancel after ordering, including any deposit you would lose ($, 0 if you can cancel for free, blank = not known yet)' : 'Total you would owe if you cancel after the deadline on the quote, including any deposit you would lose ($, blank = not known yet)', { placeholder: 'not known yet', wide: true })}</div>
      <div class="callout ${o.quoteVerified ? 'ok' : ''}">${chk(p + '.quoteVerified', 'I have this quote in writing')}<span>Until this is checked, the result will say “Not enough evidence to decide yet.”</span></div>
      <details class="qs"><summary>Questions to ask the ${t.venue} before signing</summary><ul class="plain">${questionsFor(o).map((q) => `<li>${esc(q)}</li>`).join('')}</ul></details>`;
  }

  function stepPrices() {
    const i = cur(), p = `options.${i}`, o = state.options[i], t = T(o);
    const size = Number(o.groupSize) || 1;
    const group = t.groupName && size > 1;
    const gp = o.groupPrice !== undefined ? 'groupPrice' : (o.foursomePrice !== undefined ? 'foursomePrice' : 'groupPrice');
    const gs = o.groupShare !== undefined ? 'groupShare' : (o.foursomeShare !== undefined ? 'foursomeShare' : 'groupShare');
    return `${optionTabs()}
      <div class="fields">
        ${num(p + '.price', t.survey === 'buy' ? 'Selling price per item ($)' : `Price per ${t.one} ($${t.proceeds ? ', 0 if admission is free' : ''})`)}
        ${group ? num(`${p}.${gp}`, `Price for a full ${t.groupName} of ${size} ($, blank = ${size} × the single price)`, { placeholder: String((Number(o.price) || 0) * size) }) : ''}
        ${group ? pct(`${p}.${gs}`, `Your guess: what % of ${t.many} will buy as a full ${t.groupName}?`) : ''}
      </div>
      <p class="hint">These exact prices go into the supporter survey, so a “Yes” always means yes at this price.</p>`;
  }

  function stepCosts() {
    const i = cur(), p = `options.${i}`, t = T(state.options[i]);
    return `${optionTabs()}
      <h3 class="sub">Costs for each ${t.one} <span class="muted">(${esc(t.perHint)})</span></h3>
      ${costRows(i, 'perParticipantCosts', false)}
      <h3 class="sub">One-time costs <span class="muted">(${esc(t.fixedHint)})</span></h3>
      ${costRows(i, 'fixedCosts', true)}
      <div class="callout ${state.options[i].costsVerified ? 'ok' : ''}">${chk(p + '.costsVerified', 'These costs are real quotes, not guesses')}</div>`;
  }

  function stepScenarios() {
    const i = cur(), p = `options.${i}`, o = state.options[i], t = T(o);
    const ss = state.scenarioSettings;
    const statusBoxes = (k) => E.SPONSOR_STATUSES.map((st) =>
      `<label class="chk"><input type="checkbox" data-scenario-status="${k}" value="${st}" ${ss[k].statuses.includes(st) ? 'checked' : ''}> ${st}</label>`).join('');
    return `${optionTabs()}
      ${anchors(o)}
      <div class="row-actions"><button class="small" data-action="fill-evidence" data-i="${i}">Use my survey numbers for low and likely</button></div>
      <div class="scen">
        ${SC.map((k) => `<div class="scen-col"><b>${esc(ss[k].label)}</b><span class="hint">${{ conservative: t.survey === 'buy' ? 'If sales disappoint. Start with paid orders only.' : 'If turnout disappoints. Start with paid sign-ups only.', middle: 'What your evidence supports: paid + named “yes”.', optimistic: 'If outreach goes well. Stay at or under capacity.' }[k]}</span>
          ${num(`${p}.scenarioParticipants.${k}`, t.survey === 'buy' ? 'Items sold' : `Paying ${t.many}`, { step: 1 })}
          ${t.proceeds ? num(`${p}.scenarioProceeds.${k}`, 'Auction and raffle money you would count on ($)') : ''}</div>`).join('')}
      </div>
      ${t.proceeds ? '<p class="hint">Auction and raffle money is your own figure for each case. It is counted in the low, likely and high totals but <b>not</b> in break-even, because donated items don\'t guarantee bids. Keep the low case low, and don\'t enter the same raffle money again under “Adjust assumptions”.</p>' : ''}
      <details class="qs"><summary>Adjust assumptions (sponsors counted, priced add-ons, cost cushion)</summary>
        <div class="table-wrap"><table class="edit">
          <thead><tr><th></th><th>Sponsors counted</th><th>Extra income per ${esc(t.one)} ($)<br><span class="muted">${t.proceeds ? 'drink tickets, games (not auction or raffle money)' : 'add-ons already priced, such as mulligans. Not raffle tickets, auction bids or a paddle raise'}</span></th><th>Other income ($)</th><th>Cost cushion %<br><span class="muted">not on the venue quote</span></th></tr></thead>
          <tbody>${SC.map((k) => `<tr><td><b>${esc(ss[k].label)}</b></td><td>${statusBoxes(k)}</td>
            <td><input type="number" inputmode="decimal" step="any" min="0" data-path="scenarioSettings.${k}.extraRevenuePerParticipant" data-type="number" value="${esc(ss[k].extraRevenuePerParticipant)}" aria-label="${esc(ss[k].label)} extra income per person"></td>
            <td><input type="number" inputmode="decimal" step="any" min="0" data-path="scenarioSettings.${k}.otherRevenue" data-type="number" value="${esc(ss[k].otherRevenue)}" aria-label="${esc(ss[k].label)} other income"></td>
            <td><input type="number" inputmode="decimal" step="any" min="0" data-path="scenarioSettings.${k}.costContingencyPct" data-type="number" value="${esc(ss[k].costContingencyPct || 0)}" aria-label="${esc(ss[k].label)} cost cushion percent"></td></tr>`).join('')}</tbody>
        </table></div>
      </details>`;
  }

  function stepVolunteers() {
    return `<div class="fields">
        ${state.options.map((o, i) => num(`options.${i}.volunteerHours`, `Volunteer hours needed: ${esc(o.name)}`)).join('')}
        ${num('volunteerHoursAvailable', 'Volunteer hours your club can realistically give (blank = not sure)', { placeholder: 'not sure' })}
        ${num('settings.volunteerHourValue', 'Optional: value each volunteer hour at ($)', { placeholder: 'leave blank' })}
      </div>
      <p class="hint">Volunteer time is shown next to the money, not subtracted from it, unless you give it a dollar value.</p>`;
  }

  function renderSponsors() {
    // In-kind items point at a one-time cost by its internal id; show people the cost's name and amount instead.
    const choices = new Map();
    state.options.forEach((o) => (o.fixedCosts || []).forEach((l) => {
      const c = choices.get(l.id) || { label: l.label || 'Unnamed cost', where: [] };
      c.where.push(`${o.name}: ${money(l.amount)}`); choices.set(l.id, c);
    }));
    const optSel = (j, v, nm) => `<select data-path="sponsorships.${j}.optionId" aria-label="Which option ${nm} applies to"><option value="">All options</option>${state.options.map((o) => `<option value="${esc(o.id)}" ${o.id === v ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    return `<div class="table-wrap"><table class="edit">
      <thead><tr><th>Sponsor or donation</th><th>Value ($)</th><th>Status</th><th>Type</th><th>Budgeted cost it replaces</th><th>Applies to</th><th><span class="sr-only">Remove</span></th></tr></thead>
      <tbody>${state.sponsorships.map((s, j) => { const nm = esc(s.label || `Sponsor ${j + 1}`); return `<tr>
        <td><input type="text" data-path="sponsorships.${j}.label" value="${esc(s.label)}" aria-label="Sponsor ${j + 1} name"></td>
        <td><input type="number" inputmode="decimal" step="any" min="0" data-path="sponsorships.${j}.amount" data-type="number" value="${esc(s.amount)}" aria-label="${nm} value in dollars"></td>
        <td><select data-path="sponsorships.${j}.status" aria-label="${nm} status">${[['collected', 'Collected (cash in hand)'], ['committed', 'Committed (in writing)'], ['hoped', 'Hoped-for / asked']].map(([v, l]) => `<option value="${v}" ${s.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><select data-path="sponsorships.${j}.type" aria-label="${nm} type"><option value="cash" ${s.type === 'cash' ? 'selected' : ''}>Cash</option><option value="inKind" ${s.type === 'inKind' ? 'selected' : ''}>In-kind (donated item or service)</option></select></td>
        <td>${s.type === 'inKind' ? `<select data-path="sponsorships.${j}.replacesCostId" aria-label="Budgeted cost replaced by ${nm}"><option value="">Doesn't replace a budgeted cost</option>${[...choices].map(([id, c]) => `<option value="${esc(id)}" ${s.replacesCostId === id ? 'selected' : ''}>${esc(c.label)} (${esc(c.where.join('; '))})</option>`).join('')}</select>` : '<span class="muted">Cash sponsor</span>'}</td>
        <td>${optSel(j, s.optionId, nm)}</td>
        <td><button class="link" data-action="del-sponsor" data-j="${j}" aria-label="Remove ${nm}">✕</button></td></tr>`; }).join('')}</tbody>
    </table></div><button class="small" data-action="add-sponsor">+ Add sponsor or donation</button>
    <p class="hint">In-kind donations are never counted as cash. They only reduce a one-time cost from step 5 that they actually replace, up to that cost's amount.</p>`;
  }

  let surveyOpen = false;
  const SNAP_KEYS = ['format', 'dateWindow', 'locationArea', 'included', 'beneficiary'];
  const snapshotReady = () => SNAP_KEYS.every((k) => String((state.snapshot || {})[k] || '').trim());
  function surveyText() {
    const s = state.snapshot || {};
    const f = (k, ph) => String(s[k] || '').trim() || `[${ph}]`;
    // One price per option, taken from the prices step, so every "Yes" maps 1:1 to the price the planner evaluates.
    const opts = state.options.slice(0, 3);
    const kinds = new Set(opts.map((o) => T(o).survey));
    const hasGolf = kinds.has('golf');
    const onlyProducts = kinds.size === 1 && kinds.has('buy');
    const hasGroups = opts.some((o) => T(o).groupName && Number(o.groupSize) > 1);
    const letters = 'abc';
    const groupPrice = (o) => { const g = o.groupPrice !== undefined ? o.groupPrice : o.foursomePrice; const n = Number(o.groupSize) || 1; return g == null || g === '' ? (Number(o.price) * n || '[group price]') : (Number(g) || '[group price]'); };
    const fb = String(s.fallbackPrice || '').trim().replace(/^\$/, '');
    const priceQs = opts.map((o, k) => {
      const t = T(o), q = `Q4${letters[k]}. ${o.name}`;
      if (t.survey === 'buy') return `${q}: at $${Number(o.price) || '[price]'} per item, would your household buy? (If another adult in your home is also answering, only one of you should count your household's items.)
   ( ) Yes, 1 item
   ( ) Yes, 2 items
   ( ) Yes, 3 or more items
   ( ) Maybe, I'm not sure yet
   ( ) No, that price is more than I would pay
   ( ) No, I'm not interested in this product`;
      const n = Number(o.groupSize) || 1;
      const group = t.groupName && n > 1 ? ` (or $${groupPrice(o)} for a full ${t.groupName} of ${n})` : '';
      const free = t.proceeds && !Number(o.price);
      if (free) return `${q}: admission is free, and the money is raised through the auction and raffle. Would you come and plan to bid or buy raffle tickets?
   ( ) Yes, I would come and plan to bid or buy raffle tickets if the date works
   ( ) Maybe, I might come, or I'm not sure yet
   ( ) No, probably not`;
      const ask = `if it cost $${Number(o.price) || '[price]'} per ${t.one}${group}, would you ${t.survey === 'attend' ? 'buy a ticket' : 'sign up'}?`;
      return `${q}: ${ask}
   ( ) Yes, I would ${free ? 'come' : t.survey === 'attend' ? 'buy a ticket' : 'sign up and pay this price'} if the date works
   ( ) Maybe, I'm interested but not sure yet
   ${free ? '( ) No, probably not' : '( ) No, that price is more than I would pay'}
   ( ) No, I wouldn't do this one at any price`;
    }).join('\n\n') + (fb && opts.some((o) => !(T(o).proceeds && !Number(o.price))) ? `

Q4${letters[opts.length] || 'x'}. ONLY if you answered "more than I would pay" above: would you take part in a simpler, lower-cost version at about $${fb}?
   ( ) Yes  ( ) Maybe  ( ) No` : '');
    const others = opts.filter((o) => !isGolf(o));
    const golfQ2 = `Q2. Which best describes you?
   ( ) I golf regularly
   ( ) I golf now and then, or I'm a beginner who'd enjoy a casual scramble
   ( ) I don't golf${others.length ? ', but I might take part in one of the other options (skip Q3, then answer Q4 for those)' : ', but I might support another way  -> skip to Q6'}
   ( ) I'm not interested in any of these  -> skip to Q6`;
    const otherQ2 = onlyProducts ? '' : `Q2. Would you be interested in ${kinds.has('buy') ? 'at least one of the options below' : 'taking part in a fundraiser like this'}?
   ( ) Yes  ( ) Maybe  ( ) No, none of them  -> skip to Q6

`;
    const q3 = hasGroups ? `Q3. If you took part, how would you most likely do it?
   ( ) On my own
   ( ) With one other person
   ( ) With a full group or table, made up of people who are NOT getting this survey
   ( ) With a full group or table, including people who are also getting this survey
   ( ) Not sure yet${kinds.has('buy') ? ' / only interested in the product sale' : ''}

` : '';
    return `DRAFT: review and edit before sending. Anonymous unless the respondent chooses to answer Q8.
Adults only: do not send to students or minors, and do not ask about them.

WHAT WE ARE CONSIDERING
What: ${f('format', 'what it is')}
When: ${f('dateWindow', 'date window')}
Where: ${f('locationArea', 'location area')}
Included: ${f('included', 'what is included')}
Supports: ${f('beneficiary', 'what the money supports')}
Answering does not commit you to anything. Please answer with what you would really do, not just to be encouraging.

Q1. How are you connected to our program? (choose all)
   Current parent/guardian · Alumni or alumni parent · Extended family · Coach/staff · Local business/community supporter · Other

${hasGolf ? golfQ2 + '\n\n' : otherQ2}${q3}${priceQs}

Q5. ${onlyProducts ? 'When would you most likely buy? (choose all)  [edit to your real options]\n   Before the holidays · At a game or school event · Online any time · Not sure' : 'Which times could work for you? (choose all)  [edit to your real options]\n   Weekday evening · Friday · Saturday daytime · Saturday evening · Sunday · None of these'}

Q6. What would most likely keep you from taking part? (choose up to 2)
   Price · Time commitment · Family or youth-sports schedule · Work conflict${hasGolf ? ' · Not comfortable golfing / no clubs' : ''} · Already asked to buy or give too often · Prefer to donate directly · Nothing major

Q7. Would you consider supporting in another way? (choose all)
   A business I'm connected to might sponsor · Donate an item for an auction or raffle · Volunteer · Make a direct donation · Not right now

Q8. OPTIONAL: If you answered "Yes" in Q4 and would like early sign-up, ordering or sponsorship information, leave a name and one way to reach you.
   This is voluntary and will only be used to follow up about this fundraiser.

---
Organizer notes (do not send):
- Named "yes" answers (step 8) = people who answered "Yes" to that option's Q4 AND left their name in Q8.
- Count people for events and items for product sales: "Yes, 1 item" = 1, "Yes, 2 items" = 2, "Yes, 3 or more" = 3. If two adults from one household both left their name, count that household's items once.
- Free-admission auction nights: a "Yes" is a guest, not money. Base your low, likely and high auction figures on realistic bidding, not headcount.
- Count a group or table as its full size only if the respondent chose "people who are NOT getting this survey" AND confirmed it with you directly. Otherwise the same people may be counted twice.
- "Yes" without Q8 = anonymous "Yes". "Maybe" = "Maybe". Count each person once per option.
- Edit the option names above into plain language, and delete questions that don't fit, before sending.
Report raw counts, never percentages applied to a whole school or community. Survey answers usually overstate real sign-ups and sales.`;
  }

  function stepSurvey() {
    return `<div class="fields">
        ${txt('snapshot.format', 'What it is, in plain words (e.g., “golf scramble” or “cookie dough sale”)', 'wide')}
        ${txt('snapshot.dateWindow', 'When')}
        ${txt('snapshot.locationArea', 'Where (general area)')}
        ${txt('snapshot.included', 'What the price includes', 'wide')}
        ${txt('snapshot.beneficiary', 'What the money supports')}
        ${txt('snapshot.fallbackPrice', 'Optional lower price to ask about ($)')}
      </div>
      <div class="row-actions"><button class="btn" data-action="copy-survey" ${snapshotReady() ? '' : 'disabled'}>Copy survey text</button>
      ${snapshotReady() ? '<span class="hint">Paste it into Google Forms or an email. Send it to adult supporters only.</span>' : '<span class="hint">Fill in the first five boxes to copy the survey.</span>'}</div>
      <details class="qs" open><summary>Preview the survey</summary><pre id="survey" class="survey">${esc(surveyText())}</pre></details>`;
  }

  function stepEvidence() {
    const field = (key, o) => `<input type="number" inputmode="numeric" min="0" step="1" data-path="evidence.${key}.${o.id}" data-type="number" value="${esc((state.evidence[key] || {})[o.id] || 0)}" aria-label="${esc(o.name)}: ${key}">`;
    return `<div class="fields">${num('evidence.surveyResponses', 'How many people answered the survey?', { step: 1 })}</div>
      <div class="table-wrap"><table class="edit">
        <thead><tr><th>Option</th><th>Already paid</th><th>Said “Yes” and left their name</th><th>Said “Yes” anonymously</th><th>Said “Maybe”</th></tr></thead>
        <tbody>${state.options.map((o) => `<tr><td>${esc(o.name)}</td><td>${field('paidRegistrations', o)}</td><td>${field('namedHighIntent', o)}</td><td>${field('surveyDefinitelyAtPrice', o)}</td><td>${field('surveyProbablyAtPrice', o)}</td></tr>`).join('')}</tbody>
      </table></div>
      <ul class="plain hint">
        <li>Count <b>people</b> for events and <b>items</b> for product sales (add up quantities; count “3 or more” as 3).</li>
        <li>Count someone buying for a whole group or table as the full group only if they confirmed it and the others aren't also on your survey list.</li>
        <li>Count each person once per option. Someone who left their name doesn't also go in “anonymously”.</li>
        <li>Enter totals only. Names stay in your own records, never in this planner.</li>
      </ul>
      <details class="qs"><summary>Import counts from a spreadsheet (CSV)</summary>
        <div class="row-actions"><label class="small filebtn">Choose CSV file<input type="file" accept=".csv,text/csv" data-action="import-csv" hidden></label>
        <button class="small" data-action="csv-template">Show CSV template</button></div>
      </details>`;
  }

  // ---------- results ----------
  function chart(o, curve, marks, target) {
    if (!curve.length) return '';
    const W = 560, H = 200, L = 64, R = 12, TOP = 12, B = 30;
    const xs = curve.map((p) => p.participants), ys = curve.map((p) => p.net).concat([0, target || 0]);
    const xMax = Math.max(1, ...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
    const yPad = (yMax - yMin) * 0.08 || 100;
    const y0 = yMin - yPad, y1 = yMax + yPad;
    const X = (v) => L + (v / xMax) * (W - L - R);
    const Y = (v) => TOP + (1 - (v - y0) / (y1 - y0)) * (H - TOP - B);
    const path = curve.map((p, k) => `${k ? 'L' : 'M'}${X(p.participants).toFixed(1)},${Y(p.net).toFixed(1)}`).join('');
    const ticks = [y0 + yPad, 0, y1 - yPad].filter((v, k, a) => a.indexOf(v) === k);
    const data = esc(JSON.stringify(curve));
    const t = T(o);
    return `<figure class="chart" data-curve="${data}" data-l="${L}" data-r="${R}" data-w="${W}" data-xmax="${xMax}" data-unit="${esc(t.many)}">
      <figcaption>Money left after costs at every possible number of ${esc(t.many)} (collected and committed sponsorship only)</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net proceeds by participant count for ${esc(o.name)}">
        ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="${t === 0 ? 'zero' : 'grid'}"/><text x="${L - 6}" y="${Y(t) + 4}" class="ax" text-anchor="end">${money(Math.round(t))}</text>`).join('')}
        ${target ? `<line x1="${L}" x2="${W - R}" y1="${Y(target)}" y2="${Y(target)}" class="target"/><text x="${W - R}" y="${Y(target) - 4}" class="ax" text-anchor="end">target ${money(target)}</text>` : ''}
        <path d="${path}" class="line"/>
        ${marks.map((m, k) => { const dup = marks.slice(0, k).filter((q) => q.n === m.n).length; const anchor = X(m.n) > W - 70 ? 'end' : X(m.n) < L + 40 ? 'start' : 'middle';
          return `<circle cx="${X(m.n)}" cy="${Y(m.net)}" r="4.5" class="mk"/><text x="${X(m.n)}" y="${Y(m.net) - 9 - dup * 13}" class="ax" text-anchor="${anchor}">${esc(m.label)}</text>`; }).join('')}
        <text x="${L}" y="${H - 8}" class="ax">0</text><text x="${W - R}" y="${H - 8}" class="ax" text-anchor="end">${xMax} ${esc(t.many)}</text>
        <line class="xh" x1="0" x2="0" y1="${TOP}" y2="${H - B}" visibility="hidden"/>
      </svg><div class="tip" hidden></div></figure>`;
  }

  function statusClass(s) {
    return { not_enough_evidence: 'st-unknown', not_viable_as_configured: 'st-bad', high_risk: 'st-warn', supported_by_current_evidence: 'st-ok' }[s];
  }
  function statusIcon(s) { return { not_enough_evidence: '?', not_viable_as_configured: '✕', high_risk: '!', supported_by_current_evidence: '✓' }[s]; }

  function analyse(o) {
    const proj = {};
    SC.forEach((k) => { proj[k] = E.project(o, (o.scenarioParticipants || {})[k], E.scenarioContext(state, o, k)); });
    const midCtx = E.scenarioContext(state, o, 'middle');
    const firmCtx = { ...midCtx, statuses: ['collected', 'committed'], otherRevenue: Math.max(0, midCtx.otherRevenue - (Number((o.scenarioProceeds || {}).middle) || 0)) };
    const dec = E.decide(state, o);
    return { proj, dec, curve: E.netCurve(o, firmCtx), sens: E.sensitivity(o, (o.scenarioParticipants || {}).middle, E.scenarioContext(state, o, 'middle')) };
  }

  function renderComparison(all) {
    const target = Number(state.settings.fundraisingTarget) || 0;
    return `<div class="table-wrap"><table class="res">
      <thead><tr><th>Option</th><th>Status</th><th>Break-even<br><span class="muted">firm money only${state.options.some((o) => T(o).proceeds) ? ', no auction bids' : ''}</span></th><th>Needed for ${money(target)}</th><th>Feasible capacity</th><th>Conservative net</th><th>Middle net</th><th>Optimistic net</th><th>Upfront cash</th><th>Volunteer hrs</th></tr></thead>
      <tbody>${state.options.map((o, i) => { const a = all[i]; const be = a.dec.breakEven, tg = a.dec.targetNeeded; return `<tr>
        <td><b>${esc(o.name)}</b></td>
        <td><span class="badge ${statusClass(a.dec.status)}"><i>${statusIcon(a.dec.status)}</i>${esc(E.STATUS_LABELS[a.dec.status])}</span></td>
        <td>${be.reachableWithinCapacity ? `${be.participants} ${esc(T(o).many)}` : '<b class="neg">Not within capacity</b>'}</td>
        <td>${target ? (tg.reachableWithinCapacity ? `${tg.participants} ${esc(T(o).many)}` : '<b class="neg">Exceeds capacity</b>') : '—'}</td>
        <td>${be.maxFeasible} ${esc(T(o).many)}</td>
        ${SC.map((k) => `<td class="${a.proj[k].net < 0 ? 'neg' : ''}">${money(a.proj[k].net)}</td>`).join('')}
        <td>${money(a.proj.middle.upfront.required)}</td><td>${a.proj.middle.volunteerHours}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function renderDetail(o, a) {
    const P = a.proj;
    const vhv = state.settings.volunteerHourValue;
    const row = (label, f, cls = '') => `<tr class="${cls}"><th>${label}</th>${SC.map((k) => `<td>${f(P[k], k)}</td>`).join('')}</tr>`;
    const flags = (p) => p.flags.length ? ` <span class="flag">${p.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}</span>` : '';
    const ss = state.scenarioSettings;
    const midCtx = E.scenarioContext(state, o, 'middle');
    const firmMarkCtx = { ...midCtx, statuses: ['collected', 'committed'], otherRevenue: Math.max(0, midCtx.otherRevenue - (Number((o.scenarioProceeds || {}).middle) || 0)) };
    const marks = SC.map((k) => ({ n: P[k].participants, label: ss[k].label, net: E.project(o, P[k].participants, firmMarkCtx).net }));
    const ik = [...new Map(SC.flatMap((k) => P[k].inKind.applied.concat(P[k].inKind.notCounted.filter((n) => n.reason !== 'status_not_counted_in_this_scenario'))).map((x) => [x.id, x])).values()];
    return `<details class="detail" ${state.options.indexOf(o) === 0 ? 'open' : ''}><summary>${esc(o.name)} — scenario detail</summary>
      <div class="table-wrap"><table class="res sc">
        <thead><tr><th></th>${SC.map((k) => `<th>${esc(ss[k].label)}<br><span class="muted">sponsors: ${ss[k].statuses.join(' + ') || 'none'}</span></th>`).join('')}</tr></thead>
        <tbody>
          ${row(cap(T(o).many), (p) => `${p.participants}${flags(p)}`)}
          ${row(T(o).survey === 'buy' ? 'Sales' : 'Ticket and registration revenue', (p) => money(p.revenue.registration) + (p.revenue.groups ? ` <span class="muted">${p.revenue.groups} ${esc(T(o).groupName || 'group')}s + ${p.revenue.singles} single</span>` : ''))}
          ${row(T(o).proceeds ? 'Add-ons, auction and raffle (your estimates; not in break-even)' : 'Add-on revenue', (p) => money(p.revenue.extras + p.revenue.other))}
          ${row('Sponsorship cash counted', (p) => money(p.revenue.sponsorshipCash))}
          ${row('Total revenue', (p) => money(p.revenue.total), 'sum')}
          ${row(cap(T(o).venue), (p) => money(p.expenses.venue) + (p.expenses.venueMinimumApplied ? ` <span class="flag">minimum applies (billed ${p.expenses.venueBilledParticipants})</span>` : ''))}
          ${row('Other per-participant costs', (p) => money(p.expenses.perParticipant))}
          ${row('Fixed costs (after qualifying in-kind)', (p) => money(p.expenses.fixed))}
          ${row('Separate (non-credited) deposit fee', (p) => money(p.expenses.separateDepositFee))}
          ${row('Contingency on estimated costs', (p) => money(p.expenses.contingency))}
          ${row('Total expenses', (p) => money(p.expenses.total), 'sum')}
          ${row('<b>Projected net proceeds</b>', (p) => `<b class="${p.net < 0 ? 'neg' : ''}">${money(p.net)}</b>`, 'net')}
          ${row(T(o).survey === 'buy' ? 'Cash needed before order money comes in' : 'Cash needed before the event', (p) => money(p.upfront.required))}
          ${row('Cash in hand now', (p) => money(p.upfront.cashInHand))}
          ${row('Upfront cash gap', (p) => `<span class="${p.upfront.gap > 0 ? 'neg' : ''}">${money(p.upfront.gap)}</span>`)}
          ${row('Volunteer hours (not in net)', (p) => p.volunteerHours)}
          ${vhv ? row(`Net after valuing volunteer time at ${money(vhv)}/h`, (p) => money(p.net - p.volunteerHours * vhv)) : ''}
        </tbody></table></div>
      ${chart(o, a.curve, marks, Number(state.settings.fundraisingTarget) || 0)}
      <h4>What moves the middle scenario most</h4>
      <div class="table-wrap"><table class="res small-t"><tbody>${a.sens.results.map((r) => `<tr><th>${esc(r.label)}</th><td class="${r.change < 0 ? 'neg' : ''}">${r.change >= 0 ? '+' : ''}${money(r.change)}</td><td class="muted">net becomes ${money(r.net)}</td></tr>`).join('')}</tbody></table></div>
      ${ik.length ? `<h4>In-kind handling</h4><ul class="plain">${ik.map((x) => x.replaces ? `<li>${esc(x.label)}: reduces “${esc(x.replaces)}” by ${money(x.reducedBy)}${x.excessNotCounted ? `; ${money(x.excessNotCounted)} of its value exceeds that cost and is not counted` : ''}.</li>` : `<li>${esc(x.label)}: not counted — it does not replace a budgeted cost.</li>`).join('')}</ul>` : ''}
    </details>`;
  }

  function readAloud(o, d, P, round) {
    const t = T(o);
    const firm = P.middle.sponsorshipByStatus.collected + P.middle.sponsorshipByStatus.committed;
    const have = d.paid + d.named;
    const midProceeds = Number((o.scenarioProceeds || {}).middle) || 0;
    const auction = t.proceeds && (d.proceedsLow > 0 || midProceeds > 0) ? ` Break-even leaves out auction and raffle money because bids aren't promised; our middle estimate for it is ${round(midProceeds)}, which is included in the middle-case net of ${round(P.middle.net)}.` : '';
    if (!d.breakEven.reachableWithinCapacity && d.beWithLowProceeds && d.beWithLowProceeds.reachableWithinCapacity) return `Tickets and firm sponsorship alone can't cover costs, even at full capacity of ${d.breakEven.maxFeasible} ${t.many}. This only works if auction or raffle money reaches at least our low estimate of ${round(d.proceedsLow)}, and bids aren't promised.`;
    if (!d.breakEven.reachableWithinCapacity) return `Even at full capacity of ${d.breakEven.maxFeasible} ${t.many}, this option loses money on collected and committed sponsorship as currently priced, so it should not go ahead as configured.${auction}`;
    return `With ${money(firm)} in collected and committed sponsorship, we need ${d.breakEven.participants} ${t.survey === 'buy' ? 'items sold' : 'paying ' + t.many} to break even. Right now we have ${have} (${t.survey === 'buy' ? 'paid orders' : 'paid registrations'} plus named survey “yes” answers)${d.breakEven.participants > have ? `, a gap of ${d.breakEven.participants - have}` : `, which meets the count check only. Named “yes” answers are not ${t.survey === 'buy' ? 'paid orders' : 'paid registrations'}`}. ${t.survey === 'buy' ? 'If nothing sells' : 'If nobody registers'}, we would be at about ${round(d.worst.netIfNobodyRegisters)}.${auction}`;
  }

  function renderSummary(all) {
    return state.options.map((o, i) => {
      const a = all[i], d = a.dec, P = a.proj, t = T(o);
      const top = a.sens.results[0];
      const lines = [];
      lines.push(...d.reasons);
      if (d.breakEven.reachableWithinCapacity && d.breakEven.participants === 0) lines.push(`Collected and committed sponsorship alone would cover costs even with zero ${t.many}. Confirm sponsors would still pay if the event is small or canceled.`);
      else if (d.breakEven.reachableWithinCapacity) lines.push(`With only collected and committed sponsorship, you need ${d.breakEven.participants} ${t.survey === 'buy' ? 'items sold' : 'paying ' + t.many} to cover costs (most possible: ${d.breakEven.maxFeasible}).`);
      lines.push(`At the low number you entered (${P.conservative.participants} ${t.many}), projected net is ${hm(P.conservative.net)}; at the middle ${P.middle.participants}, ${hm(P.middle.net)}.`);
      if (d.worst.contractualFloor > 0) lines.push(`From the minimums and deposit you entered, the venue bill at low turnout is about ${hm(d.worst.contractualFloor)}. That isn't a cancellation fee, and it only applies if those are the terms you actually sign.`);
      if (d.cancel) lines.push(`If you cancel after the quote's deadline: about ${hm(d.cancel.owedToVenue)} to the venue, plus ${hm(d.cancel.alreadySpent)} already spent on items paid in advance.`);
      const midP = Number((o.scenarioProceeds || {}).middle) || 0;
      if (t.proceeds && (d.proceedsLow > 0 || midP > 0)) lines.push(`Why break-even and middle-case net look different: break-even leaves out auction and raffle money because bids aren't promised. Your scenarios include about ${hm(d.proceedsLow)} (low) and ${hm(midP)} (middle) of it.`);
      if (top) lines.push(`The single assumption that moves the middle case most: “${top.label}” (${top.change >= 0 ? '+' : ''}${money(top.change)}).`);
      if (P.middle.upfront.gap > 0) lines.push(`You would need ${money(P.middle.upfront.gap)} more cash than you have in hand before ${t.survey === 'buy' ? 'order money comes in' : 'the event'}.`);
      if (P.middle.sponsorshipByStatus.hoped > 0) lines.push(`${money(P.middle.sponsorshipByStatus.hoped)} of sponsorship is only hoped-for and is excluded from break-even.`);
      lines.push(t.survey === 'buy'
        ? `Evidence so far: ${d.paid} items already paid for; ${d.named} items from named “yes” answers; ${d.definitely} from anonymous “yes”; ${d.responses} survey responses. Survey interest is not a paid order.`
        : `Evidence so far: ${d.paid} paid sign-ups or tickets; ${d.named} named “yes” answers; ${d.definitely} anonymous “yes”; ${d.responses} survey responses. Survey interest is not a paid sign-up.`);
      const vh = P.middle.volunteerHours;
      const beGap = d.breakEven.reachableWithinCapacity ? Math.max(0, d.breakEven.participants - d.paid - d.named) : 0;
      const perHour = vh ? P.middle.net / vh : null;
      return `<div class="sum"><h4><span class="badge ${statusClass(d.status)}"><i>${statusIcon(d.status)}</i>${esc(E.STATUS_LABELS[d.status])}</span> ${esc(o.name)}</h4>
        <p class="aloud"><b>What to tell the board (30 seconds):</b> ${esc(readAloud(o, d, P, (x) => money(E.roundHeadline(x))))}</p>
        <div class="cards">
          <div class="card ${beGap > 0 || !d.breakEven.reachableWithinCapacity ? 'bad' : ''}"><span>Break-even vs. evidence</span><b>${d.breakEven.reachableWithinCapacity ? d.breakEven.participants : '—'} needed · ${d.paid + d.named} paid or named</b><em>${esc(t.many)} needed on firm money${t.proceeds ? ', not counting auction bids,' : ''} vs. paid + named “yes” answers. Named answers are not money.</em></div>
          <div class="card"><span>${t.survey === 'buy' ? 'Cash needed up front' : 'Cash needed before event day'}</span><b>${hm(P.middle.upfront.required)}</b><em>deposit + bills due before the event; short by ${hm(P.middle.upfront.gap)} vs. cash in hand</em></div>
          <div class="card"><span>Contract floor</span><b>${hm(d.worst.contractualFloor)}</b><em>the least the ${esc(t.venue)} bills even if ${t.survey === 'buy' ? 'nothing sells' : 'nobody comes'}, from the minimums and deposit you entered</em></div>
          <div class="card ${d.worst.netIfNobodyRegisters < 0 ? 'bad' : ''}"><span>${t.survey === 'buy' ? 'Net if nothing sells' : 'Net if nobody registers'}</span><b>${hm(d.worst.netIfNobodyRegisters)}</b><em>collected sponsor cash minus the contract floor and all one-time costs, including ones paid later</em></div>
          <div class="card"><span>Middle-case net</span><b>${hm(P.middle.net)}</b><em>at the low number (${P.conservative.participants}): ${hm(P.conservative.net)}${t.proceeds ? '. Includes your auction and raffle estimate' : ''}</em></div>
          <div class="card"><span>Volunteer hours</span><b>${vh} h</b><em>${perHour == null ? '—' : `≈ ${money(Math.round(perHour))} net per hour (middle)`}</em></div>
        </div>
        <ul class="plain">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        ${d.missing.length ? `<p><b>Must verify before committing:</b></p><ul class="plain miss">${d.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div>`;
    }).join('');
  }

  let exact = false;
  const hm = (x) => exact ? money(x) : '≈\u2009' + money(E.roundHeadline(x));

  function copyText(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = o; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { say('Copy failed. Select the text and copy it manually.'); }
      ta.remove();
    }
  }

  function boardMemo() {
    const L = [];
    L.push(`# ${state.eventName}`);
    if (state.isDemo) L.push('**FICTIONAL DEMONSTRATION DATA — not a recommendation for any real event.**');
    L.push(`Fundraising target: ${money(state.settings.fundraisingTarget || 0)} net. Figures rounded; exact math in the planner.`);
    for (const o of state.options) {
      const a = analyse(o), d = a.dec, P = a.proj;
      L.push('', `## ${o.name}`, `**Status: ${E.STATUS_LABELS[d.status]}**`);
      L.push('', `> **Read-aloud (30 seconds):** ${readAloud(o, d, P, (x) => money(E.roundHeadline(x)))}`, '');
      d.reasons.forEach((r) => L.push(`- ${r}`));
      L.push(`- Break-even (firm sponsorship only): ${d.breakEven.reachableWithinCapacity ? d.breakEven.participants + ' ' + T(o).many : 'not reachable within capacity'} of ${d.breakEven.maxFeasible} feasible.`);
      L.push(`- Net: conservative ${hm(P.conservative.net)} (${P.conservative.participants}), middle ${hm(P.middle.net)} (${P.middle.participants}), optimistic ${hm(P.optimistic.net)} (${P.optimistic.participants}).`);
      L.push(`- Cash needed before the event: ${hm(P.middle.upfront.required)}. Worst case if nobody registers: ${hm(d.worst.netIfNobodyRegisters)}. Volunteer hours: ${P.middle.volunteerHours}.`);
      L.push(`- Evidence: ${d.paid} paid, ${d.named} named high-intent, ${d.definitely} anonymous "definitely", ${d.responses} responses.`);
      if (d.missing.length) { L.push('- Must verify before signing:'); d.missing.forEach((m) => L.push(`  - ${m}`)); }
      if (d.cancel) L.push(`- If canceled after the quote's deadline: about ${money(E.roundHeadline(d.cancel.owedToVenue))} to the venue plus ${money(E.roundHeadline(d.cancel.alreadySpent))} already spent.`);
    }
    L.push('', '## Before anyone signs'); SIGNING_QUESTIONS.forEach((q) => L.push(`- [ ] ${q}`));
    L.push('', '_Planning estimates only. No guarantee of results; no tax or legal determinations._');
    return L.join('\n');
  }

  // ---------- views ----------
  const STEPS = [
    { id: 'event', title: 'What are you planning?', help: 'Start with a name and a goal. You can change anything later.', body: stepEvent },
    { id: 'options', title: 'Which options are you comparing?', help: 'Add each idea you are weighing, such as tee times against a shotgun start, a gala against a product sale, or this year\'s event against a smaller one. Pick what kind of fundraiser each one is.', body: stepOptions },
    { id: 'quote', title: 'What will the venue or supplier charge?', help: 'Copy these numbers from the written quote. Minimums matter most: they are what you owe even if few people come.', body: stepQuote },
    { id: 'prices', title: 'What will you charge?', help: 'Pick the price you would actually put on the sign-up or order form.', body: stepPrices },
    { id: 'costs', title: 'What else will it cost?', help: 'Anything not already in the venue or supplier quote.', body: stepCosts },
    { id: 'sponsors', title: 'Who is sponsoring?', help: 'Only money that is collected or promised in writing counts toward break-even. Hoped-for sponsors are shown, but never relied on.', body: () => renderSponsors() },
    { id: 'survey', title: 'Ask your supporters', help: 'A short survey asks adults whether they would take part or buy, which option they prefer, and at what price. A “yes” is interest, not a sign-up or a sale. It stays anonymous unless someone chooses to leave a name.', body: stepSurvey },
    { id: 'evidence', title: 'What did supporters say?', help: 'Type in the totals from your survey and any paid sign-ups or orders so far.', body: stepEvidence },
    { id: 'scenarios', title: 'Plan for low, likely and high results', help: 'These are your numbers, not predictions. The survey counts are shown beside them so you can stay honest.', body: stepScenarios },
    { id: 'volunteers', title: 'How much volunteer time will it take?', help: 'A profitable event can still be a bad trade if it burns out your volunteers.', body: stepVolunteers },
  ];
  let view = 'home', stepIdx = 0, savePanel = false;
  const PER_OPTION_STEPS = new Set(['quote', 'prices', 'costs', 'scenarios']);

  function readHash() {
    const h = (location.hash || '').slice(1);
    if (h === 'results') { view = 'results'; return; }
    const k = STEPS.findIndex((st) => 'step-' + st.id === h);
    if (k >= 0) { const back = view === 'wizard' && k === stepIdx - 1; view = 'wizard'; openOption = back ? state.options.length - 1 : 0; stepIdx = k; return; }
    view = 'home';
  }
  function go(hash) { if (location.hash !== '#' + hash) location.hash = hash; else { readHash(); render(); } }

  function viewHome() {
    const hasSaved = hasSavedPlan();
    return `<section class="hero">
        <p class="eyebrow">For booster clubs, PTAs and other small volunteer groups</p>
        <h1>See whether your numbers work <em>before</em> you sign the contract.</h1>
        <p class="lede">Golf outings, galas, product sales and auctions can lock you into minimums, deposits and upfront orders. This planner puts your real quotes next to real answers from your supporters, so the board sees the risk in plain numbers.</p>
        <div class="cta">
          ${hasSaved ? `<button class="btn" data-action="nav" data-to="step-event">Continue my plan</button>` : ''}
          <button class="btn ${hasSaved ? 'ghost' : ''}" data-action="start-demo" data-demo="golf">Try a golf example (made-up numbers)</button>
          <button class="btn ghost" data-action="start-demo" data-demo="gala">Try a gala vs. product sale example</button>
          <button class="btn ghost" data-action="start-blank">Start a new plan</button>
        </div>
        <p class="hint">Free. Nothing to install. Your plan stays in your own browser.</p>
      </section>
      <section class="how">
        <div><span class="num">1</span><h3>Enter your real quotes</h3><p>Venue or supplier prices, minimums, deposits, prizes. The planner works out what you owe even if turnout or sales are low.</p></div>
        <div><span class="num">2</span><h3>Ask your supporters</h3><p>Get a ready-to-send survey with your exact prices. Enter the totals when answers come back.</p></div>
        <div><span class="num">3</span><h3>Get a clear answer</h3><p>See break-even, cash needed up front and worst case, plus a summary you can read to the board.</p></div>
      </section>
      <section class="honest">
        <h2>What it won't do</h2>
        <ul class="plain">
          <li>Guess who will come. You type the low, likely and high turnout yourself. Survey answers sit beside those numbers and are never turned into a forecast.</li>
          <li>Treat a survey “yes” as money. Break-even is a headcount worked out from your prices and costs. Paid sign-ups and named “yes” answers are only compared with that headcount.</li>
          <li>Give tax or legal advice, or promise results.</li>
        </ul>
        <p>Without a written quote and some real evidence of demand (paid sign-ups or survey answers), it says <b>“Not enough evidence to decide yet.”</b> That's often the right answer. Even its strongest result means only that your numbers hold up so far. It never means the event will make money.</p>
      </section>`;
  }

  function viewWizard() {
    const st = STEPS[stepIdx];
    const pct = Math.round(((stepIdx + 1) / STEPS.length) * 100);
    const perOpt = PER_OPTION_STEPS.has(st.id) && state.options.length > 1;
    if (!state.options[openOption]) openOption = 0;
    return `<div class="wiz">
      <nav class="steplist" aria-label="Steps"><ol>${STEPS.map((x, k) => `<li class="${k === stepIdx ? 'on' : ''} ${k < stepIdx ? 'done' : ''}"><a href="#step-${x.id}" ${k === stepIdx ? 'aria-current="step"' : ''}>${esc(x.title)}</a></li>`).join('')}
        <li class="res"><a href="#results">See results</a></li></ol></nav>
      <section class="panel stepcard">
        <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${stepIdx + 1}" aria-label="Step ${stepIdx + 1} of ${STEPS.length}"><span style="width:${pct}%"></span></div>
        <p class="eyebrow">Step ${stepIdx + 1} of ${STEPS.length}${perOpt ? ` · Option ${openOption + 1} of ${state.options.length}` : ''}</p>
        <h2 id="step-title" tabindex="-1">${esc(st.title)}</h2>
        <p class="lede-s">${esc(st.help)}</p>
        <div class="stepbody">${st.body()}</div>
        <div class="stepnav">
          ${perOpt && openOption > 0 ? `<button class="btn ghost" data-action="opt-step" data-i="${openOption - 1}">← ${esc(state.options[openOption - 1].name || 'Previous option')}</button>`
            : stepIdx > 0 ? `<a class="btn ghost" href="#step-${STEPS[stepIdx - 1].id}">← Back</a>` : '<a class="btn ghost" href="#home">← Home</a>'}
          ${perOpt && openOption < state.options.length - 1 ? `<button class="btn" data-action="opt-step" data-i="${openOption + 1}">Next: ${esc(state.options[openOption + 1].name || 'next option')} →</button>`
            : stepIdx < STEPS.length - 1 ? `<a class="btn" href="#step-${STEPS[stepIdx + 1].id}">Next →</a>` : '<a class="btn" href="#results">See results →</a>'}
        </div>
      </section>
    </div>`;
  }

  function viewResults() {
    const all = state.options.map(analyse);
    const live = state.options.map((o, k) => `${o.name}: ${E.STATUS_LABELS[all[k].dec.status]}`).join('. ');
    return `<div class="results">
      <header class="reshead">
        <p class="eyebrow">Results</p>
        <h1>${esc(state.eventName || 'Your plan')}</h1>
        <p class="lede-s">${state.options.length > 1 ? `Comparing ${state.options.length} options` : 'One option'}${Number(state.settings.fundraisingTarget) ? ` against a goal of ${money(state.settings.fundraisingTarget)} after costs` : ''}.</p>
        <div class="row-actions">
          <button class="btn" data-action="copy-memo">Copy board summary</button>
          <a class="btn ghost" href="#step-event">Edit answers</a>
          <button class="btn ghost" id="exact-toggle" data-action="toggle-exact">${exact ? 'Show rounded figures' : 'Show exact figures'}</button>
        </div>
        <p id="live-status" class="sr-only" aria-live="polite">${esc(live)}</p>
      </header>
      <section class="panel">${renderSummary(all)}</section>
      ${state.options.length > 1 ? `<section class="panel"><h2>Side by side</h2>${renderComparison(all)}</section>` : ''}
      <section class="panel"><h2>Before anyone signs</h2><p class="hint">These can change the decision but can't be calculated. Get answers in writing.</p><ul class="plain miss">${SIGNING_QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
        ${state.options.map((o) => `<details class="qs"><summary>Questions to ask the ${esc(T(o).venue)}: ${esc(o.name)}</summary><ul class="plain">${questionsFor(o).map((q) => `<li>${esc(q)}</li>`).join('')}</ul></details>`).join('')}</section>
      <section class="panel"><h2>Detailed numbers</h2><p class="hint">Every line of the math for each scenario, a chart of profit at each headcount, and which assumption matters most.</p>${state.options.map((o, i) => renderDetail(o, all[i])).join('')}</section>
    </div>`;
  }

  function render(focusTitle) {
    persist();
    document.getElementById('demo-banner').hidden = !state.isDemo || view === 'home';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === view));
    document.getElementById('save-panel').hidden = !savePanel;
    const app = document.getElementById('app');
    app.innerHTML = view === 'wizard' ? viewWizard() : view === 'results' ? viewResults() : viewHome();
    const sl = app.querySelector('.steplist'), on = sl && sl.querySelector('li.on');
    if (sl && on && sl.scrollWidth > sl.clientWidth) sl.scrollLeft = on.offsetLeft - 16; // phones: show the current step pill
    if (focusTitle) {
      const h = app.querySelector('h1, #step-title');
      if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  // ---------- events ----------
  function onChange(e) {
    const t = e.target;
    if (t.dataset.scenarioStatus) {
      const k = t.dataset.scenarioStatus;
      const set = new Set(state.scenarioSettings[k].statuses);
      t.checked ? set.add(t.value) : set.delete(t.value);
      state.scenarioSettings[k].statuses = E.SPONSOR_STATUSES.filter((s) => set.has(s));
      return renderKeepingFocus();
    }
    if (t.dataset.action === 'import-csv') return importCsv(t.files[0]);
    if (t.dataset.action === 'import-json') return importJson(t.files[0]);
    if (!t.dataset.path) return;
    let v = t.value;
    if (t.dataset.type === 'number') v = v === '' ? null : Math.max(0, Number(v));
    if (t.dataset.type === 'bool') v = t.checked;
    if (t.dataset.type === 'pct') v = v === '' ? 0 : Math.min(100, Math.max(0, Number(v))) / 100;
    setPath(state, t.dataset.path, v);
    touched = true;
    renderKeepingFocus();
  }

  // A change event fires before Tab moves focus. Re-render on the next tick, then put focus back
  // on whatever control the person had moved to (matched by its data attributes), so keyboard and
  // screen-reader users aren't thrown back to the top of the page.
  function focusKey(el) {
    if (!el || el === document.body || !document.getElementById('app').contains(el)) return null;
    if (el.dataset.path) return `[data-path="${CSS.escape(el.dataset.path)}"]`;
    if (el.dataset.scenarioStatus) return `[data-scenario-status="${CSS.escape(el.dataset.scenarioStatus)}"][value="${CSS.escape(el.value)}"]`;
    if (el.dataset.action) return `[data-action="${CSS.escape(el.dataset.action)}"]` + (el.dataset.i != null ? `[data-i="${CSS.escape(el.dataset.i)}"]` : '') + (el.dataset.j != null ? `[data-j="${CSS.escape(el.dataset.j)}"]` : '') + (el.dataset.key ? `[data-key="${CSS.escape(el.dataset.key)}"]` : '');
    if (el.id) return '#' + CSS.escape(el.id);
    return null;
  }
  function renderKeepingFocus() {
    setTimeout(() => {
      const key = focusKey(document.activeElement);
      const y = window.scrollY;
      render();
      const el = key && document.querySelector(key);
      if (el) el.focus({ preventScroll: true });
      window.scrollTo(0, y);
    }, 0);
  }

  function onClick(e) {
    const b = e.target.closest('[data-action]');
    if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.action, i = +b.dataset.i, j = +b.dataset.j;
    if (a === 'tab') openOption = i;
    else if (a === 'add-row') state.options[i][b.dataset.key].push({ id: uid('cost_'), label: 'New cost', amount: 0, paidUpfront: false });
    else if (a === 'del-row') state.options[i][b.dataset.key].splice(j, 1);
    else if (a === 'add-option') { const o = clone(window.BFDemo.BLANK_STATE.options[0]); o.id = uid('opt_'); o.name = 'New option'; state.options.push(o); openOption = state.options.length - 1; }
    else if (a === 'dup-option') { const o = clone(state.options[i]); o.id = uid('opt_'); o.name += ' (copy)'; state.options.push(o); openOption = state.options.length - 1; }
    else if (a === 'del-option') { if (!armed(b, 'Click again to remove')) return; state.options.splice(i, 1); openOption = 0; }
    else if (a === 'fill-evidence') {
      const o = state.options[i], ev = state.evidence;
      const paid = (ev.paidRegistrations || {})[o.id] || 0, named = (ev.namedHighIntent || {})[o.id] || 0;
      o.scenarioParticipants.conservative = paid;
      o.scenarioParticipants.middle = paid + named;
    }
    else if (a === 'add-sponsor') state.sponsorships.push({ id: uid('sp_'), label: 'New sponsor', amount: 0, status: 'hoped', type: 'cash', optionId: '' });
    else if (a === 'del-sponsor') state.sponsorships.splice(j, 1);
    else if (a === 'toggle-survey') { surveyOpen = !surveyOpen; document.getElementById('survey').hidden = !surveyOpen; return; }
    else if (a === 'copy-survey') return copyText(surveyText(), b);
    else if (a === 'copy-memo') return copyText(boardMemo(), b);
    else if (a === 'nav') return go(b.dataset.to);
    else if (a === 'opt-step') { openOption = i; render(true); window.scrollTo(0, 0); return; }
    else if (a === 'start-demo') { if (hasSavedPlan() && !armed(b, 'This replaces your saved plan. Click again')) return; state = clone(b.dataset.demo === 'gala' ? window.BFDemo.DEMO_GALA : window.BFDemo.DEMO_STATE); openOption = 0; touched = true; return go('step-event'); }
    else if (a === 'toggle-save') { savePanel = !savePanel; }
    else if (a === 'toggle-exact') { exact = !exact; }
    else if (a === 'csv-template') return showText('Survey summary CSV template', 'summary-template.csv', 'metric,option_id,value\nsurvey_responses,,0\n' + state.options.map((o) => ['named_high_intent', 'definitely_at_price', 'probably_at_price', 'paid_registrations'].map((m) => `${m},${o.id},0`).join('\n')).join('\n') + '\n', 'text/csv');
    else if (a === 'export') return showText('Your plan (JSON). Copy it and save it in a file, or use Download where it works.', 'fundraiser-plan.json', JSON.stringify(state, null, 2), 'application/json');
    else if (a === 'copy-export') return copyText(document.getElementById('export-text').value, b);
    else if (a === 'download-export') { const t = document.getElementById('export-text'); return download(t.dataset.name, t.value, t.dataset.type); }
    else if (a === 'close-export') { document.getElementById('export-panel').hidden = true; return; }
    else if (a === 'load-demo') { if (!armed(b, 'Replace your plan with the example? Click again')) return; state = clone(window.BFDemo.DEMO_STATE); openOption = 0; savePanel = false; say('Golf example loaded. All of its numbers are made up.'); }
    else if (a === 'start-blank') { if ((view !== 'home' || hasSavedPlan()) && !armed(b, 'This clears your current plan. Click again')) return; touched = true; state = clone(window.BFDemo.BLANK_STATE); openOption = 0; savePanel = false; say('New plan started. It saves in this browser automatically.'); return go('step-event'); }
    else return;
    touched = true;
    render();
  }

  function showText(title, name, text, type) {
    const panel = document.getElementById('export-panel');
    document.getElementById('export-title').textContent = title;
    const t = document.getElementById('export-text');
    t.value = text; t.dataset.name = name; t.dataset.type = type || 'text/plain';
    savePanel = true; document.getElementById('save-panel').hidden = false;
    panel.hidden = false; t.focus(); t.select();
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const aEl = document.createElement('a'); aEl.href = url; aEl.download = name; document.body.appendChild(aEl); aEl.click(); aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readFile(f, cb) { if (!f) return; const r = new FileReader(); r.onload = () => cb(String(r.result)); r.readAsText(f); }
  function importJson(f) {
    readFile(f, (t) => {
      try {
        const s = JSON.parse(t);
        if (!s || !Array.isArray(s.options) || !s.scenarioSettings) throw new Error('Missing options or scenario settings.');
        state = migrate(s); openOption = 0; touched = true; render(); say('Plan imported.');
      } catch (err) { say('Could not import that file: ' + err.message); }
    });
  }
  function importCsv(f) {
    const map = { named_high_intent: 'namedHighIntent', definitely_at_price: 'surveyDefinitelyAtPrice', probably_at_price: 'surveyProbablyAtPrice', paid_registrations: 'paidRegistrations' };
    readFile(f, (t) => {
      const errs = []; let n = 0;
      t.split(/\r?\n/).slice(1).forEach((line, k) => {
        if (!line.trim()) return;
        const [metric, optionId, value] = line.split(',').map((x) => x.trim());
        const v = Number(value);
        if (!Number.isFinite(v) || v < 0) { errs.push(`row ${k + 2}: bad value`); return; }
        if (metric === 'survey_responses') { state.evidence.surveyResponses = Math.floor(v); n++; }
        else if (map[metric]) {
          if (!state.options.some((o) => o.id === optionId)) { errs.push(`row ${k + 2}: unknown option_id "${optionId}"`); return; }
          state.evidence[map[metric]] = state.evidence[map[metric]] || {};
          state.evidence[map[metric]][optionId] = Math.floor(v); n++;
        } else errs.push(`row ${k + 2}: unknown metric "${metric}"`);
      });
      render();
      say(`Imported ${n} values.` + (errs.length ? ' Skipped: ' + errs.join('; ') : ''));
    });
  }

  // chart hover: nearest feasible count
  function onMove(e) {
    const fig = e.target.closest && e.target.closest('figure.chart');
    document.querySelectorAll('figure.chart').forEach((f) => { if (f !== fig) { f.querySelector('.tip').hidden = true; f.querySelector('.xh').setAttribute('visibility', 'hidden'); } });
    if (!fig) return;
    const svg = fig.querySelector('svg'), rect = svg.getBoundingClientRect();
    const W = +fig.dataset.w, L = +fig.dataset.l, R = +fig.dataset.r, xMax = +fig.dataset.xmax;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const curve = JSON.parse(fig.dataset.curve);
    const target = ((vx - L) / (W - L - R)) * xMax;
    let best = curve[0];
    for (const p of curve) if (Math.abs(p.participants - target) < Math.abs(best.participants - target)) best = p;
    const px = L + (best.participants / xMax) * (W - L - R);
    const xh = fig.querySelector('.xh'); xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
    const tip = fig.querySelector('.tip');
    tip.hidden = false;
    tip.innerHTML = `<b>${best.participants}</b> ${esc(fig.dataset.unit || 'people')}<br>net <b>${money(best.net)}</b>`;
    const left = (px / W) * rect.width;
    tip.style.left = Math.min(Math.max(left - 60, 0), rect.width - 130) + 'px';
  }

  document.addEventListener('change', onChange);
  // Enable "Copy survey text" as soon as the last snapshot box is typed in, without waiting for a blur.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.path || !t.dataset.path.startsWith('snapshot.')) return;
    setPath(state, t.dataset.path, t.value); touched = true; persist();
    const btn = document.querySelector('[data-action="copy-survey"]'); if (btn) btn.disabled = !snapshotReady();
  });
  document.addEventListener('click', onClick);
  document.addEventListener('pointermove', onMove);
  window.addEventListener('hashchange', () => { readHash(); render(true); window.scrollTo(0, 0); });
  readHash();
  render();
})();
