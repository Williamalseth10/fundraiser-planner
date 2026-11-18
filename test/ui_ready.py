# Browser checks for Batch 3: "Ready to commit?" (DECISION_LOG row 90). Run after `node scripts/build.js`:
#   python3 test/ui_ready.py [screenshot_dir]
# Real clicks and keys; each section in a fresh browser context (separate storage); fictional data only.
# A section that throws is recorded as a failure, so this also reports cleanly against an older build.
import sys, json, re, pathlib
from plan_fixtures import import_fixture
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
    pg.wait_for_timeout(300); st = pg.inner_text('#status')
    if pg.is_visible('#save-panel'): pg.click('header [data-action="toggle-save"]')
    return st
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
        ctx, pg, errs = new(); pg.goto(URL); import_fixture(pg, 'gala'); results_page(pg)
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

    # 7. Corrections from the independent review of 887774e (row 91): likely number missing, below paid, capacity below paid
    def conflicts():
        ctx, pg, errs = new(); pg.goto(URL)
        def load(edit):
            s = plan(criteria={'minNet': 0, 'maxLoss': 100000}); edit(s, s['options'][0]); st = open_file(pg, json.dumps(s)); results_page(pg); return st, s
        def agree(label):
            m = memo(pg); ms = memo_section(m, 'Shotgun golf day (fictional quote)'); screen = crit_items(pg, 'golf')
            nxt = pg.eval_on_selector_all('article.ready[data-ready="golf"] ol.next li', 'els => els.map(e => e.innerText.trim())')
            ok = all(f'- [{w}] {t}' in ms for w, t in screen) and all(f'. {x}' in ms for x in nxt)
            pg.emulate_media(media='print'); ok = ok and crit_items(pg, 'golf') == screen; pg.emulate_media(media='screen')
            check(f'{label}: screen, board summary and print agree', ok, (screen, ms[:700]))
        # 1. likely 0 with 32 paid
        st, s = load(lambda s, o: o['scenarioParticipants'].update(middle=0)); c = card(pg, 'golf')
        check('likely 0 with 32 paid: minimum is not "met", it can’t be judged', 'Unknown: Smallest amount worth raising: $0. Can’t be judged: your likely number (0) is below the 32 players already paid.' in c and 'Met: Smallest amount' not in c, c[:600])
        check('likely 0 with 32 paid: attendance is not "covered"', 'Attendance: can’t be compared' in c and 'already reaches it' not in c and 'reach it together' not in c, c[c.find('What we know'):][:400])
        check('likely 0 with 32 paid: paid and money received shown as entered, nothing raised', '32 players paid' in c and stored(pg)['options'][0]['scenarioParticipants']['middle'] == 0 and stored(pg)['evidence']['paidCashReceived'] == s['evidence']['paidCashReceived'])
        check('likely 0 with 32 paid: a next step to resolve it', 'Fix the likely number or the paid count: 32 players are already paid' in c)
        agree('likely 0 with 32 paid')
        # 2. likely blank, and missing altogether
        for label, edit in [('likely blank', lambda s, o: o['scenarioParticipants'].update(middle='')), ('likely missing', lambda s, o: o['scenarioParticipants'].pop('middle'))]:
            st, s = load(edit); c = card(pg, 'golf')
            check(f'{label}: the file opens', 'could not' not in st.lower() and 'refused' not in st.lower(), st)
            check(f'{label}: unknown, not treated as 0', 'Can’t be judged: your likely number is not entered.' in c and 'Your likely number is not entered, so nothing that depends on it can be judged.' in c and 'Enter your likely number' in c and 'Met: Smallest' not in c, c[:700])
        agree('likely blank')
        # 3. capacity 28 with 32 paid
        st, s = load(lambda s, o: o.update(capacity=28)); c = card(pg, 'golf')
        check('capacity 28 with 32 paid: minimum can’t be judged', 'Can’t be judged: the capacity entered (28) is below the 32 players already paid.' in c and 'Met: Smallest' not in c, c[:600])
        check('capacity 28 with 32 paid: low-turnout loss can’t be judged; the loss limit is not "met"', 'if you hold it and few come: can’t be judged' in c and 'Unknown: Largest loss' in c, c[:900])
        check('capacity 28 with 32 paid: the conflict is listed and a next step names both numbers', '32 people or items are already paid for, but the capacity entered is 28' in c and 'Check the capacity with the course and the paid count in your records: 32 are paid but the capacity entered is 28' in c)
        agree('capacity 28 with 32 paid')
        # 4. a valid zero with nobody paid
        def zero(s, o): o['scenarioParticipants']['middle'] = 0; s['evidence']['paidRegistrations']['golf'] = 0; s['evidence']['paidCashReceived'] = {}
        st, s = load(zero); c = card(pg, 'golf')
        check('valid 0 with nobody paid: judged at 0, not called unknown', ('Met: Smallest amount worth raising: $0.' in c or 'Not met: Smallest amount worth raising: $0.' in c) and 'likely number of 0 players' in c and 'Can’t be judged' not in c and 'your likely number is 0 players, as you entered it' in c, c[:800])
        agree('valid 0 with nobody paid')
        check('conflicts: no page errors', not errs, errs); ctx.close()
    section('conflicts', conflicts)

    # 8. Row 92: the low number on its own; a blank scenario number is never shown as a deliberate 0
    def qualifications():
        ctx, pg, errs = new(); pg.goto(URL)
        def load(edit, extra=None):
            s = plan(criteria={'minNet': 0}); edit(s, s['options'][0])
            if extra: extra(s)
            open_file(pg, json.dumps(s)); results_page(pg); return s
        def in_print(sel):
            pg.emulate_media(media='print'); v = pg.is_visible(sel) and pg.inner_text(sel); pg.emulate_media(media='screen'); return v or ''
        # 1. low 0, likely 72, 32 paid
        load(lambda s, o: o['scenarioParticipants'].update(conservative=0)); c = card(pg, 'golf')
        check('low 0 with 32 paid: the likely number still meets the minimum', 'Met: Smallest amount worth raising: $0.' in c and 'it leaves $5,020' in c, c[:500])
        check('low 0 with 32 paid: the low figure is withheld and the conflict explained', 'Your low number (0) is below the 32 players already paid, so its figure isn’t shown.' in c and 'At your low number (0) it leaves' not in c and '$380' not in c, c[:600])
        check('low 0 with 32 paid: listed as uncertain, with a next step', 'The numbers conflict: your low number (0) is below the 32 players already paid.' in c and 'Fix the low number or the paid count' in c)
        m = memo(pg); ms = memo_section(m, 'Shotgun golf day (fictional quote)')
        check('low 0 with 32 paid: board summary withholds it the same way', 'so its figure isn’t shown' in ms and 'At your low number (0) it leaves' not in ms and 'Fix the low number or the paid count' in ms, ms[:700])
        check('low 0 with 32 paid: print shows the same words', 'so its figure isn’t shown' in in_print('article.ready[data-ready="golf"]'))
        # 2. likely blank, with a second option so the side-by-side table shows
        def two(s):
            o2 = json.loads(json.dumps(s['options'][0])); o2.update(id='golf2', name='Second golf option (fictional)'); o2['scenarioParticipants']['middle'] = 72
            s['options'].append(o2); s['evidence']['paidRegistrations']['golf2'] = 0
        load(lambda s, o: o['scenarioParticipants'].update(middle=''), two)
        note = 'Not entered: your likely number. The status doesn’t use it, but the likely-case figures count it as 0 players, which you didn’t enter.'
        summ = pg.inner_text('article.sum >> nth=0')
        check('likely blank: qualified right under the status', note in summ and summ.find(note) > summ.find('Supported by current evidence'), summ[:700])
        check('likely blank: the likely-case card says "Not entered", not a dollar figure', 'Likely case (your estimate)\nNot entered\nCounted as 0 players in the figures' in summ, summ[summ.find('Likely case'):][:200])
        check('likely blank: "what matters most" and the per-hour figure are not worked out at 0 silently', 'Not worked out: your likely number is not entered' in summ and 'raised per hour in the likely case' not in summ and 'Biggest effect on the likely case' not in summ, summ[summ.find('Why'):][:900])
        check('likely blank: the detailed sensitivity table says it is worked out at 0', 'Your likely number is not entered, so this is worked out at 0.' in pg.inner_text('details.detail >> nth=0'))
        side = pg.inner_text('section.panel:has(h2:text-is("Side by side"))')
        check('likely blank: side by side marks the status and the likely net', 'likely number not entered' in side and 'not entered (counted as 0:' in side, side[:700])
        det = pg.inner_text('details.detail >> nth=0 >> table.sc thead')
        check('likely blank: the scenario table header says it is counted as 0', 'number not entered: counted as 0' in det, det)
        wi = pg.inner_text('.whatif')
        check('likely blank: what-if says the number is not entered', 'Middle case: not entered' in wi and 'Your likely number is not entered, so this is worked out at 0 players' in wi, wi[:600])
        c = card(pg, 'golf')
        check('likely blank: readiness doesn’t ask to agree a minimum that is set', 'Agree with the board on the smallest amount' not in c, c[c.find('What to do next'):])
        m = memo(pg)
        sec = m[m.find('## Shotgun golf day (fictional quote)'):m.find('## Second golf option')]
        check('likely blank: board summary qualifies the status and the figures', f'**{note}' in sec and 'middle not entered (counted as 0: ' in sec and 'middle not entered' in sec[sec.find('Scenario numbers are'):], sec[:900])
        check('likely blank: print shows the qualification', note in in_print('article.sum >> nth=0'))
        # 3. low blank: the status itself depends on it
        load(lambda s, o: o['scenarioParticipants'].update(conservative=''))
        lownote = 'Not entered: your low number. The status and the low-case figures count it as 0 players, which you didn’t enter.'
        check('low blank: the low-case figure on the card says it was not entered', 'Low case not entered (counted as 0: ' in pg.inner_text('article.sum >> nth=0'), pg.inner_text('article.sum >> nth=0')[:900])
        check('low blank: the status is qualified', lownote in pg.inner_text('article.sum >> nth=0') and lownote in memo(pg) and lownote in in_print('article.sum >> nth=0'))
        check('qualifications: no page errors', not errs, errs); ctx.close()
    section('qualifications', qualifications)

    b.close()

for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{str(detail)[:900]}]'))
print(f"{sum(ok for _, ok, _ in results)}/{len(results)} checks passed")
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
