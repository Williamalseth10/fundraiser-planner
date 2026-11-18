/* Booster Fundraiser Planner — UI. All math lives in engine.js; this file only renders and edits state. */
(function () {
  'use strict';
  const E = window.BFEngine;
  const A = window.BFAccuracy;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const SAVE_KEY = 'bfp-plan-v1';
  let state = clone(window.BFPlan.BLANK_STATE);
  let touched = false; // only save once the person has actually started a plan
  let startupNote = '';
  // Every storage write reports whether it worked. Keys in lockedKeys hold data that couldn't be set aside; never write over them.
  const lockedKeys = new Set();
  function storeWrite(key, value) { if (lockedKeys.has(key)) return false; try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function storeRead(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  // Use the saved plan only if it passes the same checks as an import; otherwise try the backup, then leave the starter empty.
  // Runs at the very end of this file, after EVENT_TYPES and validatePlan's other dependencies exist. (Until 2026-11 it ran
  // here, before they were defined, so every reload threw, showed the example, and the next edit overwrote the saved plan.)
  function loadSavedPlan() {
    let storage;
    try { storage = window.localStorage; storage.getItem(SAVE_KEY); } catch (e) { return; } // storage unavailable: offer a new plan
    for (const key of [SAVE_KEY, SAVE_KEY + '-backup']) {
      const raw = storage.getItem(key); if (!raw) continue;
      let saved = null, problems;
      try { saved = JSON.parse(raw); problems = validatePlan(saved); } catch (e) { problems = ['unreadable']; }
      if (!problems.length) {
        state = migrate(saved); touched = true; if (key === SAVE_KEY) lastWritten = raw; // loaded, not newly saved
        if (key !== SAVE_KEY) startupNote = 'Your saved plan could not be read, so your backup copy was loaded. ' + (lockedKeys.has(SAVE_KEY)
          ? 'The unreadable copy could not be set aside, so this browser will not save over it: changes are NOT saved here. Download a backup file to keep your work.'
          : 'The unreadable copy was kept aside, not deleted.');
        return;
      }
      // Keep an unreadable copy aside so nothing typed later can overwrite it. If that isn't possible (storage full, or an
      // older unreadable copy already there), lock the key instead: the app then refuses to write over it and says so.
      const aside = storage.getItem(key + '-unreadable');
      const keptAside = aside === raw || (!aside && storeWrite(key + '-unreadable', raw));
      if (!keptAside) lockedKeys.add(key);
      if (key === SAVE_KEY) startupNote = 'Your saved plan could not be read safely, so it was not loaded. ' + (keptAside
        ? 'It was kept aside in this browser, not deleted. If you have a backup file, open it under Save & backup.'
        : 'It could not be copied aside, so this browser will not save over it: changes you make now are NOT saved here. Download a backup file to keep new work.');
    }
  }
  function migrate(st) {
    st.evidence = st.evidence || {};
    st.evidence.paidCashReceived = st.evidence.paidCashReceived || {};
    if (st.isDemo) { // the made-up examples' answers are, by construction, for their own made-up terms
      st.evidence.offerTerms = st.evidence.offerTerms || {};
      (st.options || []).forEach((o) => { if (!st.evidence.offerTerms[o.id]) st.evidence.offerTerms[o.id] = E.offerTerms(o, st.snapshot); });
    }
    (st.options || []).forEach((o) => {
      if (o.groupPrice === undefined && o.foursomePrice !== undefined) { o.groupPrice = o.foursomePrice; delete o.foursomePrice; }
      if (o.groupShare === undefined && o.foursomeShare !== undefined) { o.groupShare = o.foursomeShare; delete o.foursomeShare; }
    });
    return st;
  }
  state = migrate(state);
  // Before an example, a blank plan or an opened file replaces the plan, keep the plan on screen as a backup (one level).
  // An example (isDemo) never overwrites a backup of a real plan; it may fill an empty backup or replace another example.
  //   'saved'         the plan on screen is now the backup
  //   'not-needed'    nothing of the person's own to keep (the untouched starting example, or any example)
  //   'kept-existing' an example on screen, a real plan already in the backup: the backup is left alone
  //   'failed'        a real plan could not be written to the backup: the caller must NOT replace anything
  const isDemoText = (raw) => { try { return !!JSON.parse(raw).isDemo; } catch (e) { return false; } };
  function secureBackup() {
    if (!touched) return 'not-needed';
    const existing = storeRead(SAVE_KEY + '-backup');
    if (state.isDemo && existing && !isDemoText(existing)) return 'kept-existing';
    if (!storeWrite(SAVE_KEY + '-backup', JSON.stringify(state))) return state.isDemo ? 'not-needed' : 'failed';
    storeWrite(SAVE_KEY + '-backup-at', new Date().toISOString()); // only the "kept at" time; the backup itself is safe
    return 'saved';
  }
  // Replace the plan on screen only once the current one is safely kept. Returns false (and changes nothing) otherwise.
  function replacePlan(next, doneMsg, claimAutosave) {
    const bk = secureBackup();
    if (bk === 'failed') {
      savePanel = true; render();
      say('Could not make a backup of your current plan (this browser refused to store it), so nothing was replaced. Your plan is still here and unchanged. Use Download backup file to keep a copy before trying again.');
      return false;
    }
    state = next; openOption = 0; touched = true; whatIf = freshWhatIf();
    const saved = persist();
    say(doneMsg
      + (bk === 'saved' ? ' Your previous plan was kept as a backup: Save & backup → Restore previous plan brings it back.' : '')
      + (saved ? (claimAutosave ? ' It saves in this browser as you go.' : '') : ' It is NOT saved in this browser yet: see the red warning.'));
    return true;
  }
  function backupInfo() {
    try {
      const raw = localStorage.getItem(SAVE_KEY + '-backup'); if (!raw) return null;
      const plan = JSON.parse(raw); if (validatePlan(plan).length) return null;
      return { plan, at: localStorage.getItem(SAVE_KEY + '-backup-at') || '' };
    } catch (e) { return null; }
  }
  // Save the plan on screen. Returns whether it worked; a failure shows a warning that stays until a save succeeds.
  function persist() {
    if (!touched) return true;
    const text = JSON.stringify(state);
    const ok = storeWrite(SAVE_KEY, text);
    if (ok && text !== lastWritten) { lastWritten = text; lastSavedAt = new Date(); }
    setSaveProblem(ok ? '' : lockedKeys.has(SAVE_KEY)
      ? 'Your changes are not saved in this browser, to protect an earlier saved plan that could not be read. Download a backup file to keep your work.'
      : 'Your latest changes are not saved: this browser refused to store them (its storage may be full or blocked). Download a backup file now so you don\'t lose them.');
    return ok;
  }
  // Shown in Save & backup. Only what this page actually knows: when its own write last succeeded, and that a download
  // was STARTED (the browser doesn't say whether the file was kept). Neither is stored.
  let lastWritten = null, lastSavedAt = null, downloadStartedAt = null;
  let saidAt = 0;
  function say(msg) { const el = document.getElementById('status'); if (el) { el.textContent = msg; el.hidden = !msg; saidAt = Date.now(); } }
  let saveProblem = ''; // non-empty while the plan on screen is not saved
  function setSaveProblem(msg) {
    if (msg && !saveProblem) { const st = document.getElementById('status'); if (st && /saves in this browser/.test(st.textContent)) say(''); } // don't leave a stale "it saves" claim
    saveProblem = msg; showSaveWarning();
  }
  function showSaveWarning() {
    const el = document.getElementById('save-warning'); if (!el) return;
    el.hidden = !saveProblem; const t = el.querySelector('[data-role="text"]'); if (t) t.textContent = saveProblem;
  }
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
  // Help text sits under the label and is announced with the field (aria-describedby).
  const helpId = (path) => 'help-' + path.replace(/[^A-Za-z0-9_-]/g, '-');
  const helpFor = (path, help) => help ? `<small class="help" id="${esc(helpId(path))}">${help}</small>` : '';
  const described = (path, help) => help ? ` aria-describedby="${esc(helpId(path))}"` : '';
  const num = (path, label, opts = {}) => {
    const v = getPath(state, path);
    return `<label class="f${opts.wide ? ' wide' : ''}"><span>${label}</span>${helpFor(path, opts.help)}<input type="number" inputmode="decimal" step="${opts.step || 'any'}" min="0" data-path="${path}" data-type="number" value="${v == null ? '' : esc(v)}"${described(path, opts.help)} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}></label>`;
  };
  const pct = (path, label, help) => {
    const v = getPath(state, path);
    return `<label class="f"><span>${label}</span>${helpFor(path, help)}<input type="number" inputmode="decimal" step="any" min="0" max="100" data-path="${path}" data-type="pct" value="${v == null ? '' : esc(Math.round(v * 1000) / 10)}"${described(path, help)}></label>`;
  };
  const txt = (path, label, cls = '') => `<label class="f ${cls}"><span>${label}</span><input type="text" data-path="${path}" value="${esc(getPath(state, path))}"></label>`;
  const chk = (path, label, help) => `<label class="chk"><input type="checkbox" data-path="${path}" data-type="bool" ${getPath(state, path) ? 'checked' : ''}${described(path, help)}> <span>${label}${helpFor(path, help)}</span></label>`;
  const selGrouped = (path, label, options) => {
    const v = getPath(state, path) || '';
    const groups = [...new Set(options.map((o) => o[2]))];
    return `<label class="f"><span>${label}</span><select data-path="${path}">${groups.map((g) => `<optgroup label="${esc(g)}">${options.filter((o) => o[2] === g).map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  };
  // Calendar dates: the YYYY-MM-DD text a date box gives, kept as text. Today is the LOCAL calendar date
  // (never toISOString(), which is UTC and shows tomorrow's date on a US evening).
  const pad2 = (n) => String(n).padStart(2, '0');
  const localYMD = (t = new Date()) => `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  const showDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }); };
  const dateIn = (path, label, help) => {
    const v = getPath(state, path);
    return `<label class="f"><span>${label}</span>${helpFor(path, help)}<input type="date" min="1900-01-01" max="2200-12-31" data-path="${path}" data-type="date" value="${E.isCalendarDate(v) ? esc(v) : ''}"${described(path, help)}></label>`;
  };
  const txtIn = (path, label, opts = {}) => `<label class="f${opts.wide ? ' wide' : ''}"><span>${label}</span><input type="text" maxlength="${opts.max || 300}" data-path="${path}" value="${esc(getPath(state, path))}"${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}></label>`;
  const area = (path, label, help) => `<label class="f wide"><span>${label}</span>${helpFor(path, help)}<textarea rows="3" maxlength="1000" data-path="${path}"${described(path, help)}>${esc(getPath(state, path))}</textarea></label>`;
  const sel = (path, label, options) => {
    const v = getPath(state, path) || '';
    return `<label class="f"><span>${label}</span><select data-path="${path}">${options.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  };

  function depositAnswer(path, label) {
    const value = getPath(state, path);
    const selected = typeof value === 'boolean' ? String(value) : '';
    return `<label class="f"><span>${label}</span><select data-path="${path}" data-type="optionalBool">${[['', 'Not confirmed'], ['true', 'Yes'], ['false', 'No']].map(([key, text]) => `<option value="${key}"${selected === key ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
  }

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
  const attendanceUnit = (t) => t.survey === 'buy' ? 'items sold' : t.proceeds ? 'guests' : `paying ${t.many}`;
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
    const ev = state.evidence, n = (m) => Math.max(0, Math.floor(Number((ev[m] || {})[o.id]) || 0));
    const paid = n('paidRegistrations'), def = n('surveyDefinitelyAtPrice'), prob = n('surveyProbablyAtPrice');
    const d = E.decide(state, o), named = d.namedCounted, raw = n('namedHighIntent');
    return `<p class="anchors"><b>Your evidence so far</b> (running totals, not forecasts):
      paid <b>${paid}</b> · plus named “yes” for the current offer <b>${paid + named}</b> · plus anonymous “yes” <b>${paid + named + def}</b> · plus “maybe” <b>${paid + named + def + prob}</b> · capacity <b>${E.maxFeasible(o)}</b>${raw > named ? `<br><span class="flag">${raw - named} named “yes” answers aren't counted: they were for a different or unrecorded offer</span>` : ''}</p>`;
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

  function hasProductGrouping(o) {
    return o.kind === 'product' && (Number(o.groupSize) > 1 || Number(o.groupShare) > 0);
  }
  function useIndividualItems(o) {
    o.groupSize = 1; o.wholeGroupsOnly = false; o.groupPrice = null; o.groupShare = 0;
    o.quoteVerified = false;
  }

  function stepQuote() {
    const i = cur(), p = `options.${i}`, o = state.options[i], t = T(o);
    const product = t.survey === 'buy';
    return `${optionTabs('Fill this in for each option.')}
      ${hasProductGrouping(o) ? `<div class="warn-callout"><b>Check inherited group settings.</b> This product option still uses groups of ${esc(o.groupSize)} in its saved settings. That can round item counts down or apply group pricing. If you sell individual items, use the button below, then confirm the supplier quote again. <button class="small" data-action="individual-items" data-i="${i}">Use individual-item sales</button></div>` : ''}
      ${product ? '<p class="hint">If sellers collect orders and money <b>before</b> you order from the supplier, the items you must pay for is usually 0 (unless the supplier has a minimum). If you must buy stock up front, enter that quantity: you pay for it whether it sells or not.</p>' : ''}
      <div class="fields">
        ${num(p + '.venueQuote.perParticipant', product ? 'Supplier cost per item ($)' : `${cap(t.venue)} charge per ${t.one} ($)`, { help: product ? 'What you pay the supplier for each item, including tax and shipping. This is your cost, not your selling price.' : 'From the written quote. Include sales tax and any service charge or gratuity.' })}
        ${num(p + '.venueQuote.minimumParticipants', product ? 'Items you must pay for even if they don’t sell' : `Minimum ${t.many} you must pay for`, { step: 1, help: product ? 'The supplier’s minimum order, or stock you buy in advance. Enter 0 if sellers collect orders first.' : `Some contracts charge for a minimum number of ${t.many} even if fewer come. Enter 0 if there is none.` })}
        ${num(p + '.venueQuote.flatFee', product ? 'Flat fee from the supplier ($)' : 'Flat fee, rental or buyout ($)', { help: 'A fixed charge that stays the same however many come. Enter 0 if there is none.' })}
        ${num(p + '.venueQuote.minimumSpend', product ? 'Minimum order total ($)' : 'Minimum for the whole bill ($)', { help: product ? 'If the order must reach a dollar amount, enter it. Enter 0 if there is none.' : 'If the whole bill must reach a dollar amount, enter it. Enter 0 if there is none. A separate food-and-drink minimum on top of the per-person charge goes under one-time costs.' })}
        ${num(p + '.capacity', product ? 'Most items you could realistically get and sell' : `Most ${t.many} the ${t.venue} can take`, { step: 1, help: product ? 'The planner never counts more than this.' : 'The planner never counts more than this.' })}
        ${t.groupName ? num(p + '.groupSize', `${cap(t.groupName)} size`, { step: 1, help: `How many make up one ${t.groupName}. Enter 1 if ${t.many} sign up one at a time.` }) : ''}
      </div>
      ${t.groupName && Number(o.groupSize) > 1 ? `<div class="checks">${chk(p + '.wholeGroupsOnly', `${cap(t.many)} can only come as full ${t.groupName}s`)}</div>` : ''}
      <h3 class="sub">${product ? 'Deposit to the supplier' : 'Deposit'}</h3>
      <div class="fields">${num(p + '.deposit.amount', product ? 'Deposit paid before ordering ($)' : 'Deposit amount ($)', { help: 'Money you pay when you sign or order. Enter 0 if there is none.' })}</div>
      ${o.deposit.amount > 0 ? `<div class="fields">${depositAnswer(p + '.deposit.creditedTowardBill', 'Does the deposit count toward the final bill?')}${depositAnswer(p + '.deposit.refundable', 'Is the deposit refundable under this quote?')}</div>` : ''}
      <h3 class="sub">Cancellation</h3>
      <div class="fields">${num(p + '.cancellationOwed', product ? 'Owed to the supplier if you cancel after ordering ($)' : 'Owed if you cancel after the quote’s deadline ($)', { placeholder: 'not known yet', wide: true, help: `Copy this from the ${product ? 'supplier sheet' : 'quote'}, including any deposit you would lose. Enter 0 if you can cancel for free. Leave it blank if you don’t know yet: the results will list it as missing.` })}</div>
      <h3 class="sub">Dates and terms from the ${product ? 'supplier' : 'contract'}</h3>
      <p class="hint">Copy these from the written ${product ? 'supplier sheet' : 'quote or contract'}. Leave a box blank if you don’t know yet: it shows as <b>unknown</b> on the results. Dates are a checklist only: they never change the numbers, and the planner can’t remind you when it’s closed.</p>
      <div class="fields">
        ${dateIn(p + '.contract.quoteDate', 'Date of the quote')}
        ${dateIn(p + '.contract.quoteExpires', 'Quote expires (prices good until)')}
        ${dateIn(p + '.contract.depositDue', product ? 'Deposit or payment due' : 'Deposit due')}
        ${dateIn(p + '.contract.headcountDue', contractLabel(o, 'headcountDue'))}
        ${dateIn(p + '.contract.cancelBy', contractLabel(o, 'cancelBy'), 'The deadline itself. What you’d owe after it is the dollar amount above.')}
        ${txtIn(p + '.contract.quoteSource', 'Quote reference or source', { wide: true, max: 300, placeholder: 'e.g. “emailed quote from the course, Nov 3, quote #1182”' })}
      </div>
      <div class="fields">
        ${area(p + '.contract.cancellationNotes', 'Cancellation terms, in brief', 'Copy the wording. If the amount changes by date (for example, more owed within 30 days), the planner does not work that out: enter the amount for the date you care about above and read the tiers yourself.')}
        ${area(p + '.contract.weatherNotes', 'Weather or rescheduling terms, in brief', 'Rain dates, credits instead of refunds, who decides. The planner shows these notes but never reads meaning into them.')}
      </div>
      <div class="callout ${o.quoteVerified ? 'ok' : ''}">${chk(p + '.quoteVerified', 'I have this quote in writing')}<span>Until this is checked, the result will say “Not enough evidence to decide yet.” It unchecks itself if you change a quote number.</span></div>
      <div class="callout ${o.upfrontFundingConfirmed ? 'ok' : ''}">${chk(p + '.upfrontFundingConfirmed', 'The treasurer confirmed the club can cover money due before the event, even if sign-ups come in slowly')}<span>Only needed if the deposit and bills due in advance are more than the cash you have now.</span></div>
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
        ${num(p + '.price', t.survey === 'buy' ? 'Selling price per item ($)' : `Price per ${t.one} ($)`, { help: t.proceeds ? 'Enter 0 if admission is free.' : 'The price on the sign-up or order form.' })}
        ${group ? num(`${p}.${gp}`, `Price for a full ${t.groupName} of ${size} ($)`, { placeholder: String((Number(o.price) || 0) * size), help: `Leave blank if a ${t.groupName} pays ${size} × the single price.` }) : ''}
        ${group ? pct(`${p}.${gs}`, `What % of ${t.many} will buy as a full ${t.groupName}? (your guess)`, 'Used only to work out ticket money. It does not change how many come.') : ''}
      </div>
      <p class="hint">These exact prices go into the supporter survey, so a “Yes” always means yes at this price.</p>
      <p class="hint research-hint">Optional: note prices of similar events on the <a href="#research">Research page</a>. It never changes your price.</p>`;
  }

  function stepCosts() {
    const i = cur(), p = `options.${i}`, t = T(state.options[i]);
    return `${optionTabs()}
      <h3 class="sub">Costs for each ${t.one} <span class="muted">(${esc(t.perHint)})</span></h3>
      ${costRows(i, 'perParticipantCosts', false)}
      <h3 class="sub">One-time costs <span class="muted">(${esc(t.fixedHint)})</span></h3>
      ${costRows(i, 'fixedCosts', true)}
      ${t.proceeds ? '<p class="hint">Include items the club buys and flat auctioneer or software fees, even if nothing sells. A donated item adds no cash until someone buys it.</p>' : ''}
      <div class="callout ${state.options[i].costsVerified ? 'ok' : ''}">${chk(p + '.costsVerified', 'These costs are real quotes, not guesses')}</div>`;
  }

  const AUCTION_TITLE = 'How much does the auction need to bring in?';
  function auctionWorksheet(o) {
    const rows = E.auctionTargets(state, o);
    if (!rows.length) return null;
    const labels = { conservative: 'Low', middle: 'Likely', optimistic: 'High' };
    const fixes = {
      depositTerms: 'Confirm whether the deposit counts toward the final bill and whether it is refundable.',
      missingTurnout: 'Enter a guest count.',
      capacity: 'Enter a capacity that can fit at least one guest or full table.',
      missingPrice: 'Enter the admission price. Use 0 for free entry.',
      missingCost: 'Complete the amount for each listed cost. Use 0 for a free item.',
      missingQuote: 'Complete the venue quote and deposit amounts. Use 0 for terms that do not apply.',
      missingReceipts: 'Enter the actual ticket money received from guests who already paid.',
      cashWithoutPaid: 'Ticket receipts are recorded with no paid guests. Check both entries.',
    };
    const lines = rows.map((r) => {
      const label = labels[r.key];
      if (r.issue === 'belowPaid') return `${label} — ${r.guests} guests would be counted, below the ${r.paid} already paid. Check turnout and capacity.`;
      if (r.issue) return `${label} — ${fixes[r.issue]}`;
      const count = r.requested === r.guests ? `${r.guests} guests` : `${r.guests} guests (${r.requested} entered, adjusted for capacity or whole guests/tables)`;
      const target = r.reachGoal == null ? '' : `, ${money(r.reachGoal)} to hit the ${money(state.settings.fundraisingTarget)} goal`;
      const estimate = r.proceeds == null ? 'Bid estimate missing.' : `Your estimate is ${money(r.proceeds)}.`;
      return `${label} · ${count} — ${money(r.coverCosts)} needed to cover costs${target}. ${estimate}`;
    });
    const basis = 'Targets use ticket income at each guest count, collected or written sponsor commitments, and the low-case cost cushion. Other income and hoped-for sponsors are excluded.';
    const note = o.quoteVerified && o.costsVerified ? basis : basis + ' The quote or costs still need verification.';
    return { lines, note };
  }
  function auctionPanel(o) {
    const w = auctionWorksheet(o);
    if (!w) return '';
    return `<section class="auction-targets"><h4>${AUCTION_TITLE}</h4><ul class="plain">${w.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul><p class="hint">${esc(w.note)}</p></section>`;
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
          ${num(`${p}.scenarioParticipants.${k}`, t.survey === 'buy' ? 'Items sold' : t.proceeds ? 'Guests attending' : `Paying ${t.many}`, { step: 1 })}
          ${t.proceeds ? num(`${p}.scenarioProceeds.${k}`, 'Auction and raffle money you expect ($)') : ''}
          ${scenarioReasons(o, i, k)}</div>`).join('')}
      </div>
      ${shortcutsPanel(o, i)}
      ${t.proceeds ? '<p class="hint">Use past winning bids on similar lots and allow for unsold items. Enter proceeds after any selling fees you haven’t already included in Costs. Count each cost and each receipt once. Your estimate contributes to scenario totals only.</p>' : ''}
      ${auctionPanel(o)}
      <details class="qs"><summary>Adjust assumptions (sponsors counted, priced add-ons, cost cushion)</summary>
        <p class="hint">Add-ons and other income here are assumptions. They show up in the low, likely and high totals but never in break-even. If every ${esc(t.one)} must pay something, include it in the price instead.</p>
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
    const optSel = (j, v, nm) => `<select data-path="sponsorships.${j}.optionId" aria-label="Which option ${nm} applies to"><option value="">All options</option>${v && !state.options.some((o) => o.id === v) ? `<option value="${esc(v)}" selected>(option removed: counts for no option)</option>` : ''}${state.options.map((o) => `<option value="${esc(o.id)}" ${o.id === v ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
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
      ${state.options.length > 3 ? '<p class="hint">The survey asks about your first three options only. Remove or reorder options on step 2 if a different one matters more.</p>' : ''}
      <details class="qs" open><summary>Preview the survey</summary><pre id="survey" class="survey">${esc(surveyText())}</pre></details>`;
  }

  function termsText(t) {
    if (!t) return '';
    const parts = [`$${(t.price / 100).toLocaleString('en-US')} each`];
    if (t.groupPrice != null) parts.push(`$${(t.groupPrice / 100).toLocaleString('en-US')} per group of ${t.groupSize}`);
    if (t.date) parts.push(t.date);
    if (t.place) parts.push(t.place);
    return parts.join(' · ');
  }
  // Which offer were this option's survey answers about? Answers only count for the offer they were collected for.
  function termsNote(o, i) {
    const st = E.evidenceStatus(state, o);
    if (st.state === 'none') return '';
    if (st.state === 'current') return `<p class="callout ok" data-terms="${esc(o.id)}"><span><b>${esc(o.name)}:</b> answers are for ${esc(termsText(st.now))}.</span></p>`;
    const what = st.state === 'stale'
      ? `These answers were for ${esc(termsText(st.recorded))}. Since then the ${esc(st.changed.join(', '))} changed, so they no longer count toward the decision.`
      : 'These answers were entered without recording which price and details they were for, so they don\'t count toward the decision yet.';
    return `<div class="callout warn-callout" data-terms="${esc(o.id)}"><span><b>${esc(o.name)}:</b> ${what} Re-ask supporters about the current offer, then confirm.</span>
      <button class="small" data-action="confirm-terms" data-i="${i}">These answers are for the current offer: ${esc(termsText(E.offerTerms(o, state.snapshot)))}</button></div>`;
  }
  function cashField(o) {
    const v = (state.evidence.paidCashReceived || {})[o.id];
    return `<input type="number" inputmode="decimal" min="0" step="any" data-path="evidence.paidCashReceived.${esc(o.id)}" data-type="number" value="${v == null ? '' : esc(v)}" placeholder="not entered" aria-label="${esc(o.name)}: money actually received in dollars">`;
  }

  function stepEvidence() {
    const field = (key, o) => `<input type="number" inputmode="numeric" min="0" step="1" data-path="evidence.${key}.${esc(o.id)}" data-type="number" value="${esc((state.evidence[key] || {})[o.id] ?? (key === 'paidRegistrations' ? '' : 0))}" ${key === 'paidRegistrations' ? 'placeholder="not entered"' : ''} aria-label="${esc(o.name)}: ${key}">`;
    return `<div class="fields">${num('evidence.surveyContacted', 'How many people did you send the survey to?', { step: 1, placeholder: 'not recorded', help: 'Leave blank if you don’t know. It is shown as “not recorded”, never as 0.' })}${num('evidence.surveyResponses', 'How many people answered the survey?', { step: 1 })}</div>
      <div class="table-wrap"><table class="edit">
        <thead><tr><th>Option</th><th>Already paid (${'people or items'})</th><th>Money actually received ($)<br><span class="muted">from your records</span></th><th>Said “Yes” and left their name</th><th>Said “Yes” anonymously</th><th>Said “Maybe”</th></tr></thead>
        <tbody>${state.options.map((o) => `<tr><td>${esc(o.name)}</td><td>${field('paidRegistrations', o)}</td><td>${cashField(o)}</td><td>${field('namedHighIntent', o)}</td><td>${field('surveyDefinitelyAtPrice', o)}</td><td>${field('surveyProbablyAtPrice', o)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${state.options.map(interestBlock).join('')}
      <ul class="plain hint">
        <li>Count <b>people</b> for events and <b>items</b> for product sales (add up quantities; count “3 or more” as 3).</li>
        <li>Count someone buying for a whole group or table as the full group only if they confirmed it and the others aren't also on your survey list.</li>
        <li>Count each person once per option. Someone who left their name doesn't also go in “anonymously”.</li>
        <li>Enter totals only. Names stay in your own records, never in this planner.</li>
        <li>For money received, enter what actually came in, from your records. The planner never works it out from price × people, because group deals and price changes make that wrong.</li>
      </ul>
      <p class="hint research-hint">Optional: record how many people each group could reach on the <a href="#research">Research page</a>. Those estimates are kept separate and never added to these counts.</p>
      <details class="qs"><summary>Import counts from a spreadsheet (CSV)</summary>
        <div class="row-actions"><label class="small filebtn">Choose CSV file<input type="file" class="file-input" accept=".csv,text/csv" data-action="import-csv"></label>
        <button class="small" data-action="csv-template">Show CSV template</button></div>
      </details>`;
  }

  // ---------- Batch 2: interest by offer, scenario reasons, capacity shortcuts, same turnout (row 87) ----------
  const stageCount = (v, unit) => (v == null ? 'not recorded' : `${Number(v).toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`);
  const termsWords = (t) => (t && typeof t.price === 'number' ? termsText(t) : 'an offer that was not recorded');
  // One option's evidence, stage by stage (never added together), its past rounds and the "keep as a past round" action.
  function interestBlock(o, i) {
    const f = E.interestFunnel(state, o), t = T(o), unit = t.survey === 'buy' ? 'items' : t.many;
    const any = f.named || f.anonymousYes || f.maybe;
    const notCounted = f.named && f.offerState !== 'current' ? ` <span class="flag">not counted: ${f.offerState === 'stale' ? 'the offer changed since' : 'offer not recorded'}</span>` : '';
    return `<section class="funnel" data-funnel="${esc(o.id)}"><h3 class="sub">${esc(o.name)}: evidence, stage by stage</h3>
      <ol class="stages">
        <li><span>Sent the survey <i>(whole survey)</i></span><b>${esc(stageCount(f.contacted, 'people'))}</b></li>
        <li><span>Answered <i>(whole survey)</i></span><b>${esc(stageCount(f.responses, 'people'))}</b></li>
        <li><span>Said “Yes” and left a name</span><b>${f.named} ${esc(unit)}</b>${notCounted}</li>
        <li><span>Said “Yes” anonymously</span><b>${f.anonymousYes} ${esc(unit)}</b></li>
        <li><span>Said “Maybe”</span><b>${f.maybe} ${esc(unit)}</b></li>
        <li><span>Already paid</span><b>${f.paid} ${esc(unit)}</b></li>
        <li><span>Money actually received</span><b>${f.cashReceived == null ? 'not entered' : money(f.cashReceived)}</b></li>
      </ol>
      <p class="hint">Each line is its own count. They are never added together, and none of them is a forecast of who will come.</p>
      ${termsNote(o, i)}
      ${any ? `<div class="row-actions"><button class="small" data-action="archive-round" data-i="${i}">Keep these answers as a past round and start fresh</button></div>
        <p class="hint">Use this before you ask supporters again about a changed offer. The current “yes” and “maybe” counts move to a past round, with the offer they were for. Paid sign-ups and money received stay exactly as they are.</p>` : ''}
      ${f.pastRounds.length ? `<details class="qs" data-keep="rounds-${esc(o.id)}" ${openRecords.has('rounds-' + o.id) ? 'open' : ''}><summary>Past rounds for this option (${f.pastRounds.length}; kept for the record, never added to current answers)</summary>
        <ul class="plain">${f.pastRounds.map((r) => `<li>${r.archivedOn ? `Kept ${esc(showDate(r.archivedOn))}` : 'Kept (date not recorded)'}: answers for ${esc(termsWords(r.terms))}. ${r.named} named “yes”, ${r.anonymousYes} anonymous “yes”, ${r.maybe} “maybe”. Whole survey at the time: ${esc(stageCount(r.responses))} answered, ${esc(stageCount(r.contacted))} sent.</li>`).join('')}</ul></details>` : ''}
    </section>`;
  }

  // Why the organizer chose each scenario number: the Batch 1 research notes for that number, shown in place.
  function scenarioReasons(o, i, k) {
    const ls = research().links.filter((l) => l.optionId === o.id && l.assumption === k);
    return `<div class="why"><span class="why-h">Why this number <i>(your scenario, not a prediction)</i></span>
      ${ls.length ? `<ul class="plain">${ls.map((l) => `<li>${esc(l.note || 'No reason written yet.')}${(l.researchIds || []).length ? ` <span class="muted">(cites ${(l.researchIds).map((id) => { const r = recsById(id); return r ? esc(r.name || 'a record') : 'a removed record'; }).join(', ')})</span>` : ''}</li>`).join('')}</ul>` : '<p class="hint">No reason recorded yet.</p>'}
      <button class="small" data-action="add-scenario-reason" data-i="${i}" data-k="${k}">Add a reason</button></div>`;
  }

  // 50/75/100% of capacity, previewed with the engine, applied only by a confirmed click (same engine call).
  let shortcutTarget = 'middle'; // screen-only
  function shortcutsPanel(o, i) {
    const t = T(o), ss = state.scenarioSettings, unit = t.survey === 'buy' ? 'items' : t.many;
    const open = openRecords.has('shortcuts') ? 'open' : '';
    const sc = E.capacityShortcuts(state, o, shortcutTarget);
    if (!sc.available) return `<details class="qs" data-keep="shortcuts" ${open}><summary>Capacity shortcuts: 50%, 75% or 100% of capacity</summary><p class="hint">Enter the capacity on the quote step first.</p></details>`;
    const label = esc(ss[sc.scenario].label);
    const grp = E.participantStep(o) > 1 ? ` rounded down to whole ${esc(t.groupName || 'group')}s of ${E.participantStep(o)}` : '';
    return `<details class="qs shortcuts" data-keep="shortcuts" ${open}><summary>Capacity shortcuts: 50%, 75% or 100% of capacity</summary>
      <p class="hint">Arithmetic on the capacity you entered (${sc.capacity} ${esc(unit)})${grp}. <b>These are not evidence that this many will come.</b> Preview first: nothing changes until you choose “Use … as ${label}” and confirm. Paid sign-ups, money received and sponsors are never changed.</p>
      <div class="fields"><label class="f"><span>Preview for</span><select data-shortcut="target">${SC.map((k) => `<option value="${k}" ${k === sc.scenario ? 'selected' : ''}>${esc(ss[k].label)} case (now ${esc(String((o.scenarioParticipants || {})[k] ?? 0))})</option>`).join('')}</select></label></div>
      <p class="scroll-hint hint">Scroll the table sideways to see every column.</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Capacity shortcuts"><table class="res sc-t"><thead><tr><th>Share of capacity</th><th>${esc(cap(unit))}</th><th>Revenue</th><th>Costs</th><th>Money left<br><span class="muted">${label} case assumptions</span></th><th>Firm money only</th><th>Cash short before the event</th><th></th></tr></thead><tbody>
        ${sc.rows.map((r) => `<tr data-shortcut-row="${r.pct}"><td>${r.pct}%</td><td>${r.participants}${r.flags.length ? ` <span class="flag">${r.flags.includes('over_capacity') ? 'capped' : 'rounded down'} from ${r.requested}</span>` : ''}${r.venueMinimumApplied ? ` <span class="flag">${esc(t.venue)} minimum applies</span>` : ''}</td>
          <td>${money(r.revenue)}</td><td>${money(r.expenses)}</td><td class="${r.net < 0 ? 'neg' : ''}">${money(r.net)}</td><td class="${r.firmNet < 0 ? 'neg' : ''}">${money(r.firmNet)}</td><td class="${r.cashShort > 0 ? 'neg' : ''}">${r.cashShort > 0 ? money(r.cashShort) : 'none'}</td>
          <td class="wrap">${r.belowPaid ? `<span class="flag">below the ${sc.paid} already paid</span>` : r.isCurrent ? `<span class="muted">already your ${label} number</span>` : `<button class="small" data-action="apply-shortcut" data-i="${i}" data-pct="${r.pct}">Use ${r.participants} as ${label}</button>`}</td></tr>`).join('')}
      </tbody></table></div></details>`;
  }

  // Two options at the SAME turnout: the extra documented cost and what would cover it. Screen-only choices.
  const sameT = { a: '', b: '', n: '' };
  function samePair() {
    const find = (id) => state.options.find((o) => o.id === id);
    const tee = state.options.find((o) => o.kind === 'golf_tee_times'), sg = state.options.find((o) => o.kind === 'golf_shotgun');
    const [da, db] = tee && sg ? [tee, sg] : [state.options[0], state.options[1]];
    let A = find(sameT.a) || da, B = find(sameT.b) || db;
    if (A === B) B = state.options.find((o) => o !== A);
    return [A, B];
  }
  function sameTurnout() {
    const [A, B] = samePair();
    // Default: the first option's likely number, raised to the most already paid on either side (row 88), but never more
    // than both options can take, so the comparison is like for like. Nothing is saved.
    const paid = (o) => Number(((state.evidence || {}).paidRegistrations || {})[o.id]) || 0;
    const n = sameT.n === '' ? Math.min(Math.max(Number((A.scenarioParticipants || {}).middle) || 0, paid(A), paid(B)), E.maxFeasible(A), E.maxFeasible(B)) : Math.max(0, Number(sameT.n) || 0);
    return { A, B, n, r: E.compareAtSameTurnout(state, A, B, n) };
  }
  function sameTurnoutWords(A, B, r) {
    // Different counting units (row 88): 48 guests and 48 items are not the same turnout, so nothing is compared.
    if (!r.comparable) return `Not compared at the same turnout: ${A.name} counts ${r.units.a} and ${B.name} counts ${r.units.b}. The same number of ${r.units.a} and ${r.units.b} is not the same turnout, so no extra cost or recovery figures are given. Compare each at its own numbers in the Side by side table below.`;
    const awaitingDeposit = [A, B].filter(E.depositTermsMissing);
    if (awaitingDeposit.length) return `Confirm the deposit terms for ${andList(awaitingDeposit.map((o) => o.name))} before comparing costs at the same turnout.`;
    const many = T(A).many;
    if (r.reason === 'belowPaid') {
      const why = [r.a, r.b].filter((x) => x.belowPaid).map((x) => x.capacityBelowPaid
        ? `${x.name} has ${x.paid} ${many} already paid but can take at most ${x.maxFeasible}: check its capacity and the paid count`
        : `${x.name} has ${x.paid} ${many} already paid, more than ${x.participants}`).join('; ');
      const need = Math.max(r.a.paid, r.b.paid), fits = Math.min(r.a.maxFeasible, r.b.maxFeasible) >= need;
      return `No recovery figures: ${why}. Money already received is counted as received and is not changed. ${fits ? `Choose at least ${need} ${many} to compare what the extra cost would take.` : 'Fix the capacity or the paid count before comparing.'}`;
    }
    const incomplete = [A, B].filter((o) => E.optionMoneyIssue(o));
    if (incomplete.length) return `Complete the missing financial inputs for ${andList(incomplete.map((o) => o.name))} before comparing costs or deciding how much extra to raise.`;
    if (!r.costlierId) {
      const higher = r.higherNetId === A.id ? r.a.name : r.b.name;
      return `Both cost the same (${money(r.a.expenses)}) at this number, so there is no extra cost to cover and no recovery figures apply.${r.higherNetId ? ` Their firm money still differs by ${money(r.netDifference)} (${higher} ends up with more), because of ticket prices or option-specific sponsorship, not costs.` : ' They also end up with the same firm money.'}`;
    }
    const [Y, X] = r.costlierId === A.id ? [r.a, r.b] : [r.b, r.a];
    const head = r.sameCount ? `${Y.name} costs ${money(r.extraCost)} more than ${X.name} at ${Y.participants} ${many}.`
      : `Not like for like: ${Y.name} is counted at ${Y.participants} and ${X.name} at ${X.participants} (capacity or whole-group rules). At those numbers ${Y.name} costs ${money(r.extraCost)} more.`;
    if (!(r.sponsorshipToCover > 0)) return `${head} It still ends up with at least as much firm money at that number, so nothing extra is needed.`;
    return `${head} To end up with as much firm money as ${X.name} at that number, it would need ${money(r.sponsorshipToCover)} more firm sponsorship (collected or promised in writing), or ${r.recoverable ? `${r.playersToCover} more paying ${many} (${Y.participants + r.playersToCover} in all)` : `more paying ${many} than its capacity allows: the gap can't be closed by sales within capacity (${r.maxFeasibleCostlier})`}.`;
  }
  function sameTurnoutPanel() {
    if (state.options.length < 2) return '';
    const { A, B, n, r } = sameTurnout();
    const optSel = (key, cur) => `<select data-same="${key}">${state.options.map((o) => `<option value="${esc(o.id)}" ${o === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    const intro = `<section class="panel same-turnout" aria-labelledby="st-title"><h2 id="st-title">Compare two options at the same turnout</h2>
      <p class="hint">What the extra cost of one format would take, if <b>both drew the same number of people</b>. It does not assume a format (such as a shotgun start) brings more people or a higher price: if you expect that, it is your own assumption and it is not in these numbers. Firm money only.</p>`;
    if (!r.comparable || [A, B].some(E.depositTermsMissing)) {
      return `${intro}<div class="fields wi-controls"><label class="f"><span>Option</span>${optSel('a', A)}</label><label class="f"><span>Compared with</span>${optSel('b', B)}</label></div>
      <p class="callout warn-callout st-result"><span>${esc(sameTurnoutWords(A, B, r))}</span></p></section>`;
    }
    const col = (x) => [x.participants + (x.flags.length ? ` (${x.requested !== x.participants ? `from ${x.requested}: ` : ''}${x.flags.map((f) => (f === 'fewer_than_already_paid' ? `fewer than the ${x.paid} already paid` : f.replace(/_/g, ' '))).join(', ')})` : ''), money(x.revenue), money(x.costs.venue), money(x.costs.perParticipant), money(x.costs.fixed), money(x.costs.separateDepositFee), money(x.costs.contingency), money(x.expenses), money(x.net), money(x.cashNeeded), `${x.quoteVerified ? 'quote in writing' : 'quote not confirmed'}; ${x.costsVerified ? 'costs are quotes' : 'costs are estimates'}`];
    const ca = col(r.a), cb = col(r.b);
    const labels = ['Participants', 'Revenue (ticket money + firm sponsorship)', 'Venue or supplier', 'Per-person costs', 'One-time costs', 'Separate deposit fee', 'Cost cushion', 'Total costs', 'Firm money left', 'Cash needed before the event', 'Where the costs come from'];
    return `${intro}
      <div class="fields wi-controls"><label class="f"><span>Option</span>${optSel('a', A)}</label><label class="f"><span>Compared with</span>${optSel('b', B)}</label>
        <label class="f"><span>Number of ${esc(T(A).many)} for both</span><input type="number" inputmode="numeric" step="1" min="0" data-same="n" value="${esc(sameT.n === '' ? n : sameT.n)}"></label></div>
      <p class="scroll-hint hint">Scroll the table sideways to see every column.</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Two options at the same turnout"><table class="res st-t"><thead><tr><th></th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>
        ${labels.map((l, k) => `<tr><th>${esc(l)}</th><td class="wrap">${esc(ca[k])}</td><td class="wrap">${esc(cb[k])}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="st-result${r.reason === 'belowPaid' ? ' callout warn-callout' : ''}"><b>${esc(sameTurnoutWords(A, B, r))}</b></p>
      ${r.sameCount || r.reason === 'belowPaid' ? '' : `<p class="callout warn-callout"><span>The two options end up at different numbers (${r.a.participants} and ${r.b.participants}) because of capacity or whole-group rules, so this is not a like-for-like comparison. Choose a number both can take: up to ${Math.min(E.maxFeasible(A), E.maxFeasible(B))}.</span></p>`}
      <p class="hint">“More paying people” is what the numbers need, not a forecast. Extra players are counted at each option’s own prices, group deals, minimums and deposit rules.</p></section>`;
  }

  // Board summary lines for one option: stages, past rounds, reasons for each scenario number.
  function batch2Lines(o) {
    const f = E.interestFunnel(state, o), t = T(o), unit = t.survey === 'buy' ? 'items' : t.many, L = [];
    L.push(`Evidence stage by stage (each its own count, never added): sent ${stageCount(f.contacted)}; answered ${stageCount(f.responses)} (whole survey); named "yes" ${f.named}${f.named && f.offerState !== 'current' ? ' (not counted: offer changed or not recorded)' : ''}; anonymous "yes" ${f.anonymousYes}; "maybe" ${f.maybe}; paid ${f.paid} ${unit}; money received ${f.cashReceived == null ? 'not entered' : money(f.cashReceived)}.`);
    f.pastRounds.forEach((r) => L.push(`Past round${r.archivedOn ? ` (kept ${showDate(r.archivedOn)})` : ''}, for ${termsWords(r.terms)}: ${r.named} named "yes", ${r.anonymousYes} anonymous "yes", ${r.maybe} "maybe". Not added to current answers.`));
    const ss = state.scenarioSettings, links = research().links.filter((l) => l.optionId === o.id && SC.includes(l.assumption));
    L.push(`Scenario numbers are the organizer's choices, not predictions: ${SC.map((k) => `${ss[k].label.toLowerCase()} ${notEntered((o.scenarioParticipants || {})[k]) ? 'not entered' : (o.scenarioParticipants || {})[k]}`).join(', ')}.${links.length ? ` Reasons: ${links.map((l) => `${ss[l.assumption].label.toLowerCase()}: ${l.note ? `"${l.note}"` : 'no reason written'}`).join('; ')}.` : ' No reasons recorded.'}`);
    return L;
  }


  // ---------- "Ready to commit?" (Batch 3, row 90): criteria, what we know, what is uncertain, what to do next ----------
  // One set of words for the screen, the board summary and print, so their conclusions can't differ.
  const READY_MARK = { met: ['✓', 'Met', 'yes'], unmet: ['✕', 'Not met', 'bad'], unknown: ['?', 'Unknown', 'no'], timing: ['•', 'Timing', 'no'] };
  const lossWords = (net) => (net < 0 ? `a loss of ${hm(-net)}` : `${hm(net)}, so no loss`);
  function readyWords(o, r) {
    const t = T(o), many = t.many, buy = t.survey === 'buy', cr = state.criteria || {};
    const [mn, ml, vo, db] = r.criteria;
    const crit = [], lk = r.likely;
    // Why the likely number can't be used (row 91). The numbers are shown as entered; nothing is raised.
    const FLAG = { over_capacity: `capped at the capacity of ${lk.capacity}`, rounded_down_to_whole_groups: `rounded down to whole ${t.groupName || 'group'}s`, fewer_than_already_paid: `fewer than the ${lk.paid} already paid`, negative_input_set_to_zero: 'a negative number was set to 0' };
    const words = (fl) => fl.map((f) => FLAG[f] || f.replace(/_/g, ' ')).join('; ');
    const lkWarn = lk.warnings.length ? ` (${words(lk.warnings)})` : '';
    const counted = lk.known && lk.requested !== lk.participants ? `${lk.requested}, counted as ${lk.participants}${lk.warnings.some((f) => f !== 'fewer_than_already_paid') ? `: ${words(lk.warnings.filter((f) => f !== 'fewer_than_already_paid'))}` : ''}` : `${lk.requested}`;
    const conflictText = lk.conflict === 'likelyMissing' ? 'your likely number is not entered'
      : lk.conflict === 'capacityBelowPaid' ? `the capacity entered (${lk.capacity}) is below the ${lk.paid} ${many} already paid`
        : lk.conflict === 'likelyBelowPaid' ? `your likely number (${counted}) is below the ${lk.paid} ${many} already paid` : '';
    // 1. Minimum net proceeds (firm money, at the likely number).
    const basis = `firm money (${buy ? 'sales' : 'ticket money'} plus sponsorship collected or promised in writing), at your likely number of ${mn.participants} ${many}`;
    crit.push([mn.result, E.depositTermsMissing(o)
      ? `Smallest amount worth raising: ${mn.threshold == null ? 'not set' : hm(mn.threshold)}. The net is unknown until you confirm the deposit terms.`
      : mn.conflict
      ? `Smallest amount worth raising: ${mn.threshold == null ? 'not set' : hm(mn.threshold)}. Can’t be judged: ${conflictText}.`
      : mn.result === 'unknown'
      ? `Smallest amount worth raising: not set. On ${basis}, it would leave ${hm(mn.value)}.`
      : `Smallest amount worth raising: ${hm(mn.threshold)}. On ${basis}, it leaves ${hm(mn.value)}.${mn.lowConflict === 'lowMissing' ? ' Your low number is not entered.' : mn.lowConflict === 'lowBelowPaid' ? ` Your low number (${mn.lowRequested}${mn.lowParticipants !== mn.lowRequested ? `, counted as ${mn.lowParticipants}` : ''}) is below the ${lk.paid} ${many} already paid, so its figure isn’t shown.` : ` At your low number (${mn.lowParticipants}) it leaves ${hm(mn.lowValue)}${mn.lowMeets ? '' : ', below this amount'}.`}${lkWarn ? ` Your likely number was ${lk.requested}, counted as ${lk.participants}${lkWarn}.` : ''}`]);
    // 2. Largest acceptable loss, two named exposures.
    const [cx, lx] = ml.parts;
    const within = (q) => (ml.threshold == null || q.result === 'unknown' ? '' : q.result === 'met' ? ' (within the limit)' : ' (over the limit)');
    const cancelText = cx.loss == null ? 'if you cancel after the deadline: unknown, because the cancellation terms are not entered' : `if you cancel after the deadline: ${hm(cx.loss)} owed and already spent${within(cx)}`;
    const runText = lx.conflict === 'depositTerms' ? 'if you hold the event: the possible loss is unknown until you confirm the deposit terms' : lx.conflict ? `if you hold it and few come: can’t be judged, because the capacity entered (${lk.capacity}) is below the ${lk.paid} ${many} already paid`
      : `if you hold it and few come: the lowest firm-money result at ${lx.participants} ${many} or more is ${lossWords(lx.net)}${within(lx)}`;
    crit.push([ml.result, `${ml.threshold == null ? 'Largest loss the club could accept: not set' : `Largest loss the club could accept: ${hm(ml.threshold)}`}. Exposure ${cancelText}; ${runText}.`]);
    // 3. Volunteer hours (no dollar value).
    crit.push([vo.result, vo.need == null ? 'Volunteer hours: the hours this option needs are not entered.'
      : vo.available == null ? `Volunteer hours: about ${vo.need} needed; hours available are not entered.`
        : `Volunteer hours: about ${vo.need} needed, ${vo.available} available${vo.result === 'met' ? '' : `, ${Math.round((vo.need - vo.available) * 10) / 10} short`}.${vo.need === 0 ? ' You entered 0 hours needed: check that is right.' : ''}`]);
    // 4. Decision deadline (timing only).
    const rel = db.days == null ? '' : db.days === 0 ? ' (today)' : db.days > 0 ? ` (in ${db.days} day${db.days === 1 ? '' : 's'})` : ` (${-db.days} day${db.days === -1 ? '' : 's'} ago)`;
    crit.push([db.result, !db.date ? 'Decide by: not set.' : `Decide by: ${showDate(db.date)}${rel}.${db.timing === 'passed' ? ' The date has passed. That is timing, not a sign the event will or won’t work.' : ''}`, db.timing === 'passed' || db.timing === 'today']);

    // What we know (each fact on its own).
    const a = r.attendance, cash = r.cash, k = r.contract, know = [];
    const paidW = buy ? `${a.paid} ${many} paid for` : `${a.paid} ${a.paid === 1 ? t.one : many} paid`;
    const namedW = `${a.namedCounted} named “yes” for the current offer (not payment)`;
    know.push(a.conflict ? `Attendance: can’t be compared, because ${conflictText}. Paid sign-ups and money received are shown as entered: ${paidW}.`
      : a.coveredBy === 'none' ? `Attendance: your likely number is 0 ${many}, as you entered it. ${cap(paidW)}.`
      : a.coveredBy === 'paid' ? `Attendance: your likely number is ${a.likely} ${many}. ${cap(paidW)}, which already reaches it.`
      : a.coveredBy === 'paidAndNamed' ? `Attendance: your likely number is ${a.likely} ${many}. ${cap(paidW)} and ${namedW} reach it together. That is a count, not a prediction.`
        : `Attendance: your likely number is ${a.likely} ${many}. ${cap(paidW)} and ${namedW} make ${a.paid + a.namedCounted}, ${a.likely - a.paid - a.namedCounted} short of it. The likely number is your assumption, not evidence.`);
    if (a.named > a.namedCounted) know.push(`${a.named - a.namedCounted} named “yes” answers were for different or unrecorded terms and aren’t counted.`);
    if (a.anonymousYes) know.push(`${a.anonymousYes} anonymous “yes” answers are shown but not counted.`);
    know.push(`Cash: ${hm(cash.neededBeforeEvent)} is needed before the event; ${hm(cash.inHand)} is in hand (collected sponsorship and money actually received)${cash.registrationCashUnknown ? ', not counting money received from people who paid, which isn’t entered' : ''}. ${cash.short > 0 ? `Short by ${hm(cash.short)}${cash.fundingConfirmed ? ' (the club confirmed it can cover this)' : ' (not yet covered)'}.` : 'No shortfall.'}${cash.committedSponsorship ? ` ${hm(cash.committedSponsorship)} promised in writing counts in firm money but isn’t cash yet.` : ''}${cash.hopedSponsorship ? ` ${hm(cash.hopedSponsorship)} hoped-for isn’t counted.` : ''}`);
    know.push(`Contract: ${k.quoteVerified ? `${t.venue} quote in writing` : `${t.venue} quote not in writing yet`}; ${k.costsVerified ? 'other costs are quotes' : 'other costs are estimates'}; cancellation terms ${k.cancellationKnown ? 'entered' : 'unknown'}.${k.next ? ` Next date: ${contractLabel(o, k.next.key)}, ${dateWords(k.next)}.` : ''}`);

    // What remains uncertain: the existing must-verify list plus attendance and contract dates.
    const unsure = [...r.missing];
    if (lk.conflict === 'likelyMissing') unsure.push('Your likely number is not entered, so nothing that depends on it can be judged.');
    if (mn.lowConflict === 'lowBelowPaid' && lk.conflict !== 'capacityBelowPaid') unsure.push(`The numbers conflict: your low number (${mn.lowRequested}) is below the ${lk.paid} ${many} already paid.`);
    if (lk.conflict === 'likelyBelowPaid') unsure.push(`The numbers conflict: ${conflictText}.`); // a capacity below the paid count is already in the must-verify list
    if (a.coveredBy === 'notCovered') unsure.push(`Whether ${a.likely} ${many} will actually ${buy ? 'be bought' : 'come and pay'}: paid plus named “yes” is ${a.paid + a.namedCounted}.`);
    if (!a.reasonRecorded && lk.known) unsure.push('No reason is recorded for your likely number. Add one on the “Plan for low, likely and high” step.');
    const dates = k.unresolved.filter((u) => !/owed if you cancel/i.test(u));
    if (dates.length) unsure.push(`Contract details not entered: ${dates.join(', ')}.`);
    if (k.passed.length) unsure.push(`Contract dates passed or due today: ${k.passed.join(', ')}. Check with the ${t.venue} what this means now.`);

    // What to do next.
    const next = r.actions.map((key) => ({
      depositTerms: 'Check the quote and enter both deposit answers before comparing net proceeds.',
      enterLikely: 'Enter your likely number on the “Plan for low, likely and high” step. Blank is treated as unknown, not 0.',
      resolveConflict: lk.conflict === 'capacityBelowPaid'
        ? `Check the capacity with the ${t.venue} and the paid count in your records: ${lk.paid} are paid but the capacity entered is ${lk.capacity}. The planner won’t change either number for you.`
        : `Fix the likely number or the paid count: ${lk.paid} ${many} are already paid, so the likely number can’t be lower. The planner won’t raise it for you.`,
      resolveLow: `Fix the low number or the paid count: ${lk.paid} ${many} are already paid, so the low number can’t be lower. The planner won’t raise it for you.`,
      quote: k.quoteVerified
        ? `Get the missing contract details from the ${t.venue} in writing: ${[!k.cancellationKnown && 'what you would owe if you cancel', ...dates.map((x) => x.toLowerCase())].filter(Boolean).join(', ')}.`
        : `Get the written ${t.venue} quote${k.cancellationKnown ? '' : ', including what you would owe if you cancel'}${dates.length ? `, and these details: ${dates.join(', ').toLowerCase()}` : ''}.`,
      reconfirm: a.evidenceState === 'stale' || a.evidenceState === 'unrecorded' ? 'Re-ask supporters about the current offer (price, date, what’s included), or confirm their answers still apply.' : `Collect paid sign-ups or named “yes” answers for the current offer before relying on ${a.likely} ${many}.`,
      cash: `Agree how the club will cover the ${hm(cash.short)} due before the event, and have the treasurer confirm it.`,
      adjust: 'Adjust the price, costs or scope until the numbers meet your criteria. “What would need to change?” in the planner can test this.',
      volunteers: vo.result === 'unmet' ? `Find about ${Math.round((vo.need - vo.available) * 10) / 10} more volunteer hours, or reduce the scope.` : 'Confirm how many volunteer hours people can actually give.',
      setCriteria: `Agree with the board on ${[mn.threshold == null && 'the smallest amount worth raising', ml.threshold == null && 'the largest loss the club could accept'].filter(Boolean).join(' and ')}.`,
      deadline: 'Your decide-by date has passed or is today. Confirm the real deadline with the board and the venue.',
      board: 'Take this summary, with the open items above, to the board. The board decides: this planner doesn’t approve contracts or predict turnout.',
    })[key]);
    return { crit, know, unsure, next };
  }
  const READY_CAVEAT = 'Meeting a criterion in a scenario doesn’t mean people will come, and it doesn’t make a contract safe. Firm money counts promised sponsorship that isn’t cash yet.';
  function readyCard(o) {
    const r = E.readiness(state, o, localYMD()), w = readyWords(o, r);
    const li = ([res, text, late]) => { const [icon, word, cls] = READY_MARK[res]; return `<li class="${late ? 'late' : cls}"><span aria-hidden="true">${icon}</span><span><b>${word}:</b> ${esc(text)}</span></li>`; };
    return `<article class="ready" data-ready="${esc(o.id)}" aria-labelledby="ready-${esc(o.id)}"><h3 id="ready-${esc(o.id)}">${esc(o.name)}</h3>
      ${financialWarningHtml(o)}
      <div class="ready-grid">
        <section><h4>What the numbers require</h4><ul class="standing crit">${w.crit.map(li).join('')}</ul></section>
        <section><h4>What we know</h4><ul class="plain">${w.know.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
        <section><h4>What remains uncertain</h4>${w.unsure.length ? `<ul class="plain miss">${w.unsure.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="hint">Nothing flagged from what you entered.</p>'}</section>
        <section><h4>What to do next</h4><ol class="next">${w.next.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>
      </div></article>`;
  }
  function criteriaLine() {
    const cr = state.criteria || {}, v = (x) => (x == null || x === '' ? 'not set' : hm(x));
    return `Decision criteria: smallest amount worth raising ${v(cr.minNet)}; largest loss the club could accept ${v(cr.maxLoss)}; volunteer hours available ${state.volunteerHoursAvailable == null || state.volunteerHoursAvailable === '' ? 'not entered' : state.volunteerHoursAvailable}; decide by ${E.isCalendarDate(cr.decideBy) ? showDate(cr.decideBy) : 'not set'}.`;
  }
  function readySection() {
    return `<section class="panel ready-panel" aria-labelledby="ready-title"><h2 id="ready-title">Ready to commit?</h2>
      <p class="hint">Your own limits, checked against each option. Blank means not decided yet; 0 is a real answer. Nothing here signs or approves anything.</p>
      <div class="fields noprint">
        ${num('criteria.minNet', 'Smallest amount after costs that makes this worth doing ($)', { placeholder: 'not set', help: 'Checked against firm money at your likely number.' })}
        ${num('criteria.maxLoss', 'Largest loss the club could accept ($)', { placeholder: 'not set', help: 'Checked against canceling after the deadline and against holding it with low turnout.' })}
        ${num('volunteerHoursAvailable', 'Volunteer hours your club can realistically give', { placeholder: 'not sure' })}
        ${dateIn('criteria.decideBy', 'Decide by', 'A date for the board’s decision. Timing only.')}
      </div>
      <p class="printonly">${esc(criteriaLine())}</p>
      ${state.options.map(readyCard).join('')}
      <p class="hint">${esc(READY_CAVEAT)}</p></section>`;
  }
  function readyMemoLines(o) {
    const w = readyWords(o, E.readiness(state, o, localYMD())), L = ['', '### Ready to commit?', '**What the numbers require**'];
    w.crit.forEach(([res, text]) => L.push(`- [${READY_MARK[res][1]}] ${text}`));
    L.push('', '**What we know**'); w.know.forEach((x) => L.push(`- ${x}`));
    L.push('', '**What remains uncertain**'); (w.unsure.length ? w.unsure : ['Nothing flagged from what was entered.']).forEach((x) => L.push(`- ${x}`));
    L.push('', '**What to do next**'); w.next.forEach((x, i) => L.push(`${i + 1}. ${x}`));
    L.push('');
    return L;
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
      <figcaption>Money left after costs at every possible number of ${esc(t.many)}: firm money only (ticket money plus collected and committed sponsorship; no add-ons, other income or auction estimates)</figcaption>
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
    return { not_enough_evidence: 'st-unknown', not_viable_as_configured: 'st-bad', high_risk: 'st-warn', supported_with_open_items: 'st-warn', supported_by_current_evidence: 'st-ok' }[s];
  }
  // What each status means, in one plain sentence. Shown under the badge and in the guide.
  const STATUS_MEANING = {
    not_enough_evidence: 'A written quote or real evidence of demand is still missing, or paid sign-ups plus named “yes” answers don’t yet reach break-even. This is a normal, useful answer: collect the missing pieces before anyone signs.',
    not_viable_as_configured: 'Even if every spot sells, ticket money and firm sponsorship don’t cover the costs at these prices and terms. Change the price, costs or format, or don’t sign.',
    high_risk: 'Under the numbers you entered, this plan can lose money, or it only works if assumed income (add-ons, other income, auction money) actually arrives.',
    supported_with_open_items: 'The numbers clear break-even with the evidence you have, but some items below still need checking. It is not a guarantee.',
    supported_by_current_evidence: 'The numbers clear break-even with current evidence and nothing is flagged. It still isn’t a guarantee of profit, and it doesn’t make a contract safe.',
  };
  function statusIcon(s) { return { not_enough_evidence: '?', not_viable_as_configured: '✕', high_risk: '!', supported_with_open_items: '…', supported_by_current_evidence: '✓' }[s]; }

  // A scenario number left blank (row 92). The engine still counts it as 0 people, as it always has; everywhere a status
  // or a figure depends on it, the screen and the board summary say it was not entered, so it never reads as a typed 0.
  const SC_WORD = { conservative: 'low', middle: 'likely', optimistic: 'high' };
  const notEntered = (v) => v == null || v === '' || !Number.isFinite(Number(v));
  const blankScenarios = (o) => SC.filter((k) => notEntered((o.scenarioParticipants || {})[k]));
  const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  function blankNote(o) {
    const b = blankScenarios(o);
    if (!b.length) return '';
    const names = andList(b.map((k) => SC_WORD[k])), many = T(o).many, it = b.length > 1 ? 'them' : 'it';
    return `Not entered: your ${names} number${b.length > 1 ? 's' : ''}. ${b.includes('conservative') ? 'The status and the' : 'The status doesn’t use it, but the'} ${names}-case figures count ${it} as 0 ${many}, which you didn’t enter. Enter ${it} on the “Plan for low, likely and high” step.`;
  }
  const scenarioNet = (o, k, p) => (notEntered((o.scenarioParticipants || {})[k]) ? `not entered (counted as 0: ${hm(p.net)})` : hm(p.net));

  function financialInputWarning(o) {
    const issue = E.optionMoneyIssue(o);
    if (E.depositTermsMissing(o)) return 'Incomplete estimate. ' + briefIssue('depositTerms');
    return issue ? `Incomplete estimate. ${briefIssue(issue)} The detailed figures treat missing amounts as zero until you enter them.` : '';
  }
  function financialWarningHtml(o) {
    const note = financialInputWarning(o);
    return note ? `<p class="warn-callout">${esc(note)}</p>` : '';
  }

  function depositPrompt(o) {
    return `${financialWarningHtml(o)}<a href="${esc(issueLink(o, 'depositTerms'))}">Check the deposit terms</a>`;
  }

  function analyse(o) {
    const proj = {};
    SC.forEach((k) => { proj[k] = E.project(o, (o.scenarioParticipants || {})[k], E.scenarioContext(state, o, k)); });
    const firmCtx = E.firmContext(state, o); // same basis as the firm break-even
    const dec = E.decide(state, o);
    const missingMoney = financialInputWarning(o);
    const status = missingMoney ? 'not_enough_evidence' : dec.status;
    return { proj, dec, status, missingMoney, curve: E.netCurve(o, firmCtx), sens: E.sensitivity(o, (o.scenarioParticipants || {}).middle, E.scenarioContext(state, o, 'middle')) };
  }

  function renderComparison(all) {
    const target = Number(state.settings.fundraisingTarget) || 0;
    return `<p class="hint scroll-hint">Scroll the table sideways to see every column.</p><div class="table-wrap" tabindex="0" role="region" aria-label="Options side by side"><table class="res">
      <thead><tr><th>Option</th><th>Status</th><th>Break-even<br><span class="muted">firm money only${state.options.some((o) => T(o).proceeds) ? ', no auction bids' : ''}</span></th><th>Needed for ${money(target)}</th><th>Feasible capacity</th><th>Conservative net</th><th>Middle net</th><th>Optimistic net</th><th>Upfront cash</th><th>Volunteer hrs</th></tr></thead>
      <tbody>${state.options.map((o, i) => { if (E.depositTermsMissing(o)) return `<tr><th scope="row">${esc(o.name)}</th><td colspan="9" class="wrap">${depositPrompt(o)}</td></tr>`;
        const a = all[i]; const be = a.dec.breakEven, tg = a.dec.targetNeeded; return `<tr>
        <td><b>${esc(o.name)}</b></td>
        <td><span class="badge ${statusClass(a.status)}"><i>${statusIcon(a.status)}</i>${a.missingMoney ? 'Incomplete estimate' : esc(E.STATUS_LABELS[a.status])}</span>${blankScenarios(o).length ? ` <span class="flag">${esc(andList(blankScenarios(o).map((k) => SC_WORD[k])))} number not entered</span>` : ''}</td>
        <td>${be.reachableWithinCapacity ? `${be.participants} ${esc(T(o).many)}` : '<b class="neg">Not within capacity</b>'}</td>
        <td>${target ? (tg.reachableWithinCapacity ? `${tg.participants} ${esc(T(o).many)}` : '<b class="neg">Exceeds capacity</b>') : '—'}</td>
        <td>${be.maxFeasible} ${esc(T(o).many)}</td>
        ${SC.map((k) => notEntered((o.scenarioParticipants || {})[k]) ? `<td><span class="flag">not entered</span> <span class="muted">(counted as 0: ${money(a.proj[k].net)})</span></td>` : `<td class="${a.proj[k].net < 0 ? 'neg' : ''}">${money(a.proj[k].net)}</td>`).join('')}
        <td>${money(a.proj.middle.upfront.required)}</td><td>${a.proj.middle.volunteerHours}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function renderDetail(o, a) {
    if (E.depositTermsMissing(o)) return `<details class="detail"><summary>${esc(o.name)} — scenario detail</summary>${depositPrompt(o)}</details>`;
    const P = a.proj;
    const vhv = state.settings.volunteerHourValue;
    const row = (label, f, cls = '') => `<tr class="${cls}"><th>${label}</th>${SC.map((k) => `<td>${f(P[k], k)}</td>`).join('')}</tr>`;
    const flags = (p) => p.flags.length ? ` <span class="flag">${p.flags.map((f) => f.replace(/_/g, ' ')).join(', ')}</span>` : '';
    const ss = state.scenarioSettings;
    const firmMarkCtx = E.firmContext(state, o);
    const marks = SC.map((k) => ({ n: P[k].participants, label: ss[k].label, net: E.project(o, P[k].participants, firmMarkCtx).net }));
    const ik = [...new Map(SC.flatMap((k) => P[k].inKind.applied.concat(P[k].inKind.notCounted.filter((n) => n.reason !== 'status_not_counted_in_this_scenario'))).map((x) => [x.id, x])).values()];
    return `<details class="detail" ${state.options.indexOf(o) === 0 ? 'open' : ''}><summary>${esc(o.name)} — scenario detail</summary>
      ${financialWarningHtml(o)}
      <p class="hint scroll-hint">Scroll the table sideways to see every column.</p><div class="table-wrap" tabindex="0" role="region" aria-label="${esc(o.name)}: scenario detail"><table class="res sc">
        <thead><tr><th></th>${SC.map((k) => `<th>${esc(ss[k].label)}<br><span class="muted">sponsors: ${ss[k].statuses.join(' + ') || 'none'}</span>${notEntered((o.scenarioParticipants || {})[k]) ? '<br><span class="flag">number not entered: counted as 0</span>' : ''}</th>`).join('')}</tr></thead>
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
          ${row('Cash in hand now', (p) => money(p.upfront.cashInHand) + (p.upfront.registrationCashUnknown ? ' <span class="flag">registration money received not entered</span>' : ''))}
          ${row('Upfront cash gap', (p) => `<span class="${p.upfront.gap > 0 ? 'neg' : ''}">${money(p.upfront.gap)}</span>`)}
          ${row('Volunteer hours (not in net)', (p) => p.volunteerHours)}
          ${vhv ? row(`Net after valuing volunteer time at ${money(vhv)}/h`, (p) => money(p.net - p.volunteerHours * vhv)) : ''}
        </tbody></table></div>
      ${chart(o, a.curve, marks, Number(state.settings.fundraisingTarget) || 0)}
      <h4>What moves the middle scenario most</h4>
      ${notEntered((o.scenarioParticipants || {}).middle) ? '<p class="flag">Your likely number is not entered, so this is worked out at 0.</p>' : ''}
      <div class="table-wrap" tabindex="0" role="region" aria-label="${esc(o.name)}: what moves the middle scenario"><table class="res small-t"><tbody>${a.sens.results.map((r) => `<tr><th>${esc(r.label)}</th><td class="${r.change < 0 ? 'neg' : ''}">${r.change >= 0 ? '+' : ''}${money(r.change)}</td><td class="muted">net becomes ${money(r.net)}</td></tr>`).join('')}</tbody></table></div>
      ${ik.length ? `<h4>In-kind handling</h4><ul class="plain">${ik.map((x) => x.replaces ? `<li>${esc(x.label)}: reduces “${esc(x.replaces)}” by ${money(x.reducedBy)}${x.excessNotCounted ? `; ${money(x.excessNotCounted)} of its value exceeds that cost and is not counted` : ''}.</li>` : `<li>${esc(x.label)}: not counted — it does not replace a budgeted cost.</li>`).join('')}</ul>` : ''}
    </details>`;
  }

  function auctionEstimateNote(o) {
    if (!T(o).proceeds) return '';
    const bids = o.scenarioProceeds || {};
    return 'Break-even leaves out auction and raffle money because bids are uncertain. ' +
      (notEntered(bids.middle) ? 'The likely case has no bid estimate entered.' : `The likely case includes ${money(bids.middle)} in estimated proceeds.`);
  }

  function readAloud(o, d, P, round) {
    const issue = E.optionMoneyIssue(o);
    if (issue) return `We still need figures before we can judge what the club would raise. ${briefIssue(issue)}`;
    const t = T(o);
    const firm = P.middle.sponsorshipByStatus.collected + P.middle.sponsorshipByStatus.committed;
    const have = d.paid + d.namedCounted;
    const auction = t.proceeds ? ' ' + auctionEstimateNote(o) : '';
    if (!d.breakEven.reachableWithinCapacity && d.conditional && d.conditional.reachableWithinCapacity) return `Tickets and firm sponsorship alone can't cover costs, even at full capacity of ${d.breakEven.maxFeasible} ${t.many}. This only works if our low-case ${d.conditional.uses.join(' and ')} come in, and none of that is promised.`;
    if (t.proceeds && !d.breakEven.reachableWithinCapacity) return `Tickets and firm sponsorship alone cannot cover this auction’s costs within its capacity. Use the bid targets to check what bidders would have to contribute.${auction}`;
    if (!d.breakEven.reachableWithinCapacity) return `Even at full capacity of ${d.breakEven.maxFeasible} ${t.many}, this option loses money on collected and committed sponsorship as currently priced, so it should not go ahead as configured.${auction}`;
    return `With ${money(firm)} in collected and committed sponsorship, we need ${d.breakEven.participants} ${attendanceUnit(t)} to break even. Right now we have ${have} (${t.survey === 'buy' ? 'paid orders' : 'paid registrations'} plus named survey “yes” answers)${d.breakEven.participants > have ? `, a gap of ${d.breakEven.participants - have}` : `, which meets the count check only. Named “yes” answers are not ${t.survey === 'buy' ? 'paid orders' : 'paid registrations'}`}. ${t.survey === 'buy' ? 'If nothing sells' : 'If nobody registers'}, we would be at ${round(d.worst.netIfNobodyRegisters)}.${auction}`;
  }

  // "Where the numbers stand": what is in writing or on record, and what is still an estimate or missing.
  function standing(o, d) {
    const ev = d.evidence.state;
    const items = [
      [o.quoteVerified, `${cap(T(o).venue)} quote in writing`],
      [o.costsVerified, 'Other costs are real quotes'],
      [d.cancel != null, 'Cancellation terms entered'],
      [ev === 'current', ev === 'none' ? 'No survey answers yet' : 'Survey answers are for the current offer'],
      [d.paid > 0, d.paid > 0 ? `${d.paid} already paid` : 'Nobody has paid yet'],
    ];
    if (d.paid > 0) items.push([d.firm.upfront.registrationCash != null, 'Money received entered']);
    if (d.exposure.shortBeforeEvent > 0) items.push([!!o.upfrontFundingConfirmed, 'Club confirmed it can cover money due first']);
    return `<ul class="standing" aria-label="Where the numbers stand">${items.map(([ok, label]) => `<li class="${ok ? 'yes' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '–'}</span>${esc(label)}<span class="sr-only">: ${ok ? 'yes' : 'not yet'}</span></li>`).join('')}</ul>`;
  }

  // ---------- contract dates and terms (a checklist; never part of the math) ----------
  function contractLabel(o, key) {
    const t = T(o), product = t.survey === 'buy';
    return {
      quoteExpires: 'Quote expires', depositDue: product ? 'Deposit or payment due' : 'Deposit due',
      headcountDue: product ? 'Final order quantity due' : `Final guaranteed number of ${t.many} due`,
      cancelBy: product ? 'Last day to cancel the order' : 'Last day to cancel under the quote’s terms',
    }[key];
  }
  const dateWords = (x) => {
    if (x.state === 'unknown') return 'unknown';
    const rel = x.days == null ? '' : x.days === 0 ? ' (today)' : x.days > 0 ? ` (in ${x.days} day${x.days === 1 ? '' : 's'})` : ` (${-x.days} day${x.days === -1 ? '' : 's'} ago)`;
    return showDate(x.date) + rel;
  };
  const CONTRACT_CAVEAT = 'Dates come from what you entered and never change the numbers. The planner doesn’t work out tiered cancellation amounts or weather exceptions: read those terms yourself. A complete list doesn’t mean the contract is safe or approved.';
  // One list for the results page, the board summary and print: [state, text]. state: 'known' | 'unknown' | 'late'.
  function contractItems(o) {
    const k = E.contractChecklist(o, localYMD()), venue = T(o).venue, out = [];
    out.push(k.quoteDate ? ['known', `Quote dated ${showDate(k.quoteDate)}`] : ['unknown', 'Quote date: unknown']);
    out.push(k.quoteSource ? ['known', `Quote reference or source: ${k.quoteSource}`] : ['unknown', 'Quote reference or source: unknown']);
    k.dates.forEach((x) => {
      const label = contractLabel(o, x.key);
      if (x.state === 'unknown') out.push(['unknown', `${label}: unknown`]);
      else if (x.state === 'upcoming') out.push(['known', `${label}: ${dateWords(x)}`]);
      else out.push(['late', `${label}: ${dateWords(x)}. ${x.key === 'quoteExpires' ? `Ask the ${venue} to confirm the prices still hold.` : `Check with the ${venue} what this means now.`}`]);
    });
    out.push(k.cancellationOwed == null ? ['unknown', 'Owed if you cancel after the deadline: unknown'] : ['known', `Owed if you cancel after the deadline: ${hm(k.cancellationOwed)} (the amount you entered)`]);
    if (E.depositTermsMissing(o)) out.push(['unknown', briefIssue('depositTerms')]);
    if (k.cancellationNotes) out.push(['known', `Your notes on cancellation: “${k.cancellationNotes}”`]);
    if (k.weatherNotes) out.push(['known', `Your notes on weather or rescheduling: “${k.weatherNotes}”`]);
    return { items: out, check: k };
  }
  const unknownCount = (items) => items.filter(([st]) => st === 'unknown').length;
  function contractSection(o) {
    const { items } = contractItems(o);
    const icon = { known: '•', unknown: '?', late: '!' }, sr = { known: '', unknown: ': not known yet', late: ': date has passed or is today' };
    return `<section class="contract" data-contract="${esc(o.id)}"><h4>Contract dates and terms <span class="muted">(${unknownCount(items) ? `${unknownCount(items)} still unknown` : 'all entered'})</span></h4>
      <ul class="standing">${items.map(([st, text]) => `<li class="${st === 'known' ? 'yes' : st === 'late' ? 'late' : 'no'}"><span aria-hidden="true">${icon[st]}</span>${esc(text)}<span class="sr-only">${sr[st]}</span></li>`).join('')}</ul>
      <p class="hint">${esc(CONTRACT_CAVEAT)}</p></section>`;
  }

  function renderSummary(all) {
    return state.options.map((o, i) => {
      if (E.depositTermsMissing(o)) return `<article class="sum"><h2>${esc(o.name)}</h2>${depositPrompt(o)}</article>`;
      const a = all[i], d = a.dec, P = a.proj, t = T(o), x = d.exposure;
      const unit = attendanceUnit(t);
      const nobody = t.survey === 'buy' ? 'nothing sells' : 'nobody comes';
      const have = d.paid + d.namedCounted;
      const gapOpen = x.shortBeforeEvent > 0 && !o.upfrontFundingConfirmed;
      const moreLoss = x.worstOnChartLoss > x.largestLoss; // the two-case figure is not a maximum; say so when the chart goes lower
      const top = a.sens.results[0];
      const why = [...d.reasons];
      if (t.proceeds) why.push(auctionEstimateNote(o));
      if (d.worst.contractualFloor > 0) why.push(`From the minimums and deposit you entered, the ${t.venue} bill is at least ${hm(d.worst.contractualFloor)} even if ${nobody}. That applies only if those are the terms you actually sign.`);
      if (P.middle.sponsorshipByStatus.hoped > 0) why.push(`${hm(P.middle.sponsorshipByStatus.hoped)} of sponsorship is only hoped-for and is left out of break-even.`);
      const vh = P.middle.volunteerHours;
      if (vh) why.push(`Volunteer time: about ${vh} hours${vh && P.middle.net > 0 && !notEntered((o.scenarioParticipants || {}).middle) ? `, roughly ${hm(P.middle.net / vh)} raised per hour in the likely case` : ''}.`);
      const matters = [];
      const likelyBlank = notEntered((o.scenarioParticipants || {}).middle);
      if (likelyBlank) matters.push('Not worked out: your likely number is not entered, so these tests would only show the effect at 0.');
      else if (top) matters.push(`Biggest effect on the likely case: “${top.label}” changes it by ${top.change >= 0 ? '+' : ''}${hm(top.change)}.`);
      if (!likelyBlank) a.sens.results.slice(1, 3).forEach((r) => matters.push(`“${r.label}”: ${r.change >= 0 ? '+' : ''}${hm(r.change)}.`));
      if (d.conditional && d.breakEven.reachableWithinCapacity && d.conditional.participants !== d.breakEven.participants) matters.push(`Your assumed ${d.conditional.uses.join(' and ')} would lower break-even to ${d.conditional.participants}${d.conditional.reachableWithinCapacity ? '' : ' (not reachable)'}, but they aren't promised.`);
      return `<article class="sum" aria-labelledby="sum-${i}">
        <h3 id="sum-${i}" class="sum-title">${esc(o.name)}</h3>
        <p class="status-line"><span class="badge ${statusClass(a.status)}"><i aria-hidden="true">${statusIcon(a.status)}</i>${a.missingMoney ? 'Incomplete estimate' : esc(E.STATUS_LABELS[a.status])}</span></p>
        ${a.missingMoney ? financialWarningHtml(o) : `<p class="meaning">${esc(STATUS_MEANING[d.status])}</p>`}
        ${blankNote(o) ? `<p class="warn-callout blank-note">${esc(blankNote(o))}</p>` : ''}
        ${hasProductGrouping(o) ? `<p class="warn-callout">This product option uses group settings that can change item counts or pricing. <a href="#step-quote">Review the supplier step</a> before relying on these results.</p>` : ''}
        <div class="cards">
          <div class="card ${gapOpen ? 'bad' : ''}"><span>${t.survey === 'buy' ? 'Cash needed up front' : 'Cash needed before event day'}</span><b>${hm(x.cashNeededBeforeEvent)}</b><em>Deposit and bills due in advance. You have ${hm(x.cashInHand)} in hand${x.shortBeforeEvent > 0 ? `, so you are short ${hm(x.shortBeforeEvent)}${o.upfrontFundingConfirmed ? ' (the club confirmed it can cover this)' : ' (not yet covered)'}` : ''}.${d.firm.upfront.registrationCashUnknown ? ' Money received from people who paid is not entered yet.' : ''}</em></div>
          <div class="card ${x.largestLoss > 0 || moreLoss ? 'bad' : ''}"><span>Loss if ${nobody} or you cancel</span><b>${hm(x.largestLoss)}${x.cancellationKnown ? '' : ' or more'}</b><em>If ${nobody}: ${hm(x.lossIfNobodyComes)}. If you cancel after the deadline: ${x.cancellationKnown ? hm(x.lossIfCanceled) : 'not entered yet'}. ${moreLoss ? `<strong>Holding it can lose more:</strong> at ${x.worstOnChart.participants} ${esc(t.many)}, firm money comes out at ${hm(x.worstOnChart.net)} (see the chart).` : 'Other turnouts can lose more; check the chart.'} Uses only the terms you entered.</em></div>
          <div class="card ${!d.breakEven.reachableWithinCapacity || d.breakEven.participants > have ? 'bad' : ''}"><span>Needed to break even</span><b>${d.breakEven.reachableWithinCapacity ? `${d.breakEven.participants} ${esc(unit)}` : 'Not reachable'}</b><em>${d.breakEven.reachableWithinCapacity ? '' : `Even all ${d.breakEven.maxFeasible} wouldn't cover costs. `}${d.breakEven.reachableWithinCapacity && d.paid > 0 && d.breakEven.participants <= d.paid ? `Already reached by the ${d.paid} who have paid. ` : ''}Firm money only${t.proceeds ? ', no auction bids' : ''}. You have ${d.paid} paid + ${d.namedCounted} named “yes” = ${have}. Named answers are not money.</em></div>
          <div class="card"><span>Likely case (your estimate)</span><b>${notEntered((o.scenarioParticipants || {}).middle) ? 'Not entered' : hm(P.middle.net)}</b><em>${notEntered((o.scenarioParticipants || {}).middle) ? `Counted as 0 ${esc(t.many)} in the figures: ${hm(P.middle.net)}. ` : ''}Low case ${scenarioNet(o, 'conservative', P.conservative)}, high case ${scenarioNet(o, 'optimistic', P.optimistic)}. These use your own numbers and are not predictions.${t.proceeds ? ' They include your auction and raffle estimates.' : ''}</em></div>
        </div>
        <p class="aloud"><b>What to tell the board (30 seconds):</b> ${esc(readAloud(o, d, P, hm))}</p>
        <div class="sum-grid">
          <section><h4>Why</h4><ul class="plain">${why.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>
          <section><h4>What matters most</h4><ul class="plain">${matters.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
            <h4>Where the numbers stand</h4>${standing(o, d)}</section>
        </div>
        ${d.missing.length ? `<section class="verify"><h4>Must verify before signing</h4><ul class="plain miss">${d.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></section>` : '<p class="hint">Nothing is flagged, but check the “Before anyone signs” list below.</p>'}
        ${auctionPanel(o)}
        ${contractSection(o)}
        ${researchSection(o)}
      </article>`;
    }).join('');
  }

  // ---------- "What would need to change?" (hypothetical; lives only on screen, never saved) ----------
  const freshWhatIf = () => ({ opt: 0, at: 'middle', custom: '', prices: ['', ''], groups: ['', ''] });
  let whatIf = freshWhatIf();
  const FLAG_WORDS = {
    rounded_down_to_whole_groups: (o) => `counted as whole ${T(o).groupName || 'group'}s, rounded down`,
    over_capacity: () => 'capped at the capacity you entered',
    negative_input_set_to_zero: () => 'a negative number was counted as 0',
    fewer_than_already_paid: () => 'fewer than the number already paid, so this mixes money already received with a smaller event',
  };
  function whatIfRequest(o) {
    const sp = o.scenarioParticipants || {};
    const scenario = SC.includes(whatIf.at) ? whatIf.at : null;
    const n = scenario ? sp[scenario] : Number(whatIf.custom);
    const usable = (v) => /^\s*\d*\.?\d+\s*$/.test(String(v)); // a plain, non-negative number typed in a box
    const slots = [0, 1].filter((k) => usable(whatIf.prices[k]));
    return {
      scenario, participants: Number.isFinite(n) ? n : 0, slots,
      prices: slots.map((k) => ({ price: Number(whatIf.prices[k]), groupPrice: usable(whatIf.groups[k]) ? Number(whatIf.groups[k]) : null })),
    };
  }
  // One more sale, in words: singles and full groups are described separately, so mixed pricing is never summed up as
  // "each extra one loses money" when only one kind does.
  function marginWords(m, t) {
    // Each kind of sale is costed on its own (row 83): what the venue bill actually goes up by, plus per-person costs.
    const g = `full ${t.groupName || 'group'} of ${m.groupSize}`;
    const extra = (venue, people) => `${money(venue)} more on the ${t.venue} bill + ${money(Math.round(m.otherPerPerson * people * 100) / 100)} per-person costs`;
    const sCost = `${money(m.singleCost)} in costs (${extra(m.singleVenue, 1)}${m.singleUnderMinimum ? `; the ${t.venue}’s minimum already covers ${m.singleVenue > 0 ? 'part of ' : ''}its charge` : ''})`;
    const gCost = m.groupsUsed ? `${money(m.groupCost)} in costs (${extra(m.groupVenue, m.groupSize)}${m.groupUnderMinimum ? `; the ${t.venue}’s minimum covers only ${m.groupVenue > 0 ? 'part' : 'all'} of it` : ''})` : '';
    if (m.loses === 'all') return m.groupsUsed && !m.singlesUsed
      ? `Every extra sale loses money: everyone buys as a ${g} at ${money(m.groupPrice)}, which adds ${gCost}.`
      : m.groupsUsed
      ? `Every extra sale loses money: a single ${t.one} at ${money(m.price)} adds ${sCost}, and a ${g} at ${money(m.groupPrice)} adds ${gCost}.`
      : `Each extra ${t.one} loses money: it adds ${sCost}, more than its ${money(m.price)} price.`;
    if (m.loses === 'group') return `A ${g} at ${money(m.groupPrice)} loses ${money(-m.groupMargin)}: it adds ${gCost}. A single ${t.one} at ${money(m.price)} still covers its cost (+${money(m.singleMargin)}).`;
    if (m.loses === 'single') return `A single ${t.one} at ${money(m.price)} loses ${money(-m.singleMargin)}: it adds ${sCost}. A ${g} at ${money(m.groupPrice)} still covers its cost (+${money(m.groupMargin)}).`;
    return '';
  }
  function renderWhatIf() {
    if (!state.options[whatIf.opt]) whatIf.opt = 0;
    const i = whatIf.opt, o = state.options[i], t = T(o), ss = state.scenarioSettings;
    const optionChooser = state.options.length > 1 ? `<label class="f"><span>Option</span><select data-whatif="opt">${state.options.map((x, k) => `<option value="${k}" ${k === i ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '';
    if (E.depositTermsMissing(o)) return `<section class="panel whatif" aria-labelledby="wi-title"><h2 id="wi-title">What would need to change?</h2>${optionChooser}${depositPrompt(o)}</section>`;
    const req = whatIfRequest(o), w = E.whatWouldChange(state, o, req), b = w.basis;
    const unitMany = t.survey === 'buy' ? 'items sold' : `paying ${t.many}`;
    // Group rows follow what the engine actually does (group size > 1), including grouping a product option inherited.
    const group = b.groupSize > 1, gName = t.groupName || 'group', gOf = `${gName} of ${b.groupSize}`;
    const target = w.target;
    const firmWords = b.statuses.length === 2 ? 'collected or promised in writing' : b.statuses[0] === 'collected' ? 'already collected' : b.statuses.length ? 'promised in writing' : 'none';
    const sc = req.scenario ? ss[req.scenario].label : null;
    const flags = b.flags.map((f) => (FLAG_WORDS[f] ? FLAG_WORDS[f](o) : f.replace(/_/g, ' ')));
    const basis = [
      `${req.scenario ? `${esc(sc)} case: ` : 'Your number: '}<b>${b.participants} ${esc(unitMany)}</b>${flags.length ? ` <span class="flag">you asked for ${esc(b.requested)}: ${esc(flags.join('; '))}</span>` : ''}.`,
      `Counts ticket money${b.paid > 0 ? (b.paidCash != null ? ` (${hm(b.paidCash)} actually received from the ${b.paid} who paid, plus ${hm(b.price)} each for the rest)` : ` (the ${b.paid} who paid are valued at today’s price because the amount received isn’t entered)`) : ` at ${hm(b.price)} each${group ? ` (${hm(b.groupPrice)} per ${esc(t.groupName)})` : ''}`} and sponsorship ${firmWords}: ${hm(b.firmSponsorship)}.`,
      `Left out: ${b.leftOut > 0 ? Object.entries(b.leftOutByStatus).map(([k, v]) => `${hm(v)} ${{ committed: 'promised in writing (this case counts collected money only)', hoped: 'hoped-for (never counted here)', collected: 'collected' }[k]}`).join(', ') : 'no sponsorship'}; add-ons, other income and auction or raffle estimates. Cost cushion ${esc(b.costCushionPct)}%.`,
    ];
    const lines = [];
    if (req.scenario && notEntered((o.scenarioParticipants || {})[req.scenario])) lines.push(`<b>Your ${esc(SC_WORD[req.scenario])} number is not entered</b>, so this is worked out at 0 ${esc(t.many)}. Enter it on the “Plan for low, likely and high” step, or choose another number.`);
    const firmNet = `<b class="${w.net < 0 ? 'neg' : ''}">${hm(w.net)}</b>`;
    // Break-even: the gap at this number, then a headcount answer only when more people actually raise firm money.
    let beText;
    if (w.net >= 0) beText = `Covered at ${b.participants}: firm money comes out at ${hm(w.net)}.`;
    else {
      beText = `${hm(w.sponsorship.toBreakEven)} more sponsorship ${firmWords === 'already collected' ? 'collected' : 'collected or promised in writing'} would close the gap at ${b.participants}.`;
      if (w.headcount.moreHelps && w.headcount.toBreakEven != null) beText += ` Or, if they actually pay, ${w.headcount.toBreakEven} ${esc(unitMany)} would break even on this basis.`;
    }
    let goalText;
    if (!(target > 0)) goalText = 'No fundraising goal entered (step 1), so only break-even is shown.';
    else if (w.net >= target) goalText = `Reached at ${b.participants}: firm money is ${hm(w.net)}, at or above the ${hm(target)} goal.`;
    else {
      goalText = `${hm(w.sponsorship.toGoal)} more firm sponsorship would reach the ${hm(target)} goal at ${b.participants}.`;
      if (w.headcount.moreHelps && w.headcount.toGoal != null) goalText += ` Or, if they actually pay, ${w.headcount.toGoal} ${esc(unitMany)} would reach it on this basis.`;
      else if (!w.goal.reachableWithinCapacity) goalText += ` <strong>No number up to capacity (${b.maxFeasible}) reaches the goal under these prices and costs:</strong> the most firm money gets to is ${hm(w.goal.bestOnChart.net)} at ${w.goal.bestOnChart.participants}, still ${hm(w.goal.sponsorshipAtBest)} short.`;
    }
    if (!w.headcount.moreHelps && w.headcount.nextParticipants != null) lines.push(`<b>More ${esc(t.many)} won’t help here.</b> Going from ${b.participants} to ${w.headcount.nextParticipants} changes firm money by ${money(w.headcount.nextChange)}.${w.margins.loses !== 'none' ? ' ' + marginWords(w.margins, t) : ''}${w.headcount.breakEvenBelow != null ? ` Firm money breaks even at a smaller number (${w.headcount.breakEvenBelow}) on this basis.` : ''}`);
    if (w.headcount.nextParticipants == null) lines.push(`${b.participants} is the most the capacity you entered allows, so a larger turnout isn’t possible as configured.`);
    if (w.venueMinimumApplied) lines.push(b.minimumParticipants > b.participants
      ? `The ${esc(t.venue)} bills at least ${b.minimumParticipants} ${esc(t.many)} even with ${b.participants}, so each one added up to ${b.minimumParticipants} adds money without adding to that bill.`
      : `A minimum on the ${esc(t.venue)} bill applies at ${b.participants}: you pay more than ${b.participants} would otherwise cost.`);
    lines.push('Headcount answers are what the numbers need, not a forecast of who will come.');

    // req.prices holds only the boxes with a usable price (see whatIfRequest), each remembering its box (slot).
    const alts = w.prices.map((p, k) => ({ ...p, slot: req.slots[k] }));
    const cols = [{ price: b.price, groupPrice: b.groupPrice, net: w.net, sponsorshipToBreakEven: w.sponsorship.toBreakEven, sponsorshipToGoal: w.sponsorship.toGoal, current: true,
      margins: w.margins, nextChange: w.headcount.nextChange, nextParticipants: w.headcount.nextParticipants, groupPriceSource: b.groupPriceIsDeal ? 'current-deal' : 'none' }].concat(alts);
    const groupNote = (c) => ({ kept: ' <span class="muted">(your current deal, kept)</span>', none: ' <span class="muted">(no discount)</span>', typed: '', 'current-deal': '' }[c.groupPriceSource] || '');
    const inherited = hasProductGrouping(o) ? `<p class="warn-callout">This product option still has group settings from another kind of event: groups of ${esc(b.groupSize)}${b.wholeGroupsOnly ? ' (whole groups only)' : ''}${b.groupShare > 0 ? `, ${Math.round(b.groupShare * 100)}% assumed to buy as a group at ${money(b.groupPrice)}` : ''}. These figures use them, exactly as your results do, and applying a price keeps them. If you sell single items, use <a href="#step-quote">Use individual-item sales</a> on the supplier step first.</p>` : '';
    const priceTable = alts.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Price comparison"><table class="res wi-t"><thead><tr><th></th>${cols.map((c) => `<th>${c.current ? 'Current plan' : `Price ${'AB'[c.slot]}`}</th>`).join('')}</tr></thead><tbody>
        <tr><th>Price per ${esc(t.one)}</th>${cols.map((c) => `<td>${hm(c.price)}</td>`).join('')}</tr>
        ${group ? `<tr><th>Price for a full ${esc(gOf)}</th>${cols.map((c) => `<td>${money(c.groupPrice)}${groupNote(c)}</td>`).join('')}</tr>` : ''}
        <tr><th>Firm money at ${b.participants}</th>${cols.map((c) => `<td class="${c.net < 0 ? 'neg' : ''}">${hm(c.net)}</td>`).join('')}</tr>
        <tr><th>More firm sponsorship to break even</th>${cols.map((c) => `<td>${c.sponsorshipToBreakEven > 0 ? hm(c.sponsorshipToBreakEven) : 'none needed'}</td>`).join('')}</tr>
        ${target > 0 ? `<tr><th>More firm sponsorship to reach ${hm(target)}</th>${cols.map((c) => `<td>${c.sponsorshipToGoal > 0 ? hm(c.sponsorshipToGoal) : 'none needed'}</td>`).join('')}</tr>` : ''}
        ${cols.some((c) => c.margins.loses !== 'none') ? `<tr><th>Money from one more sale</th>${cols.map((c) => `<td class="wrap">${c.margins.loses === 'none' ? 'Covers its cost' : `<span class="neg">${marginWords(c.margins, t)}</span>`}${c.nextChange != null && c.margins.groupsUsed && c.nextParticipants - b.participants === b.groupSize ? ` <span class="muted">From ${b.participants} to ${c.nextParticipants}, using your ${Math.round(c.margins.groupShare * 100)}% ${esc(gName)} guess: ${money(c.nextChange)}.</span>` : ''}</td>`).join('')}</tr>` : ''}
        <tr class="noprint"><th></th>${cols.map((c) => `<td>${c.current ? '' : `<button class="small" data-action="apply-price" data-k="${c.slot}">Use ${hm(c.price)} in my plan</button>`}</td>`).join('')}</tr>
      </tbody></table></div>` : '';
    const rows = state.options.length > 1 ? E.compareOptions(state) : [];
    const me = rows[i];
    const altTable = rows.length ? `<h3 class="sub">Compare with your other options</h3>
      <p class="hint">Each option at its <b>own</b> likely number, firm money only. Lower cash or fewer hours isn’t automatically better: check each option’s status and evidence above.</p>
      <p class="hint scroll-hint">Scroll the table sideways to see every column.</p>      <div class="table-wrap" tabindex="0" role="region" aria-label="Options compared"><table class="res wi-t"><thead><tr><th>Option</th><th>Likely number</th><th>Firm money there</th>${target > 0 ? `<th>Reaches ${hm(target)}?</th>` : ''}<th>Cash needed first</th><th>Loss if nobody comes or you cancel</th><th>Volunteer hours</th></tr></thead><tbody>
      ${rows.map((r, k) => E.depositTermsMissing(state.options[k]) ? `<tr><th scope="row">${esc(r.name)}</th><td colspan="${target > 0 ? 6 : 5}" class="wrap">${depositPrompt(state.options[k])}</td></tr>` : `<tr${k === i ? ' class="sel"' : ''}><td><b>${esc(r.name)}</b>${E.optionMoneyIssue(state.options[k]) ? ' <span class="flag">Incomplete estimate</span>' : ''}${k === i ? ' <span class="muted">(selected)</span>' : ''}</td><td>${r.likelyParticipants}</td><td class="${r.firmNetLikely < 0 ? 'neg' : ''}">${hm(r.firmNetLikely)}</td>
        ${target > 0 ? `<td>${r.meetsGoalAtLikely ? 'Yes, at its likely number' : r.goalReachableWithinCapacity ? 'Not at its likely number' : '<b class="neg">Not within capacity</b>'}</td>` : ''}
        <td>${hm(r.cashNeededBeforeEvent)}${k !== i && r.cashNeededBeforeEvent < me.cashNeededBeforeEvent ? ' <span class="flag">less</span>' : ''}</td>
        <td>${hm(r.largestLoss)}${r.cancellationKnown ? '' : ' or more'}${r.worstOnChartLoss > r.largestLoss ? ` <span class="flag">can lose ${hm(r.worstOnChartLoss)} if held</span>` : ''}</td>
        <td>${r.volunteerHours}${k !== i && r.volunteerHours < me.volunteerHours ? ' <span class="flag">fewer</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '';
    const sp = o.scenarioParticipants || {};
    const priceIn = (k) => `<div class="wi-price"><label class="f"><span>Price ${'AB'[k]} per ${esc(t.one)} ($)</span><input type="number" inputmode="decimal" step="any" min="0" data-whatif="prices.${k}" value="${esc(whatIf.prices[k])}"></label>
      ${group ? `<label class="f"><span>Price ${'AB'[k]} for a full ${esc(gOf)} ($)</span><input type="number" inputmode="decimal" step="any" min="0" data-whatif="groups.${k}" value="${esc(whatIf.groups[k])}" placeholder="${b.groupPriceIsDeal ? `blank = keep ${esc(money(b.groupPrice))}` : `blank = ${esc(b.groupSize)} × price`}"></label>` : ''}</div>`;
    return `<section class="panel whatif" aria-labelledby="wi-title">
      <h2 id="wi-title">What would need to change?</h2>
      <p class="hint">Hypothetical answers for one option at one number you choose, on firm money. <b>Nothing here changes your plan</b> unless you press a “Use … in my plan” button. These boxes aren’t saved; they clear when you reload.</p>
      <div class="fields wi-controls">
        ${optionChooser}
        <label class="f"><span>At which number?</span><select data-whatif="at">${SC.map((k) => `<option value="${k}" ${whatIf.at === k ? 'selected' : ''}>${esc(ss[k].label)} case: ${notEntered(sp[k]) ? 'not entered' : `${esc(sp[k])} ${esc(t.many)}`}</option>`).join('')}<option value="custom" ${whatIf.at === 'custom' ? 'selected' : ''}>Another number…</option></select></label>
        ${whatIf.at === 'custom' ? `<label class="f"><span>Number of ${esc(unitMany)}</span><input type="number" inputmode="numeric" step="1" min="0" data-whatif="custom" value="${esc(whatIf.custom)}"></label>` : ''}
      </div>
      ${financialWarningHtml(o)}
      <ul class="plain hint wi-basis">${basis.map((x) => `<li>${x}</li>`).join('')}</ul>
      <div class="cards wi-cards">
        <div class="card ${w.net < 0 ? 'bad' : ''}"><span>Firm money at ${b.participants}</span>${firmNet}<em>Ticket money plus counted sponsorship, minus costs.</em></div>
        <div class="card ${w.net < 0 ? 'bad' : ''}"><span>To break even</span><b>${w.net >= 0 ? 'Covered' : hm(w.sponsorship.toBreakEven) + ' short'}</b><em>${beText}</em></div>
        <div class="card ${target > 0 && w.net < target ? 'bad' : ''}"><span>To reach the goal</span><b>${!(target > 0) ? 'No goal set' : w.net >= target ? 'Reached' : hm(w.sponsorship.toGoal) + ' short'}</b><em>${goalText}</em></div>
      </div>
      <ul class="plain wi-notes">${lines.map((x) => `<li>${x}</li>`).join('')}</ul>
      <h3 class="sub">Compare prices you choose</h3>
      <p class="hint">Type one or two prices to see them at the same ${b.participants} ${esc(unitMany)}. This keeps the number the same: it does <b>not</b> know whether that many would still pay a higher price, or whether a lower price would bring more. ${b.paid > 0 && b.paidCash != null ? `The ${b.paid} who already paid keep the ${hm(b.paidCash)} received. ` : ''}Survey answers were for today’s offer, so a new price needs new answers.</p>
      ${inherited}
      <div class="wi-prices">${priceIn(0)}${priceIn(1)}</div>
      ${priceTable}
      ${alts.length ? `<p class="hint">“Use … in my plan” asks you to confirm, then changes the price in your plan. Your low, likely and high numbers stay as they are: review them, because a different price can change who comes. Survey answers for the old price stop counting until you re-ask or confirm them.</p>` : ''}
      ${alts.length || whatIf.custom !== '' || whatIf.at !== 'middle' ? '<div class="row-actions"><button class="small" data-action="clear-whatif">Clear these what-if boxes</button></div>' : ''}
      ${altTable}
    </section>`;
  }

  // Headline money: whole dollars, never rounded further (rounding to $50 could understate cash needed or a loss).
  const hm = (x) => money(Math.round(Number(x) || 0));

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

  function boardQuestionLines() {
    const questions = window.BFBoardQuestions, today = localYMD(), out = [];
    const regular = state.options.filter((o) => o.kind === 'golf_tee_times');
    const starts = state.options.filter((o) => o.kind === 'golf_shotgun');
    const inputFix = {
      missingPrice: 'Enter the ticket price, including a confirmed 0 for free entry.',
      missingQuote: 'Complete the venue quote, minimums and deposit amount. Enter 0 where the quote specifies none.',
      missingCost: 'Enter the amount of each listed cost.',
      verifyCosts: 'Confirm the written quote and other costs.',
      expiredQuote: 'The entered quote has expired. Ask the course for current terms.',
      futureQuote: 'The quote is dated in the future. Check the date and ask the course to confirm the terms in effect.',
      depositTerms: 'Confirm whether the deposit is refundable and whether it counts toward the bill.',
      sponsorAmount: 'Enter the amount of each sponsorship or replacement donation counted by this case.',
      paidCount: 'Enter the paid count on the Evidence step, including a confirmed 0.',
      receipts: 'Reconcile the paid count with the actual registration receipts on the Evidence step.',
      unusableCount: 'Check the entered turnout, capacity, whole-group rules and paid count.',
      differentCounts: 'The options have different paid counts. Confirm which paid registrations apply to both offers before comparing them.',
      differentReceipts: 'Paid counts match, but receipts differ. Verify the ticket money that would carry over to each offer.',
      inventory: 'In Research, list the planned lots and enter expected winning bids after fees.',
      noIncludedDonation: 'Mark which donated lots are already included in the likely auction proceeds.',
      unknownLotValue: 'Enter an after-fee estimate for each included lot so they can be reconciled with the likely bid total.',
      reconcileLots: 'Reconcile the lots marked as included with the likely auction proceeds after fees. The two totals must match.',
      missingTurnout: 'Enter the likely guest count in Scenarios.',
    };
    const dateWords = (d) => d.label + ' ' + (d.date ? d.date + (d.state === 'passed' ? ' (passed)' : d.state === 'today' ? ' (today)' : '') : 'unknown');
    const golfTitle = 'What would make a shotgun start pay for itself?';
    if ((regular.length || starts.length) && (!regular.length || !starts.length)) {
      out.push({ title: golfTitle, lines: ['Add the other golf format as an option and record both course quotes to compare them at today’s paid count.'] });
    }
    for (const tee of regular) for (const shot of starts) {
      const v = questions.golfQuestion(state, tee, shot, today);
      const lines = [];
      if (v.issue) lines.push((v.optionName ? v.optionName + ' — ' : '') + inputFix[v.issue]);
      else {
        lines.push('At ' + v.paid + ' paid golfers and ' + money(v.receipts) + ' in ticket receipts under either offer, ' +
          tee.name + ' leaves ' + money(v.teeNet) + ' after costs and ' + shot.name + ' leaves ' + money(v.shotgunNet) + ' using collected and written sponsorship.');
        const diff = v.shotgunCostDifference;
        lines.push((diff === 0 ? 'Costs are equal.' : 'Shotgun costs ' + money(Math.abs(diff)) + (diff > 0 ? ' more.' : ' less.')) +
          (v.match ? ' Another ' + money(v.match) + ' in firm sponsorship specific to shotgun would match the tee-time net.' : ' Shotgun already matches or exceeds the tee-time net.') +
          (v.minimum == null ? ' Enter the board minimum to check that target.' :
            v.reachMinimum ? ' The shotgun needs ' + money(v.reachMinimum) + ' more to reach the board minimum of ' + money(v.minimum) + '.' :
              ' The shotgun also reaches the board minimum of ' + money(v.minimum) + '.'));
        lines.push('These are separate targets at the same turnout. Each extra sponsorship dollar assumes no extra fulfillment cost. A sponsor available to either format helps both equally.');
        lines.push('Shotgun upfront costs are ' + money(v.upfront.required) + ', with ' + money(v.upfront.cashInHand) + ' in recorded cash.' +
          (v.upfront.gap ? ' The ' + money(v.upfront.gap) + ' gap ' + (v.clubCanCoverGap ? 'has a funding source confirmed by the club.' : 'still needs funding.') : '') +
          ' Confirm when any new sponsorship will be paid against the course deadlines.');
      }
      [tee, shot].forEach((o, index) => lines.push(o.name + ' dates — ' + v.timing[index].dates.map(dateWords).join(' · ') + '.'));
      lines.push(dateWords(v.timing[0].board) + '. Confirm missing or passed dates with the course or board before committing.');
      out.push({ title: golfTitle + (regular.length * starts.length > 1 ? ' ' + shot.name + ' vs. ' + tee.name : ''), lines });
    }
    for (const o of state.options.filter((option) => option.kind === 'auction')) {
      const v = questions.auctionQuestion(state, o, today);
      const lines = [];
      if (v.issue) lines.push(inputFix[v.issue]);
      else {
        const name = v.names.length === 1 ? v.names[0] : 'Any one of the tied lots (' + v.names.join(', ') + ')';
        lines.push(name + ' contributes an estimated ' + money(v.lotNet) + ' to the likely ' + money(v.proceeds) + ' of bids after fees.');
        lines.push('Losing one such lot changes the likely after-cost net from ' + money(v.likelyNet) + ' to ' + money(v.after) +
          ' at ' + v.participants + ' guests' + (v.participants !== v.requested ? ' (adjusted from ' + v.requested + ' for capacity or whole groups)' : '') + '.' +
          (v.minimum == null ? ' Enter the board minimum to judge the result.' : v.vsMinimum === 0 ? ' That exactly reaches the ' + money(v.minimum) + ' board minimum.' :
            ' That is ' + money(Math.abs(v.vsMinimum)) + (v.vsMinimum < 0 ? ' below' : ' above') + ' the ' + money(v.minimum) + ' board minimum.'));
        lines.push('This assumes unchanged turnout, other bids, other income and remaining costs. Check whether any lot fees are still owed.' +
          (v.costsConfirmed ? '' : ' The quote or other costs still need confirmation.'));
        lines.push((v.sources.every((n) => n > 0) ? 'Club bid outcomes with recorded fees are on file.' : 'At least one largest lot has no comparable club bid outcome with known fees on file.') +
          ' Confirm the donor commitment and check the bid estimate against past sales.');
      }
      const decideBy = (state.criteria || {}).decideBy;
      if (E.isCalendarDate(decideBy)) {
        lines.push('Board decision ' + decideBy + (decideBy < today ? ' (passed). Confirm the new date before relying on these estimates.' : '. Confirm the donor and replacement plan before the board decides.'));
      } else {
        lines.push('Set a board decision date for confirming the donation or choosing a replacement.');
      }
      out.push({ title: 'What if the largest donated lot falls through? ' + o.name, lines });
    }
    return out;
  }

  function boardMemo() {
    const L = [];
    L.push(`# ${state.eventName}`);
    if (state.isDemo) L.push('**FICTIONAL EXAMPLE: every number is made up. Not a recommendation for any real event.**');
    L.push(`Prepared ${showDate(localYMD())} from the organizer's entries. This is a planning summary, not a record of board approval.`);
    L.push(`Fundraising target: ${money(state.settings.fundraisingTarget || 0)} after costs. Figures are rounded to the nearest dollar.`);
    L.push(criteriaLine(), `_${READY_CAVEAT}_`);
    const brief = clubBrief();
    L.push('', '**Which fundraiser should we pursue?**', ...recommendationLines(brief.recommendation), BRIEF_BASIS);
    for (const [i, o] of state.options.entries()) {
      const a = analyse(o), d = a.dec, P = a.proj;
      const optionBrief = brief.options[i];
      L.push('', `## ${o.name}`, `**Status: ${a.missingMoney ? 'Incomplete estimate' : E.STATUS_LABELS[a.status]}**`);
      L.push(a.missingMoney || STATUS_MEANING[a.status]);
      L.push(comparisonNetLine(optionBrief));
      const adjustment = likelyAdjustmentText(optionBrief.b);
      if (adjustment) L.push(adjustment);
      if (blankNote(o)) L.push('', `**${blankNote(o)}**`);
      L.push('', `> **Read-aloud (30 seconds):** ${readAloud(o, d, P, hm)}`, '');
      if (!E.depositTermsMissing(o)) {
        const xp = d.exposure, nobodyM = T(o).survey === 'buy' ? 'nothing sells' : 'nobody comes';
        L.push(`- Cash needed before the event: ${hm(xp.cashNeededBeforeEvent)}. Loss if ${nobodyM} or you cancel after the deadline, under the terms entered: ${hm(xp.largestLoss)}${xp.cancellationKnown ? '' : ' or more (cancellation terms not entered)'}. ${xp.worstOnChartLoss > xp.largestLoss ? `Holding it can lose more: at ${xp.worstOnChart.participants} ${T(o).many}, firm money comes out at ${hm(xp.worstOnChart.net)}.` : 'Other turnouts can lose more; see the chart in the planner.'}`);
        d.reasons.forEach((r) => L.push(`- ${r}`));
        L.push(`- Break-even (firm sponsorship only): ${d.breakEven.reachableWithinCapacity ? d.breakEven.participants + ' ' + T(o).many : 'not reachable within capacity'} of ${d.breakEven.maxFeasible} feasible.`);
        L.push(`- Net: ${SC.map((k) => notEntered((o.scenarioParticipants || {})[k]) ? `${k} not entered (counted as 0: ${hm(P[k].net)})` : `${k} ${hm(P[k].net)} (${P[k].participants})`).join(', ')}.`);
        L.push(`- Cash needed before the event (firm money only): ${hm(d.firm.upfront.required)}; cash in hand ${hm(d.firm.upfront.cashInHand)}${d.firm.upfront.registrationCashUnknown ? ' (registration money received not entered)' : ''}; short by ${hm(d.firm.upfront.gap)}${d.firm.upfront.gap > 0 ? (o.upfrontFundingConfirmed ? ' (club confirmed it can cover this)' : ' (not yet covered)') : ''}.`);
        L.push(`- Worst case if nobody registers: ${hm(d.worst.netIfNobodyRegisters)}. Volunteer hours: ${P.middle.volunteerHours}.`);
        L.push(`- Evidence: ${d.paid} paid${P.middle.upfront.registrationCashUnknown ? ' (amount received not entered)' : ''}, ${d.named} named "yes"${d.named !== d.namedCounted ? ' (not counted: collected for different or unrecorded terms)' : ''}, ${d.definitely} anonymous "yes", ${d.responses} responses.`);
        if (d.missing.length) { L.push('- Must verify before signing:'); d.missing.forEach((m) => L.push(`  - ${m}`)); }
        if (d.cancel) L.push(`- If canceled after the quote's deadline: ${hm(d.cancel.owedToVenue)} to the ${T(o).venue} plus ${hm(d.cancel.alreadySpent)} already spent.`);
      }
      const ct = contractItems(o);
      L.push(`- Contract dates and terms (${unknownCount(ct.items) ? `${unknownCount(ct.items)} still unknown` : 'all entered'}):`);
      ct.items.forEach(([st, text]) => L.push(`  - ${st === 'unknown' ? '[unknown] ' : st === 'late' ? '[date passed or today] ' : ''}${text}`));
      L.push(`  - ${CONTRACT_CAVEAT}`);
      const auction = auctionWorksheet(o);
      if (auction) L.push(`- ${AUCTION_TITLE}`, ...auction.lines.map((line) => `  - ${line}`), `  - ${auction.note}`);
      batch2Lines(o).forEach((l) => L.push(`- ${l}`));
      const rl = researchLines(o);
      if (rl.length) { L.push(`- Research on file (${state.isDemo ? 'fictional; ' : ''}organizer's records; not used in any calculation):`); rl.forEach((l) => L.push(l.startsWith('  ') ? `    - ${l.trim()}` : `  - ${l}`)); }
      readyMemoLines(o).forEach((l) => L.push(l));
    }
    for (const q of brief.questions) L.push('', '## ' + q.title, ...q.lines.map((line) => '- ' + line));
    const au = E.audienceSummary(state);
    if (au.groups || au.fictionalLeftOut) {
      L.push('', '## Audience research', '_Estimates of who could be reached, per counting unit. Sums are not unique people, and units are never added together. None of this is a sign-up or a forecast._');
      au.units.forEach((u) => L.push(`- ${UNIT_LABEL[u.unit]}: ${u.reachSum == null ? 'reach unknown' : `${u.reachSum.toLocaleString('en-US')} estimated reach`} across ${u.groups} group${u.groups === 1 ? '' : 's'}${u.reachUnknown ? ` (${u.reachUnknown} unknown)` : ''}${u.overlaps ? '; some groups overlap' : ''}. Records: ${[u.observations && `${u.observations} sourced`, u.estimates && `${u.estimates} estimates`, u.unrecorded && `${u.unrecorded} without provenance`, u.fictional && `${u.fictional} fictional`].filter(Boolean).join(', ')}; ${u.unchecked} not checked${u.conflicting ? `, ${u.conflicting} conflicting` : ''}.`));
      if (au.fictionalLeftOut) L.push(`- ${au.fictionalLeftOut} fictional group${au.fictionalLeftOut === 1 ? '' : 's'} left out of these totals.`);
      au.warnings.forEach((w) => L.push(`- ${w}`));
    }
    if (state.options.length >= 2) {
      const st = sameTurnout();
      L.push('', '## Same turnout comparison');
      if (!st.r.comparable || [st.A, st.B].some(E.depositTermsMissing)) L.push(`- ${sameTurnoutWords(st.A, st.B, st.r)}`);
      else L.push(`_${st.A.name} and ${st.B.name}, both at ${st.n} ${T(st.A).many}; firm money only. It assumes neither format brings more people or a higher price._`, `- Total costs: ${st.A.name} ${money(st.r.a.expenses)} (${st.r.a.participants}); ${st.B.name} ${money(st.r.b.expenses)} (${st.r.b.participants}). Firm money left: ${money(st.r.a.net)} and ${money(st.r.b.net)}.`, `- ${sameTurnoutWords(st.A, st.B, st.r)}`);
    }
    L.push('', '## Before anyone signs'); SIGNING_QUESTIONS.forEach((q) => L.push(`- [ ] ${q}`));
    L.push('', '_Planning estimates only. No guarantee of results; no tax or legal determinations._');
    return L.join('\n');
  }

  // ---------- research records (Batch 1, DECISION_LOG row 84) ----------
  // A record of what the organizer found out. Nothing here feeds a calculation, a status, the evidence counts or the
  // scenarios: it is shown beside the plan, labeled, and in the board summary.
  const RES_KEYS = ['audiences', 'comparables', 'links'];
  const openRecords = new Set(); // which research records are expanded (screen only, never saved)
  const recDetails = (id, summary, body) => `<details class="rcard" data-rec="${esc(id)}" ${openRecords.has(id) ? 'open' : ''}><summary>${summary}</summary><div class="rcard-body">${body}</div></details>`;
  const research = () => {
    const r = state.research && typeof state.research === 'object' && !Array.isArray(state.research) ? state.research : {};
    return { audiences: Array.isArray(r.audiences) ? r.audiences : [], comparables: Array.isArray(r.comparables) ? r.comparables : [], links: Array.isArray(r.links) ? r.links : [] };
  };
  function ensureResearch() {
    if (!state.research || typeof state.research !== 'object' || Array.isArray(state.research)) state.research = {};
    RES_KEYS.forEach((k) => { if (!Array.isArray(state.research[k])) state.research[k] = []; });
    return state.research;
  }
  const UNIT_LABEL = { people: 'people', households: 'households', businesses: 'businesses', organizations: 'organizations', other: 'other units' };
  const CATEGORY_LABEL = { parents: 'Parents and guardians', alumni: 'Alumni', businesses: 'Local businesses', golfers: 'Golfers', community: 'Community group', staff: 'Coaches and staff', other: 'Other' };
  // Provenance (where it comes from) and verification (whether anyone checked it) are separate choices (row 85).
  const KIND_LABEL = { fictional: 'Fictional example', observation: 'Sourced observation', estimate: 'Organizer estimate', unrecorded: 'Provenance not recorded (older record)' };
  const PROV_CHOICES = [['observation', 'Sourced observation (seen in a source)'], ['estimate', 'Organizer estimate'], ['fictional', 'Fictional example']];
  const VER_LABEL = { unchecked: 'Not checked against the source', checked: 'Checked against the source', conflicting: 'Unresolved or conflicting' };
  const QUALITY_LABEL = { official: 'Organizer’s own published page or flyer', secondhand: 'Secondhand (news, social post, someone told us)', ai: 'AI or search summary (source not opened)', personal: 'Our own experience', unknown: 'Not recorded' };
  const BASIS_LABEL = { unknown: 'Not recorded', advertised: 'Advertised as a group offer', derived: 'My own arithmetic (not an advertised offer)' };
  const COMPARABILITY_LABEL = { unknown: 'Not judged yet', close: 'Close: same kind, units and inclusions', partial: 'Partly: some differences matter', not: 'Not comparable' };
  const TIER_LABEL = { unknown: 'Not recorded', early: 'Early-bird', regular: 'Regular', single: 'Only one price offered' };
  const ASSUMPTION_LABEL = { price: 'Price per person or item', groupPrice: 'Group price', capacity: 'Capacity', conservative: 'Low (conservative) number', middle: 'Likely (middle) number', optimistic: 'High (optimistic) number', sponsorship: 'Sponsorship', costs: 'Costs', other: 'Something else' };
  const kindBadge = (rec) => { const k = E.researchKind(state, rec), v = E.researchVerification(rec); return `<span class="kind kind-${k}">${esc(KIND_LABEL[k])}</span> <span class="kind ver-${v}">${esc(VER_LABEL[v])}</span>`; };
  // Provenance and verification boxes. An older record with no provenance shows that honestly instead of a default.
  const provSel = (p, rec) => `<label class="f"><span>Where this comes from</span><select data-path="${p}.provenance">${PROVENANCES_UI(rec).map(([v, l]) => `<option value="${esc(v)}" ${v === (rec.provenance || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const PROVENANCES_UI = (rec) => (PROV_CHOICES.some(([v]) => v === rec.provenance) ? PROV_CHOICES : [['', 'Not recorded (older record): choose one']].concat(PROV_CHOICES));
  const verSel = (p) => sel(p + '.verification', 'Checked?', Object.entries(VER_LABEL));
  const countText = (v, unit) => (v == null || v === '' ? 'unknown' : `${Number(v).toLocaleString('en-US')} ${unit || ''}`.trim());
  // Only plain web links become clickable; anything else (javascript:, data:, file:) is shown as text, escaped.
  const safeUrl = (u) => { try { const x = new URL(String(u || '').trim()); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (e) { return null; } };
  const sourceHtml = (c) => {
    const u = String(c.sourceUrl || '').trim(), ok = safeUrl(u);
    const link = ok ? `<a href="${esc(ok)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : u ? `${esc(u)} <span class="flag">not opened: only http and https links are clickable</span>` : '';
    return [link, c.sourceRef ? esc(c.sourceRef) : ''].filter(Boolean).join(' · ') || '<span class="muted">no source recorded</span>';
  };
  const optionChecks = (path, ids) => state.options.map((o) => `<label class="chk"><input type="checkbox" data-research-toggle="${path}" value="${esc(o.id)}" ${(ids || []).includes(o.id) ? 'checked' : ''}> ${esc(o.name)}</label>`).join('');
  const missingChecks = (path, ids, known) => (ids || []).filter((id) => !known.has(id)).map((id) => `<label class="chk missing"><input type="checkbox" data-research-toggle="${path}" value="${esc(id)}" checked> <span class="flag">missing: ${esc(id)}</span></label>`).join('');
  function currentAssumption(o, a) {
    if (!o) return 'unknown (option missing)';
    const t = T(o), sp = o.scenarioParticipants || {};
    if (a === 'price') return money(Number(o.price) || 0) + ` per ${t.one}`;
    if (a === 'groupPrice') return (Number(o.groupSize) || 1) > 1 ? (o.groupPrice == null || o.groupPrice === '' ? `${money((Number(o.price) || 0) * Number(o.groupSize))} (no discount)` : money(Number(o.groupPrice))) + ` per ${t.groupName || 'group'} of ${o.groupSize}` : 'no group pricing';
    if (a === 'capacity') return `${E.maxFeasible(o)} ${t.many}`;
    if (a === 'conservative' || a === 'middle' || a === 'optimistic') return notEntered(sp[a]) ? 'not entered' : `${sp[a]} ${t.many}`;
    if (a === 'sponsorship') { const p = E.project(o, 0, E.firmContext(state, o)); return `${money(p.sponsorshipByStatus.collected + p.sponsorshipByStatus.committed)} collected or committed; ${money(p.sponsorshipByStatus.hoped)} hoped-for`; }
    if (a === 'costs') return `${money((o.perParticipantCosts || []).reduce((s, l) => s + (Number(l.amount) || 0), 0))} per ${t.one} + ${money((o.fixedCosts || []).reduce((s, l) => s + (Number(l.amount) || 0), 0))} one-time`;
    return '—';
  }

  function audienceCard(a, j, all) {
    const p = `research.audiences.${j}`, others = all.filter((x) => x.id !== a.id);
    const sum = `<span class="rtitle">${esc(a.name || 'Unnamed group')}</span> <span class="rfacts">${esc(countText(a.reach, UNIT_LABEL[a.unit] || 'units'))} reach${(a.overlapsWith || []).length ? ' · overlaps' : ''}</span> ${kindBadge(a)}`;
    return recDetails(a.id, sum, `<div class="rcard-head"><button class="small danger" data-action="del-research" data-kind="audiences" data-j="${j}">Remove this group</button></div>
      <div class="fields">
        ${txtIn(p + '.name', 'Group', { max: 120, placeholder: 'e.g. current team parents' })}
        ${sel(p + '.category', 'Kind of group', Object.entries(CATEGORY_LABEL))}
        ${sel(p + '.unit', 'Counted in', Object.entries(UNIT_LABEL))}
        ${num(p + '.reach', 'Estimated people or units you could reach', { step: 1, placeholder: 'unknown', help: 'Your estimate of who could hear about it. Not a forecast of who will come.' })}
        ${num(p + '.contacted', 'Actually contacted so far', { step: 1, placeholder: 'unknown' })}
        ${num(p + '.responded', 'Survey responses from this group', { step: 1, placeholder: 'unknown', help: 'Kept here only. The plan’s own survey totals are on step 8.' })}
        ${provSel(p, a)}${verSel(p)}
        ${txtIn(p + '.source', 'Where the number comes from', { wide: true, max: 300, placeholder: 'e.g. roster count from the coach' })}
        ${dateIn(p + '.sourceDate', 'Date of that source')}
      </div>
      <fieldset class="checks-set"><legend>Overlaps with (the same people may be in both)</legend>${others.length ? others.map((x) => `<label class="chk"><input type="checkbox" data-research-toggle="${p}.overlapsWith" value="${esc(x.id)}" ${(a.overlapsWith || []).includes(x.id) ? 'checked' : ''}> ${esc(x.name || 'Unnamed group')}</label>`).join('') : '<span class="muted">No other groups yet.</span>'}${missingChecks(p + '.overlapsWith', a.overlapsWith, new Set(others.map((x) => x.id)))}</fieldset>
      <fieldset class="checks-set"><legend>Relevant to</legend>${optionChecks(p + '.optionIds', a.optionIds)}${missingChecks(p + '.optionIds', a.optionIds, new Set(state.options.map((o) => o.id)))}</fieldset>
      ${area(p + '.notes', 'Notes', 'Counts and context only. No names, contact details, student information or sensitive personal details.')}`);
  }

  function comparableCard(c, j) {
    const p = `research.comparables.${j}`;
    const price = c.priceSingle == null || c.priceSingle === '' ? 'price unknown' : `${money(Number(c.priceSingle))}${c.feesPerPerson == null || c.feesPerPerson === '' ? ' + fees unknown' : Number(c.feesPerPerson) ? ` + ${money(Number(c.feesPerPerson))} fees` : ''}`;
    const sum = `<span class="rtitle">${esc(c.name || 'Unnamed event')}</span> <span class="rfacts">${esc(price)}${c.eventDate && E.isCalendarDate(c.eventDate) ? ` · ${esc(c.eventDate.slice(0, 4))}` : ''} · ${esc((COMPARABILITY_LABEL[c.comparability] || COMPARABILITY_LABEL.unknown).split(':')[0])}</span> ${kindBadge(c)}`;
    return recDetails(c.id, sum, `<div class="rcard-head"><button class="small danger" data-action="del-research" data-kind="comparables" data-j="${j}">Remove this event</button></div>
      <p class="hint">Source: ${sourceHtml(c)}</p>
      <div class="fields">
        ${txtIn(p + '.name', 'Event name', { max: 160 })}
        ${txtIn(p + '.eventType', 'Kind and format', { max: 160, placeholder: 'e.g. golf scramble, shotgun start' })}
        ${txtIn(p + '.location', 'Where', { max: 160 })}
        ${dateIn(p + '.eventDate', 'Event date')}
        ${txtIn(p + '.sourceUrl', 'Web address (if any)', { wide: true, max: 2000, placeholder: 'https://…' })}
        ${txtIn(p + '.sourceRef', 'Or other source', { wide: true, max: 300, placeholder: 'e.g. printed flyer, phone call with the organizer' })}
        ${dateIn(p + '.checkedDate', 'Date you checked')}
        ${sel(p + '.sourceQuality', 'Source quality', Object.entries(QUALITY_LABEL))}
        ${provSel(p, c)}${verSel(p)}
        ${txtIn(p + '.format', 'Format details', { max: 200, placeholder: 'e.g. 18 holes, foursomes' })}
        ${txtIn(p + '.included', 'What the price includes', { wide: true, max: 300, placeholder: 'e.g. golf, cart, lunch, gift' })}
        ${sel(p + '.pricingTier', 'Price shown is', Object.entries(TIER_LABEL))}
        ${num(p + '.priceSingle', 'Advertised price per person ($)', { placeholder: 'unknown' })}
        ${num(p + '.priceGroup', 'Advertised group price ($)', { placeholder: 'unknown' })}
        ${num(p + '.groupSize', 'Group size', { step: 1, placeholder: 'unknown' })}
        ${sel(p + '.groupPriceBasis', 'Group price is', Object.entries(BASIS_LABEL))}
        ${num(p + '.feesPerPerson', 'Required fees per person, not in the price ($)', { placeholder: 'unknown', help: 'Processing or other required fees. Enter 0 if there are none; leave blank if you don’t know.' })}
        ${txtIn(p + '.feesNote', 'About the fees', { max: 200 })}
      </div>
      <h4 class="sub">Results (only if known)</h4>
      <p class="hint">An advertised price, a capacity or a “sold out” claim is not a result. Record a result only from something like the organizer’s report.</p>
      <div class="fields">
        ${num(p + '.advertisedCapacity', 'Advertised capacity (a limit, not attendance)', { step: 1, placeholder: 'unknown' })}
        ${num(p + '.resultAttendance', 'Reported participation (as reported; not paid registrations)', { step: 1, placeholder: 'unknown' })}
        ${txtIn(p + '.resultNote', 'Where that result comes from', { wide: true, max: 300 })}
      </div>
      <div class="checks">${chk(p + '.resultVerified', 'The organizer reported this number in writing (still not a count of paid registrations)')}</div>
      <div class="fields">
        ${sel(p + '.comparability', 'How comparable to your event?', Object.entries(COMPARABILITY_LABEL))}
        ${area(p + '.differences', 'Differences and limitations', 'e.g. includes dinner, private club, nine holes, early-bird price, cart unclear, page not fully opened.')}
      </div>
      <fieldset class="checks-set"><legend>Compare with</legend>${optionChecks(p + '.optionIds', c.optionIds)}${missingChecks(p + '.optionIds', c.optionIds, new Set(state.options.map((o) => o.id)))}</fieldset>`);
  }

  function linkCard(l, j, recs) {
    const p = `research.links.${j}`, o = state.options.find((x) => x.id === l.optionId);
    const optSel = `<label class="f"><span>Option</span><select data-path="${p}.optionId">${o ? '' : `<option value="${esc(l.optionId)}" selected>(option no longer exists)</option>`}${state.options.map((x) => `<option value="${esc(x.id)}" ${x.id === l.optionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`;
    const known = new Set(recs.map((r) => r.id));
    const sum = `<span class="rtitle">${esc(ASSUMPTION_LABEL[l.assumption] || 'Assumption')}${o ? `: ${esc(o.name)}` : ' (option missing)'}</span> <span class="rfacts">cites ${(l.researchIds || []).length}</span>`;
    return recDetails(l.id, sum, `<div class="rcard-head"><button class="small danger" data-action="del-research" data-kind="links" data-j="${j}">Remove this note</button></div>
      <div class="fields">${optSel}${sel(p + '.assumption', 'Assumption', Object.entries(ASSUMPTION_LABEL))}</div>
      <p class="hint">In your plan now: <b>${esc(currentAssumption(o, l.assumption))}</b>. Citing research here does not change it.</p>
      <fieldset class="checks-set"><legend>Research that supports it</legend>${recs.length ? recs.map((r) => `<label class="chk"><input type="checkbox" data-research-toggle="${p}.researchIds" value="${esc(r.id)}" ${(l.researchIds || []).includes(r.id) ? 'checked' : ''}> ${esc(r.name || 'Unnamed record')} <span class="muted">(${esc(KIND_LABEL[E.researchKind(state, r)])})</span></label>`).join('') : '<span class="muted">Add audience groups or similar events first.</span>'}${missingChecks(p + '.researchIds', l.researchIds, known)}</fieldset>
      ${area(p + '.note', 'Why this research supports it', 'Say what it shows and what it doesn’t.')}`);
  }

  function audienceTotals() {
    const s = E.audienceSummary(state);
    if (!s.groups && !s.fictionalLeftOut) return '';
    const mix = (u) => [u.observations && `${u.observations} sourced`, u.estimates && `${u.estimates} estimate${u.estimates === 1 ? '' : 's'}`, u.unrecorded && `${u.unrecorded} older record${u.unrecorded === 1 ? '' : 's'} without provenance`,
      u.fictional && `${u.fictional} fictional`, u.unchecked && `${u.unchecked} not checked`, u.conflicting && `${u.conflicting} conflicting`].filter(Boolean).join(', ');
    return `<div class="rsum"><h3 class="sub">Totals by counting unit</h3><ul class="plain">${s.units.map((u) => `<li><b>${esc(UNIT_LABEL[u.unit])}:</b> ${u.reachSum == null ? 'reach unknown' : `${u.reachSum.toLocaleString('en-US')} estimated reach`} across ${u.groups} group${u.groups === 1 ? '' : 's'}${u.reachUnknown ? ` (${u.reachUnknown} unknown, not counted)` : ''}; ${esc(mix(u))}. <i>A sum of records, not unique ${esc(UNIT_LABEL[u.unit])}${u.overlaps ? ': some groups overlap, so the real number is lower' : ''}.</i>${u.contactedSum != null ? ` Contacted: ${u.contactedSum.toLocaleString('en-US')}.` : ''}${u.respondedSum != null ? ` Responses: ${u.respondedSum.toLocaleString('en-US')}.` : ''}</li>`).join('')}</ul>
      ${s.unitCount > 1 ? '<p class="hint">Different units are never added together: households, businesses and people are not the same thing.</p>' : ''}
      ${s.fictionalLeftOut ? `<p class="hint">${s.fictionalLeftOut} fictional group${s.fictionalLeftOut === 1 ? ' is' : 's are'} left out of these totals.</p>` : ''}
      ${s.warnings.length ? `<ul class="plain warnlist">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  // One observation, in words: what was advertised, for whom, when, on what terms, and how sure we are.
  const TIER_WORDS = { early: 'early-bird price', regular: 'regular price', single: 'only price offered', unknown: 'pricing tier not recorded' };
  const BASIS_WORDS = { advertised: 'advertised', derived: 'your own arithmetic, not an advertised offer', unknown: 'basis not recorded' };
  function obsPrice(o) {
    const parts = [o.priceSingle != null ? `${money(o.priceSingle)} per person (advertised)` : 'individual price not recorded'];
    if (o.priceGroup != null) parts.push(`${money(o.priceGroup)} for a group of ${o.groupSize == null ? 'unknown size' : o.groupSize} (${BASIS_WORDS[o.groupPriceBasis]})`);
    return parts.join('; ');
  }
  const obsStatus = (o) => `${KIND_LABEL[o.provenance].toLowerCase()}; ${VER_LABEL[o.verification].toLowerCase()}`;
  const COMP_WORDS = { close: 'close comparison', partial: 'partly comparable', not: 'not comparable', unknown: 'comparability not judged' };
  function obsText(o, rec) {
    const src = [rec && rec.sourceUrl ? String(rec.sourceUrl).trim() : '', rec && rec.sourceRef ? String(rec.sourceRef).trim() : ''].filter(Boolean).join('; ');
    return `${o.name} (${o.eventDate ? showDate(o.eventDate) : 'date not recorded'}): ${obsPrice(o)}; ${TIER_WORDS[o.pricingTier]}; includes: ${o.included || 'not recorded'}; required fees: ${o.feesKnown ? `${money(o.feesPerPerson)} per person` : 'unknown'}`
      + `${o.advertisedCapacity != null ? `; advertised capacity ${o.advertisedCapacity} (a limit, not attendance)` : ''}${o.reportedParticipation != null ? `; reported participation ${o.reportedParticipation} (as reported${o.reportedInWriting ? ' in writing' : ''}; not paid registrations)` : ''}`
      + `; ${COMP_WORDS[o.comparability]}; ${obsStatus(o)}${src ? `; source: ${src}` : '; no source recorded'}${rec && rec.checkedDate ? `, checked ${showDate(rec.checkedDate)}` : ''}${rec && rec.differences ? `. Limitations: ${String(rec.differences).trim().replace(/[.\s]+$/, '')}` : ''}.`;
  }
  function comparablesForOption(o) {
    const c = E.comparableSummary(state, o);
    if (!c.linked && !c.fictional.length) return `<h4 class="sub">${esc(o.name)}</h4><p class="hint">No similar events linked.</p>`;
    const rec = (id) => research().comparables.find((x) => x.id === id) || {};
    return `<h4 class="sub">${esc(o.name)} <span class="muted">(your price: ${money(Number(o.price) || 0)})</span></h4>
      ${c.linked ? `<p class="scroll-hint hint">Scroll the table sideways to see every column.</p><div class="table-wrap" tabindex="0" role="region" aria-label="${esc(o.name)}: similar events side by side"><table class="res obs-t"><thead><tr><th>Event</th><th>Date</th><th>Advertised price</th><th>Tier</th><th>Includes</th><th>Required fees</th><th>Status</th><th>Source</th></tr></thead><tbody>
        ${c.observations.map((x) => `<tr data-obs="${esc(x.id)}"><td><b>${esc(x.name)}</b><br><span class="muted">${esc(cap(COMP_WORDS[x.comparability]))}</span></td><td>${x.eventDate ? esc(showDate(x.eventDate)) : 'not recorded'}</td>
          <td>${esc(obsPrice(x))}${x.advertisedCapacity != null ? `<br><span class="muted">capacity ${x.advertisedCapacity} (a limit, not attendance)</span>` : ''}${x.reportedParticipation != null ? `<br><span class="muted">reported participation ${x.reportedParticipation} (not paid registrations)</span>` : ''}</td>
          <td>${esc(TIER_WORDS[x.pricingTier])}</td><td>${esc(x.included || 'not recorded')}</td><td>${x.feesKnown ? `${money(x.feesPerPerson)} per person` : '<b>unknown</b>'}</td>
          <td>${esc(KIND_LABEL[x.provenance])}<br><span class="${x.verification === 'checked' ? '' : 'flag'}">${esc(VER_LABEL[x.verification])}</span></td><td>${sourceHtml(rec(x.id))}${rec(x.id).checkedDate ? `<br><span class="muted">checked ${esc(showDate(rec(x.id).checkedDate))}</span>` : ''}${rec(x.id).differences ? `<br><span class="muted">${esc(rec(x.id).differences)}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${c.fictional.length ? `<p class="hint">Fictional, not compared: ${c.fictional.map((x) => esc(x.name)).join('; ')}.</p>` : ''}
      <ul class="plain obs-notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <p class="hint">No combined price range is shown: package contents, admission, pricing tier, year and checking differ between events. Compare them line by line.</p>`;
  }

  function problemsBox() {
    const p = E.researchProblems(state);
    if (!p.length) return '';
    return `<div class="callout warn-callout research-problems" role="status"><span><b>Research links that point at nothing (${p.length}).</b> They are kept until you remove them.</span>
      <ul class="plain">${p.map((x) => `<li>${esc(x.text)} <button class="small" data-action="fix-research" data-kind="${esc(x.kind)}" data-id="${esc(x.recordId)}" data-field="${esc(x.field)}" data-missing="${esc(x.missingId)}">${x.field === 'optionId' ? 'Remove this note' : 'Remove the broken link'}</button></li>`).join('')}</ul></div>`;
  }

  // The club's own dated outcomes. Each original estimate belongs to the historical event and format.
  const clubHistory = () => (state.research && state.research.clubHistory) || [];
  let outcomeOptionId = '';
  const MAX_OUTCOME_VALUE = Math.floor(Number.MAX_SAFE_INTEGER / 400);
  const validOutcomeNumber = (v, count) => v == null || v === '' ||
    Number.isFinite(v) && Math.abs(v) <= MAX_OUTCOME_VALUE && (count ? v >= 0 && Number.isInteger(v) : Number(v.toFixed(2)) === v);

  const accountLabels = {ticketSales: 'Admission or product sales', sponsorship: 'Cash sponsorship',
    other: 'Other proceeds, including auction bids and add-ons', costs: 'Event costs'};
  const accuracyMoney = (v) => amountText.format(v);
  const amountText = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 2});

  function accuracyLines(r) {
    const lines = [], actual = A.actual(r);
    const future = E.isCalendarDate(r.eventDate) && r.eventDate > localYMD();
    if (!r.finalizedOn && (A.amount(r.actualNet) || A.categories.some((k) => r.actualAmounts && A.amount(r.actualAmounts[k])))) {
      lines.push(future ? 'The event date is in the future. Amounts entered as actuals are held for later confirmation.' :
        'These actual amounts are provisional until the club confirms its final accounts.');
    }
    if (r.forecast) {
      const f = r.forecast, differences = A.differences(r);
      lines.push(f.preDecision ? 'Saved before the board committed, according to the organizer.' : 'Planning snapshot. Pre-decision timing was not recorded at capture.');
      lines.push('Estimates frozen on ' + showDate(r.estimatedOn) + '. Board’s independent net: ' +
        (f.boardNet == null ? 'not entered' : accuracyMoney(f.boardNet)) + '. Prior comparable: ' +
        (f.prior ? f.prior.name + ' (' + showDate(f.prior.eventDate) + '), ' + accuracyMoney(f.prior.net) + ' final net.' : 'none selected.'));
      for (const k of A.categories) {
        const v = r.actualAmounts && r.actualAmounts[k];
        const diff = future ? null : differences[k];
        lines.push(accountLabels[k] + ': estimated ' + accuracyMoney(f.amounts[k]) +
          ', actual ' + (future ? 'pending event' : A.amount(v) ? accuracyMoney(v) : 'unknown') +
          (diff == null ? '' : ', actual minus estimate ' + accuracyMoney(diff)) + '.');
      }
    }
    if (!future && actual.fromParts != null) lines.push('Net from all four actual amounts: ' + accuracyMoney(actual.fromParts) + '.');
    if (!future && actual.conflict) lines.push('The four actual amounts disagree with the reported final net. Reconcile them before confirming the result.');
    if (r.finalizedOn) lines.push('Final accounts confirmed ' + showDate(r.finalizedOn) + '.');
    return lines;
  }

  function accuracySummary() {
    const scored = A.score(clubHistory(), localYMD(), state.isDemo);
    const overall = scored.planner, names = {planner: 'Planner likely net', board: 'Board’s independent net', prior: 'Prior comparable’s final net'};
    const summary = overall.count ? `Across ${overall.count} completed ${overall.count === 1 ? 'event' : 'events'}, the planner missed final net by ${accuracyMoney(overall.meanAbsoluteMiss)} on average in either direction. It overestimated ${overall.overestimates} of ${overall.count}.` :
      'No completed pre-decision forecasts to score yet.';
    return `<section class="rsum"><h3 class="sub">How close were our forecasts?</h3><p>${esc(summary)}</p>
      <p class="hint">This counts this plan’s confirmed event accounts with an estimate saved before the event and before the board committed. Past events entered afterward and fictional records stay out.</p>
      ${scored.matched ? `<p>All three methods were recorded in advance for the same ${scored.matched} ${scored.matched === 1 ? 'event' : 'events'}.</p><div class="table-wrap" tabindex="0" role="region" aria-label="Forecast comparison"><table class="res"><thead><tr><th>Estimate</th><th>Average absolute miss</th><th>Times too high</th></tr></thead><tbody>
        ${Object.entries(scored.methods).map(([k,m]) => `<tr><th scope="row">${names[k]}</th><td>${accuracyMoney(m.meanAbsoluteMiss)}</td><td>${m.overestimates} of ${m.count}</td></tr>`).join('')}</tbody></table></div><p class="hint">A smaller miss was closer on these events. A few events cannot establish how the next one will turn out.</p>` :
        '<p class="hint">To compare methods, record the board’s own net estimate and select a past comparable before the decision. All three methods use the same completed events.</p>'}
      ${scored.duplicate ? `<p class="flag">Excluded ${scored.duplicate} forecast record(s) because multiple completed accounts share the same event name and date. Reconcile the completed accounts. You can keep proposals for options the board did not choose.</p>` : ''}</section>`;
  }

  function clubOutcomeLines(r) {
    const finalNet = A.actual(r).net;
    const unit = T({kind: r.kind}).many, delta = E.clubOutcomeDifference({...r, actualNet: finalNet}, localYMD());
    const shown = (n, m) => n == null || n === '' ? 'unknown' : m ? money(n) : n + ' ' + unit;
    const date = (n) => n ? showDate(n) : 'date unknown';
    const lines = [
      `${r.name || 'Unnamed fundraiser'} (${T({kind:r.kind}).label}, ${date(r.eventDate)}${r.fictional || state.isDemo ? ', fictional' : ''}).`,
      `${r.captured ? 'Saved likely estimate' : 'Original estimate from club records'} (${date(r.estimatedOn)}): ${shown(r.estimatedCount, false)}, net ${shown(r.estimatedNet, true)}.`,
      delta.issue === 'futureEvent' ? 'Outcome pending confirmation of the event date.' : `Club’s reported outcome: ${shown(r.actualCount, false)}, net ${shown(finalNet, true)}. Source: ${r.source || 'not recorded'}.`,
    ];
    if (r.qualification) lines.push(r.qualification);
    if (delta.issue === 'estimateAfterEvent') lines.push('The estimate is dated after the event. Check the dates before comparing it with the result.');
    if (delta.issue === 'futureEvent') lines.push('The event is dated in the future. Check the event date and the outcome before comparing them.');
    if (delta.issue === 'datesMissing' && (r.actualCount != null || r.actualNet != null)) lines.push('Enter the event date and the original estimate date to compare them.');
    if (delta.count != null) lines.push(delta.count === 0 ? 'Turnout matched the estimate.' : `Actual turnout was ${Math.abs(delta.count)} ${unit} ${delta.count > 0 ? 'above' : 'below'} the estimate.`);
    if (delta.net != null) lines.push(delta.net === 0 ? 'Net proceeds matched the estimate.' : `Actual net proceeds were ${money(Math.abs(delta.net))} ${delta.net > 0 ? 'above' : 'below'} the estimate.`);
    return lines.concat(accuracyLines(r));
  }

  function outcomeNumberField(path, label, count, nonnegative = false) {
    const value = getPath(state, path);
    return `<label class="f"><span>${esc(label)}</span><input type="number" data-path="${esc(path)}" data-type="${count ? 'outcomeCount' : nonnegative ? 'outcomePositive' : 'outcomeNet'}" step="${count ? '1' : '0.01'}" ${count || nonnegative ? 'min="0"' : ''} value="${value == null ? '' : esc(value)}" placeholder="unknown"></label>`;
  }

  function clubOutcomeCard(r, j) {
    const p = 'research.clubHistory.' + j, unit = T({kind: r.kind}).many;
    const current = !r.fromPriorPlan && state.options.find((o) => o.id === r.optionId);
    const lines = clubOutcomeLines(r);
    return recDetails(r.id, `<span class="rtitle">${esc(r.name || 'Untitled club result')}</span> <span class="rfacts">${esc(r.eventDate ? showDate(r.eventDate) : 'date unknown')}</span>`,
      `<p class="hint">${esc(T({kind:r.kind}).label)} · ${esc(r.fromPriorPlan ? 'earlier plan' : current ? current.name : 'original option removed')}${current && (current.kind || 'generic') !== r.kind ? ' · original format differs from the current option' : ''}${r.fictional || state.isDemo ? ' · fictional' : ''}</p>
      <div class="fields">${r.forecast && r.forecast.preDecision ? '<p>Event and date locked at capture: ' + esc(r.name) + ' · ' + esc(showDate(r.eventDate)) + '.</p>' :
        txtIn(p + '.name', 'Event name', {max:160}) + dateIn(p + '.eventDate', 'Event date')}
        ${!r.captured ? dateIn(p + '.estimatedOn', 'Date of original estimate') +
          outcomeNumberField(p + '.estimatedCount', 'Originally estimated ' + unit, true) +
          outcomeNumberField(p + '.estimatedNet', 'Originally estimated net ($)', false) : ''}
        ${outcomeNumberField(p + '.actualCount', 'Actual ' + unit, true)}
        ${outcomeNumberField(p + '.actualNet', 'Actual net after all expenses ($)', false)}
        ${txtIn(p + '.source', 'Source of final numbers', {max:300, placeholder:'e.g., final treasurer report and event tally'})}</div>
      <details class="qs" data-keep="${esc(r.id)}-accounts" ${openRecords.has(r.id + '-accounts') ? 'open' : ''}><summary>Final accounts by category</summary>
        <p class="hint">Use net auction receipts after item expenses under Other. Enter remaining event costs once. Include voluntary donations under Other and ticket add-ons there too. An empty category is unknown. Enter 0 when the final accounts show none.</p>
        <div class="fields">${A.categories.map((k) => outcomeNumberField(p + '.actualAmounts.' + k, accountLabels[k] + ' ($)', false, k !== 'other')).join('')}</div>
      </details>
      <p class="hint">Confirm once the event has taken place on its recorded date and you have checked the final ledger.</p>
      <button class="small ghost" data-action="confirm-club-actuals" data-j="${j}">Confirm final accounts</button>
      <ul class="plain">${lines.slice(1).map((l) => '<li>' + esc(l) + '</li>').join('')}</ul>
      <button class="small danger" data-action="delete-club-result" data-j="${j}">Remove this record</button>`);
  }

  function clubOutcomeEditor() {
    const history = clubHistory(), o = state.options.find((x) => x.id === outcomeOptionId) || state.options[0];
    const draftPath = 'options.' + state.options.indexOf(o) + '.forecastDraft';
    const prior = state.isDemo ? [] : A.priorOptions(history, o.kind || 'generic', localYMD());
    const priorChoices = [['', 'No comparable selected'], ...prior.map((row) => [row.id, row.name + ' · ' + showDate(row.eventDate) + ' · ' + accuracyMoney(A.actual(row).net)])];
    return `<section class="panel"><details class="qs" data-keep="outcome-editor" ${openRecords.has('outcome-editor') ? 'open' : ''}><summary>Past club results${history.length ? ' (' + history.length + ')' : ''}</summary>
      <p>Save a likely estimate before the event, then enter actual turnout and net proceeds from your records. You can also enter an earlier event from its original budget and final report. Enter a loss as a negative net. The records stay with this plan and its backup.</p>
      <label class="f"><span>Fundraiser option</span><select id="club-outcome-option" data-outcome-option>${state.options.map((x) => `<option value="${esc(x.id)}" ${x === o ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="fields">${dateIn(draftPath + '.eventDate', 'Scheduled event date')}
        ${outcomeNumberField(draftPath + '.boardNet', 'Board’s independent estimate of net proceeds ($)', false)}
        ${sel(draftPath + '.priorId', 'Comparable event for a baseline', priorChoices)}</div>
      <p class="hint">Use the board’s estimate made before seeing the planner’s result. Pick a prior event of this format with similar scale, audience and costs. The list uses completed events in this plan with confirmed accounts. You can leave either estimate blank.</p>
      ${chk(draftPath + '.preDecision', 'The board has not committed to this event yet.', 'For accuracy tracking, check this and enter a future event date before saving. The plan freezes the date, event name, amounts and comparison choices.')}
      <div class="row-actions"><button class="small" data-action="capture-club-result" data-i="${state.options.indexOf(o)}">Save current likely estimate</button><button class="small" data-action="add-club-result" data-i="${state.options.indexOf(o)}">Enter a past club event</button></div>
      ${state.isDemo ? '' : '<label class="f"><span>Bring completed club results from another plan backup</span><small>Only confirmed final event records are added. Existing records, current inputs and registrations are kept.</small><input type="file" accept=".json,application/json" data-action="import-club-outcomes"></label>'}
      ${accuracySummary()}${history.map(clubOutcomeCard).join('')}</details></section>`;
  }

  function createClubResult(o, capture) {
    const kind = o.kind || 'generic', today = localYMD();
    const r = {id: uid('hist_'), optionId: o.id, kind, name: '', eventDate: null, captured: capture,
      fictional: !!state.isDemo, estimatedOn: null, estimatedCount: null, estimatedNet: null, actualCount: null, actualNet: null, source: ''};
    if (capture) {
      const brief = E.decisionBrief(state, o), likely = brief.cases.middle;
      if (likely.issue || likely.net == null || !validOutcomeNumber(likely.net, false) || !validOutcomeNumber(likely.participants, true)) {
        say(likely.issue === 'missingBid' ? 'Enter the likely net auction proceeds first. Enter 0 if you intend to assume no proceeds.' : 'Check the missing or conflicting figures in the Results overview before saving a forecast.');
        return false;
      }
      const saved = A.snapshot(state, o, likely, o.forecastDraft || {}, today);
      if (!saved.forecast) {
        say(saved.issue === 'date' ? 'Enter an event date after today to save a pre-decision forecast.' :
          saved.issue === 'prior' ? 'Choose a completed comparable with confirmed accounts, or leave the comparable blank.' :
          'Check the forecast inputs and the dollar amounts before saving.');
        return false;
      }
      r.forecast = saved.forecast;
      r.eventDate = r.forecast.eventDate;
      r.name = r.forecast.eventName;
      delete o.forecastDraft;
      r.estimatedOn = today;
      r.estimatedCount = likely.participants;
      r.estimatedNet = likely.net;
      const details = ['Saved using the income and cost settings for the likely scenario.'];
      if (likely.requested !== likely.participants) details.push(`Entered turnout ${likely.requested}, modeled turnout ${likely.participants} after capacity or group limits.`);
      if (!brief.quoteVerified || !brief.costsVerified) details.push('Quote or costs were unverified when saved.');
      r.qualification = details.join(' ');
    }
    const researchState = ensureResearch();
    if (!researchState.clubHistory) researchState.clubHistory = [];
    researchState.clubHistory.push(r);
    openRecords.add('outcome-editor'); openRecords.add(r.id);
    return true;
  }

  // Comparisons made from the club's own registration logs and auction settlement sheets.
  function clubEvidenceLines(o) {
    const h = o.clubHistoryResearch;
    if (!h) return [];
    const C = window.BFClubHistory, today = localYMD();
    if (C.isGolf(o) && (h.golf || []).some((r) => state.isDemo || !r.fictional)) {
      const report = C.golfComparison(state, o, today);
      if (report.issue) return [report.issue];
      const lines = [`At ${report.weeks} weeks out, this option has ${report.paid} paid golfers. ${report.matches.length} comparable historical checkpoint${report.matches.length === 1 ? '' : 's'} at that stage.`];
      const offer = state.snapshot || {};
      lines.push(`Current single price ${o.price == null || o.price === '' ? 'unknown' : money(o.price)}. Location: ${offer.locationArea || 'unknown'}. Inclusions: ${offer.included || 'unknown'}.`);
      for (const {record: r, difference} of report.matches) {
        lines.push(`${r.name || 'Past golf event'} (${r.eventDate}): ${r.paid} paid then, ${r.final == null || r.final === '' ? 'final turnout unknown' : r.final + ' final golfers'}. Today’s count is ${difference === 0 ? 'the same' : Math.abs(difference) + (difference > 0 ? ' higher' : ' lower')}. ${r.price == null || r.price === '' ? 'Past price unknown' : 'Past single price ' + money(r.price)}. Course and package: ${r.coursePackage || 'unknown'}. Source: ${r.source}.${r.notes ? ' ' + r.notes : ''}`);
      }
      return lines;
    }
    if (o.kind === 'auction' && (h.lots || []).length) {
      const inventory = C.auctionInventory(state, o);
      return inventory.lots.map((lot) => {
        const record = h.lots.find((r) => r.id === lot.id);
        const bids = C.lotBids(state, record, today);
        const unsold = bids.filter((b) => b.record.outcome === 'unsold').length;
        const net = lot.estimatedNet == null ? 'unknown' : money(lot.estimatedNet);
        const recent = bids.reduce((latest, next) => !latest || next.record.eventDate > latest.record.eventDate ? next : latest, null);
        let line = `${lot.name}: organizer’s expected proceeds after fees ${net}. ${bids.length} comparable past result${bids.length === 1 ? '' : 's'}, including ${unsold} unsold. ${lot.includedInLikely ? 'Marked as already in the likely proceeds.' : 'Separate from the likely proceeds.'}`;
        if (recent) line += ` Most recent: ${recent.record.name || 'past lot'} (${recent.record.eventDate}), ${recent.record.outcome === 'unsold' ? 'unsold' : 'winning bid ' + money(recent.gross)}, ${recent.net == null ? 'fees unknown' : money(recent.net) + ' after fees'}. Source: ${recent.record.source}.`;
        return line;
      });
    }
    return [];
  }

  function clubRecordAction(action, label, i, j, k) {
    return `<button class="small" data-action="club-record" data-record-action="${action}" data-i="${i}" data-j="${j ?? ''}" data-k="${k ?? ''}">${esc(label)}</button>`;
  }
  function clubAmount(path, label) {
    return `<label class="f"><span>${esc(label)}</span><input type="number" step="0.01" min="0" max="1000000000" data-type="clubAmount" data-path="${path}" value="${esc(getPath(state, path))}" placeholder="Unknown"></label>`;
  }
  function clubSourceFields(p) {
    return `${txtIn(p + '.source', 'Club record or source', {placeholder: 'File name or reference, no personal details'})}
      ${txtIn(p + '.notes', 'Important differences or limitations')}`;
  }
  function golfHistoryEditor(i, p, h) {
    const rows = h.golf || [];
    const editor = rows.map((r, j) => {
      const path = p + '.golf.' + j;
      return recDetails('club-' + i + '-' + r.id, esc(r.name || 'Past golf checkpoint') + (r.fictional ? ' · fictional' : ''),
        `<div class="fields">${txtIn(path + '.name', 'Past event or registration round', {max:160})}
        ${dateIn(path + '.eventDate', 'Past event date')}${outcomeNumberField(path + '.weeks', 'Whole weeks before that event', true)}
        ${outcomeNumberField(path + '.paid', 'Golfers who had paid at that point', true)}
        ${outcomeNumberField(path + '.final', 'Actual final golfers', true)}
        ${clubAmount(path + '.price', 'Past single golfer price ($)')}
        ${txtIn(path + '.coursePackage', 'Course and what the price included')}
        ${clubSourceFields(path)}</div>${chk(path + '.comparable', 'I checked the log and consider this event comparable to this golf option.')}${clubRecordAction('drop-golf', 'Remove checkpoint', i, j)}`);
    }).join('');
    return `<p class="hint">Use the paid count in your registration log. Compare one checkpoint per past event at the same number of weeks out. Later sign-ups can differ.</p>
      <div class="fields">${outcomeNumberField(p + '.golfWeeks', 'Whole weeks until this option’s event today', true)}</div>
      ${h.golfWeeks != null && h.golfAsOf !== localYMD() ? clubRecordAction('confirm-weeks', 'Confirm weeks remaining today', i) : ''}
      ${editor}${rows.length < window.BFClubHistory.limits.golf ? clubRecordAction('add-golf', 'Add past golf checkpoint', i) : '<p>Checkpoint limit reached.</p>'}`;
  }
  function auctionLotEditor(i, p, h) {
    const C = window.BFClubHistory, lots = h.lots || [];
    const editors = lots.map((lot, j) => {
      const path = p + '.lots.' + j, comps = lot.comps || [];
      const qualified = C.lotBids(state, lot, localYMD());
      const rows = comps.map((r, k) => {
        const bp = path + '.comps.' + k, result = qualified.find((x) => x.record.id === r.id);
        const note = result ? `${result.record.outcome === 'unsold' ? 'Confirmed unsold' : 'Winning bid ' + money(result.gross)}. After fees: ${result.net == null ? 'unknown' : money(result.net)}.` :
          r.outcome === 'unsold' && Number(r.bid) > 0 ? 'A positive bid conflicts with an unsold result. Check the bid or change the outcome.' :
          'Excluded from the comparable count. Check the past date, source, outcome, amount and comparability.';
        return recDetails('club-' + i + '-' + r.id, esc(r.name || 'Past lot result') + (r.fictional ? ' · fictional' : ''),
          `<div class="fields">${txtIn(bp + '.name', 'Past item and event', {max:160})}${dateIn(bp + '.eventDate', 'Past sale date')}
          ${sel(bp + '.outcome', 'Result', [['', 'Unknown'], ['sold', 'Sold'], ['unsold', 'Confirmed unsold']])}
          ${clubAmount(bp + '.bid', 'Winning bid before fees ($)')}${clubAmount(bp + '.fees', 'Fees charged for this item ($)')}
          ${clubSourceFields(bp)}</div>${chk(bp + '.comparable', 'I checked the settlement record and consider this item comparable to this lot.')}<p>${esc(note)}</p>${clubRecordAction('drop-comp', 'Remove past result', i, j, k)}`);
      }).join('');
      return recDetails('club-' + i + '-' + lot.id, esc(lot.name || 'Planned auction lot') + (lot.fictional ? ' · fictional' : ''),
        `<div class="fields">${txtIn(path + '.name', 'Item or lot', {max:160})}
        ${clubAmount(path + '.estimatedNet', 'Your expected proceeds after item fees ($)')}${txtIn(path + '.notes', 'Basis for this estimate')}</div>
        ${chk(path + '.donated', 'This item is donated.')}${chk(path + '.includedInLikely', 'I already included this item’s expected proceeds in this option’s likely auction total.')}
        ${rows}<div class="row-actions">${comps.length < C.limits.comps ? clubRecordAction('add-comp', 'Add comparable past result', i, j) : 'Past result limit reached.'}
        ${clubRecordAction('drop-lot', 'Remove this lot', i, j)}</div>`);
    }).join('');
    return `<p class="hint">Enter each planned lot once. Use winning bids and confirmed unsold items from comparable club auctions. Item estimates stay separate from the budget. Enter the combined net bids and raffle proceeds once on the Scenarios step.</p>
      ${editors}${lots.length < C.limits.lots ? clubRecordAction('add-lot', 'Add planned auction lot', i) : '<p>Lot limit reached.</p>'}`;
  }
  function clubEvidenceEditor(o, i) {
    const C = window.BFClubHistory, golf = C.isGolf(o);
    if (!golf && o.kind !== 'auction') return '';
    const key = 'club-records-' + i, p = 'options.' + i + '.clubHistoryResearch', h = o.clubHistoryResearch || {};
    const lines = clubEvidenceLines(o);
    return `<section class="panel"><details class="qs" data-keep="${key}" ${openRecords.has(key) ? 'open' : ''}><summary>${golf ? 'Compare golf registrations' : 'Estimate auction lots'} · ${esc(o.name)}</summary>
      ${golf ? golfHistoryEditor(i, p, h) : auctionLotEditor(i, p, h)}
      ${lines.length ? '<ul class="plain">' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : ''}
      </details></section>`;
  }

  function editClubEvidence(b, i, j) {
    const o = state.options[i], action = b.dataset.recordAction;
    if (!o) return false;
    const C = window.BFClubHistory, h = o.clubHistoryResearch || (o.clubHistoryResearch = {});
    if (action === 'confirm-weeks' && C.isGolf(o) && C.whole(h.golfWeeks)) { h.golfAsOf = localYMD(); return true; }
    const key = { 'add-golf': 'golf', 'drop-golf': 'golf', 'add-lot': 'lots', 'drop-lot': 'lots', 'add-comp': 'comps', 'drop-comp': 'comps' }[action];
    if (!key || (key === 'golf' ? !C.isGolf(o) : o.kind !== 'auction')) return false;
    const parent = key === 'comps' ? (h.lots || [])[j] : h;
    if (!parent) return false;
    const list = parent[key] || (parent[key] = []);
    if (action.startsWith('add-')) {
      if (list.length >= C.limits[key]) return false;
      const row = {id: uid('club_'), fictional: !!state.isDemo || (key === 'comps' && !!parent.fictional)};
      list.push(row); openRecords.add('club-' + i + '-' + row.id); openRecords.add('club-records-' + i);
    } else {
      const index = key === 'comps' ? Number(b.dataset.k) : j;
      if (!list[index] || !armed(b, 'Click again to remove this record')) return false;
      list.splice(index, 1);
    }
    return true;
  }

  function viewResearch() {
    const r = research(), recs = r.audiences.concat(r.comparables), ev = state.evidence || {};
    const evRows = state.options.map((o) => { const n = (k) => Math.max(0, Math.floor(Number((ev[k] || {})[o.id]) || 0)); return `<li>${esc(o.name)}: paid ${n('paidRegistrations')} · named “yes” ${n('namedHighIntent')} · anonymous “yes” ${n('surveyDefinitelyAtPrice')} · “maybe” ${n('surveyProbablyAtPrice')}</li>`; }).join('');
    return `<article class="research">
      <p class="eyebrow">Optional</p>
      <h1 tabindex="-1">Research</h1>
      <p class="lede-s">Keep what you found out about your audience and similar events in one place, with where it came from. <b>Nothing on this page changes your numbers, your status or your survey totals.</b> It shows up beside your results and in the board summary, labeled.</p>
      ${state.isDemo ? '<p class="callout warn-callout"><span>This is a made-up example: every record here is fictional.</span></p>' : ''}
      ${problemsBox()}
      ${state.options.map(clubEvidenceEditor).join('')}
      ${clubOutcomeEditor()}
      <section class="panel"><h2>Audience worksheet</h2>
        <p class="hint">One row per group you could ask: parents, alumni, local businesses, golfers, others. Keep each group in its own unit. Households and businesses are not players, and nothing here becomes a sign-up or a forecast. Blank means unknown.</p>
        ${r.audiences.length ? r.audiences.map((a, j) => audienceCard(a, j, r.audiences)).join('') : '<p class="empty">No audience groups yet. Add one for each group you could reach.</p>'}
        <div class="row-actions"><button class="small" data-action="add-research" data-kind="audiences">+ Add audience group</button></div>
        ${audienceTotals()}
        <details class="qs"><summary>Your plan’s own evidence (step 8), kept separate</summary><p class="hint">These are the counts the decision uses. Research totals above are never added to them.</p><ul class="plain">${evRows}</ul><p class="hint">Survey responses: ${Math.max(0, Math.floor(Number(ev.surveyResponses) || 0))}.</p></details>
      </section>
      <section class="panel"><h2>Similar events</h2>
        <p class="hint">Prices and details from comparable fundraisers, entered by hand with a source. Say where each one comes from and whether you checked it yourself: a link from a search or an AI summary is <b>not checked</b> until you open the source. Events are listed side by side; there is no combined price range, and nothing here is a recommended price.</p>
        ${r.comparables.length ? r.comparables.map((c, j) => comparableCard(c, j)).join('') : '<p class="empty">No similar events yet.</p>'}
        <div class="row-actions"><button class="small" data-action="add-research" data-kind="comparables">+ Add similar event</button></div>
        ${r.comparables.length ? `<div class="rsum"><h3 class="sub">Similar events side by side</h3>${state.options.map(comparablesForOption).join('')}</div>` : ''}
      </section>
      <section class="panel"><h2>What supports your assumptions</h2>
        <p class="hint">Point an assumption (price, capacity, your low, likely or high number) at the research behind it. This records your reasoning; it never changes the assumption.</p>
        ${r.links.length ? r.links.map((l, j) => linkCard(l, j, recs)).join('') : '<p class="empty">No notes yet.</p>'}
        <div class="row-actions"><button class="small" data-action="add-research" data-kind="links">+ Add a note on an assumption</button></div>
      </section>
      <div class="row-actions"><a class="btn" href="#decision">See results</a><a class="btn ghost" href="#step-event">Edit answers</a></div>
    </article>`;
  }

  // Per option on the results page, in print and (as text) in the board summary.
  function researchLines(o) {
    const r = research(), lines = clubEvidenceLines(o);
    const counts = (a) => !!state.isDemo || E.researchKind(state, a) !== 'fictional';
    const tag = (a) => `${KIND_LABEL[E.researchKind(state, a)].toLowerCase()}, ${VER_LABEL[E.researchVerification(a)].toLowerCase()}`;
    clubHistory().filter((h) => !h.fromPriorPlan && h.optionId === o.id && h.kind === (o.kind || 'generic') && (state.isDemo || !h.fictional)).forEach((h) => lines.push('Club outcome record: ' + clubOutcomeLines(h).join(' ')));
    const linked = r.audiences.filter((a) => (a.optionIds || []).includes(o.id));
    const aud = linked.filter(counts), fic = linked.filter((a) => !counts(a));
    aud.forEach((a) => lines.push(`${a.name || 'Unnamed group'}: ${countText(a.reach, UNIT_LABEL[a.unit] || 'units')} estimated reach${a.contacted != null && a.contacted !== '' ? `, ${countText(a.contacted)} contacted` : ''}${a.responded != null && a.responded !== '' ? `, ${countText(a.responded)} responses` : ''} (${tag(a)}${a.source ? `; source: ${a.source}` : ''})${(a.overlapsWith || []).length ? '; overlaps another group' : ''}.`));
    if (aud.length) lines.push('Audience figures are records of who could be reached, not sign-ups, and overlapping groups are not unique people.');
    if (fic.length) lines.push(`Fictional audience records, not counted: ${fic.map((a) => a.name || 'Unnamed group').join('; ')}.`);
    const c = E.comparableSummary(state, o);
    if (c.linked || c.fictional.length) {
      lines.push(`Similar events (${c.linked} listed side by side; no combined price range):`);
      c.observations.forEach((x) => lines.push(`  ${obsText(x, r.comparables.find((y) => y.id === x.id))}`));
      c.notes.forEach((n) => lines.push(`  ${n}`));
    }
    r.links.filter((l) => l.optionId === o.id).forEach((l) => {
      const cited = (l.researchIds || []).map((id) => recsById(id)).map((x) => (x ? `${x.name || 'Unnamed record'} (${tag(x)})` : 'a removed record'));
      lines.push(`${ASSUMPTION_LABEL[l.assumption] || 'Assumption'} (${currentAssumption(o, l.assumption)} in the plan): ${cited.length ? `cites ${cited.join(', ')}` : 'no research cited yet'}${l.note ? `. "${l.note}"` : ''}`);
    });
    const broken = E.researchProblems(state).filter((p) => p.missingId === o.id || (p.kind === 'link' && (r.links.find((l) => l.id === p.recordId) || {}).optionId === o.id));
    if (broken.length) lines.push(`${broken.length} research link${broken.length === 1 ? '' : 's'} for this option point at a removed record.`);
    return lines;
  }
  const recsById = (id) => { const r = research(); return r.audiences.concat(r.comparables).find((x) => x.id === id); };
  function researchSection(o) {
    const lines = researchLines(o);
    return `<section class="research-sum" data-research="${esc(o.id)}"><h4>Research on file <span class="muted">(${state.isDemo ? 'fictional; ' : ''}not used in any calculation)</span></h4>
      ${lines.length ? `<ul class="plain">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">No research linked to this option.</p>'}
      <p class="hint noprint"><a href="#research">${lines.length ? 'Edit research' : 'Add research (optional)'}</a></p></section>`;
  }

  // ---------- views ----------
  const STEPS = [
    { id: 'event', short: 'Basics', title: 'What are you planning?', help: 'Start with a name and a goal. You can change anything later.', body: stepEvent },
    { id: 'options', short: 'Options', title: 'Which options are you comparing?', help: 'Add each idea you are weighing, such as tee times against a shotgun start, a gala against a product sale, or this year\'s event against a smaller one. Pick what kind of fundraiser each one is.', body: stepOptions },
    { id: 'quote', short: 'Quote', title: 'What will the venue or supplier charge?', help: 'Copy these numbers from the written quote. Minimums matter most: they are what you owe even if few people come.', body: stepQuote },
    { id: 'prices', short: 'Pricing', title: 'What will you charge?', help: 'Pick the price you would actually put on the sign-up or order form.', body: stepPrices },
    { id: 'costs', short: 'Costs', title: 'What else will it cost?', help: 'Anything not already in the venue or supplier quote.', body: stepCosts },
    { id: 'sponsors', short: 'Sponsors', title: 'Who is sponsoring?', help: 'Only money that is collected or promised in writing counts toward break-even. Hoped-for sponsors are shown, but never relied on.', body: () => renderSponsors() },
    { id: 'survey', short: 'Survey', title: 'Ask your supporters', help: 'A short survey asks adults whether they would take part or buy, which option they prefer, and at what price. A “yes” is interest, not a sign-up or a sale. It stays anonymous unless someone chooses to leave a name.', body: stepSurvey },
    { id: 'evidence', short: 'Responses', title: 'What did supporters say?', help: 'Type in the totals from your survey and any paid sign-ups or orders so far.', body: stepEvidence },
    { id: 'scenarios', short: 'Turnout', title: 'Plan for low, likely and high results', help: 'These are your numbers, not predictions. The survey counts are shown beside them so you can stay honest.', body: stepScenarios },
    { id: 'volunteers', short: 'Volunteers', title: 'How much volunteer time will it take?', help: 'A profitable event can still be a bad trade if it burns out your volunteers.', body: stepVolunteers },
  ];
  let view = 'home', stepIdx = 0, savePanel = false;
  let showNewPlan = false;
  const ideaSignals = new Set();
  function ideaSettings() {
    return { selected: ideaSignals, hasPlan: touched && !state.isDemo, existingKinds: state.options.map((option) => option.kind) };
  }
  const STEP_KEY = 'bfp-last-step-v1';
  const savedStep = storeRead(STEP_KEY);
  let lastStep = STEPS.find((s) => s.id === savedStep) || STEPS[0];
  function rememberStep(step) {
    lastStep = step;
    storeWrite(STEP_KEY, step.id);
  }
  const PER_OPTION_STEPS = new Set(['quote', 'prices', 'costs', 'scenarios']);

  // A next-step link targets a field within the named option even if the option order changes.
  let fieldTarget = null;
  function readHash() {
    fieldTarget = null;
    const h = (location.hash || '').slice(1);
    if (h && h !== 'home') showNewPlan = false;
    if (h === 'ideas') { view = 'ideas'; return; }
    if (!touched && h !== 'guide') { view = 'home'; return; }
    if (h === 'results' || h === 'decision') { view = h; return; }
    if (h === 'guide') { view = 'guide'; return; }
    if (h === 'research') { view = 'research'; return; }
    const stepRoute = /^step-([a-z]+)(?:\/([a-zA-Z0-9_-]{1,40})(?:\/([a-zA-Z0-9.]{1,70}))?)?$/.exec(h);
    const k = stepRoute ? STEPS.findIndex((st) => st.id === stepRoute[1]) : -1;
    if (k >= 0) {
      const id = stepRoute[2], step = STEPS[k], back = view === 'wizard' && k === stepIdx - 1;
      if (id && !PER_OPTION_STEPS.has(step.id) && step.id !== 'evidence' && step.id !== 'volunteers') { view = 'home'; return; }
      const index = id ? state.options.findIndex((o) => o.id === id) : back ? state.options.length - 1 : 0;
      if (index < 0) {
        view = 'decision';
        say('That fundraiser option is no longer in this plan. Choose a next step from the current results.');
        return;
      }
      view = 'wizard'; openOption = index; stepIdx = k; rememberStep(step);
      const field = stepRoute[3];
      if (id && step.id === 'evidence') fieldTarget = `evidence.${field || 'paidCashReceived'}.${id}`;
      else if (step.id === 'volunteers' && field === 'volunteerHoursAvailable') fieldTarget = field;
      else if (field) fieldTarget = `options.${index}.${field}`;
      return;
    }
    view = 'home';
  }
  function go(hash) { if (location.hash !== '#' + hash) location.hash = hash; else { readHash(); render(true); } }

  function newPlanControls() {
    const kinds = { golf_tee_times: 'Golf outing', auction: 'Auction or raffle', ticketed: 'Dinner or gala', product: 'Product sale', participation: 'Run or tournament', generic: 'Other event' };
    return `<div class="cta new-plan"><label class="f"><span>Fundraiser type</span>
      <select id="new-plan-kind">${Object.entries(kinds).map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label>
      <button class="btn" data-action="start-blank">Start a new plan</button></div>`;
  }

  function newOptionForKind(kind, name) {
    const option = clone(window.BFPlan.BLANK_STATE.options[0]);
    option.kind = kind;
    option.name = name || EVENT_TYPES[kind].label;
    if (kind !== 'golf_tee_times') { option.groupSize = 1; option.wholeGroupsOnly = false; }
    return option;
  }

  function startPlanForKind(button, kind, name) {
    if (!Object.hasOwn(EVENT_TYPES, kind)) return;
    if (touched && !armed(button, state.isDemo ? 'Start over with your own plan? Click again' : 'Replace this plan and keep a backup? Click again')) return;
    const fresh = clone(window.BFPlan.BLANK_STATE);
    fresh.options = [newOptionForKind(kind, name)];
    if (!replacePlan(migrate(fresh), 'New plan started.', true)) return;
    ideaSignals.clear(); showNewPlan = false; savePanel = false;
    go('step-event');
  }

  function viewHome() {
    const openBackup = '<button class="home-link" data-action="choose-backup">Open a backup file</button>';
    if (touched && !state.isDemo) {
      return `<section class="home-card">
        <p class="eyebrow">Edmonds-Woodway Booster Club</p>
        <h1>${esc(state.eventName || 'Your fundraiser plan')}</h1>
        <p class="lede">Continue at step ${STEPS.indexOf(lastStep) + 1} of ${STEPS.length} · ${esc(lastStep.short)}</p>
        <div class="cta"><a class="btn" href="#step-${lastStep.id}">Continue my plan</a><a class="btn ghost" href="#decision">See my results</a></div>
        <p><a href="#ideas">Find another fundraiser to compare</a></p>
        <details id="other-plan" class="other-plan"${showNewPlan ? ' open' : ''}><summary>Start another plan</summary>
          <p>A new plan replaces the one on screen. You can restore the previous plan from Save &amp; backup.</p>${newPlanControls()}</details>
        <div class="home-tools">${openBackup}<a href="#guide">How to use the planner</a></div>
        <p class="hint">Opening a file replaces the plan on screen. Save &amp; backup can restore the previous plan.</p>
      </section>`;
    }
    return `<section class="home-card">
      <p class="eyebrow">Edmonds-Woodway Booster Club</p>
      <h1>Plan your <em>fundraiser.</em></h1>
      <p class="lede">Find out what the club could raise, what it could lose, and how many people need to take part.</p>
      ${newPlanControls()}
      <p><a href="#ideas">Help me choose a fundraiser</a></p>
      ${touched && state.isDemo ? `<details class="other-plan"><summary>Earlier saved plan</summary>
        <p>${esc(state.eventName)} contains fictional figures. To keep your edits separately, download a backup before starting over.</p>
        <a href="#step-${lastStep.id}">Continue earlier plan</a></details>` : ''}
      <div class="home-tools">${openBackup}<a href="#guide">How to use the planner</a></div>
    </section>
    <aside class="home-note"><b>What to bring</b><p>Start with a venue or supplier quote, your proposed price, and any sign-ups. Enter what you know now and come back later.</p><p class="hint">Your plan saves only in this browser on this device. Download a backup to keep a copy.</p></aside>`;
  }

  // Real information to collect before entering a plan. Shown in the guide; mirrored in docs/START_HERE.md.
  const COLLECT = [
    ['Written quote from the venue, course or supplier', 'Price per person or item, what it includes, tax and service charges, minimum number or minimum bill, flat fees, and how many it can hold.'],
    ['Deposit terms', 'How much, when it is due, whether it counts toward the bill, and whether (and until when) it is refundable.'],
    ['Cancellation terms', 'What you would owe if you cancel, and the deadline. Copy the dollar amount from the quote.'],
    ['Key dates', 'When the quote expires, when the final headcount (or order quantity) is due, and the last day to cancel.'],
    ['Your prices', 'The single price and any group or table price you would actually put on the form.'],
    ['Other costs', 'Prizes, food not in the quote, printing, signs, insurance, supplies. Mark which ones are paid before the event.'],
    ['Sponsor commitments', 'Who has paid (collected), who has promised in writing (committed), and who you have only asked (hoped-for). Donated items, and which cost they replace.'],
    ['Actual receipts', 'How many people have paid, and the total money actually received, from your records or bank.'],
    ['Supporter survey totals', 'How many answered, and per option: “yes” with a name, anonymous “yes”, and “maybe”. Counts only, no names.'],
    ['Volunteer hours', 'Hours the event needs, and hours your volunteers can realistically give.'],
    ['Who signs', 'Whether the club, the school or the district signs and holds the money, and whether approval or insurance is required.'],
  ];

  function viewGuide() {
    return `<article class="guide">
      <p class="eyebrow">How to use</p>
      <h1 tabindex="-1">Plan a fundraiser</h1>
      <p class="lede-s">Use the club’s quote, receipts and supporter responses to decide whether an event is worth the money and volunteer time.</p>
      <section class="panel"><h2>Start with one fundraiser</h2>
        <p>On <a href="#home">Home</a>, choose the fundraiser you’re considering and select <b>Start a new plan</b>. If you’re unsure, <a href="#ideas">explore ideas based on what the club already has</a>. Give your plan a name and a fundraising goal. In <b>Options</b>, you can add another idea for comparison.</p>
        <p>Returning? Choose <b>Continue my plan</b> on Home to pick up at your last planning step. If you have a downloaded plan, choose <b>Open a backup file</b>.</p>
      </section>
      <section class="panel"><h2>Enter what you know</h2>
        <p>Work through the steps with <b>Next</b>. Start with the written quote, your prices and other costs. Enter paid registrations, cash received and survey responses in their own fields. Use the club’s records to choose low, likely and high turnout.</p>
        <details class="detail"><summary>What should I gather?</summary>
          <ul class="plain miss">${COLLECT.map(([h, d]) => `<li><b>${esc(h)}.</b> ${esc(d)}</li>`).join('')}</ul>
        </details>
        <details class="detail"><summary>How do I enter auction income?</summary>
          <p>Enter admission as the ticket price. For each scenario, estimate winning-bid or raffle proceeds after selling fees. Enter purchased items, flat fees and other expenses once under costs. The results show how much the club needs in bids to break even or reach its goal.</p>
        </details>
      </section>
      <section class="panel"><h2>Use Results to make the decision</h2>
        <p>Compare what the club would keep at each turnout, how much interest is backed by payments, and which club limits each option misses. Use <b>Copy decision brief</b> or <b>Print brief</b> to take that comparison to the board.</p>
        <p>Open <b>Full analysis</b> for upfront cash, cancellation exposure, break-even, volunteer hours and missing evidence. Under <b>Ready to commit?</b>, enter the board’s minimum proceeds and maximum acceptable loss.</p>
        <details class="detail"><summary>How should I read the estimates and status?</summary>
          <p>Each estimate depends on the turnout and income you entered. Firm money includes ticket or sales revenue at that turnout and sponsorship collected or promised in writing. Cash in hand counts only money received. Auction bids, add-ons and other assumed income are shown separately from firm break-even.</p>
          <dl class="statuses">${Object.keys(STATUS_MEANING).map((k) => `<dt><span class="badge ${statusClass(k)}"><i aria-hidden="true">${statusIcon(k)}</i>${esc(E.STATUS_LABELS[k])}</span></dt><dd>${esc(STATUS_MEANING[k])}</dd>`).join('')}</dl>
        </details>
        <details class="detail"><summary>How can we check our assumptions?</summary>
          <p>Use <b>What would need to change?</b> in Full analysis to try another price or turnout. Choose <b>Use … in my plan</b> only when you want to save the change. If the offer changes, keep the old survey answers as a past round and ask supporters about the new terms.</p>
          <p>In <b>Research</b>, record local prices, audience counts and sources. Under <b>Past club results</b>, save the likely estimate before the event, then enter actual turnout and net proceeds afterward to see how close it was.</p>
        </details>
      </section>
      <section class="panel"><h2>Keep a copy of your plan</h2>
        <p>Work saves in this browser on this device. The website and downloaded HTML file keep separate saved plans. To move a plan, choose <b>Save &amp; backup → Download backup file</b>, then <b>Open a backup file</b> in the other copy.</p>
        <details class="detail"><summary>What happens if I start over or saving fails?</summary>
          <p>Starting a new plan or opening a file keeps the current saved plan as the previous plan. <b>Restore previous plan</b> swaps it back. The browser keeps one previous plan. Download a file for each plan you want to keep longer.</p>
          <p>Clearing site data or closing a private browsing session can remove local work. If you see the red <b>Not saved</b> warning, use its <b>Download backup file</b> button to keep your latest edits.</p>
        </details>
      </section>
      <p><a class="btn" href="#home">Back to home</a></p>
    </article>`;
  }

  function viewWizard() {
    const st = STEPS[stepIdx];
    const pct = Math.round(((stepIdx + 1) / STEPS.length) * 100);
    const perOpt = PER_OPTION_STEPS.has(st.id) && state.options.length > 1;
    if (!state.options[openOption]) openOption = 0;
    return `<div class="wiz">
      <nav class="steplist" aria-label="Steps"><ol>${STEPS.map((x, k) => `<li class="${k === stepIdx ? 'on' : ''}"><a href="#step-${x.id}" ${k === stepIdx ? 'aria-current="step"' : ''}>${esc(x.short)}</a></li>`).join('')}
        <li class="res"><a href="#decision">See results</a></li></ol></nav>
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
            : stepIdx < STEPS.length - 1 ? `<a class="btn" href="#step-${STEPS[stepIdx + 1].id}">Next: ${esc(STEPS[stepIdx + 1].short)} →</a>` : '<a class="btn" href="#decision">See results →</a>'}
        </div>
      </section>
    </div>`;
  }

  const BRIEF_ISSUES = {
    noCapacity: { step: 'quote', text: 'Enter a usable capacity.' },
    capacityBelowPaid: { step: 'quote', text: 'Check capacity against the number already paid.' },
    belowPaid: { step: 'scenarios', text: 'The adjusted turnout is below the number already paid.' },
    paidCashMissing: { step: 'evidence', text: 'Enter the receipts for existing paid registrations or sales.' },
    cashWithoutPaid: { step: 'evidence', text: 'Reconcile the recorded receipts and the zero paid count.' },
    missing: { step: 'scenarios', text: 'Enter the turnout for this case.' },
    partialGroup: { step: 'quote', text: 'Check the paid count against whole-group sales.' },
    missingPrice: { step: 'prices', text: 'Enter the admission or sale price. Use 0 for free entry.' },
    missingCost: { step: 'costs', text: 'Complete the costs for this option.' },
    missingQuote: { step: 'quote', text: 'Complete the venue or supplier quote.' },
    depositTerms: { step: 'quote', text: 'Confirm whether the deposit counts toward the final bill and whether it is refundable.' },
    missingBid: { step: 'scenarios', text: 'Enter expected auction proceeds after fees. Use 0 if none.' },
  };
  const briefIssue = (issue) => BRIEF_ISSUES[issue]?.text || 'Check the inputs for this case.';

  const stepField = (o, step, field) => field ? `#step-${step}/${encodeURIComponent(o.id)}/${field}` : null;

  function issueLink(o, issue, scenario) {
    const entry = BRIEF_ISSUES[issue];
    if (!entry) return null;
    const fields = {
      noCapacity: 'capacity', capacityBelowPaid: 'capacity', partialGroup: 'wholeGroupsOnly',
      missingPrice: 'price', paidCashMissing: 'paidCashReceived', cashWithoutPaid: 'paidRegistrations',
      depositTerms: typeof o.deposit?.creditedTowardBill === 'boolean' ? 'deposit.refundable' : 'deposit.creditedTowardBill',
      belowPaid: 'scenarioParticipants.' + scenario, missing: 'scenarioParticipants.' + scenario,
      missingBid: 'scenarioProceeds.' + scenario,
    };
    if (issue === 'missingQuote') {
      fields.missingQuote = ['venueQuote.perParticipant', 'venueQuote.minimumParticipants', 'venueQuote.flatFee', 'venueQuote.minimumSpend', 'deposit.amount']
        .find((path) => notEntered(getPath(o, path)));
    }
    if (issue === 'missingCost') {
      for (const key of ['perParticipantCosts', 'fixedCosts']) {
        const row = (o[key] || []).findIndex((r) => notEntered(r.amount));
        if (row >= 0) { fields.missingCost = `${key}.${row}.amount`; break; }
      }
    }
    return stepField(o, entry.step, fields[issue]);
  }

  function readyLink(o, r) {
    switch (r.actions[0]) {
      case 'quote': {
        const missingDate = E.CONTRACT_DATES.find(([key]) => !o.contract?.[key]);
        const field = !r.contract.cancellationKnown ? 'cancellationOwed'
          : !o.contract?.quoteSource ? 'contract.quoteSource'
          : missingDate ? 'contract.' + missingDate[0] : 'quoteVerified';
        return stepField(o, 'quote', field);
      }
      case 'cash': return stepField(o, 'quote', 'upfrontFundingConfirmed');
      case 'volunteers': return stepField(o, 'volunteers', notEntered(o.volunteerHours) ? 'volunteerHours' : 'volunteerHoursAvailable');
      default: return null; // Obtaining a quote, gathering interest and board decisions can require work outside a form.
    }
  }

  function briefComparison(comparison, options) {
    const leaderLine = (indices, amount, basis) => {
      const names = andList(indices.map((i) => options[i].name));
      const description = amount < 0 ? 'smallest modeled loss' : 'highest modeled net';
      return `${basis}: ${names} (${description}, ${money(amount)}).`;
    };
    switch (comparison.reason) {
      case 'single': return '';
      case 'compared':
      case 'tie': {
        const lines = [leaderLine(comparison.leaderIndices, comparison.firmLeaderNet, 'Comparison net at likely turnout, before applying club limits')];
        if (options.some((o) => o.b.cases.middle.net !== o.b.cases.middle.firmNet)) {
          lines.push(leaderLine(comparison.scenarioLeaderIndices, comparison.scenarioLeaderNet, 'With the likely scenario settings instead'));
        }
        lines.push(options.some((o) => o.limitWarnings.length) ? 'Check the club limits flagged below before choosing.' : 'Compare the upfront cash and volunteer time before choosing.');
        return lines.join(' ');
      }
      case 'quoteOrCosts': return 'Confirm the quotes and other costs for each option before choosing on net proceeds.';
      case 'turnoutEvidence': return 'At least one likely turnout exceeds its paid count plus current named interest. Check demand at the proposed price before choosing a fundraiser.';
      case 'scenarioOrder': return 'Check that the low, likely and high turnout counts are in order for each option.';
      default: return 'Complete the missing figures or resolve the flagged entries before comparing the options.';
    }
  }

  function likelyAdjustmentText(b) {
    const amounts = b.likelyAdjustments;
    if (!amounts) return '';
    const changes = [];
    if (amounts.extraIncome) changes.push(`adds ${money(amounts.extraIncome)} in estimated income`);
    if (amounts.cashSponsorChange) changes.push(`counts ${money(Math.abs(amounts.cashSponsorChange))} ${amounts.cashSponsorChange > 0 ? 'more' : 'less'} cash sponsorship`);
    if (amounts.inKindSavingsChange) changes.push(`counts ${money(Math.abs(amounts.inKindSavingsChange))} ${amounts.inKindSavingsChange > 0 ? 'more' : 'less'} in costs covered by in-kind sponsors`);
    const sentences = [];
    if (changes.length) sentences.push(`The likely scenario ${andList(changes)} compared with the ranking.`);
    if (amounts.scenarioCushion !== amounts.comparisonCushion) {
      sentences.push(`In the likely scenario, the cost cushion is ${money(amounts.scenarioCushion)} instead of ${money(amounts.comparisonCushion)} on non-venue costs.`);
    }
    return sentences.join(' ');
  }

  function clubBrief() {
    const options = state.options.map((o) => {
      const r = E.readiness(state, o, localYMD());
      const b = E.decisionBrief(state, o);
      const middle = b.cases.middle, t = T(o), bidRows = E.auctionTargets(state, o);
      const figures = SC.map((key) => {
        const c = b.cases[key];
        const count = c.participants == null ? '' : `${c.participants} ${t.many}`;
        const caption = c.issue ? briefIssue(c.issue) : c.requested !== c.participants
          ? `${count} counted from ${c.requested} entered (capacity or whole groups).` : count;
        return { label: cap(SC_WORD[key]) + ' scenario net', value: c.net == null ? 'Needs input' : money(c.net), caption, negative: c.net != null && c.net < 0 };
      });
      const issues = SC.map((key) => b.cases[key].issue).filter(Boolean);
      const hasAllCounts = SC.every((key) => b.cases[key].requested != null);
      const outOfOrder = hasAllCounts && (b.cases.conservative.requested > middle.requested || middle.requested > b.cases.optimistic.requested);
      const basisIssue = b.breakEven.issue === 'unreachable' ? null : b.breakEven.issue;
      const [minimum, lossLimit, hours] = r.criteria;
      const limitWarnings = [];
      if (minimum.result === 'unmet' && middle.firmNet != null) {
        limitWarnings.push(`Firm net at the likely turnout is ${money(middle.firmNet)}, below the club’s ${money(minimum.threshold)} minimum.`);
      }
      for (const part of lossLimit.parts) {
        if (part.result !== 'unmet' || (part.key === 'lowTurnout' && basisIssue) || (part.key === 'cancel' && ['missingQuote', 'missingCost'].includes(basisIssue))) continue;
        const exposure = part.key === 'cancel' ? 'Canceling after the deadline' : `Running with ${part.participants} ${t.many} on firm money`;
        limitWarnings.push(`${exposure} could cost the club ${money(part.loss)}, over its ${money(lossLimit.threshold)} loss limit.`);
      }
      if (hours.result === 'unmet') limitWarnings.push(`This option needs ${hours.need} volunteer hours. The club has ${hours.available}.`);
      const status = issues.length || outOfOrder ? 'not_enough_evidence' : r.status;
      const statusLabel = limitWarnings.length ? 'Outside the club’s limits' : E.STATUS_LABELS[status];
      const facts = [];
      if (outOfOrder) facts.push('Review the order of the low, likely and high turnout counts.');
      const adjustment = likelyAdjustmentText(b);
      if (adjustment) facts.push(adjustment);
      if (bidRows.length && !bidRows[1].issue) {
        const row = bidRows[1];
        facts.push(`At ${row.guests} guests, the auction needs ${money(row.coverCosts)} in net bids to cover costs${row.reachGoal == null ? '' : ` or ${money(row.reachGoal)} to reach the ${money(state.settings.fundraisingTarget)} goal`}.${row.proceeds == null ? ' Your bid estimate is missing.' : ` Your bid estimate is ${money(row.proceeds)}.`}`);
      }
      const counts = t.survey === 'buy' ? `${b.paid} items paid for` : `${b.paid} paid registrations`;
      facts.push(`${cap(counts)} on record. ${b.namedAtCurrentOffer} additional named “yes” for the current offer.${middle.salesStillNeeded > 0 ? ` Your likely turnout requires ${middle.salesStillNeeded} more ${t.many} beyond the paid count.` : ''}`);
      const more = [];
      if (b.breakEven.issue === 'unreachable') more.push('Ticket or sale revenue and firm sponsorship alone cannot cover costs within the entered capacity.');
      else if (!b.breakEven.issue) more.push(`First break-even with firm sponsorship: ${b.breakEven.participants} ${t.many}.${b.breakEven.dipsAt != null ? ` The net falls below zero again at ${b.breakEven.dipsAt}; check the full chart.` : ''}`);
      const cash = r.cash;
      more.push(basisIssue ? `Upfront cash needs review. ${briefIssue(basisIssue)}`
        : cash.registrationCashUnknown ? 'Enter money received before judging the upfront cash gap.'
        : `${money(cash.neededBeforeEvent)} due in advance. ${money(cash.inHand)} recorded in hand.${cash.short > 0 ? ` Upfront gap: ${money(cash.short)}.` : ''}`);
      if (b.atPaidOnly.net != null) more.push(`At the paid count of ${b.paid} ${t.many}, the net would be ${money(b.atPaidOnly.net)} if written sponsorship arrives, using the low-case costs.`);
      const loss = r.criteria[1].parts[0].loss, vol = r.criteria[2];
      more.push(loss == null || ['missingCost', 'missingQuote'].includes(basisIssue) ? 'Cancellation exposure is unknown. Check the contract.' : `Canceling after the deadline would cost ${money(loss)} including money already spent.`);
      if (vol.need != null) more.push(`Volunteer time: ${vol.need} hours needed${vol.available == null ? ', availability unknown' : `, ${vol.available} available`}.`);
      if (!b.quoteVerified || !b.costsVerified) more.push('The quote or other costs still need verification.');
      let next = readyWords(o, r).next[0];
      if (limitWarnings.length) next = 'Test a lower cost, a different price or firmer sponsorship in Full analysis, then compare the option with the club’s limits again.';
      if (outOfOrder) next = 'Review the three turnout counts on the scenarios step.';
      if (issues.length) next = briefIssue(issues[0]);
      const issueCase = SC.find((key) => b.cases[key].issue);
      const issueHref = issueCase ? issueLink(o, b.cases[issueCase].issue, issueCase) : null;
      const nextHref = issueHref || (outOfOrder
        ? stepField(o, 'scenarios', 'scenarioParticipants.' + (b.cases.conservative.requested > middle.requested ? 'conservative' : 'optimistic'))
        : !limitWarnings.length ? readyLink(o, r) : null);
      return { name: o.name, b, ready: r, status, statusLabel, figures, facts, more, next, nextHref, issueHref, limitWarnings };
    });
    const comparison = E.compareClubEstimates(options.map((x) => x.b));
    const recommendation = window.BFRecommendations.recommendEvents(state, localYMD(), options.map((o) => ({ brief: o.b, ready: o.ready })));
    return { title: state.eventName || 'Your plan', demo: !!state.isDemo, options, recommendation, questions: boardQuestionLines(), comparison: briefComparison(comparison, options) };
  }

  function recommendationLines(r) {
    const lines = [r.title, r.reason, 'Next step: ' + r.next];
    if (r.options.length > 1) {
      for (const o of r.options) lines.push(o.name + ' — ' + o.reason + ' ' + o.next);
    }
    return lines;
  }

  function recommendationCard(r, options) {
    const pendingIndex = r.options.findIndex((o) => o.status === 'needsInput');
    const pending = r.options[pendingIndex];
    const href = pending?.edit ? stepField(pending, pending.edit.step, pending.edit.field) : options[pendingIndex]?.issueHref;
    return `<section class="panel recommendation" aria-labelledby="club-choice">
      <h2 id="club-choice">Which fundraiser should we pursue?</h2>
      <p class="sum-title"><strong>${esc(r.title)}</strong></p>
      <p>${esc(r.reason)}</p><p><b>Next step</b> · ${href ? `<a href="${esc(href)}">${esc(r.next)}</a>` : esc(r.next)}</p>
      ${r.options.length > 1 ? `<details class="qs"><summary>Why each option landed here</summary><ul class="plain">${r.options.map((o) => `<li><b>${esc(o.name)}</b> · ${esc(o.reason)} ${esc(o.next)}</li>`).join('')}</ul></details>` : ''}
      </section>`;
  }

  const BRIEF_BASIS = 'To rank eligible events, the club compares what each would keep at its likely turnout using tickets or sales, collected or written sponsorship, and the low-case cost cushion. The scenario estimates use the income and cost settings you chose for each turnout.';
  function comparisonNetLine(o) {
    const likely = o.b.cases.middle;
    return 'Comparison net at likely turnout: ' + (likely.firmNet == null ? 'Needs input' : money(likely.firmNet));
  }
  function briefText(brief) {
    const lines = [brief.title, 'Booster club decision brief'];
    if (brief.demo) lines.push('FICTIONAL EXAMPLE — all figures are made up.');
    lines.push(BRIEF_BASIS, '', 'Which fundraiser should we pursue?', ...recommendationLines(brief.recommendation));
    if (brief.comparison) lines.push(brief.comparison);
    for (const q of brief.questions) lines.push('', q.title, ...q.lines);
    for (const o of brief.options) {
      lines.push('', o.name, o.statusLabel, comparisonNetLine(o));
      o.figures.forEach((f) => lines.push(`${f.label}: ${f.value} · ${f.caption}`));
      lines.push(...o.limitWarnings, ...o.facts, ...o.more, 'Next step: ' + o.next);
    }
    return lines.join('\n');
  }

  function viewDecision() {
    const brief = clubBrief();
    return `<div class="results"><header class="reshead"><p class="eyebrow">Booster club decision brief</p><h1>${esc(brief.title)}</h1>
        <p class="lede-s">${esc(BRIEF_BASIS)}</p>
        <div class="row-actions"><a class="btn" href="#results">Full analysis</a>
        <button class="btn ghost" data-action="copy-brief">Copy decision brief</button>
        <button class="btn ghost" data-action="print">Print brief</button></div></header>
        ${recommendationCard(brief.recommendation, brief.options)}
        <section class="panel club-brief" aria-label="Fundraiser estimates"><h2>What could the club keep?</h2>
        ${brief.comparison ? `<p class="meaning">${esc(brief.comparison)}</p>` : ''}
        ${brief.options.map((o) => `<article class="club-option"><h3>${esc(o.name)}</h3>
        <p><span class="badge ${o.limitWarnings.length ? 'st-bad' : statusClass(o.status)}">${esc(o.statusLabel)}</span></p>
        <p class="comparison-net"><strong>${esc(comparisonNetLine(o))}</strong></p>
        <dl class="club-figures">${o.figures.map((f) => `<div><dt>${esc(f.label)}</dt><dd${f.negative ? ' class="neg"' : ''}>${esc(f.value)}</dd><dd class="brief-caption">${esc(f.caption)}</dd></div>`).join('')}</dl>
        ${o.limitWarnings.length ? `<ul class="plain brief-limits">${o.limitWarnings.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        ${o.facts.map((s) => `<p>${esc(s)}</p>`).join('')}
        <p class="aloud"><b>Next step</b> · ${o.nextHref ? `<a href="${esc(o.nextHref)}">${esc(o.next)}</a>` : esc(o.next)}</p>
        <details class="qs"><summary>Break-even, cash and volunteer time</summary><ul class="plain">${o.more.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details></article>`).join('')}</section>
        ${brief.questions.length ? `<section class="panel"><h2>Questions for the board</h2>${brief.questions.map((q) => `<div class="board-question"><h3>${esc(q.title)}</h3><ul class="plain">${q.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>`).join('')}</section>` : ''}
        <div class="row-actions"><a class="btn ghost" href="#step-scenarios">Edit turnout estimates</a>
        <a class="btn ghost" href="#research">Research and past results</a><a class="btn ghost" href="#step-options">Edit fundraiser options</a></div></div>`;
  }

  function viewResults() {
    const all = state.options.map(analyse);
    const live = state.options.map((o, k) => `${o.name}: ${all[k].missingMoney ? 'Incomplete estimate' : E.STATUS_LABELS[all[k].status]}`).join('. ');
    return `<div class="results">
      <header class="reshead">
        <p class="eyebrow">Full analysis</p>
        <p class="noprint"><a href="#decision">← Back to decision brief</a></p>
        <h1>${esc(state.eventName || 'Your plan')}</h1>
        <p class="lede-s">${state.options.length > 1 ? `Comparing ${state.options.length} options` : 'One option'}${Number(state.settings.fundraisingTarget) ? ` against a goal of ${money(state.settings.fundraisingTarget)} after costs` : ''}.</p>
        <div class="row-actions">
          <button class="btn" data-action="copy-memo">Copy board summary</button>
          <button class="btn ghost" data-action="print">Print</button>
          <button class="btn ghost dl-only" data-action="download-backup">Download backup file</button>
          <a class="btn ghost" href="#step-event">Edit answers</a>
          <a class="btn ghost" href="#research">Research</a>
        </div>
        <p id="live-status" class="sr-only" aria-live="polite">${esc(live)}</p>
      </header>
      <section class="panel" aria-label="Answers for each option">${renderSummary(all)}</section>
      ${readySection()}
      ${renderWhatIf()}
      ${sameTurnoutPanel()}
      ${state.options.length > 1 ? `<section class="panel"><h2>Side by side</h2>${renderComparison(all)}</section>` : ''}
      <section class="panel"><h2>Before anyone signs</h2><p class="hint">These can change the decision but can't be calculated. Get answers in writing.</p><ul class="plain miss">${SIGNING_QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
        ${state.options.map((o) => `<details class="qs"><summary>Questions to ask the ${esc(T(o).venue)}: ${esc(o.name)}</summary><ul class="plain">${questionsFor(o).map((q) => `<li>${esc(q)}</li>`).join('')}</ul></details>`).join('')}</section>
      <section class="panel"><h2>Detailed numbers</h2><p class="hint">Every line of the math for each scenario, a chart of profit at each headcount, and which assumption matters most.</p>${state.options.map((o, i) => renderDetail(o, all[i])).join('')}</section>
    </div>`;
  }

  function render(focusTitle) {
    document.getElementById('demo-banner').hidden = !state.isDemo || view === 'home' || view === 'ideas';
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const current = a.dataset.nav === (view === 'decision' ? 'results' : view);
      a.classList.toggle('on', current);
      if (current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      a.hidden = !touched && ['wizard', 'results', 'research'].includes(a.dataset.nav);
      if (a.dataset.nav === 'wizard') a.href = '#step-' + lastStep.id;
    });
    document.getElementById('save-panel').hidden = !savePanel;
    document.querySelectorAll('#save-panel [data-requires-plan]').forEach((el) => { el.hidden = !touched; });
    document.querySelectorAll('[data-action="toggle-save"]').forEach((el) => el.setAttribute('aria-expanded', String(savePanel)));
    const bk = savePanel ? backupInfo() : null, bkEl = document.getElementById('backup-line');
    const svEl = document.getElementById('save-line');
    if (svEl && savePanel) {
      const at = (t) => t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (localYMD(t) === localYMD() ? ' today' : ', ' + showDate(localYMD(t)));
      svEl.textContent = (saveProblem ? 'Not saved in this browser: see the red warning at the top.'
        : !touched ? 'No plan is open yet. Choose a fundraiser type on Home or open a backup file.'
          : lastSavedAt ? `Last saved in this browser at ${at(lastSavedAt)}.` : 'Saved in this browser.')
        + (downloadStartedAt ? ` You started a backup download at ${at(downloadStartedAt)}. The planner can’t tell whether the file was kept: check your Downloads folder.` : '');
    }
    if (bkEl) bkEl.innerHTML = bk ? `Backup in this browser: <b>${esc(bk.plan.eventName || 'Untitled plan')}</b>${bk.at ? ` (kept ${esc(new Date(bk.at).toLocaleString())})` : ''}. <button class="small" data-action="restore-backup">Restore previous plan</button>` : 'No backup in this browser yet. One is kept when a new plan or an imported file replaces your current plan.';
    const app = document.getElementById('app');
    app.innerHTML = view === 'wizard' ? viewWizard() : view === 'results' ? viewResults() : view === 'decision' ? viewDecision() : view === 'guide' ? viewGuide() : view === 'research' ? viewResearch() : view === 'ideas' ? window.BFEventIdeasUI.render(ideaSettings()) : viewHome();
    persist();
    const sl = app.querySelector('.steplist'), on = sl && sl.querySelector('li.on');
    if (sl && on && sl.scrollWidth > sl.clientWidth) sl.scrollLeft = on.offsetLeft - 16; // phones: show the current step pill
    if (focusTitle) {
      const field = fieldTarget && app.querySelector(`[data-path="${fieldTarget}"]`);
      if (field) {
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: 'center', inline: 'nearest' });
        return;
      }
      const h = view === 'home' && showNewPlan ? app.querySelector('#new-plan-kind') : app.querySelector('h1, #step-title');
      if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  // ---------- events ----------
  function onChange(e) {
    const t = e.target;
    if (t.dataset.ideaSignal) {
      const id = t.dataset.ideaSignal;
      if (view !== 'ideas' || !window.BFEventIdeas.signals.some((signal) => signal.id === id)) return;
      if (t.checked) ideaSignals.add(id); else ideaSignals.delete(id);
      document.getElementById('event-idea-matches').innerHTML = window.BFEventIdeasUI.renderMatches(ideaSettings());
      return;
    }
    if (t.dataset.scenarioStatus) {
      const k = t.dataset.scenarioStatus;
      const set = new Set(state.scenarioSettings[k].statuses);
      t.checked ? set.add(t.value) : set.delete(t.value);
      state.scenarioSettings[k].statuses = E.SPONSOR_STATUSES.filter((s) => set.has(s));
      return renderKeepingFocus();
    }
    if (t.dataset.outcomeOption != null) { outcomeOptionId = t.value; return renderKeepingFocus(); }
    if (t.dataset.shortcut === 'target') { shortcutTarget = SC.includes(t.value) ? t.value : 'middle'; return renderKeepingFocus(); }
    if (t.dataset.same) { sameT[t.dataset.same] = t.value; if (t.dataset.same !== 'n' && sameT.a && sameT.a === sameT.b) sameT[t.dataset.same === 'a' ? 'b' : 'a'] = ''; return renderKeepingFocus(); }
    if (t.dataset.researchToggle) { // research id lists (overlaps, options, cited records): add or remove one id
      const list = getPath(state, t.dataset.researchToggle);
      const next = (Array.isArray(list) ? list : []).filter((x) => x !== t.value);
      if (t.checked) next.push(t.value);
      setPath(state, t.dataset.researchToggle, next); touched = true;
      return renderKeepingFocus();
    }
    if (t.dataset.whatif) { // hypothetical boxes: screen-only, never written into the plan
      const [key, k] = t.dataset.whatif.split('.');
      if (key === 'opt') { whatIf = { ...freshWhatIf(), opt: +t.value }; }
      else if (k != null) whatIf[key][+k] = t.value;
      else whatIf[key] = t.value;
      return renderKeepingFocus();
    }
    if (t.dataset.action === 'import-csv') return importCsv(t.files[0]);
    if (t.dataset.action === 'import-club-outcomes') {
      const file = t.files[0]; t.value = '';
      if (file) importClubOutcomes(file);
      return;
    }
    if (t.dataset.action === 'import-json') {
      const file = t.files[0];
      t.value = ''; // Choosing the same backup again must still fire a change event.
      if (file) importJson(file);
      return;
    }
    if (!t.dataset.path) return;
    let v = t.value;
    if (t.dataset.type === 'number') { const n = Number(v); v = v === '' || !Number.isFinite(n) ? null : Math.max(0, n); }
    if (['outcomeCount', 'outcomeNet', 'outcomePositive'].includes(t.dataset.type)) {
      const count = t.dataset.type === 'outcomeCount'; v = v === '' ? null : Number(v);
      if ((t.validity && !t.validity.valid) || !validOutcomeNumber(v, count) || (t.dataset.type === 'outcomePositive' && v < 0)) {
        say(count ? 'Enter a whole count of zero or more, or leave it blank.' : t.dataset.type === 'outcomePositive' ? 'Enter dollars and cents of zero or more, or leave it blank.' : 'Enter dollars and cents, using a minus sign for a loss, or leave it blank.');
        return renderKeepingFocus();
      }
    }
    if (t.dataset.type === 'clubAmount') {
      v = v === '' ? null : Number(v);
      if ((t.validity && !t.validity.valid) || (v !== null && !window.BFClubHistory.dollars(v))) { say('Enter a nonnegative amount in dollars and cents, or leave it blank.'); return renderKeepingFocus(); }
    }
    if (t.dataset.type === 'bool') v = t.checked;
    if (t.dataset.type === 'optionalBool') v = v === 'true' ? true : v === 'false' ? false : null;
    if (t.dataset.type === 'date') v = E.isCalendarDate(v) ? v : null; // blank or not a real calendar date = unknown
    if (t.dataset.type === 'pct') { const n = Number(v); v = v === '' || !Number.isFinite(n) ? 0 : Math.min(100, Math.max(0, n)) / 100; }
    const before = state.options.map((o) => E.evidenceStatus(state, o).state);
    const accountEdit = /^research\.clubHistory\.(\d+)\.(?:actualNet|actualCount|actualAmounts\.\w+|eventDate|name|source)$/.exec(t.dataset.path);
    if (accountEdit && getPath(state, t.dataset.path) !== v) delete clubHistory()[Number(accountEdit[1])].finalizedOn;
    setPath(state, t.dataset.path, v);
    afterEdit(t.dataset.path, before);
    touched = true;
    renderKeepingFocus();
  }

  // Side effects of an edit that keep the evidence honest.
  function afterEdit(path, before) {
    if (/^options\.\d+\.clubHistoryResearch\.golfWeeks$/.test(path)) {
      state.options[Number(path.split('.')[1])].clubHistoryResearch.golfAsOf = localYMD();
    }
    const m = path.match(/^evidence\.(namedHighIntent|surveyDefinitelyAtPrice|surveyProbablyAtPrice)\.(.+)$/);
    if (m && before) { // record terms only when this option had NO survey answers before this edit
      const idx = state.options.findIndex((x) => x.id === m[2]), o = state.options[idx];
      state.evidence.offerTerms = state.evidence.offerTerms || {};
      if (o && before[idx] === 'none' && !state.evidence.offerTerms[o.id]) {
        const issued = (state.evidence.surveyIssuedTerms || {})[o.id];
        state.evidence.offerTerms[o.id] = issued ? { ...issued } : E.offerTerms(o, state.snapshot); // the offer people actually saw, if the survey was copied here
      }
    }
    const dep = path.match(/^options\.(\d+)\.(deposit\.amount|fixedCosts\.\d+\.(amount|paidUpfront))$/);
    if (dep && state.options[+dep[1]] && state.options[+dep[1]].upfrontFundingConfirmed) { state.options[+dep[1]].upfrontFundingConfirmed = false; say('Money due before the event changed, so the treasurer\'s confirmation was unchecked. Check it again once it\'s confirmed for the new amount.'); }
    const q = path.match(/^options\.(\d+)\.((?:venueQuote|deposit|capacity|groupSize|wholeGroupsOnly|cancellationOwed)\b|contract\.(?:quoteDate|quoteExpires|depositDue|headcountDue|cancelBy|quoteSource)$)/);
    if (q && state.options[+q[1]] && state.options[+q[1]].quoteVerified) { state.options[+q[1]].quoteVerified = false; say(/contract\./.test(q[2]) ? 'You changed a date or the reference on the quote, so "I have this quote in writing" was unchecked. Check it again once it matches the written quote.' : 'You changed a quote number, so "I have this quote in writing" was unchecked. Check it again once the new number is in writing.'); }
    const k = path.match(/^options\.(\d+)\.(perParticipantCosts|fixedCosts)\.\d+\.amount$/);
    if (k && state.options[+k[1]] && state.options[+k[1]].costsVerified) { state.options[+k[1]].costsVerified = false; say('You changed a cost, so "These costs are real quotes" was unchecked. Check it again once it\'s confirmed.'); }
    if (before) state.options.forEach((o, i) => {
      if (before[i] === 'current' && E.evidenceStatus(state, o).state === 'stale') say(`Heads up: supporters answered the survey for different terms than ${o.name} now has. Their answers won't count toward the decision until you re-ask or confirm them on the "What did supporters say?" step.`);
    });
  }

  // A change event fires before Tab moves focus. Re-render on the next tick, then put focus back
  // on whatever control the person had moved to (matched by its data attributes), so keyboard and
  // screen-reader users aren't thrown back to the top of the page.
  function focusKey(el) {
    if (!el || el === document.body || !document.getElementById('app').contains(el)) return null;
    if (el.dataset.path) return `[data-path="${CSS.escape(el.dataset.path)}"]`;
    if (el.dataset.whatif) return `[data-whatif="${CSS.escape(el.dataset.whatif)}"]`;
    if (el.dataset.shortcut) return `[data-shortcut="${CSS.escape(el.dataset.shortcut)}"]`;
    if (el.dataset.same) return `[data-same="${CSS.escape(el.dataset.same)}"]`;
    if (el.dataset.researchToggle) return `[data-research-toggle="${CSS.escape(el.dataset.researchToggle)}"][value="${CSS.escape(el.value)}"]`;
    if (el.dataset.scenarioStatus) return `[data-scenario-status="${CSS.escape(el.dataset.scenarioStatus)}"][value="${CSS.escape(el.value)}"]`;
    if (el.dataset.action) return `[data-action="${CSS.escape(el.dataset.action)}"]` + (el.dataset.i != null ? `[data-i="${CSS.escape(el.dataset.i)}"]` : '') + (el.dataset.k != null ? `[data-k="${CSS.escape(el.dataset.k)}"]` : '') + (el.dataset.pct != null ? `[data-pct="${CSS.escape(el.dataset.pct)}"]` : '') + (el.dataset.j != null ? `[data-j="${CSS.escape(el.dataset.j)}"]` : '') + (el.dataset.key ? `[data-key="${CSS.escape(el.dataset.key)}"]` : '');
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
    if (!b) {
      const link = e.target.closest('a[href^="#step-"]');
      // Following the current fragment again does not fire hashchange.
      if (link && fieldTarget && link.hash === location.hash && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        readHash();
        render(true);
      }
      return;
    }
    if (b.tagName === 'INPUT') return;
    const a = b.dataset.action, i = +b.dataset.i, j = +b.dataset.j;
    if (a === 'club-record') { if (!editClubEvidence(b, i, j)) return; }
    else if (a === 'tab') openOption = i;
    else if (a === 'individual-items') { const before = state.options.map((o) => E.evidenceStatus(state, o).state); useIndividualItems(state.options[i]); afterEdit(`options.${i}.groupSize`, before); }
    else if (a === 'add-row') { state.options[i][b.dataset.key].push({ id: uid('cost_'), label: 'New cost', amount: 0, paidUpfront: false }); state.options[i].costsVerified = false; }
    else if (a === 'del-row') { state.options[i][b.dataset.key].splice(j, 1); state.options[i].costsVerified = false; }
    else if (a === 'confirm-terms') { if (!armed(b, 'Only if you asked supporters about this exact offer. Click again')) return; state.evidence.offerTerms = state.evidence.offerTerms || {}; state.evidence.offerTerms[state.options[i].id] = E.offerTerms(state.options[i], state.snapshot); say('Recorded: these answers are for the current offer.'); }
    else if (a === 'add-option') { const o = clone(window.BFPlan.BLANK_STATE.options[0]); o.id = uid('opt_'); o.name = 'New option'; state.options.push(o); openOption = state.options.length - 1; }
    else if (a === 'dup-option') { const o = clone(state.options[i]); o.id = uid('opt_'); o.name += ' (copy)'; state.options.push(o); openOption = state.options.length - 1; }
    else if (a === 'del-option') {
      if (!armed(b, 'Click again to remove')) return;
      state.options.splice(i, 1); openOption = 0;
      // Its survey and payment counts stay in the file (nothing is erased) but count for nothing; the plan stays readable.
      say('Option removed. Its survey answers and payment numbers stay in your saved file but no longer count, and sponsors tied only to it now count for no option.');
    }
    else if (a === 'fill-evidence') {
      const o = state.options[i], d = E.decide(state, o);
      o.scenarioParticipants.conservative = d.paid;
      o.scenarioParticipants.middle = d.paid + d.namedCounted; // stale or unrecorded answers don't count
    }
    else if (a === 'archive-round') {
      const o = state.options[i]; if (!o) return;
      if (!armed(b, 'Move these answers to a past round? Paid sign-ups and money stay. Click again')) return;
      const ev = state.evidence;
      if (!ev.offerHistory || typeof ev.offerHistory !== 'object' || Array.isArray(ev.offerHistory)) ev.offerHistory = {};
      if (!Array.isArray(ev.offerHistory[o.id])) ev.offerHistory[o.id] = [];
      const g = (k) => Math.max(0, Math.floor(Number((ev[k] || {})[o.id]) || 0));
      const terms = (ev.offerTerms || {})[o.id];
      ev.offerHistory[o.id].push({ id: uid('rnd_'), archivedOn: localYMD(), terms: terms ? { ...terms } : null, named: g('namedHighIntent'), definitely: g('surveyDefinitelyAtPrice'), probably: g('surveyProbablyAtPrice'),
        surveyResponses: ev.surveyResponses == null || ev.surveyResponses === '' ? null : ev.surveyResponses, surveyContacted: ev.surveyContacted == null || ev.surveyContacted === '' ? null : ev.surveyContacted });
      ['namedHighIntent', 'surveyDefinitelyAtPrice', 'surveyProbablyAtPrice'].forEach((k) => { if (ev[k] && typeof ev[k] === 'object') ev[k][o.id] = 0; });
      if (ev.offerTerms) delete ev.offerTerms[o.id];
      if (ev.surveyIssuedTerms) delete ev.surveyIssuedTerms[o.id]; // that survey described the old offer
      openRecords.add('rounds-' + o.id);
      say(`${o.name}: answers kept as a past round. Enter the new answers when supporters reply about the current offer. Paid sign-ups and money received did not change. The whole-survey totals stay as they are: update them if you send a new survey.`);
    }
    else if (a === 'add-scenario-reason') {
      const o = state.options[i], k = b.dataset.k; if (!o || !SC.includes(k)) return;
      const r = ensureResearch(), id = uid('lnk_');
      r.links.push({ id, optionId: o.id, assumption: k, researchIds: [], note: '' });
      openRecords.add(id); touched = true; persist();
      return go('research');
    }
    else if (a === 'apply-shortcut') {
      const o = state.options[i]; if (!o) return;
      const sc = E.capacityShortcuts(state, o, shortcutTarget), r = sc.rows.find((x) => x.pct === +b.dataset.pct);
      if (!r || r.belowPaid) return;
      const label = state.scenarioSettings[sc.scenario].label;
      if (!armed(b, `Set your ${label} number to ${r.participants}? Click again`)) return;
      o.scenarioParticipants[sc.scenario] = r.participants; // the same engine call as the preview, so the result is the preview
      const after = E.project(o, o.scenarioParticipants[sc.scenario], E.scenarioContext(state, o, sc.scenario)).net;
      say(`${label} number set to ${r.participants} (${r.pct}% of capacity). Money left in that case: ${money(after)}${after === r.net ? ', as previewed' : ` (the preview said ${money(r.net)}: please report this)`}. It is your scenario, not a prediction; say why under “Why this number”.`);
    }
    else if (a === 'capture-club-result' || a === 'add-club-result') {
      if (!state.options[i] || !createClubResult(state.options[i], a === 'capture-club-result')) return;
    }
    else if (a === 'confirm-club-actuals') {
      const r = clubHistory()[j], today = localYMD();
      if (!r) return;
      const totals = A.actual(r);
      if (!r.name || !r.name.trim() || !E.isCalendarDate(r.eventDate) || r.eventDate > today || !r.source || !r.source.trim() || totals.net == null) {
        say(totals.conflict ? 'The net from actual amounts and your final net disagree. Check the final accounts.' :
          'Enter the event name, an elapsed event date, the source of final figures, and either the final net or all four actual amounts.');
        return;
      }
      r.finalizedOn = today;
      say('Final accounts confirmed.');
    }
    else if (a === 'delete-club-result') {
      if (!clubHistory()[j] || !armed(b, 'Remove this result and its estimate? Click again')) return;
      clubHistory().splice(j, 1);
    }
    else if (a === 'add-research') {
      const r = ensureResearch(), k = b.dataset.kind;
      if (k === 'audiences') r.audiences.push({ id: uid('aud_'), name: '', provenance: 'estimate', verification: 'unchecked', category: 'other', unit: 'people', reach: null, contacted: null, responded: null, source: '', sourceDate: null, overlapsWith: [], optionIds: [], notes: '' });
      else if (k === 'comparables') r.comparables.push({ id: uid('cmp_'), name: '', provenance: 'observation', verification: 'unchecked', groupPriceBasis: 'unknown', advertisedCapacity: null, eventType: '', location: '', eventDate: null, sourceUrl: '', sourceRef: '', checkedDate: null, sourceQuality: 'unknown', format: '', included: '', pricingTier: 'unknown', priceSingle: null, priceGroup: null, groupSize: null, feesPerPerson: null, feesNote: '', resultAttendance: null, resultVerified: false, resultNote: '', comparability: 'unknown', differences: '', optionIds: state.options.length === 1 ? [state.options[0].id] : [] });
      else if (k === 'links') r.links.push({ id: uid('lnk_'), optionId: (state.options[0] || {}).id || '', assumption: 'price', researchIds: [], note: '' });
      else return;
      openRecords.add(r[k][r[k].length - 1].id); // a new record opens for editing
    }
    else if (a === 'del-research') {
      const r = ensureResearch(), k = b.dataset.kind;
      if (!RES_KEYS.includes(k) || !r[k][j]) return;
      if (!armed(b, 'Remove this record? Click again')) return;
      r[k].splice(j, 1);
      say('Removed. Anything that pointed at it is listed under “Research links that point at nothing” until you remove it.');
    }
    else if (a === 'fix-research') {
      const r = ensureResearch(), key = { audience: 'audiences', comparable: 'comparables', link: 'links' }[b.dataset.kind];
      if (!key) return;
      const idx = r[key].findIndex((x) => x && x.id === b.dataset.id); if (idx < 0) return;
      const rec = r[key][idx], f = b.dataset.field;
      if (f === 'optionId') r.links.splice(idx, 1);
      else if (Array.isArray(rec[f])) rec[f] = rec[f].filter((x) => x !== b.dataset.missing);
      else return;
    }
    else if (a === 'add-sponsor') state.sponsorships.push({ id: uid('sp_'), label: 'New sponsor', amount: 0, status: 'hoped', type: 'cash', optionId: '' });
    else if (a === 'del-sponsor') state.sponsorships.splice(j, 1);
    else if (a === 'toggle-survey') { surveyOpen = !surveyOpen; document.getElementById('survey').hidden = !surveyOpen; return; }
    else if (a === 'copy-survey') {
      state.evidence.surveyIssuedTerms = state.evidence.surveyIssuedTerms || {};
      state.options.forEach((o) => { state.evidence.surveyIssuedTerms[o.id] = E.offerTerms(o, state.snapshot); });
      touched = true; persist();
      return copyText(surveyText(), b);
    }
    else if (a === 'copy-brief') return copyText(briefText(clubBrief()), b);
    else if (a === 'copy-memo') return copyText(boardMemo(), b);
    else if (a === 'clear-whatif') { whatIf = { ...freshWhatIf(), opt: whatIf.opt }; render(); return; }
    else if (a === 'apply-price') {
      // The one way a hypothetical reaches the plan: an explicit, confirmed click. The same edit rules as typing the
      // price on step 4 apply (survey answers for the old offer go stale; paid tickets keep the money received).
      const o = state.options[whatIf.opt], k = +b.dataset.k, req = whatIfRequest(o), slot = req.slots.indexOf(k);
      if (!o || slot < 0) return;
      // Apply exactly the fields the preview used (engine hypotheticalPrice), so the plan gives the previewed figure.
      const preview = E.whatWouldChange(state, o, req), pr = preview.prices[slot];
      if (!pr) return;
      if (!armed(b, `Change ${o.name}'s price in your plan? Click again`)) return;
      const before = state.options.map((x) => E.evidenceStatus(state, x).state), was = E.evidenceStatus(state, o).state;
      o.price = pr.apply.price; o.groupPrice = pr.apply.groupPrice; delete o.foursomePrice;
      afterEdit(`options.${whatIf.opt}.price`, before);
      const now = E.evidenceStatus(state, o).state;
      const after = E.whatWouldChange(state, o, { scenario: req.scenario, participants: req.participants }).net;
      const gName = T(o).groupName || 'group', grouped = (Number(o.groupSize) || 1) > 1;
      whatIf = { ...freshWhatIf(), opt: whatIf.opt, at: whatIf.at, custom: whatIf.custom };
      touched = true; render();
      say(`${o.name}: price changed to ${money(pr.apply.price)}${grouped ? ` (${pr.groupPriceSource === 'kept' ? `your ${money(pr.groupPrice)} ${gName} deal kept` : pr.groupPriceSource === 'typed' ? `${money(pr.groupPrice)} per ${gName}` : `no ${gName} discount`}; group settings unchanged)` : ''} in your plan. At ${pr.participants}, firm money is now ${money(after)}${after === pr.net ? ', as previewed' : ` (the preview said ${money(pr.net)}: please report this)`}. Your low, likely and high numbers were not changed: review them on step 9.`
        + (was === 'current' && now === 'stale' ? ' Survey answers were for the old price, so they no longer count until you re-ask or confirm them on step 8.' : ''));
      return;
    }
    else if (a === 'nav') return go(b.dataset.to);
    else if (a === 'opt-step') { openOption = i; render(true); window.scrollTo(0, 0); return; }
    else if (a === 'choose-backup') { document.getElementById('backup-input').click(); return; }
    else if (a === 'choose-new') {
      savePanel = false; showNewPlan = true; go('home');
      return;
    }
    else if (a === 'toggle-save') { savePanel = !savePanel; render(); return; }
    else if (a === 'csv-template') return showText('Survey summary CSV template', 'summary-template.csv', 'metric,option_id,value\nsurvey_responses,,0\n' + state.options.map((o) => ['paid_registrations', 'cash_received', 'named_high_intent', 'definitely_at_price', 'probably_at_price'].map((m) => `${m},${o.id},0`).join('\n')).join('\n') + '\n', 'text/csv');
    else if (a === 'export' || a === 'warn-export') return showText('Your plan (JSON). Copy it and save it in a file, or use Download where it works.', 'fundraiser-plan.json', JSON.stringify(state, null, 2), 'application/json');
    else if (a === 'copy-export') return copyText(document.getElementById('export-text').value, b);
    else if (a === 'download-export') { const t = document.getElementById('export-text'); return download(t.dataset.name, t.value, t.dataset.type); }
    else if (a === 'close-export') { document.getElementById('export-panel').hidden = true; return; }
    else if (a === 'start-blank') {
      const kind = document.getElementById('new-plan-kind')?.value || 'golf_tee_times';
      return startPlanForKind(b, kind);
    }
    else if (a === 'choose-event-idea') {
      if (view !== 'ideas') return;
      const match = window.BFEventIdeas.suggestIdeas(ideaSignals).find((idea) => idea.kind === b.dataset.kind);
      if (!match) return;
      if (!touched || state.isDemo) return startPlanForKind(b, match.kind, match.title);
      if (state.options.some((o) => o.kind === match.kind)) return;
      const option = newOptionForKind(match.kind, match.title);
      option.id = uid('opt_');
      state.options.push(option);
      persist(); say(match.title + ' added. Enter the quote for this option.');
      return go('step-quote/' + option.id);
    }
    else if (a === 'restore-backup') {
      const bk = backupInfo(); if (!bk) { say('There is no backup to restore.'); return; }
      if (!armed(b, 'Swap your current plan with the backup? Click again')) return;
      // A swap needs two writes. Change the plan on screen only if both work; otherwise put back what was there and say so.
      const fail = 'Could not restore: this browser refused to store the change. Your current plan is still here. Use Download backup file to keep a copy.';
      const backupRaw = storeRead(SAVE_KEY + '-backup'), primaryBefore = storeRead(SAVE_KEY), currentRaw = JSON.stringify(state);
      if (!storeWrite(SAVE_KEY, backupRaw)) { say(fail); return; }
      if (!storeWrite(SAVE_KEY + '-backup', currentRaw)) {
        const undone = primaryBefore != null ? storeWrite(SAVE_KEY, primaryBefore) : (() => { try { localStorage.removeItem(SAVE_KEY); return true; } catch (e) { return false; } })();
        if (!undone) setSaveProblem('Your current plan is not saved in this browser (a restore could not finish). Download a backup file now so you don\'t lose it.');
        say(fail); return;
      }
      storeWrite(SAVE_KEY + '-backup-at', new Date().toISOString());
      state = migrate(clone(bk.plan)); openOption = 0; touched = true; whatIf = freshWhatIf(); setSaveProblem('');
      rememberStep(view === 'wizard' ? STEPS[stepIdx] : STEPS[0]); showNewPlan = false;
      say('Previous plan restored. The plan you had open is now the backup, so you can swap back.');
    }
    else if (a === 'download-backup') { download(`fundraiser-plan-${localYMD()}.json`, JSON.stringify(state, null, 2), 'application/json'); downloadStartedAt = new Date(); if (savePanel) render(); return; }
    else if (a === 'print') { window.print(); return; }
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
  // Check an imported plan before it replaces anything. Returns a list of plain-language problems (empty = OK).
  function validatePlan(s) {
    const p = [];
    const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
    const isNum = (v) => v == null || v === '' || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
    const isStr = (v) => v == null || typeof v === 'string';
    const isFlag = (v) => v == null || typeof v === 'boolean';
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObj(s)) return ['The file is not a plan.'];
    if (!isStr(s.eventName)) p.push('The plan name must be text.');
    if (!isFlag(s.isDemo)) p.push('The fictional-plan setting must be true or false.');
    if (!Array.isArray(s.options) || !s.options.length) p.push('It has no fundraiser options.');
    const ids = new Set();
    (s.options || []).forEach((o, i) => {
      const n = `Option ${i + 1}`;
      if (!isObj(o)) { p.push(`${n} is not readable.`); return; }
      if (typeof o.id !== 'string' || !SAFE_ID.test(o.id)) p.push(`${n} has a missing or invalid id (letters, numbers, - and _ only).`); else if (ids.has(o.id)) p.push(`${n} repeats its id.`); else ids.add(o.id);
      if (o.forecastDraft != null && !A.validDraft(o.forecastDraft)) p.push(`${n}: the draft forecast needs a valid event date, board estimate and comparable choice.`);
      if (o.clubHistoryResearch != null && !window.BFClubHistory.valid(o.clubHistoryResearch)) p.push(`${n}: club checkpoints or auction lots have an invalid amount, count, date, id or source.`);
      if (!isStr(o.name)) p.push(`${n}: the name must be text.`);
      if (['quoteVerified', 'costsVerified', 'upfrontFundingConfirmed', 'wholeGroupsOnly'].some((k) => !isFlag(o[k]))) p.push(`${n}: quote, cost, funding and whole-group checkboxes must be true or false.`);
      if (o.kind != null && !(o.kind in EVENT_TYPES)) p.push(`${n}: unknown kind of fundraiser.`);
      ['price', 'groupPrice', 'groupShare', 'capacity', 'groupSize', 'volunteerHours', 'cancellationOwed'].forEach((k) => { if (!isNum(o[k])) p.push(`${n}: "${k}" must be a number of 0 or more.`); });
      if (!isObj(o.venueQuote)) p.push(`${n} is missing its venue quote.`);
      else ['flatFee', 'perParticipant', 'minimumParticipants', 'minimumSpend'].forEach((k) => { if (!isNum(o.venueQuote[k])) p.push(`${n}: venue "${k}" must be a number of 0 or more.`); });
      if (!isObj(o.deposit) || !isNum(o.deposit.amount)) p.push(`${n} is missing a valid deposit.`);
      else if (!isFlag(o.deposit.creditedTowardBill) || !isFlag(o.deposit.refundable)) p.push(`${n}: the deposit answers must be yes, no or unknown.`);
      ['perParticipantCosts', 'fixedCosts'].forEach((k) => { if (!Array.isArray(o[k]) || o[k].some((r) => !isObj(r) || !isNum(r.amount) || !isStr(r.label) || (r.id != null && !SAFE_ID.test(String(r.id))))) p.push(`${n}: ${k} must be a list of costs with names and amounts.`); });
      if (Array.isArray(o.fixedCosts) && o.fixedCosts.some((line) => isObj(line) && !isFlag(line.paidUpfront))) p.push(`${n}: the paid-upfront setting for each fixed cost must be true or false.`);
      // Contract dates and notes (optional; older plans have none). Dates must be real calendar dates; notes are short text.
      if (o.contract != null && (!isObj(o.contract) || Object.entries(o.contract).some(([k, v]) => (E.CONTRACT_DATES.some(([dk]) => dk === k) || k === 'quoteDate')
        ? !(v == null || v === '' || E.isCalendarDate(v)) : !(v == null || (typeof v === 'string' && v.length <= 2000))))) p.push(`${n}: contract dates must be calendar dates (YYYY-MM-DD) and notes must be short text.`);
      ['scenarioParticipants', 'scenarioProceeds'].forEach((k) => { if (k === 'scenarioParticipants' && !isObj(o[k])) p.push(`${n} is missing its low/likely/high numbers.`); else if (o[k] != null && (!isObj(o[k]) || Object.values(o[k]).some((v) => !isNum(v)))) p.push(`${n}: ${k} must hold numbers.`); });
    });
    const ss = s.scenarioSettings;
    if (!isObj(ss) || !['conservative', 'middle', 'optimistic'].every((k) => isObj(ss[k]) && Array.isArray(ss[k].statuses) && ss[k].statuses.every((x) => E.SPONSOR_STATUSES.includes(x)) && ['extraRevenuePerParticipant', 'otherRevenue', 'costContingencyPct'].every((f) => isNum(ss[k][f])) && isStr(ss[k].label))) p.push('Scenario settings are missing or incomplete.');
    if (!Array.isArray(s.sponsorships)) p.push('Sponsorships must be a list.');
    else if (s.sponsorships.some((x) => !isObj(x) || !isNum(x.amount) || !E.SPONSOR_STATUSES.includes(x.status) || !['cash', 'inKind'].includes(x.type) || !isStr(x.label) || (x.optionId && !SAFE_ID.test(String(x.optionId))) || (x.replacesCostId && !SAFE_ID.test(String(x.replacesCostId))) || (x.id != null && !SAFE_ID.test(String(x.id))))) p.push('A sponsorship has a bad amount, status, type or link.');
    const ev = s.evidence;
    if (!isObj(ev)) p.push('Survey and payment evidence is missing.');
    else {
      if (!isNum(ev.surveyResponses)) p.push('The number of survey responses must be a number.');
      ['paidRegistrations', 'paidCashReceived', 'namedHighIntent', 'surveyDefinitelyAtPrice', 'surveyProbablyAtPrice'].forEach((k) => {
        if (ev[k] == null) return;
        // Entries for an option that was deleted are kept and ignored (row 86); they must still be safe ids and numbers.
        if (!isObj(ev[k]) || Object.entries(ev[k]).some(([id, v]) => !SAFE_ID.test(id) || !isNum(v))) p.push(`Evidence "${k}" must hold numbers for the plan's options.`);
      });
      if (!isNum(ev.surveyContacted)) p.push('The number of people the survey was sent to must be a number.');
      // Past rounds (row 87): per option, a list of kept answers with the offer they were for.
      if (ev.offerHistory != null && (!isObj(ev.offerHistory) || Object.entries(ev.offerHistory).some(([id, list]) => !SAFE_ID.test(id) || !Array.isArray(list) || list.some((r) => !isObj(r)
        || (r.id != null && !SAFE_ID.test(String(r.id))) || !['named', 'definitely', 'probably', 'surveyResponses', 'surveyContacted'].every((f) => isNum(r[f]))
        || !(r.archivedOn == null || r.archivedOn === '' || E.isCalendarDate(r.archivedOn))
        || !(r.terms == null || (isObj(r.terms) && Object.values(r.terms).every((v) => v == null || ['string', 'number'].includes(typeof v)))))))) p.push('Past survey rounds are not readable.');
      ['offerTerms', 'surveyIssuedTerms'].forEach((k) => {
        if (ev[k] == null) return;
        if (!isObj(ev[k]) || Object.entries(ev[k]).some(([id, t]) => !SAFE_ID.test(id) || !isObj(t) || Object.values(t).some((v) => v != null && !['string', 'number'].includes(typeof v)))) p.push(`Evidence "${k}" is not readable.`);
      });
    }
    if (!isObj(s.settings) || !isNum(s.settings.fundraisingTarget) || !isNum(s.settings.volunteerHourValue)) p.push('Plan settings are missing or not numbers.');
    if (!isNum(s.volunteerHoursAvailable)) p.push('Volunteer hours available must be a number.');
    // Decision criteria (optional; row 90): blank = not set, numbers 0 or more, a real calendar date.
    if (s.criteria != null && (!isObj(s.criteria) || !isNum(s.criteria.minNet) || !isNum(s.criteria.maxLoss) || !(s.criteria.decideBy == null || s.criteria.decideBy === '' || E.isCalendarDate(s.criteria.decideBy)))) p.push('Decision criteria must be amounts of 0 or more and a calendar date.');
    if (s.snapshot != null && (!isObj(s.snapshot) || Object.values(s.snapshot).some((v) => !isStr(v)))) p.push('Survey details must be text.');
    // Research (optional; row 84). Imported research is untrusted: every known field is type-checked. Unknown extra fields
    // are kept but never shown. Links may point at a missing option or record: that is shown, not refused.
    if (s.research != null) {
      const r = s.research;
      const isIdList = (v) => v == null || (Array.isArray(v) && v.every((x) => typeof x === 'string' && SAFE_ID.test(x)));
      const shortStr = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
      const isDate = (v) => v == null || v === '' || E.isCalendarDate(v);
      const oneOf = (v, list) => v == null || list.includes(v);
      const rids = new Set();
      const recOk = (x, numFields, strFields, dateFields, enums, idLists) => isObj(x) && typeof x.id === 'string' && SAFE_ID.test(x.id) && !rids.has(x.id) && rids.add(x.id)
        && numFields.every((k) => isNum(x[k])) && strFields.every(([k, m]) => shortStr(x[k], m)) && dateFields.every((k) => isDate(x[k]))
        && Object.entries(enums).every(([k, list]) => oneOf(x[k], list)) && idLists.every((k) => isIdList(x[k]))
        && (x.resultVerified == null || typeof x.resultVerified === 'boolean') && (x.fictional == null || typeof x.fictional === 'boolean');
      if (!isObj(r)) p.push('Research must be a set of records.');
      else {
        ['audiences', 'comparables', 'links'].forEach((k) => { if (r[k] != null && !Array.isArray(r[k])) p.push(`Research "${k}" must be a list.`); });
        if (r.clubHistory != null && (!Array.isArray(r.clubHistory) || r.clubHistory.some((h) =>
          !isObj(h) || typeof h.id !== 'string' || !SAFE_ID.test(h.id) || rids.has(h.id) || !rids.add(h.id) ||
          typeof h.optionId !== 'string' || !SAFE_ID.test(h.optionId) || typeof h.kind !== 'string' || !Object.hasOwn(EVENT_TYPES, h.kind) ||
          typeof h.captured !== 'boolean' || typeof h.fictional !== 'boolean' || !shortStr(h.name, 160) ||
          !shortStr(h.source, 300) || !shortStr(h.qualification, 500) || !isDate(h.eventDate) || !isDate(h.estimatedOn) ||
          ![h.actualCount, h.estimatedCount].every((v) => validOutcomeNumber(v, true)) ||
          ![h.actualNet, h.estimatedNet].every((v) => validOutcomeNumber(v, false)) ||
          !A.validRecord(h) || (h.captured && (!E.isCalendarDate(h.estimatedOn) || h.estimatedCount == null || h.estimatedCount === '' || h.estimatedNet == null || h.estimatedNet === ''))))) p.push('A club outcome needs a valid format, dates, whole counts and readable net amounts.');
        const prov = { provenance: ['', ...E.PROVENANCES], verification: E.VERIFICATIONS };
        if ((r.audiences || []).some((x) => !recOk(x, ['reach', 'contacted', 'responded'], [['name', 120], ['source', 300], ['notes', 1000]], ['sourceDate'],
          { category: Object.keys(CATEGORY_LABEL), unit: Object.keys(UNIT_LABEL), ...prov }, ['overlapsWith', 'optionIds']))) p.push('An audience research record has a bad id, number, date, kind or text.');
        if ((r.comparables || []).some((x) => !recOk(x, ['priceSingle', 'priceGroup', 'groupSize', 'feesPerPerson', 'resultAttendance', 'advertisedCapacity'],
          [['name', 160], ['eventType', 160], ['location', 160], ['sourceUrl', 2000], ['sourceRef', 300], ['format', 200], ['included', 300], ['feesNote', 200], ['resultNote', 300], ['differences', 1000]],
          ['eventDate', 'checkedDate'], { sourceQuality: Object.keys(QUALITY_LABEL), pricingTier: Object.keys(TIER_LABEL), comparability: Object.keys(COMPARABILITY_LABEL), groupPriceBasis: Object.keys(BASIS_LABEL), ...prov }, ['optionIds']))) p.push('A similar-event research record has a bad id, price, date, kind or text.');
        if ((r.links || []).some((x) => !recOk(x, [], [['note', 1000]], [], { assumption: Object.keys(ASSUMPTION_LABEL) }, ['researchIds']) || !(typeof x.optionId === 'string' && SAFE_ID.test(x.optionId)))) p.push('A research note on an assumption has a bad id, option or kind.');
      }
    }
    return p;
  }
  function importClubOutcomes(file) {
    const target = state;
    readFile(file, (content) => {
      try {
        if (target !== state) throw new Error('The open plan has changed. Choose the file again.');
        const previous = JSON.parse(content);
        const problems = validatePlan(previous);
        if (problems.length) throw new Error(problems[0]);
        const added = A.carryForward(previous, state, localYMD());
        if (!added.length) { say('No new completed club events to bring in. Check for fictional, duplicate or unconfirmed records.'); return; }
        const records = ensureResearch();
        records.clubHistory = clubHistory().concat(added);
        touched = true; render();
        say(`${added.length} completed event record(s) added to past club results.` + (saveProblem ? ' Download a backup to keep these changes.' : ''));
      } catch (error) { say('Could not bring in club results: ' + error.message); }
    });
  }
  function importJson(f) {
    readFile(f, (t) => {
      try {
        const s = JSON.parse(t);
        const problems = validatePlan(s);
        if (problems.length) throw new Error(problems.slice(0, 3).join(' ') + (problems.length > 3 ? ` (${problems.length - 3} more)` : ''));
        const candidate = migrate(clone(s));
        const prevState = state, prevSaved = storeRead(SAVE_KEY);
        try {
          state = candidate;
          // Dry run: every calculation and page the plan feeds must work before anything is replaced.
          candidate.options.forEach((o) => { analyse(o); });
          viewDecision(); viewResults(); viewWizard(); viewResearch(); boardMemo();
        } catch (err) { state = prevState; throw new Error('the plan has values the planner cannot use (' + err.message + ').'); }
        state = prevState; // the backup is of the plan on screen, so put it back while the backup is made
        const bk = secureBackup(); // same rule as the other replacements: no backup of a real plan, no replacement
        if (bk === 'failed') {
          savePanel = true; render();
          say('Could not make a backup of your current plan (this browser refused to store it), so the file was not opened. Your plan is still here and unchanged. Use Download backup file to keep a copy before trying again.');
          return;
        }
        const prevTouched = touched;
        state = candidate; openOption = 0; touched = true; whatIf = freshWhatIf();
        try { render(); } catch (err) { state = prevState; touched = prevTouched; if (prevSaved != null) storeWrite(SAVE_KEY, prevSaved); render(); throw err; }
        rememberStep(view === 'wizard' ? STEPS[stepIdx] : STEPS[0]);
        showNewPlan = false;
        if (view === 'home' || view === 'ideas') { ideaSignals.clear(); savePanel = false; go('step-event'); }
        say('Plan imported.' + (bk === 'saved' ? ' Your previous plan was kept as a backup in this browser.' : '') + (saveProblem ? ' It is NOT saved in this browser yet: see the red warning.' : ''));
      } catch (err) { say('Could not import that file: ' + err.message); }
    });
  }
  function importCsv(f) {
    const map = { named_high_intent: 'namedHighIntent', definitely_at_price: 'surveyDefinitelyAtPrice', probably_at_price: 'surveyProbablyAtPrice', paid_registrations: 'paidRegistrations', cash_received: 'paidCashReceived' };
    readFile(f, (t) => {
      const errs = []; let n = 0;
      const before = state.options.map((o) => E.evidenceStatus(state, o).state);
      t.split(/\r?\n/).slice(1).forEach((line, k) => {
        if (!line.trim()) return;
        const [metric, optionId, value] = line.split(',').map((x) => x.trim());
        const v = Number(value);
        if (!Number.isFinite(v) || v < 0) { errs.push(`row ${k + 2}: bad value`); return; }
        if (metric === 'survey_responses') { state.evidence.surveyResponses = Math.floor(v); n++; }
        else if (map[metric]) {
          if (!state.options.some((o) => o.id === optionId)) { errs.push(`row ${k + 2}: unknown option_id "${optionId}"`); return; }
          state.evidence[map[metric]] = state.evidence[map[metric]] || {};
          state.evidence[map[metric]][optionId] = metric === 'cash_received' ? v : Math.floor(v); n++;
          afterEdit(`evidence.${map[metric]}.${optionId}`, before);
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
    const before = state.options.map((o) => E.evidenceStatus(state, o).state);
    setPath(state, t.dataset.path, t.value); touched = true; afterEdit(t.dataset.path, before); persist();
    const btn = document.querySelector('[data-action="copy-survey"]'); if (btn) btn.disabled = !snapshotReady();
  });
  document.addEventListener('click', onClick);
  // Remember which research records are open, so re-drawing the page after an edit keeps them open.
  document.addEventListener('toggle', (e) => { const d = e.target; if (!d || !d.matches) return; const key = d.matches('details[data-rec]') ? d.dataset.rec : d.matches('details[data-keep]') ? d.dataset.keep : null; if (key) { if (d.open) openRecords.add(key); else openRecords.delete(key); } }, true);
  // Printing: open every collapsed detail section so the printout is complete, then put them back.
  let printOpened = [];
  // Add to the list rather than replace it: if a second beforeprint arrives first, the first one's sections still close.
  window.addEventListener('beforeprint', () => { const closed = [...document.querySelectorAll('#app details:not([open])')]; closed.forEach((el) => { el.open = true; }); printOpened = printOpened.concat(closed); });
  window.addEventListener('afterprint', () => { printOpened.forEach((el) => { el.open = false; }); printOpened = []; });
  document.addEventListener('pointermove', onMove);
  // Moving to another page clears an old status message (but not one set by the click that caused the move).
  window.addEventListener('hashchange', () => { if (Date.now() - saidAt > 1500) say(''); readHash(); window.scrollTo(0, 0); render(true); });
  loadSavedPlan();
  readHash();
  render(!!fieldTarget);
  if (startupNote) say(startupNote);
})();
