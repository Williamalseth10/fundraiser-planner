# Browser checks for Batch 3: "Ready to commit?" (DECISION_LOG row 90). Run after `node scripts/build.js`:
#   python3 test/ui_ready.py [screenshot_dir]
# Real clicks and keys; each section in a fresh browser context (separate storage); fictional data only.
# A section that throws is recorded as a failure, so this also reports cleanly against an older build.
import sys, json, re, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'dist' / 'booster-fundraiser-planner.html').as_uri()
CONTROL = json.loads((ROOT / 'test' / 'fixtures' / 'golf-control-fictional.json').read_text())
shots = sys.argv[1] if len(sys.argv) > 1 else None
results = []
def check(name, cond, detail=''): results.append((name, bool(cond), detail))
def section(name, fn):
    try: fn()
    except Exception as e: results.append((f'{name}: section ran to the end', False, f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'))
def P(p): return f'[data-path="{p}"]'
def fill(pg, sel, v): pg.fill(sel, str(v), timeout=5000); pg.press(sel, 'Tab'); pg.wait_for_timeout(150)
def stored(pg): return json.loads(pg.evaluate("localStorage.getItem('bfp-plan-v1')") or 'null')
def open_file(pg, text):
    if not pg.is_visible('#save-panel'): pg.click('[data-action="toggle-save"]')
    pg.set_input_files('input[data-action="import-json"]', files=[{'name': 'p.json', 'mimeType': 'application/json', 'buffer': text.encode()}])
    pg.wait_for_timeout(300); st = pg.inner_text('#status'); pg.click('[data-action="toggle-save"]'); return st
def memo(pg):
    pg.evaluate("""() => { window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } });
      document.execCommand = () => { const el = document.activeElement; window.__copied = el && el.value; return true; }; }""")
    pg.click('[data-action="copy-memo"]'); pg.wait_for_timeout(150); return pg.evaluate('window.__copied') or ''
def no_hscroll(pg):
    sw, cw = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]'); return sw <= cw + 1
def card(pg, oid): return pg.inner_text(f'article.ready[data-ready="{oid}"]')
def crit_items(pg, oid):  # [(mark word, text)] from the screen
    return [tuple(t.split(': ', 1)) for t in pg.eval_on_selector_all(f'article.ready[data-ready="{oid}"] ul.crit li', 'els => els.map(e => e.innerText.replace(/^\\S+\\s*/, "").trim())')]
def memo_section(m, name):
    i = m.find(f'## {name}'); j = m.find('### Ready to commit?', i); k = m.find('\n## ', j)
    return m[j:k if k > 0 else len(m)]
def plan(**over):
    p = json.loads(json.dumps(CONTROL)); p.update(over); return p
def results_page(pg):
    pg.goto(URL + '#results'); pg.wait_for_timeout(300)
def local_day(pg, delta):
    return pg.evaluate(f"(() => {{ const t = new Date(); t.setDate(t.getDate() + ({delta})); const p = (n) => String(n).padStart(2, '0'); return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); }})()")

with sync_playwright() as p:
    b = p.chromium.launch()
    def new(**kw):
        ctx = b.new_context(viewport=kw.pop('viewport', {'width': 1280, 'height': 900}), accept_downloads=True, timezone_id=kw.pop('tz', 'America/Los_Angeles'), **kw)
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); return ctx, pg, errs

    # 1. Criteria: blank vs zero, exact boundaries, matching screen / board summary / print
    def criteria():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, json.dumps(plan())); results_page(pg)
        c = card(pg, 'golf')
        check('section is on the results page with the four parts', all(h in c for h in ['What the numbers require', 'What we know', 'What remains uncertain', 'What to do next']), c[:300])
        check('blank criteria are unknown, not met, with the comparison value shown', 'Unknown: Smallest amount worth raising: not set. On firm money' in c and 'it would leave $5,020' in c and 'Unknown: Largest loss the club could accept: not set' in c and 'Unknown: Decide by: not set.' in c, c[:800])
        check('blank criteria are stored as nothing (no invented defaults)', 'criteria' not in stored(pg) or all(v is None for v in (stored(pg).get('criteria') or {}).values()))
        fill(pg, P('criteria.minNet'), 0); fill(pg, P('criteria.maxLoss'), 0)
        st = stored(pg)['criteria']
        check('typed 0 is saved as 0, not blank', st.get('minNet') == 0 and st.get('maxLoss') == 0, st)
        c = card(pg, 'golf')
        check('0 minimum is a real value: met by $5,020', 'Met: Smallest amount worth raising: $0.' in c, c[:500])
        check('0 loss limit is a real value: not met by the $5,120 cancellation exposure', 'Not met: Largest loss the club could accept: $0.' in c and '$5,120 owed and already spent (over the limit)' in c, c[:900])
        fill(pg, P('criteria.minNet'), '')
        check('clearing a criterion makes it unknown (null), not 0', stored(pg)['criteria']['minNet'] is None and 'Unknown: Smallest amount worth raising: not set' in card(pg, 'golf'))
        fill(pg, P('criteria.minNet'), 5020)
        check('exact boundary: $5,020 minimum with $5,020 firm net is met', 'Met: Smallest amount worth raising: $5,020.' in card(pg, 'golf'))
        fill(pg, P('criteria.minNet'), 5020.01)
        c = card(pg, 'golf')
        check('one cent more is not met', 'Not met: Smallest amount worth raising' in c and 'Adjust the price, costs or scope' in c, c[:500])
        fill(pg, P('criteria.maxLoss'), 5120)
        check('exact boundary: $5,120 loss limit with a $5,120 cancellation exposure is met', 'Met: Largest loss the club could accept: $5,120.' in card(pg, 'golf'))
        fill(pg, P('criteria.maxLoss'), 5119.99)
        check('one cent less is not met', 'Not met: Largest loss the club could accept' in card(pg, 'golf'))
        check('the scenario and basis are named', 'firm money (ticket money plus sponsorship collected or promised in writing), at your likely number of 72 players' in card(pg, 'golf') and 'if you hold it and few come' in card(pg, 'golf') and 'if you cancel after the deadline' in card(pg, 'golf'))
        pg.reload(); pg.wait_for_timeout(300); results_page(pg)
        check('refresh keeps the criteria', pg.input_value(P('criteria.minNet')) == '5020.01' and pg.input_value(P('criteria.maxLoss')) == '5119.99')
        # screen, board summary and print agree
        m = memo(pg); ms = memo_section(m, 'Shotgun golf day (fictional quote)')
        screen = crit_items(pg, 'golf')
        check('board summary: same criteria and conclusions as the screen', all(f'- [{w}] {t}' in ms for w, t in screen) and len(screen) == 4, (screen, ms[:900]))
        check('board summary: what we know, uncertain and next steps match the screen', all(x in ms for x in pg.eval_on_selector_all('article.ready[data-ready="golf"] section:nth-child(2) li, article.ready[data-ready="golf"] .miss li', 'els => els.map(e => e.innerText.trim())')) and all(f'. {x}' in ms for x in pg.eval_on_selector_all('article.ready[data-ready="golf"] ol.next li', 'els => els.map(e => e.innerText.trim())')))
        check('board summary: the criteria line and the caveat', 'Decision criteria: smallest amount worth raising $5,020; largest loss the club could accept $5,120;' in m and 'doesn’t mean people will come' in m, m[:900])
        pg.emulate_media(media='print')
        check('print: the section prints with the criteria as text and without the input boxes', pg.is_visible('.ready-panel') and pg.is_visible('.ready-panel .printonly') and not pg.is_visible(P('criteria.minNet')) and 'smallest amount worth raising $5,020' in pg.inner_text('.ready-panel .printonly'))
        check('print: the same conclusions as on screen', crit_items(pg, 'golf') == screen)
        if shots: pg.pdf(path=f'{shots}/b3-print.pdf')
        pg.emulate_media(media='screen')
        check('criteria: no page errors', not errs, errs); ctx.close()
    section('criteria', criteria)

    # 2. Evidence and money facts kept apart
    def facts():
        # positive likely net, stale answers
        ctx, pg, errs = new(); pg.goto(URL)
        s = plan(criteria={'minNet': 1000}); s['evidence']['offerTerms'] = {'golf': {'kind': 'golf_shotgun', 'price': 12500, 'groupSize': 4, 'groupPrice': 50000}}
        s['options'][0]['price'] = 150; s['options'][0]['groupPrice'] = 600
        open_file(pg, json.dumps(s)); results_page(pg); c = card(pg, 'golf')
        check('stale answers: the scenario can meet the minimum...', 'Met: Smallest amount worth raising: $1,000.' in c, c[:400])
        check('...but attendance is not called supported, and the old answers are not counted', '32 players paid and 0 named “yes” for the current offer (not payment) make 32, 40 short of it' in c and '40 named “yes” answers were for different or unrecorded terms' in c and 'The likely number is your assumption, not evidence.' in c, c[c.find('What we know'):][:600])
        check('stale answers: next step is to re-ask about the current offer', 'Re-ask supporters about the current offer' in c)
        check('no promise words anywhere in the section', not re.search(r'\b(will succeed|guarantee[sd]?(?! headcount)|approved|safe to sign|cancel the event|likely to attend)\b', pg.inner_text('.ready-panel'), re.I))
        # missing cancellation terms
        s = plan(criteria={'maxLoss': 100000}); s['options'][0]['cancellationOwed'] = None
        open_file(pg, json.dumps(s)); results_page(pg); c = card(pg, 'golf')
        check('missing cancellation terms stay unknown, not $0', 'Unknown: Largest loss the club could accept: $100,000. Exposure if you cancel after the deadline: unknown, because the cancellation terms are not entered' in c and 'within the limit' in c, c[:900])
        check('missing cancellation terms: next step asks for them in writing', 'what you would owe if you cancel' in c[c.find('What to do next'):])
        # low turnout over the limit is "not met" even while cancellation terms are unknown
        s = plan(criteria={'maxLoss': 1}); o = s['options'][0]; o.update(price=10, groupPrice=None, cancellationOwed=None)
        s['evidence']['paidRegistrations']['golf'] = 0; s['evidence']['paidCashReceived'] = {}
        open_file(pg, json.dumps(s)); results_page(pg); c = card(pg, 'golf')
        check('low turnout over the loss limit is not met, even with cancellation unknown', 'Not met: Largest loss the club could accept: $1.' in c and 'cancellation terms are not entered' in c and re.search(r'is a loss of \$[\d,]+ \(over the limit\)', c), c[:900])
        # firm sponsorship vs cash
        s = plan(); s['options'][0]['deposit']['amount'] = 9000
        open_file(pg, json.dumps(s)); results_page(pg); c = card(pg, 'golf')
        check('cash: promised sponsorship counts in firm money but is not cash', '$500 promised in writing counts in firm money but isn’t cash yet' in c and '$5,000 is in hand (collected sponsorship and money actually received)' in c, c[c.find('Cash:'):][:400])
        check('cash: shortfall shown and a step to cover it', 'Short by' in c and '(not yet covered)' in c and 'Agree how the club will cover the' in c)
        # volunteers
        s = plan(volunteerHoursAvailable=80)
        open_file(pg, json.dumps(s)); results_page(pg); c = card(pg, 'golf')
        check('volunteer hours: 100 needed, 80 available is not met, with no dollar value', 'Not met: Volunteer hours: about 100 needed, 80 available, 20 short.' in c and 'Find about 20 more volunteer hours' in c, c[:900])
        fill(pg, P('volunteerHoursAvailable'), '')
        check('volunteer hours: blank available is unknown', 'Unknown: Volunteer hours: about 100 needed; hours available are not entered.' in card(pg, 'golf') and stored(pg)['volunteerHoursAvailable'] is None)
        if shots: pg.locator('article.ready[data-ready="golf"]').screenshot(path=f'{shots}/b3-volunteers-unknown.png')
        check('facts: no page errors', not errs, errs); ctx.close()
    section('facts', facts)

    # 3. Deadlines on local calendar dates (a US evening, when UTC is already tomorrow)
    def deadlines():
        ctx, pg, errs = new(tz='America/Los_Angeles'); pg.goto(URL); open_file(pg, json.dumps(plan(criteria={'minNet': 1000, 'maxLoss': 6000}))); results_page(pg)
        before = crit_items(pg, 'golf')[:3]
        fill(pg, P('criteria.decideBy'), local_day(pg, -3))
        c = card(pg, 'golf')
        check('passed deadline: shown as timing, 3 days ago', 'Timing: Decide by:' in c and '(3 days ago). The date has passed. That is timing, not a sign the event will or won’t work.' in c, c[:1200])
        check('passed deadline: next step is to confirm the real deadline', 'Confirm the real deadline with the board' in c)
        check('passed deadline: no other result changes', crit_items(pg, 'golf')[:3] == before)
        fill(pg, P('criteria.decideBy'), local_day(pg, 0))
        check('deadline today: "(today)"', '(today).' in card(pg, 'golf'))
        fill(pg, P('criteria.decideBy'), local_day(pg, 1))
        c = card(pg, 'golf')
        check('upcoming deadline: "in 1 day", no deadline step, other results unchanged', '(in 1 day).' in c and 'Confirm the real deadline' not in c and crit_items(pg, 'golf')[:3] == before)
        check('deadline is stored as a plain calendar date', stored(pg)['criteria']['decideBy'] == local_day(pg, 1))
        check('deadlines: no page errors', not errs, errs); ctx.close()
    section('deadlines', deadlines)

    # 4. Product items vs event participants
    def units():
        ctx, pg, errs = new(); pg.goto(URL); pg.click('[data-action="start-demo"][data-demo="gala"]'); pg.wait_for_timeout(300); results_page(pg)
        g, dgh = card(pg, 'gala'), card(pg, 'dough')
        check('event option counts guests', 'likely number of' in g and 'guests' in g[:600], g[:600])
        check('product option counts items, and paid means items paid for', 'items' in dgh[:600] and 'items paid for' in dgh and 'guests' not in dgh, dgh[:800])
        check('units: no page errors', not errs, errs); ctx.close()
    section('units', units)

    # 5. Backup, restore, refresh, older plans, malformed files
    def saving():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, json.dumps(plan(criteria={'minNet': 2500, 'maxLoss': 0, 'decideBy': '2026-12-01'}))); results_page(pg)
        pg.click('[data-action="toggle-save"]')
        with pg.expect_download() as dl: pg.click('#save-panel [data-action="download-backup"]')
        saved = json.loads(pathlib.Path(dl.value.path()).read_text())
        check('downloaded backup holds the criteria exactly', saved.get('criteria') == {'minNet': 2500, 'maxLoss': 0, 'decideBy': '2026-12-01'}, saved.get('criteria'))
        pg.click('[data-action="toggle-save"]')
        older = plan(); older.pop('criteria', None)
        st = open_file(pg, json.dumps(older)); results_page(pg)
        check('an older plan without criteria opens, criteria unknown', 'criteria' not in stored(pg) and 'Unknown: Smallest amount worth raising: not set' in card(pg, 'golf'), st)
        pg.click('[data-action="toggle-save"]'); pg.click('[data-action="restore-backup"]'); pg.wait_for_timeout(80); pg.click('[data-action="restore-backup"]'); pg.wait_for_timeout(300)
        if pg.is_visible('#save-panel'): pg.click('[data-action="toggle-save"]')
        results_page(pg)
        check('restore previous plan brings the criteria back', (stored(pg) or {}).get('criteria') == {'minNet': 2500, 'maxLoss': 0, 'decideBy': '2026-12-01'} and 'Met: Smallest amount worth raising: $2,500.' in card(pg, 'golf'))
        st = open_file(pg, json.dumps(saved)); results_page(pg)
        check('reopening the downloaded backup restores it exactly', stored(pg).get('criteria') == saved['criteria'], st)
        good = stored(pg)
        for label, crit in [('negative minimum', {'minNet': -5}), ('loss limit as text', {'maxLoss': '500'}), ('impossible date', {'decideBy': '2026-02-30'}), ('criteria not an object', [1])]:
            st = open_file(pg, json.dumps(plan(criteria=crit)))
            check(f'malformed file ({label}) is refused and changes nothing', 'criteria' in st.lower() and stored(pg) == good, st)
        check('saving: no page errors', not errs, errs); ctx.close()
    section('saving', saving)

    # 6. Keyboard, phone width, dark mode
    def layout():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, json.dumps(plan())); results_page(pg)
        pg.focus(P('criteria.minNet')); pg.keyboard.type('3000'); pg.keyboard.press('Tab'); pg.wait_for_timeout(250)
        check('keyboard: typing then Tab saves and moves to the next criterion', stored(pg)['criteria']['minNet'] == 3000 and pg.evaluate("document.activeElement.dataset.path") == 'criteria.maxLoss')
        pg.keyboard.type('2000'); pg.keyboard.press('Tab'); pg.wait_for_timeout(250)
        check('keyboard: focus stays in the form after the page re-draws', pg.evaluate("document.activeElement.dataset.path") == 'volunteerHoursAvailable')
        ctx.close()
        for w, scheme in [(375, 'light'), (375, 'dark'), (768, 'dark')]:
            ctx, pg, errs = new(viewport={'width': w, 'height': 800}, color_scheme=scheme, device_scale_factor=2 if shots else 1); pg.goto(URL); open_file(pg, json.dumps(plan(criteria={'minNet': 3000, 'maxLoss': 2000}))); results_page(pg)
            pg.locator('.ready-panel').scroll_into_view_if_needed()
            check(f'{w}px {scheme}: no sideways scrolling', no_hscroll(pg))
            if shots and w == 375: pg.locator('.ready-panel').screenshot(path=f'{shots}/b3-ready-375-{scheme}.png')
            check(f'{w}px {scheme}: no page errors', not errs, errs); ctx.close()
    section('layout', layout)

    b.close()

for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{str(detail)[:900]}]'))
print(f"{sum(ok for _, ok, _ in results)}/{len(results)} checks passed")
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
