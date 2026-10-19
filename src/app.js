/* Booster Fundraiser Planner — UI. All math lives in engine.js; this file only renders and edits state. */
(function () {
  'use strict';
  const E = window.BFEngine;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const SAVE_KEY = 'bfp-plan-v1';
  let state = clone(window.BFDemo.DEMO_STATE);
  let touched = false; // only save once the person has actually started a plan
  try { const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (saved && Array.isArray(saved.options) && saved.scenarioSettings) { state = saved; touched = true; } } catch (e) { /* storage unavailable: start from demo */ }
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
  const sel = (path, label, options) => {
    const v = getPath(state, path) || '';
    return `<label class="f"><span>${label}</span><select data-path="${path}">${options.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  };

  // ---------- inputs ----------
  function costRows(i, key, withUpfront) {
    const rows = state.options[i][key];
    return `<div class="table-wrap"><table class="edit"><thead><tr><th>Label</th><th>Amount $</th>${withUpfront ? '<th>Paid before event?</th><th class="muted">ID (for in-kind)</th>' : ''}<th></th></tr></thead><tbody>
      ${rows.map((r, j) => `<tr>
        <td><input type="text" data-path="options.${i}.${key}.${j}.label" value="${esc(r.label)}"></td>
        <td><input type="number" inputmode="decimal" step="any" min="0" data-path="options.${i}.${key}.${j}.amount" data-type="number" value="${esc(r.amount)}"></td>
        ${withUpfront ? `<td class="c"><input type="checkbox" data-path="options.${i}.${key}.${j}.paidUpfront" data-type="bool" ${r.paidUpfront ? 'checked' : ''}></td><td><code>${esc(r.id)}</code></td>` : ''}
        <td><button class="link" data-action="del-row" data-i="${i}" data-key="${key}" data-j="${j}" aria-label="Remove">✕</button></td></tr>`).join('')}
      </tbody></table></div><button class="small" data-action="add-row" data-i="${i}" data-key="${key}">+ Add line</button>`;
  }

  const COURSE_QUESTIONS = [
    'What is the per-player rate, and exactly what does it include (cart, range balls, food, tax, gratuity/service charge)?',
    'Is there a minimum number of paid players, or a minimum total spend? Is that minimum binding if we fall short?',
    'For a shotgun start: what is the minimum, the buyout fee, and how many players fit (holes × group size)?',
    'For regular tee times: how many consecutive tee times can we hold, and when must unfilled times be released?',
    'Deposit: amount, due date, is it credited toward the final bill, and is it refundable — until what date?',
    'Cancellation and weather policy: what do we owe if we cancel, and by when must we decide?',
    'When is the final headcount due, and when is final payment due?',
    'Are food and beverage minimums separate from golf fees?',
    'Can we bring our own prizes, sponsors\' signage, and raffle? Any fees or restrictions?',
    'Does the course require event insurance or a certificate of insurance from us?',
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
        ${sel(`options.${i}.kind`, 'Format', [['golf_tee_times', 'Golf: regular tee times'], ['golf_shotgun', 'Golf: shotgun start'], ['generic', 'Other kind of event']])}
        <div class="optrow-actions"><button class="small" data-action="dup-option" data-i="${i}">Duplicate</button>
        ${state.options.length > 1 ? `<button class="small danger" data-action="del-option" data-i="${i}">Remove</button>` : ''}</div>
      </div>`).join('')}</div>
      <button class="small" data-action="add-option">+ Add another option</button>`;
  }

  function stepQuote() {
    const i = cur(), p = `options.${i}`, o = state.options[i];
    const golf = o.kind !== 'generic';
    return `${optionTabs('Fill this in for each option.')}
      <div class="fields">
        ${num(p + '.venueQuote.perParticipant', golf ? 'Course charge per player ($)' : 'Venue charge per person ($)')}
        ${num(p + '.venueQuote.minimumParticipants', golf ? 'Minimum players you must pay for (0 if none)' : 'Minimum people you must pay for (0 if none)', { step: 1 })}
        ${num(p + '.venueQuote.flatFee', 'Flat fee or buyout ($, 0 if none)')}
        ${num(p + '.venueQuote.minimumSpend', 'Minimum total spend ($, 0 if none)')}
        ${num(p + '.capacity', golf ? 'Most players the course can take' : 'Most people the venue can hold', { step: 1 })}
        ${num(p + '.groupSize', golf ? 'Players per group' : 'Group size (1 if people sign up individually)', { step: 1 })}
      </div>
      <div class="checks">${chk(p + '.wholeGroupsOnly', golf ? 'Players must fill whole groups (e.g., foursomes)' : 'Only whole groups can register')}</div>
      <h3 class="sub">Deposit</h3>
      <div class="fields">${num(p + '.deposit.amount', 'Deposit amount ($)')}</div>
      <div class="checks">${chk(p + '.deposit.creditedTowardBill', 'The deposit counts toward the final bill')}${chk(p + '.deposit.refundable', 'The deposit is refundable')}</div>
      <div class="callout ${o.quoteVerified ? 'ok' : ''}">${chk(p + '.quoteVerified', 'I have this quote in writing')}<span>Until this is checked, the result will say “Not enough evidence to decide yet.”</span></div>
      <details class="qs"><summary>Questions to ask the ${golf ? 'course' : 'venue'} before signing</summary><ul class="plain">${COURSE_QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></details>`;
  }

  function stepPrices() {
    const i = cur(), p = `options.${i}`, o = state.options[i];
    const four = o.wholeGroupsOnly && Number(o.groupSize) === 4;
    return `${optionTabs()}
      <div class="fields">
        ${num(p + '.price', 'Price per person ($)')}
        ${four ? num(p + '.foursomePrice', 'Price for a full foursome ($, blank = 4 × the single price)', { placeholder: String((Number(o.price) || 0) * 4) }) : ''}
        ${four ? pct(p + '.foursomeShare', 'Your guess: what % of players will sign up as foursomes?') : ''}
      </div>
      <p class="hint">These exact prices go into the supporter survey, so a “Yes” always means yes at this price.</p>`;
  }

  function stepCosts() {
    const i = cur(), p = `options.${i}`;
    return `${optionTabs()}
      <h3 class="sub">Costs for each person who comes <span class="muted">(meals, gifts, carts not in the quote)</span></h3>
      ${costRows(i, 'perParticipantCosts', false)}
      <h3 class="sub">One-time costs <span class="muted">(prizes, signs, printing, insurance)</span></h3>
      ${costRows(i, 'fixedCosts', true)}
      <div class="callout ${state.options[i].costsVerified ? 'ok' : ''}">${chk(p + '.costsVerified', 'These costs are real quotes, not guesses')}</div>`;
  }

  function stepScenarios() {
    const i = cur(), p = `options.${i}`, o = state.options[i];
    const ss = state.scenarioSettings;
    const statusBoxes = (k) => E.SPONSOR_STATUSES.map((st) =>
      `<label class="chk"><input type="checkbox" data-scenario-status="${k}" value="${st}" ${ss[k].statuses.includes(st) ? 'checked' : ''}> ${st}</label>`).join('');
    return `${optionTabs()}
      ${anchors(o)}
      <div class="row-actions"><button class="small" data-action="fill-evidence" data-i="${i}">Use my survey numbers for low and likely</button></div>
      <div class="scen">
        ${SC.map((k) => `<div class="scen-col"><b>${esc(ss[k].label)}</b><span class="hint">${{ conservative: 'If turnout disappoints. Start with paid sign-ups only.', middle: 'What your evidence supports: paid + named “yes”.', optimistic: 'If outreach goes well. Stay at or under capacity.' }[k]}</span>
          ${num(`${p}.scenarioParticipants.${k}`, 'People who pay', { step: 1 })}</div>`).join('')}
      </div>
      <details class="qs"><summary>Adjust assumptions (sponsors counted, raffle income, cost cushion)</summary>
        <div class="table-wrap"><table class="edit">
          <thead><tr><th></th><th>Sponsors counted</th><th>Extra income per person ($)<br><span class="muted">raffle, mulligans</span></th><th>Other income ($)</th><th>Cost cushion %<br><span class="muted">not on the venue quote</span></th></tr></thead>
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
    const costIds = [...new Set(state.options.flatMap((o) => o.fixedCosts.map((l) => l.id)))];
    const optSel = (j, v) => `<select data-path="sponsorships.${j}.optionId"><option value="">All options</option>${state.options.map((o) => `<option value="${esc(o.id)}" ${o.id === v ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    return `<div class="table-wrap"><table class="edit">
      <thead><tr><th>Sponsor / donation</th><th>Value $</th><th>Status</th><th>Type</th><th>In-kind replaces cost ID</th><th>Applies to</th><th></th></tr></thead>
      <tbody>${state.sponsorships.map((s, j) => `<tr>
        <td><input type="text" data-path="sponsorships.${j}.label" value="${esc(s.label)}"></td>
        <td><input type="number" inputmode="decimal" step="any" min="0" data-path="sponsorships.${j}.amount" data-type="number" value="${esc(s.amount)}"></td>
        <td><select data-path="sponsorships.${j}.status">${[['collected', 'Collected (cash in hand)'], ['committed', 'Committed (in writing)'], ['hoped', 'Hoped-for / asked']].map(([v, l]) => `<option value="${v}" ${s.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><select data-path="sponsorships.${j}.type"><option value="cash" ${s.type === 'cash' ? 'selected' : ''}>Cash</option><option value="inKind" ${s.type === 'inKind' ? 'selected' : ''}>In-kind</option></select></td>
        <td>${s.type === 'inKind' ? `<select data-path="sponsorships.${j}.replacesCostId"><option value="">— replaces no budgeted cost —</option>${costIds.map((id) => `<option value="${esc(id)}" ${s.replacesCostId === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select>` : '<span class="muted">n/a</span>'}</td>
        <td>${optSel(j, s.optionId)}</td>
        <td><button class="link" data-action="del-sponsor" data-j="${j}" aria-label="Remove">✕</button></td></tr>`).join('')}</tbody>
    </table></div><button class="small" data-action="add-sponsor">+ Add sponsor / donation</button>
    <p class="note">In-kind donations are never counted as cash. They only reduce a fixed cost they genuinely replace, up to that cost's amount.</p>`;
  }

  let surveyOpen = false;
  const SNAP_KEYS = ['format', 'dateWindow', 'locationArea', 'included', 'beneficiary'];
  const snapshotReady = () => SNAP_KEYS.every((k) => String((state.snapshot || {})[k] || '').trim());
  function surveyText() {
    const s = state.snapshot || {};
    const f = (k, ph) => String(s[k] || '').trim() || `[${ph}]`;
    // One price per option, taken from Step 1, so every "Yes" maps 1:1 to the price the planner evaluates.
    const opts = state.options.slice(0, 3);
    const letters = 'abc';
    const fourOf = (o) => (o.foursomePrice == null || o.foursomePrice === '' ? (Number(o.price) * 4 || '[team price]') : (Number(o.foursomePrice) || '[team price]'));
    const fb = String(s.fallbackPrice || '').trim().replace(/^\$/, '');
    const priceQs = opts.map((o, k) => `Q4${letters[k]}. ${o.name}: if registration were $${Number(o.price) || '[price]'} per player${o.wholeGroupsOnly && Number(o.groupSize) === 4 ? ` (or $${fourOf(o)} for a 4-player team)` : ''}, would you register?
   ( ) Yes — count me in at this price
   ( ) Maybe — I'm interested, but it depends on my schedule
   ( ) No — that price is too high for me
   ( ) No — I wouldn't play regardless of price`).join('\n\n') + (fb ? `

Q4${letters[opts.length] || 'x'}. ONLY if you answered "No — that price is too high" above: would you register for a lower-cost version at about $${fb} per player?
   ( ) Yes  ( ) Maybe  ( ) No` : '');
    return `DRAFT — review and edit before sending. Anonymous unless the respondent chooses to answer Q8.
Adults only: do not send to students or minors, and do not ask about them.

THE EVENT WE ARE CONSIDERING
Format: ${f('format', 'format')}
When: ${f('dateWindow', 'date window')}
Where: ${f('locationArea', 'location area')}
Included: ${f('included', 'what is included')}
Supports: ${f('beneficiary', 'what the money supports')}
Answering does not commit you to anything.

Q1. How are you connected to our program? (choose all)
   Current parent/guardian · Alumni or alumni parent · Extended family · Coach/staff · Local business/community supporter · Other

Q2. Which best describes you?
   ( ) I play golf regularly and would want to play
   ( ) I rarely golf / beginner, but would play a casual scramble
   ( ) I don't want to golf, but might attend a meal/social or support another way  -> skip to Q6
   ( ) Not interested  -> skip to Q6

Q3. If you played, how would you most likely sign up?
   ( ) Organize a full foursome  ( ) As a pair  ( ) As a single  ( ) Not sure

${priceQs}

Q5. Which times could work? (choose all)  [edit to your real options]
   Friday morning · Friday afternoon · Saturday morning · Sunday afternoon · None of these

Q6. What would most get in the way? (choose up to 2)
   Price · Time commitment · Family/sports schedule conflicts · Work conflict · Not comfortable golfing / no clubs · Prefer to donate directly · Nothing major

Q7. Would you consider supporting in another way? (choose all)
   A business I'm connected to might sponsor · Donate a raffle/auction item · Volunteer · Make a direct donation · Not right now

Q8. OPTIONAL — If you'd like early registration or sponsorship information, leave a name and one contact method.
   This is voluntary and will only be used to follow up about this event.

---
Organizer notes (do not send):
- Named high-intent leads (Step 2) = players from respondents who answered "Yes" to that option's Q4 AND completed Q8.
  Count a foursome captain as 4 players only if they confirmed they can fill the team; otherwise count 1.
- "Yes" without Q8 = anonymous "definitely". "Maybe" = "probably". Count each person once per option.
- Edit the option names and descriptions above into plain language before sending.
Report raw counts, never percentages extrapolated to a whole school or community. Survey intent usually overstates real sign-ups.`;
  }

  function stepSurvey() {
    return `<div class="fields">
        ${txt('snapshot.format', 'Event format, in plain words', 'wide')}
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
        <li>Count <b>players</b>. A foursome captain counts as 4 only if they confirmed their team.</li>
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
    const W = 560, H = 200, L = 64, R = 12, T = 12, B = 30;
    const xs = curve.map((p) => p.participants), ys = curve.map((p) => p.net).concat([0, target || 0]);
    const xMax = Math.max(1, ...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
    const yPad = (yMax - yMin) * 0.08 || 100;
    const y0 = yMin - yPad, y1 = yMax + yPad;
    const X = (v) => L + (v / xMax) * (W - L - R);
    const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const path = curve.map((p, k) => `${k ? 'L' : 'M'}${X(p.participants).toFixed(1)},${Y(p.net).toFixed(1)}`).join('');
    const ticks = [y0 + yPad, 0, y1 - yPad].filter((v, k, a) => a.indexOf(v) === k);
    const data = esc(JSON.stringify(curve));
    return `<figure class="chart" data-curve="${data}" data-l="${L}" data-r="${R}" data-w="${W}" data-xmax="${xMax}">
      <figcaption>Net proceeds at every feasible participant count (firm sponsorship only)</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net proceeds by participant count for ${esc(o.name)}">
        ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="${t === 0 ? 'zero' : 'grid'}"/><text x="${L - 6}" y="${Y(t) + 4}" class="ax" text-anchor="end">${money(Math.round(t))}</text>`).join('')}
        ${target ? `<line x1="${L}" x2="${W - R}" y1="${Y(target)}" y2="${Y(target)}" class="target"/><text x="${W - R}" y="${Y(target) - 4}" class="ax" text-anchor="end">target ${money(target)}</text>` : ''}
        <path d="${path}" class="line"/>
        ${marks.map((m) => `<circle cx="${X(m.n)}" cy="${Y(m.net)}" r="4.5" class="mk"/><text x="${X(m.n)}" y="${Y(m.net) - 9}" class="ax" text-anchor="middle">${esc(m.label)}</text>`).join('')}
        <text x="${L}" y="${H - 8}" class="ax">0</text><text x="${W - R}" y="${H - 8}" class="ax" text-anchor="end">${xMax} participants</text>
        <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      </svg><div class="tip" hidden></div></figure>`;
  }

  function statusClass(s) {
    return { not_enough_evidence: 'st-unknown', not_viable_as_configured: 'st-bad', high_risk: 'st-warn', supported_by_current_evidence: 'st-ok' }[s];
  }
  function statusIcon(s) { return { not_enough_evidence: '?', not_viable_as_configured: '✕', high_risk: '!', supported_by_current_evidence: '✓' }[s]; }

  function analyse(o) {
    const proj = {};
    SC.forEach((k) => { proj[k] = E.project(o, (o.scenarioParticipants || {})[k], E.scenarioContext(state, o, k)); });
    const firmCtx = { ...E.scenarioContext(state, o, 'middle'), statuses: ['collected', 'committed'] };
    const dec = E.decide(state, o);
    return { proj, dec, curve: E.netCurve(o, firmCtx), sens: E.sensitivity(o, (o.scenarioParticipants || {}).middle, E.scenarioContext(state, o, 'middle')) };
  }

  function renderComparison(all) {
    const target = Number(state.settings.fundraisingTarget) || 0;
    return `<div class="table-wrap"><table class="res">
      <thead><tr><th>Option</th><th>Status</th><th>Break-even<br><span class="muted">firm sponsorship</span></th><th>Needed for ${money(target)}</th><th>Feasible capacity</th><th>Conservative net</th><th>Middle net</th><th>Optimistic net</th><th>Upfront cash</th><th>Volunteer hrs</th></tr></thead>
      <tbody>${state.options.map((o, i) => { const a = all[i]; const be = a.dec.breakEven, tg = a.dec.targetNeeded; return `<tr>
        <td><b>${esc(o.name)}</b></td>
        <td><span class="badge ${statusClass(a.dec.status)}"><i>${statusIcon(a.dec.status)}</i>${esc(E.STATUS_LABELS[a.dec.status])}</span></td>
        <td>${be.reachableWithinCapacity ? be.participants : '<b class="neg">Not within capacity</b>'}</td>
        <td>${target ? (tg.reachableWithinCapacity ? tg.participants : '<b class="neg">Exceeds capacity</b>') : '—'}</td>
        <td>${be.maxFeasible}</td>
        ${SC.map((k) => `<td class="${a.proj[k].net < 0 ? 'neg' : ''}">${money(a.proj[k].net)}</td>`).join('')}
        <td>${money(a.proj.middle.upfront.required)}</td><td>${a.proj.middle.volunteerHours}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function renderDetail(o, a) {
    const P = a.proj;
    const vhv = state.settings.volunteerHourValue;
    const row = (label, f, cls = '') => `<tr class="${cls}"><th>${label}</th>${SC.map((k) => `<td>${f(P[k], k)}</td>`).join('')}</tr>`;
    const flags = (p) => p.flags.length ? ` <span class="flag">${p.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}</span>` : '';
    const ss = state.scenarioSettings;
    const marks = SC.map((k) => ({ n: P[k].participants, label: ss[k].label[0], net: E.project(o, P[k].participants, { ...E.scenarioContext(state, o, 'middle'), statuses: ['collected', 'committed'] }).net }));
    const ik = [...new Map(SC.flatMap((k) => P[k].inKind.applied.concat(P[k].inKind.notCounted.filter((n) => n.reason !== 'status_not_counted_in_this_scenario'))).map((x) => [x.id, x])).values()];
    return `<details class="detail" ${state.options.indexOf(o) === 0 ? 'open' : ''}><summary>${esc(o.name)} — scenario detail</summary>
      <div class="table-wrap"><table class="res sc">
        <thead><tr><th></th>${SC.map((k) => `<th>${esc(ss[k].label)}<br><span class="muted">sponsors: ${ss[k].statuses.join(' + ') || 'none'}</span></th>`).join('')}</tr></thead>
        <tbody>
          ${row('Participants', (p) => `${p.participants}${flags(p)}`)}
          ${row('Registration revenue', (p) => money(p.revenue.registration) + (p.revenue.foursomes ? ` <span class="muted">${p.revenue.foursomes} foursomes + ${p.revenue.singles} singles</span>` : ''))}
          ${row('Add-on revenue', (p) => money(p.revenue.extras + p.revenue.other))}
          ${row('Sponsorship cash counted', (p) => money(p.revenue.sponsorshipCash))}
          ${row('Total revenue', (p) => money(p.revenue.total), 'sum')}
          ${row('Venue / course', (p) => money(p.expenses.venue) + (p.expenses.venueMinimumApplied ? ` <span class="flag">minimum applies (billed ${p.expenses.venueBilledParticipants})</span>` : ''))}
          ${row('Other per-participant costs', (p) => money(p.expenses.perParticipant))}
          ${row('Fixed costs (after qualifying in-kind)', (p) => money(p.expenses.fixed))}
          ${row('Separate (non-credited) deposit fee', (p) => money(p.expenses.separateDepositFee))}
          ${row('Contingency on estimated costs', (p) => money(p.expenses.contingency))}
          ${row('Total expenses', (p) => money(p.expenses.total), 'sum')}
          ${row('<b>Projected net proceeds</b>', (p) => `<b class="${p.net < 0 ? 'neg' : ''}">${money(p.net)}</b>`, 'net')}
          ${row('Cash needed before the event', (p) => money(p.upfront.required))}
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

  function renderSummary(all) {
    return state.options.map((o, i) => {
      const a = all[i], d = a.dec, P = a.proj;
      const top = a.sens.results[0];
      const lines = [];
      lines.push(...d.reasons);
      if (d.breakEven.reachableWithinCapacity && d.breakEven.participants === 0) lines.push('Collected and committed sponsorship alone would cover costs even with zero participants — confirm sponsors still pay if the event is small or canceled.');
      else if (d.breakEven.reachableWithinCapacity) lines.push(`With only collected and committed sponsorship, you need ${d.breakEven.participants} paying participants to cover costs (feasible capacity ${d.breakEven.maxFeasible}).`);
      lines.push(`If attendance comes in at the conservative ${P.conservative.participants}, projected net is ${hm(P.conservative.net)}; at the middle ${P.middle.participants}, ${hm(P.middle.net)}.`);
      if (d.worst.contractualFloor > 0) lines.push(`The venue contract alone commits you to about ${hm(d.worst.contractualFloor)} even if attendance collapses.`);
      if (top) lines.push(`The single assumption that moves the middle case most: “${top.label}” (${top.change >= 0 ? '+' : ''}${money(top.change)}).`);
      if (P.middle.upfront.gap > 0) lines.push(`You would need ${money(P.middle.upfront.gap)} more cash than you have in hand before the event.`);
      if (P.middle.sponsorshipByStatus.hoped > 0) lines.push(`${money(P.middle.sponsorshipByStatus.hoped)} of sponsorship is only hoped-for and is excluded from break-even.`);
      lines.push(`Evidence so far: ${d.paid} paid registrations; ${d.named} named high-intent leads; ${d.definitely} anonymous “definitely”; ${d.responses} total responses. Stated interest is not a registration.`);
      const vh = P.middle.volunteerHours;
      const beGap = d.breakEven.reachableWithinCapacity ? Math.max(0, d.breakEven.participants - d.paid - d.named) : 0;
      const perHour = vh ? P.middle.net / vh : null;
      return `<div class="sum"><h4><span class="badge ${statusClass(d.status)}"><i>${statusIcon(d.status)}</i>${esc(E.STATUS_LABELS[d.status])}</span> ${esc(o.name)}</h4>
        <div class="cards">
          <div class="card ${beGap > 0 || !d.breakEven.reachableWithinCapacity ? 'bad' : ''}"><span>Break-even vs. evidence</span><b>${d.breakEven.reachableWithinCapacity ? d.breakEven.participants : '—'} needed · ${d.paid + d.named} in hand</b><em>players needed (firm sponsorship) vs. paid + named high-intent</em></div>
          <div class="card"><span>Cash needed before event day</span><b>${hm(P.middle.upfront.required)}</b><em>deposit + costs paid in advance; gap vs. cash in hand ${hm(P.middle.upfront.gap)}</em></div>
          <div class="card"><span>Course contract floor</span><b>${hm(d.worst.contractualFloor)}</b><em>the least the venue bills even if turnout is low (minimums, non-refundable deposit)</em></div>
          <div class="card ${d.worst.netIfNobodyRegisters < 0 ? 'bad' : ''}"><span>Net if nobody registers</span><b>${hm(d.worst.netIfNobodyRegisters)}</b><em>= collected sponsorship − contract floor − fixed costs</em></div>
          <div class="card"><span>Middle-case net</span><b>${hm(P.middle.net)}</b><em>conservative ${hm(P.conservative.net)}</em></div>
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
      const firm = P.middle.sponsorshipByStatus.collected + P.middle.sponsorshipByStatus.committed;
      const have = d.paid + d.named;
      L.push('', `> **Read-aloud (30 seconds):** ` + (d.breakEven.reachableWithinCapacity
        ? `With ${money(firm)} in collected and committed sponsorship, we need ${d.breakEven.participants} paying participants to break even. Right now we have ${have} (paid registrations plus named survey leads)${d.breakEven.participants > have ? `, a gap of ${d.breakEven.participants - have}` : ', which covers break-even'}. If nobody registers, we would be at about ${money(E.roundHeadline(d.worst.netIfNobodyRegisters))}.`
        : `Even at full capacity of ${d.breakEven.maxFeasible}, this option loses money on firm sponsorship as currently priced, so it should not go ahead as configured.`), '');
      d.reasons.forEach((r) => L.push(`- ${r}`));
      L.push(`- Break-even (firm sponsorship only): ${d.breakEven.reachableWithinCapacity ? d.breakEven.participants + ' participants' : 'not reachable within capacity'} of ${d.breakEven.maxFeasible} feasible.`);
      L.push(`- Net: conservative ${hm(P.conservative.net)} (${P.conservative.participants}), middle ${hm(P.middle.net)} (${P.middle.participants}), optimistic ${hm(P.optimistic.net)} (${P.optimistic.participants}).`);
      L.push(`- Cash needed before the event: ${hm(P.middle.upfront.required)}. Worst case if nobody registers: ${hm(d.worst.netIfNobodyRegisters)}. Volunteer hours: ${P.middle.volunteerHours}.`);
      L.push(`- Evidence: ${d.paid} paid, ${d.named} named high-intent, ${d.definitely} anonymous "definitely", ${d.responses} responses.`);
      if (d.missing.length) { L.push('- Must verify before signing:'); d.missing.forEach((m) => L.push(`  - ${m}`)); }
    }
    L.push('', '_Planning estimates only. No guarantee of results; no tax or legal determinations._');
    return L.join('\n');
  }

  // ---------- views ----------
  const STEPS = [
    { id: 'event', title: 'What are you planning?', help: 'Start with a name and a goal. You can change anything later.', body: stepEvent },
    { id: 'options', title: 'Which options are you comparing?', help: 'For golf, that\'s usually regular tee times against a shotgun start. You can also compare golf with a different kind of event.', body: stepOptions },
    { id: 'quote', title: 'What will the venue charge?', help: 'Copy these numbers from the written quote. Minimums matter most: they are what you owe even if few people come.', body: stepQuote },
    { id: 'prices', title: 'What will you charge?', help: 'Pick the price you would actually put on the sign-up form.', body: stepPrices },
    { id: 'costs', title: 'What else will it cost?', help: 'Anything not already in the venue quote.', body: stepCosts },
    { id: 'sponsors', title: 'Who is sponsoring?', help: 'Only money that is collected or promised in writing counts toward break-even. Hoped-for sponsors are shown, but never relied on.', body: () => renderSponsors() },
    { id: 'survey', title: 'Ask your supporters', help: 'A short anonymous survey tells you who would actually play, in which format, at your price.', body: stepSurvey },
    { id: 'evidence', title: 'What did supporters say?', help: 'Type in the totals from your survey and any paid sign-ups so far.', body: stepEvidence },
    { id: 'scenarios', title: 'Plan for low, likely and high turnout', help: 'These are your numbers, not predictions. The survey counts are shown beside them so you can stay honest.', body: stepScenarios },
    { id: 'volunteers', title: 'How much volunteer time will it take?', help: 'A profitable event can still be a bad trade if it burns out your volunteers.', body: stepVolunteers },
  ];
  let view = 'home', stepIdx = 0, savePanel = false;

  function readHash() {
    const h = (location.hash || '').slice(1);
    if (h === 'results') { view = 'results'; return; }
    const k = STEPS.findIndex((st) => 'step-' + st.id === h);
    if (k >= 0) { view = 'wizard'; stepIdx = k; return; }
    view = 'home';
  }
  function go(hash) { if (location.hash !== '#' + hash) location.hash = hash; else { readHash(); render(); } }

  function viewHome() {
    const hasSaved = hasSavedPlan();
    return `<section class="hero">
        <p class="eyebrow">For booster clubs, PTAs and other 501(c)(3)s</p>
        <h1>Know whether your fundraiser will pay off <em>before</em> you sign the contract.</h1>
        <p class="lede">Golf outings, galas and auctions can lock you into big minimums. This planner puts your real quotes next to real answers from your supporters, so the board sees the risk in plain numbers.</p>
        <div class="cta">
          ${hasSaved ? `<button class="btn" data-action="nav" data-to="step-event">Continue my plan</button>` : ''}
          <button class="btn ${hasSaved ? 'ghost' : ''}" data-action="start-demo">Try the golf example</button>
          <button class="btn ghost" data-action="start-blank">Start a new plan</button>
        </div>
        <p class="hint">Free. Nothing to install. Your plan stays in your own browser.</p>
      </section>
      <section class="how">
        <div><span class="num">1</span><h3>Enter your real quotes</h3><p>Course fees, player minimums, deposits, prizes. The planner works out what you owe even if turnout is low.</p></div>
        <div><span class="num">2</span><h3>Ask your supporters</h3><p>Get a ready-to-send survey with your exact prices. Enter the totals when answers come back.</p></div>
        <div><span class="num">3</span><h3>Get a clear answer</h3><p>See break-even, cash needed up front and worst case, plus a summary you can read to the board.</p></div>
      </section>
      <section class="honest">
        <h2>What it won't do</h2>
        <ul class="plain">
          <li>Guess who will come. Attendance comes from your supporters' answers and paid sign-ups, never from assumptions about people.</li>
          <li>Count “interested” as “registered”. Only paid sign-ups and named “yes” answers count toward break-even.</li>
          <li>Give tax or legal advice, or promise results.</li>
        </ul>
        <p>Until there's a written quote and real supporter answers, it will say <b>“Not enough evidence to decide yet.”</b> That's often the right answer.</p>
      </section>`;
  }

  function viewWizard() {
    const st = STEPS[stepIdx];
    const pct = Math.round(((stepIdx + 1) / STEPS.length) * 100);
    return `<div class="wiz">
      <nav class="steplist" aria-label="Steps"><ol>${STEPS.map((x, k) => `<li class="${k === stepIdx ? 'on' : ''} ${k < stepIdx ? 'done' : ''}"><a href="#step-${x.id}" ${k === stepIdx ? 'aria-current="step"' : ''}>${esc(x.title)}</a></li>`).join('')}
        <li class="res"><a href="#results">See results</a></li></ol></nav>
      <section class="panel stepcard">
        <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${stepIdx + 1}" aria-label="Step ${stepIdx + 1} of ${STEPS.length}"><span style="width:${pct}%"></span></div>
        <p class="eyebrow">Step ${stepIdx + 1} of ${STEPS.length}</p>
        <h2 id="step-title" tabindex="-1">${esc(st.title)}</h2>
        <p class="lede-s">${esc(st.help)}</p>
        <div class="stepbody">${st.body()}</div>
        <div class="stepnav">
          ${stepIdx > 0 ? `<a class="btn ghost" href="#step-${STEPS[stepIdx - 1].id}">← Back</a>` : '<a class="btn ghost" href="#home">← Home</a>'}
          ${stepIdx < STEPS.length - 1 ? `<a class="btn" href="#step-${STEPS[stepIdx + 1].id}">Next →</a>` : '<a class="btn" href="#results">See results →</a>'}
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
      return render();
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
    render();
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
    else if (a === 'start-demo') { if (hasSavedPlan() && !armed(b, 'This replaces your saved plan. Click again')) return; state = clone(window.BFDemo.DEMO_STATE); openOption = 0; touched = true; return go('step-event'); }
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
        state = s; openOption = 0; touched = true; render(); say('Plan imported.');
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
    tip.innerHTML = `<b>${best.participants}</b> participants<br>net <b>${money(best.net)}</b>`;
    const left = (px / W) * rect.width;
    tip.style.left = Math.min(Math.max(left - 60, 0), rect.width - 130) + 'px';
  }

  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);
  document.addEventListener('pointermove', onMove);
  window.addEventListener('hashchange', () => { readHash(); render(true); window.scrollTo(0, 0); });
  readHash();
  render();
})();
