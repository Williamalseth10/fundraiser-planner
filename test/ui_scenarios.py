# Browser checks for Batch 2: interest by offer, past rounds, scenario reasons, capacity shortcuts, same-turnout
# comparison (DECISION_LOG row 87). Run after `node scripts/build.js`:   python3 test/ui_scenarios.py [screenshot_dir]
# Real clicks and keys; each section in a fresh browser context (separate storage); fictional data only.
# A section that throws is recorded as a failure, so this also reports cleanly against an older build.
import sys, json, pathlib
from plan_fixtures import import_fixture
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'dist' / 'booster-fundraiser-planner.html').as_uri()
CONTROL = json.loads((ROOT / 'test' / 'fixtures' / 'golf-control-fictional.json').read_text())
PRACTICE = (ROOT / 'docs' / 'practice-plan-fictional.json').read_text()
shots = sys.argv[1] if len(sys.argv) > 1 else None
results = []
def check(name, cond, detail=''): results.append((name, bool(cond), detail))
def section(name, fn):
    try: fn()
    except Exception as e: results.append((f'{name}: section ran to the end', False, f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'))
def P(p): return f'[data-path="{p}"]'
def fill(pg, sel, v): pg.fill(sel, str(v), timeout=5000); pg.press(sel, 'Tab'); pg.wait_for_timeout(120)
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
    pg.click('[data-action="copy-memo"]'); pg.wait_for_timeout(120); return pg.evaluate('window.__copied') or ''
def no_hscroll(pg):
    sw, cw = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]'); return sw <= cw + 1
def two_clicks(pg, sel):
    pg.click(sel); pg.wait_for_timeout(80); pg.click(sel); pg.wait_for_timeout(250)

def tee_and_shotgun():
    plan = json.loads(json.dumps(CONTROL)); sg = plan['options'][0]; tee = json.loads(json.dumps(sg))
    tee.update(id='tee', name='Tee times (fictional quote)', kind='golf_tee_times', capacity=64)
    tee['venueQuote'] = {'flatFee': 0, 'perParticipant': 55, 'minimumParticipants': 0, 'minimumSpend': 0}
    tee['deposit'] = {'amount': 250, 'creditedTowardBill': True, 'refundable': True}
    tee['fixedCosts'] = [{'id': 'other', 'label': 'Prizes and signs', 'amount': 500, 'paidUpfront': True}]
    plan['options'] = [tee, sg]; plan['evidence']['paidRegistrations']['tee'] = 0
    return plan
FAULTS = """(() => { const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k !== '__fault') { let f = null; try { f = JSON.parse(window.sessionStorage.getItem('__fault') || 'null'); } catch (e) {}
      if (f && (f.all || (f.keys || []).includes(k))) throw new DOMException('Synthetic quota (test)', 'QuotaExceededError'); }
    return orig.call(this, k, v); }; })();"""

with sync_playwright() as p:
    b = p.chromium.launch()
    def new(**kw):
        ctx = b.new_context(viewport=kw.pop('viewport', {'width': 1280, 'height': 900}), accept_downloads=True, **kw)
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); return ctx, pg, errs

    # 1. Evidence stage by stage, offer change, past round, payments untouched, round trips
    def interest():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, json.dumps(tee_and_shotgun()))
        pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(250)
        f = pg.inner_text('[data-funnel="golf"]')
        check('stages: each count shown on its own; "sent" unknown stays "not recorded"', 'Sent the survey (whole survey)\nnot recorded' in f and '40 players' in f and '20 players' in f and '32 players' in f and '$4,000' in f, f[:400])
        check('stages: says they are never added together and not a forecast', 'never added together' in f and 'none of them is a forecast of who will come' in f)
        fill(pg, P('evidence.surveyContacted'), 200)
        check('sent-to count saves', stored(pg)['evidence']['surveyContacted'] == 200)
        fill(pg, P('evidence.surveyContacted'), '')
        check('clearing sent-to makes it unknown (null), not 0', stored(pg)['evidence']['surveyContacted'] is None)
        fill(pg, P('evidence.surveyContacted'), 200)
        # the offer changes: answers go stale, payments stay
        pg.goto(URL + '#step-prices'); pg.wait_for_timeout(150); pg.click('.tab >> nth=1'); pg.wait_for_timeout(150)
        fill(pg, P('options.1.price'), 150)
        pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(250)
        f = pg.inner_text('[data-funnel="golf"]')
        check('after a price change: named "yes" shown but marked not counted', 'not counted: the offer changed since' in f, f[:500])
        before = stored(pg)
        two_clicks(pg, '[data-action="archive-round"][data-i="1"]')
        after = stored(pg); ev = after['evidence']
        r = (ev.get('offerHistory') or {}).get('golf', [{}])[-1]
        check('keep as past round: answers move to a past round with the offer they were for ($125)', r.get('named') == 40 and r.get('probably') == 20 and (r.get('terms') or {}).get('price') == 12500 and r.get('surveyContacted') == 200, r)
        check('keep as past round: current answers start fresh', ev['namedHighIntent']['golf'] == 0 and ev['surveyProbablyAtPrice']['golf'] == 0 and 'golf' not in (ev.get('offerTerms') or {}))
        check('keep as past round: paid sign-ups and money received are untouched', ev['paidRegistrations'] == before['evidence']['paidRegistrations'] and ev['paidCashReceived'] == before['evidence']['paidCashReceived'] and after['sponsorships'] == before['sponsorships'])
        check('keep as past round: the person is told', 'Paid sign-ups and money received did not change' in pg.inner_text('#status'))
        rounds = pg.inner_text('details[data-keep="rounds-golf"]')
        check('past round is listed with its own offer and is never added to current answers', 'never added to current answers' in rounds and '$125 each' in rounds and '40 named “yes”' in rounds, rounds)
        fill(pg, P('evidence.namedHighIntent.golf'), 30)
        check('new answers are recorded for the new $150 offer', stored(pg)['evidence']['offerTerms']['golf']['price'] == 15000)
        check('new answers count (current), the old ones are not added', 'Said “Yes” and left a name\n30 players' in pg.inner_text('[data-funnel="golf"]') and 'not counted' not in pg.inner_text('[data-funnel="golf"]'))
        pg.goto(URL + '#results'); pg.wait_for_timeout(250)
        cards = pg.inner_text('article.sum >> nth=1')
        check('results use current-offer answers only (32 paid + 30 named), not 70', '32 paid + 30 named “yes” = 62' in cards, cards[cards.find('Needed to break even'):][:200])
        m = memo(pg)
        check('board summary: stage-by-stage line and the past round', 'Evidence stage by stage (each its own count, never added): sent 200; answered 60' in m and 'Past round (kept' in m and 'for $125 each' in m and 'Not added to current answers' in m, m[m.find('Evidence stage'):][:400])
        # refresh, real download, reopen, restore
        pg.reload(); pg.wait_for_timeout(300)
        saved = stored(pg)
        check('refresh keeps past rounds and the sent-to count', len(saved['evidence']['offerHistory']['golf']) == 1 and saved['evidence']['surveyContacted'] == 200)
        pg.click('[data-action="toggle-save"]')
        with pg.expect_download() as dl: pg.click('#save-panel [data-action="download-backup"]')
        file_text = pathlib.Path(dl.value.path()).read_text(); pg.click('[data-action="toggle-save"]')
        check('downloaded backup holds the past round exactly', json.loads(file_text) == saved)
        st = open_file(pg, PRACTICE); check('an older backup (no rounds, no sent-to) opens', 'Plan imported' in st, st)
        pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(200)
        check('older backup: sent-to shows "not recorded", no past rounds', 'not recorded' in pg.inner_text('#app') and 'Past rounds' not in pg.inner_text('#app'))
        st = open_file(pg, file_text)
        check('reopening the downloaded backup restores it exactly', 'Plan imported' in st and stored(pg) == saved, st)
        import_fixture(pg, 'golf')
        pg.click('[data-action="toggle-save"]'); two_clicks(pg, '[data-action="restore-backup"]')
        check('restore previous plan brings the past round back exactly', stored(pg) == saved, pg.inner_text('#status'))
        if shots: pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(200); pg.screenshot(path=f'{shots}/b2-evidence.png', full_page=True)
        check('interest: no page errors', not errs, errs)
        ctx.close()
    section('interest', interest)

    # 2. Scenario reasons, capacity shortcuts with preview = apply
    def scenarios():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, json.dumps(tee_and_shotgun()))
        pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(200); pg.click('.tab >> nth=1'); pg.wait_for_timeout(200)
        t = pg.inner_text('#app')
        check('each scenario number has "Why this number (your scenario, not a prediction)"', t.count('Why this number') == 3 and 'your scenario, not a prediction' in t)
        pg.click('[data-action="add-scenario-reason"][data-k="middle"]'); pg.wait_for_function("location.hash === '#research'")
        lk = stored(pg)['research']['links'][-1]
        check('"Add a reason" opens a research note for that number, without changing it', lk['assumption'] == 'middle' and lk['optionId'] == 'golf' and stored(pg)['options'][1]['scenarioParticipants']['middle'] == 72, lk)
        fill(pg, P('research.links.0.note'), '40 named "yes" for $125 plus 32 paid (fictional).')
        pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(200); pg.click('.tab >> nth=1'); pg.wait_for_timeout(200)
        check('the reason shows under the likely number', '40 named "yes" for $125 plus 32 paid (fictional).' in pg.inner_text('.scen'))
        pg.click('details[data-keep="shortcuts"] > summary'); pg.wait_for_timeout(200)
        panel = pg.inner_text('details[data-keep="shortcuts"]')
        check('shortcuts say they are not evidence', 'not evidence that this many will come' in panel)
        rows = {r.get_attribute('data-shortcut-row'): r.inner_text() for r in pg.query_selector_all('tr[data-shortcut-row]')}
        check('50% of 100 players in foursomes is 48 (rounded down), with the course minimum', rows['50'].startswith('50%\t48') and 'rounded down from 50' in rows['50'] and 'course minimum applies' in rows['50'], rows['50'])
        check('75% is 72 and is already the likely number', '72' in rows['75'] and 'already your Middle number' in rows['75'], rows['75'])
        check('100% preview: 100 players, $14,000 revenue, $7,300 costs, $6,700 left', '\t100\t$14,000\t$7,300\t$6,700' in rows['100'], rows['100'])
        before = stored(pg)
        btn = '[data-action="apply-shortcut"][data-pct="100"]'
        pg.click(btn); pg.wait_for_timeout(80)
        check('apply asks to confirm first; nothing changes on the first click', stored(pg)['options'][1]['scenarioParticipants']['middle'] == 72)
        pg.click(btn); pg.wait_for_timeout(250)
        after = stored(pg)
        check('apply sets the likely number to 100', after['options'][1]['scenarioParticipants']['middle'] == 100)
        check('apply message: "as previewed", and not a prediction', '$6,700, as previewed' in pg.inner_text('#status') and 'not a prediction' in pg.inner_text('#status'), pg.inner_text('#status'))
        check('apply leaves paid sign-ups, money, answers and sponsors untouched', after['evidence'] == before['evidence'] and after['sponsorships'] == before['sponsorships'])
        pg.goto(URL + '#results'); pg.wait_for_timeout(250)
        card = pg.inner_text('article.sum >> nth=1')
        check('results: the likely case now shows the previewed $6,700', 'Likely case (your estimate)\n$6,700' in card, card[card.find('Likely'):][:120])
        # a rounded row: 50% of 100 is 48 whole-foursome players; that exact number must be saved
        pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(200); pg.click('.tab >> nth=1'); pg.wait_for_timeout(200)
        pg.select_option('[data-shortcut="target"]', 'optimistic'); pg.wait_for_timeout(200)
        prev = pg.inner_text('tr[data-shortcut-row="50"]')
        two_clicks(pg, '[data-action="apply-shortcut"][data-pct="50"]')
        check('a rounded shortcut saves exactly the previewed number (48, not 50)', stored(pg)['options'][1]['scenarioParticipants']['optimistic'] == 48 and prev.startswith('50%\t48'), (stored(pg)['options'][1]['scenarioParticipants'], prev))
        # keyboard: preview another case with the keyboard
        pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(200); pg.click('.tab >> nth=1'); pg.wait_for_timeout(200)
        pg.focus('[data-shortcut="target"]'); pg.keyboard.press('ArrowUp'); pg.wait_for_timeout(250)
        check('keyboard: arrow keys change the previewed case and focus stays', pg.evaluate("document.activeElement.dataset.shortcut") == 'target' and 'Middle case assumptions' in pg.inner_text('details[data-keep="shortcuts"]'))  # it was on Optimistic; one up is Middle
        # below the number already paid
        pg.goto(URL + '#step-quote'); pg.wait_for_timeout(150); pg.click('.tab >> nth=1'); pg.wait_for_timeout(150)
        fill(pg, P('options.1.capacity'), 60)
        pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(200); pg.click('.tab >> nth=1'); pg.wait_for_timeout(200)
        r50 = pg.inner_text('tr[data-shortcut-row="50"]')
        check('a shortcut below the 32 already paid is marked and cannot be applied', 'below the 32 already paid' in r50 and pg.locator('[data-action="apply-shortcut"][data-pct="50"]').count() == 0, r50)
        if shots: pg.screenshot(path=f'{shots}/b2-scenarios.png', full_page=True)
        check('scenarios: no page errors', not errs, errs)
        ctx.close()
    section('scenarios', scenarios)

    # 3. Same turnout: tee times vs shotgun
    def same():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, json.dumps(tee_and_shotgun())); pg.goto(URL + '#results'); pg.wait_for_timeout(300)
        st = pg.inner_text('.same-turnout')
        check('same turnout: defaults to a number both can take (64), like for like', 'Participants\t64\t64' in st, st[:600])
        check('same turnout: extra cost and what would cover it', 'costs $1,100 more than Tee times (fictional quote) at 64 players' in st and '$1,100 more firm sponsorship' in st and '12 more paying players (76 in all)' in st, st[st.find('Shotgun golf day (fictional quote) costs'):][:400])
        check('same turnout: says it assumes no extra people or price for a format', 'does not assume a format (such as a shotgun start) brings more people or a higher price' in st)
        check('same turnout: where the costs come from is shown', 'quote in writing' in st)
        fill(pg, '[data-same="n"]', 80)
        st = pg.inner_text('.same-turnout')
        check('a number above one option\'s capacity is flagged as not like for like', 'Not like for like' in st and 'up to 64' in st, st[-500:])
        m = memo(pg)
        check('board summary: same turnout section with its assumption', '## Same turnout comparison' in m and 'assumes neither format brings more people or a higher price' in m)
        pg.emulate_media(media='print')
        check('print: the comparison prints', pg.is_visible('.same-turnout'))
        if shots: pg.pdf(path=f'{shots}/b2-print.pdf')
        pg.emulate_media(media='screen')
        # never recoverable: $200 foursomes for everyone on the shotgun
        plan = tee_and_shotgun(); plan['options'][1]['groupPrice'] = 200; plan['options'][1]['groupShare'] = 1
        open_file(pg, json.dumps(plan)); pg.goto(URL + '#results'); pg.wait_for_timeout(300)
        st = pg.inner_text('.same-turnout')
        check('an extra cost that more players can never recover is said to be so', "can't be closed by sales within capacity" in st, st[-500:])
        if shots: pg.goto(URL + '#results'); pg.wait_for_timeout(200); pg.locator('.same-turnout').screenshot(path=f'{shots}/b2-same-turnout.png')
        check('same: no page errors', not errs, errs)
        ctx.close()
    section('same turnout', same)

    # 3b. Corrections from the independent review of b496eae (DECISION_LOG row 88)
    def same_corrections():
        # mixed units: the gala example compares guests with cookie-dough items
        ctx, pg, errs = new(); pg.goto(URL); import_fixture(pg, 'gala')
        pg.goto(URL + '#results'); pg.wait_for_timeout(300)
        st = pg.inner_text('.same-turnout')
        check('mixed units: guests vs items is not compared at the same turnout, and says why',
              'Not compared at the same turnout' in st and 'counts guests' in st and 'counts items' in st and 'is not the same turnout' in st and 'Side by side table below' in st, st[:700])
        check('mixed units: no figures, number box or recovery advice shown',
              pg.locator('.same-turnout .st-t').count() == 0 and pg.locator('[data-same="n"]').count() == 0 and 'Number of people for both' not in st
              and 'more firm sponsorship' not in st and 'more paying' not in st, st[:700])
        check('mixed units: the ordinary side-by-side comparison is still there', pg.locator('section.panel:has(h2:text-is("Side by side")) table').count() >= 1 and 'Cookie dough sale' in pg.inner_text('section.panel:has(h2:text-is("Side by side"))'))
        m = memo(pg); sec = m[m.find('## Same turnout comparison'):][:600]
        check('mixed units: board summary withholds the comparison and says why',
              '## Same turnout comparison' in m and 'Not compared at the same turnout' in sec and 'more firm sponsorship' not in sec and 'Total costs:' not in sec and 'both at 48' not in sec, sec)
        check('mixed units: no page errors', not errs, errs); ctx.close()

        # below paid: 32 already paid, $4,000 received, compared at 0
        ctx, pg, errs = new(); pg.goto(URL); plan = tee_and_shotgun(); plan['options'][0]['capacity'] = 100
        open_file(pg, json.dumps(plan)); pg.goto(URL + '#results'); pg.wait_for_timeout(300)
        check('same turnout: the number box is labelled in the option\'s own unit', 'Number of players for both' in pg.inner_text('.same-turnout'))
        check('same turnout: the default is never below the number already paid', pg.input_value('[data-same="n"]') == '72', pg.input_value('[data-same="n"]'))
        before = stored(pg)
        fill(pg, '[data-same="n"]', 0); st = pg.inner_text('.same-turnout')
        check('below paid: the engine warning is shown', 'fewer than the 32 already paid' in st, st[:700])
        check('below paid: no recovery figures, and the conflict is explained',
              'No recovery figures' in st and 'has 32 players already paid, more than 0' in st and 'Money already received is counted as received and is not changed' in st
              and 'Choose at least 32 players' in st and 'more firm sponsorship' not in st and 'more paying players' not in st, st[-700:])
        after = stored(pg)
        check('below paid: paid sign-ups, money received and attendance numbers are not changed',
              after['evidence'] == before['evidence'] and [o['scenarioParticipants'] for o in after['options']] == [o['scenarioParticipants'] for o in before['options']])
        m = memo(pg); sec = m[m.find('## Same turnout comparison'):][:700]
        check('below paid: board summary gives no recovery figures and explains', 'No recovery figures' in sec and 'more firm sponsorship' not in sec, sec)
        fill(pg, '[data-same="n"]', 32)
        check('below paid: at the paid number the recovery figures come back', 'more firm sponsorship' in pg.inner_text('.same-turnout') or 'nothing extra is needed' in pg.inner_text('.same-turnout'))
        # capacity below the number paid
        plan2 = tee_and_shotgun(); plan2['options'][1]['capacity'] = 28
        open_file(pg, json.dumps(plan2)); pg.goto(URL + '#results'); pg.wait_for_timeout(300)
        st = pg.inner_text('.same-turnout')
        check('capacity below paid: said to be a capacity problem, no recovery figures',
              'can take at most 28: check its capacity and the paid count' in st and 'Fix the capacity or the paid count' in st and 'more firm sponsorship' not in st, st[-700:])
        m = memo(pg); sec = m[m.find('## Same turnout comparison'):][:700]
        check('capacity below paid: board summary says so', 'can take at most 28' in sec and 'more firm sponsorship' not in sec, sec)
        check('below paid: no page errors', not errs, errs); ctx.close()

        # equal costs, unequal firm money: same course, lower price
        ctx, pg, errs = new(); pg.goto(URL); plan = json.loads(json.dumps(CONTROL)); y = json.loads(json.dumps(plan['options'][0]))
        y.update(id='low', name='Same course, $100 (fictional)', price=100, groupPrice=None); plan['options'].append(y); plan['evidence']['paidRegistrations']['low'] = 0
        open_file(pg, json.dumps(plan)); pg.goto(URL + '#results'); pg.wait_for_timeout(300)
        st = pg.inner_text('.same-turnout')
        check('equal costs: says there is no extra cost to cover and no recovery figures apply',
              'Both cost the same' in st and 'no extra cost to cover and no recovery figures apply' in st, st[-700:])
        check('equal costs: the firm-money difference is still reported, and why',
              'Their firm money still differs by $' in st and 'ends up with more' in st and 'not costs' in st and 'nothing extra is needed' not in st and '$0 more' not in st, st[-700:])
        m = memo(pg); sec = m[m.find('## Same turnout comparison'):][:800]
        check('equal costs: board summary reports the difference without recovery figures', 'Their firm money still differs by $' in sec and 'more firm sponsorship' not in sec, sec)
        check('equal costs: no page errors', not errs, errs); ctx.close()
    section('same turnout corrections', same_corrections)

    # 4. Malformed files, save failure, phone width
    def safety():
        ctx, pg, errs = new(); pg.goto(URL); base = tee_and_shotgun(); open_file(pg, json.dumps(base)); good = stored(pg)
        bad_cases = {
            'negative past-round count': lambda d: d['evidence'].__setitem__('offerHistory', {'golf': [{'id': 'r1', 'named': -1, 'definitely': 0, 'probably': 0}]}),
            'past rounds not a list': lambda d: d['evidence'].__setitem__('offerHistory', {'golf': {'named': 3}}),
            'impossible round date': lambda d: d['evidence'].__setitem__('offerHistory', {'golf': [{'id': 'r1', 'named': 1, 'archivedOn': '2026-02-30'}]}),
            'round terms not readable': lambda d: d['evidence'].__setitem__('offerHistory', {'golf': [{'id': 'r1', 'named': 1, 'terms': {'price': {'x': 1}}}]}),
            'sent-to as text': lambda d: d['evidence'].__setitem__('surveyContacted', 'lots'),
        }
        for name, mutate in bad_cases.items():
            d = json.loads(json.dumps(base)); mutate(d)
            st = open_file(pg, json.dumps(d))
            check(f'malformed file ({name}) is refused and changes nothing', 'Could not import' in st and stored(pg) == good, st)
        ctx.close()
        c2 = b.new_context(viewport={'width': 1280, 'height': 900}); c2.add_init_script(FAULTS); p2 = c2.new_page(); e2 = []
        p2.on('pageerror', lambda e: e2.append(str(e)))
        p2.goto(URL); open_file(p2, json.dumps(base)); p2.goto(URL + '#step-evidence'); p2.wait_for_timeout(200)
        before = stored(p2)
        p2.evaluate("sessionStorage.setItem('__fault', JSON.stringify({all: true}))")
        two_clicks(p2, '[data-action="archive-round"][data-i="1"]')
        check('save failure: keeping a past round shows the red Not saved warning', p2.is_visible('#save-warning'))
        check('save failure: the stored plan is untouched', stored(p2) == before)
        check('save failure: no page errors', not e2, e2)
        c2.close()
        c3 = b.new_context(viewport={'width': 375, 'height': 800}); p3 = c3.new_page(); p3.goto(URL); open_file(p3, json.dumps(base))
        bad = []
        for h in ['#step-evidence', '#step-scenarios', '#results']:
            p3.goto(URL + h); p3.wait_for_timeout(250)
            if h == '#step-scenarios': p3.click('.tab >> nth=1'); p3.wait_for_timeout(150); p3.click('details[data-keep="shortcuts"] > summary'); p3.wait_for_timeout(150)
            if not no_hscroll(p3): bad.append(h)
        check('375px: evidence, scenarios (shortcuts open) and results have no sideways scrolling', not bad, bad)
        if shots: p3.goto(URL + '#step-scenarios'); p3.wait_for_timeout(200); p3.screenshot(path=f'{shots}/b2-scenarios-375.png', full_page=True)
        c3.close()
    section('safety', safety)
    b.close()

for n, ok, det in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok or not det else f'  [{det}]'))
print(f'{sum(ok for _, ok, _ in results)}/{len(results)} checks passed')
sys.exit(0 if results and all(ok for _, ok, _ in results) else 1)
