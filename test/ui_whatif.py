# Browser checks for "What would need to change?", contract dates and save confidence (DECISION_LOG rows 77-80).
# Run after `node scripts/build.js`:   python3 test/ui_whatif.py [screenshot_dir]
# Every section uses its own fresh browser context (separate storage) and fictional data only.
# Sections never stop the run: a section that throws is recorded as a failure, so this file also reports cleanly
# against an older build (that is how the "fails before the change" evidence was produced).
import sys, json, pathlib, re, traceback
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'dist' / 'booster-fundraiser-planner.html').as_uri()
CONTROL = (ROOT / 'test' / 'fixtures' / 'golf-control-fictional.json').read_text()
PRACTICE = (ROOT / 'docs' / 'practice-plan-fictional.json').read_text()
shots = sys.argv[1] if len(sys.argv) > 1 else None
results = []
def check(name, cond, detail=''): results.append((name, bool(cond), detail))
def section(name, fn):
    try: fn()
    except Exception as e: results.append((f'{name}: section ran to the end', False, f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'))
def shot(pg, name, **kw):
    if shots: pg.screenshot(path=f'{shots}/{name}.png', **kw)

def fill(pg, sel, value):
    pg.fill(sel, str(value)); pg.press(sel, 'Tab'); pg.wait_for_timeout(80)
def path(p): return f'[data-path="{p}"]'
def open_file(pg, text, name='plan.json'):
    if not pg.is_visible('#save-panel'): pg.click('[data-action="toggle-save"]')
    pg.set_input_files('input[data-action="import-json"]', files=[{'name': name, 'mimeType': 'application/json', 'buffer': text.encode()}])
    pg.wait_for_timeout(250)
    status = pg.inner_text('#status'); pg.click('[data-action="toggle-save"]'); return status
def plan_json(pg): return pg.evaluate("localStorage.getItem('bfp-plan-v1')")
def capture_memo(pg):
    pg.evaluate("""() => { window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } });
      document.execCommand = () => { const el = document.activeElement; window.__copied = el && el.value; return true; }; }""")
    pg.click('[data-action="copy-memo"]'); pg.wait_for_timeout(100)
    return pg.evaluate('window.__copied') or ''
def no_hscroll(pg):
    sw, cw = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]'); return sw <= cw + 1

with sync_playwright() as p:
    b = p.chromium.launch()
    def new(**kw):
        ctx = b.new_context(viewport=kw.pop('viewport', {'width': 1280, 'height': 900}), accept_downloads=True, **kw)
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        return ctx, pg, errs

    # 1. Control case: the scenario figures and the what-if answers on the results page
    def control():
        ctx, pg, errs = new(); pg.goto(URL)
        st = open_file(pg, CONTROL)
        check('control: imports', 'Plan imported' in st, st)
        pg.goto(URL + '#results'); pg.wait_for_timeout(200)
        detail = pg.inner_text('details.detail')
        check('control: conservative $1,640, middle $5,020, optimistic $7,200', all(x in detail for x in ['$1,640', '$5,020', '$7,200']))
        cards = pg.inner_text('article.sum .cards')
        check('control: cash needed $1,800 with $5,000 in hand; break-even 32', '$1,800' in cards and '$5,000 in hand' in cards and '32 paying players' in cards, cards)
        check('control: no separate deposit expense', 'Separate (non-credited) deposit fee\t$0\t$0\t$0' in detail)
        wi = pg.inner_text('.whatif')
        check('what-if: says nothing changes the plan unless a button is pressed', 'Nothing here changes your plan' in wi)
        check('what-if: defaults to the middle case, 72 players, firm money $5,020, goal reached', 'Middle case: 72 paying players' in wi and '$5,020' in wi and 'Reached' in wi, wi[:600])
        before = plan_json(pg)
        pg.select_option('[data-whatif="at"]', 'conservative'); pg.wait_for_timeout(150)
        wi = pg.inner_text('.whatif')
        check('what-if conservative: keeps the scenario\'s collected-only rule ($1,640)', 'Conservative case: 48 paying players' in wi and 'Firm money at 48\n$1,640' in wi, wi[:900])
        check('what-if conservative: lists what is left out (promised and hoped-for sponsorship)', '$500 promised in writing' in wi and '$500 hoped-for (never counted here)' in wi)
        check('what-if conservative: break-even is covered, goal is $3,360 short', 'To break even\nCovered' in wi and '$3,360 short' in wi)
        check('what-if conservative: goal by headcount is 80 players, labeled as not a forecast', '80 paying players would reach it' in wi and 'not a forecast' in wi)
        check('what-if: choosing a case does not change the saved plan', plan_json(pg) == before)
        pg.select_option('[data-whatif="at"]', 'custom'); pg.wait_for_timeout(150)
        fill(pg, '[data-whatif="custom"]', 50)
        wi = pg.inner_text('.whatif')
        check('what-if custom 50: counted as 48 whole foursomes, and says so', '48 paying players' in wi and 'you asked for 50' in wi and 'rounded down' in wi, wi[:500])
        pg.select_option('[data-whatif="at"]', 'optimistic'); pg.wait_for_timeout(150)
        wi = pg.inner_text('.whatif')
        check('what-if optimistic: hoped-for $500 is left out ($6,700, not $7,200)', 'Firm money at 100\n$6,700' in wi and '100 is the most the capacity' in wi, wi[:900])
        # two typed prices, side by side, at the same headcount
        pg.select_option('[data-whatif="at"]', 'conservative'); pg.wait_for_timeout(150)
        fill(pg, '[data-whatif="prices.0"]', 150); fill(pg, '[data-whatif="groups.0"]', 560); fill(pg, '[data-whatif="prices.1"]', 110)
        tbl = pg.inner_text('.whatif table')
        check('price comparison: $150 with $560 foursomes gives $1,960; $110 (no discount, $440) gives $1,400', '$1,960' in tbl and '$440 (no discount)' in tbl and '$1,400' in tbl, tbl)
        check('price comparison: says it keeps the same headcount and paid tickets keep money received', 'does not know whether that many would still pay' in pg.inner_text('.whatif') and 'keep the $4,000 received' in pg.inner_text('.whatif'))
        check('price comparison: typing prices does not change the saved plan', plan_json(pg) == before)
        shot(pg, 'whatif-control-desktop', full_page=True)
        # discard by reloading: boxes clear, plan unchanged
        pg.reload(); pg.wait_for_timeout(200)
        check('discard: reload clears the what-if boxes and the plan is unchanged', pg.input_value('[data-whatif="prices.0"]') == '' and plan_json(pg) == before)
        # apply: two clicks, price changes, evidence goes stale, scenario numbers untouched
        pg.select_option('[data-whatif="at"]', 'conservative'); pg.wait_for_timeout(120)
        fill(pg, '[data-whatif="prices.0"]', 150); fill(pg, '[data-whatif="groups.0"]', 560)
        btn = '[data-action="apply-price"][data-k="0"]'
        pg.click(btn); pg.wait_for_timeout(80)
        check('apply: first click only asks to confirm', json.loads(plan_json(pg))['options'][0]['price'] == 125 and 'Click again' in pg.inner_text(btn))
        pg.click(btn); pg.wait_for_timeout(200)
        saved = json.loads(plan_json(pg)); o = saved['options'][0]
        check('apply: second click saves $150 and the $560 foursome price', o['price'] == 150 and o['groupPrice'] == 560, (o['price'], o['groupPrice']))
        check('apply: low/likely/high numbers are not changed', o['scenarioParticipants'] == {'conservative': 48, 'middle': 72, 'optimistic': 100})
        check('apply: paid count and money received are unchanged', saved['evidence']['paidRegistrations'] == {'golf': 32} and saved['evidence']['paidCashReceived'] == {'golf': 4000})
        st = pg.inner_text('#status')
        check('apply: message says survey answers no longer count and to review the scenarios', 'no longer count' in st and 'review them on step 9' in st, st)
        summ = pg.inner_text('article.sum')
        check('apply: survey answers for $125 are now stale on the results', 'collected for different terms (price, group price changed since)' in summ, summ[summ.find('Must verify'):][:400])
        check('apply: the 40 named answers for $125 stop counting (only the 32 paid remain)', '40 named “yes” = 72' not in summ and '32 paid + 0 named “yes” = 32' in summ, summ[:1500])
        check('apply: what-if boxes clear after applying', pg.input_value('[data-whatif="prices.0"]') == '')
        pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(150)
        check('apply: evidence step offers to confirm answers for the new offer', '$150 each' in pg.inner_text('[data-terms="golf"]'))
        check('control: no page errors', not errs, errs)
        ctx.close()
    section('control', control)

    # 2. Negative margin: never suggests more sales; 50 items stay 50 with individual items
    def negative():
        ctx, pg, errs = new(); pg.goto(URL)
        plan = json.loads(PRACTICE); sale = dict(plan['options'][1], id='sale', name='Fictional $10 sale with $15 supplier cost', capacity=100, price=10, groupSize=1, wholeGroupsOnly=False, groupPrice=None, groupShare=0,
            venueQuote={'flatFee': 0, 'perParticipant': 15, 'minimumParticipants': 0, 'minimumSpend': 0}, deposit={'amount': 0, 'creditedTowardBill': True, 'refundable': True},
            fixedCosts=[], perParticipantCosts=[], cancellationOwed=0, scenarioParticipants={'conservative': 0, 'middle': 50, 'optimistic': 100}, scenarioProceeds=None)
        sale.pop('scenarioProceeds', None)
        plan.update(isDemo=False, eventName='Fictional negative-margin sale', options=[sale], sponsorships=[], settings={'fundraisingTarget': 0, 'volunteerHourValue': None},
            scenarioSettings={k: {'label': k.capitalize(), 'statuses': ['collected', 'committed'], 'extraRevenuePerParticipant': 0, 'otherRevenue': 0, 'costContingencyPct': 0} for k in ('conservative', 'middle', 'optimistic')},
            evidence={'surveyResponses': 0, 'paidRegistrations': {}, 'paidCashReceived': {}, 'namedHighIntent': {}, 'surveyDefinitelyAtPrice': {}, 'surveyProbablyAtPrice': {}})
        st = open_file(pg, json.dumps(plan)); check('negative margin: imports', 'Plan imported' in st, st)
        pg.goto(URL + '#results'); pg.wait_for_timeout(200)
        wi = pg.inner_text('.whatif')
        check('negative margin: 50 items stay 50, firm money −$250', 'Middle case: 50 items sold' in wi and 'Firm money at 50\n−$250' in wi, wi[:600])
        check('negative margin: says more items won\'t help and never offers a sales count', 'More items won’t help here' in wi and 'items sold would break even' not in wi, wi)
        check('negative margin: offers the firm sponsorship gap instead ($250)', '$250 more sponsorship' in wi)
        fill(pg, '[data-whatif="prices.0"]', 8)
        check('negative margin: a typed price below cost is flagged', 'Each extra item loses money at this price' in pg.inner_text('.whatif table'))
        check('negative margin: loss card still names −$500 at 100 items', '−$500' in pg.inner_text('article.sum .cards'))
        check('negative margin: no page errors', not errs, errs)
        ctx.close()
    section('negative margin', negative)

    # 3. Contract dates: entered by keyboard, local calendar days, refresh, verification reset, board summary
    #    The clock is fixed at 11:30 pm on Nov 14 in Los Angeles, when UTC is already Nov 15.
    def dates():
        ctx, pg, errs = new(timezone_id='America/Los_Angeles')
        pg.clock.install(time='2026-11-14T23:30:00-08:00')
        pg.goto(URL); open_file(pg, CONTROL)
        pg.goto(URL + '#step-quote'); pg.wait_for_timeout(150)
        check('dates: quote step has the date boxes', pg.locator('input[type="date"]').count() == 5)
        check('dates: quote starts as "in writing"', pg.is_checked(path('options.0.quoteVerified')))
        fill(pg, path('options.0.contract.cancellationNotes'), '100% of the bill within 30 days; 50% within 60 days (fictional)')
        check('dates: typing notes does not uncheck "in writing"', pg.is_checked(path('options.0.quoteVerified')))
        fill(pg, path('options.0.contract.quoteDate'), '2026-11-01')
        check('dates: changing a quote date unchecks "in writing" and says why', not pg.is_checked(path('options.0.quoteVerified')) and 'date or the reference on the quote' in pg.inner_text('#status'))
        for k, v in [('quoteExpires', '2026-11-13'), ('depositDue', '2026-11-14'), ('headcountDue', '2027-05-01')]: fill(pg, path(f'options.0.contract.{k}'), v)
        fill(pg, path('options.0.contract.quoteSource'), 'Fictional emailed quote #1182')
        fill(pg, path('options.0.contract.weatherNotes'), 'Rain credit, no refund (fictional)')
        pg.reload(); pg.wait_for_timeout(200)
        check('dates: survive refresh', pg.input_value(path('options.0.contract.depositDue')) == '2026-11-14' and pg.input_value(path('options.0.contract.quoteSource')) == 'Fictional emailed quote #1182')
        c = json.loads(plan_json(pg))['options'][0]['contract']
        check('dates: stored as plain calendar dates', c['quoteExpires'] == '2026-11-13' and c['headcountDue'] == '2027-05-01' and 'cancelBy' not in c, c)
        pg.goto(URL + '#results'); pg.wait_for_timeout(200)
        sec = pg.inner_text('[data-contract="golf"]')
        check('dates: deposit due today in Los Angeles (not shifted to the UTC date)', 'Deposit due: Nov 14, 2026 (today)' in sec, sec)
        check('dates: expired quote is flagged, with what to do', 'Quote expires: Nov 13, 2026 (1 day ago). Ask the course to confirm the prices still hold.' in sec, sec)
        check('dates: future date counts calendar days', 'Final guaranteed number of players due: May 1, 2027 (in 168 days)' in sec, sec)
        check('dates: unknown deadline shown as unknown, separate from the amount owed', 'Last day to cancel under the quote’s terms: unknown' in sec and 'Owed if you cancel after the deadline: $4,320' in sec, sec)
        check('dates: notes are shown as the organizer\'s words, with the caveat', '“100% of the bill within 30 days' in sec and 'doesn’t work out tiered cancellation amounts' in sec and 'doesn’t mean the contract is safe or approved' in sec, sec)
        check('dates: money is unchanged by dates', '$1,800' in pg.inner_text('article.sum .cards'))
        memo = capture_memo(pg)
        check('board summary: prepared date is the local date', 'Prepared Nov 14, 2026' in memo, memo[:300])
        check('board summary: lists unknown and passed contract items', '[unknown] Last day to cancel' in memo and '[date passed or today] Quote expires' in memo, memo[memo.find('Contract dates'):][:600])
        check('board summary: never claims approval', 'not a record of board approval' in memo)
        with pg.expect_download() as dl: pg.click('.reshead [data-action="download-backup"]')
        check('backup file name uses the local date', dl.value.suggested_filename == 'fundraiser-plan-2026-11-14.json', dl.value.suggested_filename)
        shot(pg, 'contract-dates-results', full_page=True)
        check('dates: no page errors', not errs, errs)
        ctx.close()
    section('dates', dates)

    # 4. Backup, reopen, restore, old backups and malformed files
    def backups():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, CONTROL)
        pg.goto(URL + '#step-quote'); pg.wait_for_timeout(120)
        fill(pg, path('options.0.contract.cancelBy'), '2027-03-01'); fill(pg, path('options.0.contract.weatherNotes'), 'Rain date the next Sunday (fictional)')
        original = plan_json(pg)
        pg.click('[data-action="toggle-save"]')
        with pg.expect_download() as dl: pg.click('#save-panel [data-action="download-backup"]')
        saved_file = pathlib.Path(dl.value.path()).read_text()
        line = pg.inner_text('#save-line')
        check('save line: says when it last saved and that a download was only started', 'Last saved in this browser at' in line and 'started a backup download' in line and 'can’t tell whether the file was kept' in line, line)
        pg.click('[data-action="toggle-save"]')
        check('backup file holds the contract dates and notes', json.loads(saved_file)['options'][0]['contract']['cancelBy'] == '2027-03-01')
        st = open_file(pg, PRACTICE); check('old backup without contract dates still opens', 'Plan imported' in st, st)
        pg.goto(URL + '#results'); pg.wait_for_timeout(150)
        check('old backup: contract dates show as unknown', 'Quote expires: unknown' in pg.inner_text('article.sum .contract'))
        st = open_file(pg, saved_file); check('downloaded file reopens', 'Plan imported' in st, st)
        check('reopened file equals the original plan exactly', json.loads(plan_json(pg)) == json.loads(original))
        bad = json.loads(original); bad['options'][0]['contract']['cancelBy'] = '2027-02-30'
        st = open_file(pg, json.dumps(bad)); check('malformed date in a file is refused', 'Could not import' in st and 'calendar dates' in st, st)
        bad2 = json.loads(original); bad2['options'][0]['contract'] = {'cancellationNotes': {'x': 1}}
        st = open_file(pg, json.dumps(bad2)); check('malformed notes in a file are refused', 'Could not import' in st, st)
        check('refused files change nothing', json.loads(plan_json(pg)) == json.loads(original))
        pg.click('[data-action="toggle-save"]')
        # the practice file is marked as made up, so it never pushed the real (golf) plan out of the backup
        check('backup still holds the real golf plan, not the made-up practice file', 'FICTIONAL PRACTICE — Booster Club Golf Day' in pg.inner_text('#backup-line'), pg.inner_text('#backup-line'))
        pg.click('[data-action="load-demo"]'); pg.click('[data-action="load-demo"]'); pg.wait_for_timeout(200)
        pg.click('[data-action="toggle-save"]'); pg.wait_for_timeout(80)
        pg.click('[data-action="restore-backup"]'); pg.click('[data-action="restore-backup"]'); pg.wait_for_timeout(200)
        check('restore brings the plan with its contract dates back exactly', json.loads(plan_json(pg)) == json.loads(original), pg.inner_text('#status'))
        check('backups: no page errors', not errs, errs)
        ctx.close()
    section('backups', backups)

    # 5. Options compared, phone width, keyboard, print
    def layout():
        ctx, pg, errs = new(viewport={'width': 375, 'height': 800}); pg.goto(URL)
        pg.click('[data-demo="gala"]'); pg.wait_for_function("location.hash === '#step-event'")
        pg.goto(URL + '#results'); pg.wait_for_timeout(200)
        wi = pg.inner_text('.whatif')
        check('options compared: both gala and cookie dough rows, each at its own likely number', 'Compare with your other options' in wi and 'Cookie dough sale' in wi and '(selected)' in wi)
        check('375px results: no sideways scrolling', no_hscroll(pg))
        pg.goto(URL + '#step-quote'); pg.wait_for_timeout(150)
        check('375px quote step with dates: no sideways scrolling', no_hscroll(pg))
        pg.goto(URL + '#results'); pg.wait_for_timeout(150)
        pg.focus('[data-whatif="opt"]'); seen = []
        for _ in range(8):
            pg.keyboard.press('Tab'); seen.append(pg.evaluate("(document.activeElement.dataset.whatif || document.activeElement.dataset.action || document.activeElement.getAttribute('role') || document.activeElement.tagName)"))
        check('keyboard: Tab moves through the what-if boxes in order', seen[:3] == ['at', 'prices.0', 'groups.0'], seen)
        pg.focus('[data-whatif="opt"]'); pg.select_option('[data-whatif="opt"]', '1'); pg.wait_for_timeout(150)
        check('switching option keeps focus on the option menu', pg.evaluate('document.activeElement.dataset.whatif') == 'opt')
        fill(pg, '[data-whatif="prices.0"]', 20)
        check('price table region is keyboard-focusable on a phone', pg.locator('.whatif .table-wrap[tabindex="0"]').count() >= 1)
        check('375px with a price comparison: no sideways scrolling', no_hscroll(pg))
        # the side-by-side table is far wider than a phone: it must take focus so arrow keys can scroll it
        region = '.table-wrap[aria-label="Options side by side"]'
        check('375px: side-by-side table says it scrolls sideways', pg.locator('.scroll-hint').first.is_visible())
        pg.focus(region); x0 = pg.eval_on_selector(region, 'e => e.scrollLeft')
        for _ in range(6): pg.keyboard.press('ArrowRight')
        pg.wait_for_timeout(400)  # arrow-key scrolling is animated
        check('375px: keyboard focus on the side-by-side table scrolls it', pg.evaluate('document.activeElement.getAttribute("aria-label")') == 'Options side by side' and pg.eval_on_selector(region, 'e => e.scrollLeft') > x0)
        shot(pg, 'whatif-gala-375', full_page=True)
        pg.emulate_media(media='print')
        check('print: what-if section prints, apply buttons do not', pg.is_visible('.whatif') and not pg.is_visible('[data-action="apply-price"]'))
        check('print: contract checklist prints', pg.is_visible('article.sum .contract'))
        if shots: pg.pdf(path=f'{shots}/whatif-print.pdf')
        pg.emulate_media(media='screen')
        check('layout: no page errors', not errs, errs)
        ctx.close()
    section('layout', layout)

    # 6. Storage refuses to save while a hypothetical price is applied: the red warning appears, the old copy stays
    FAULTS = """(() => { const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k !== '__fault') { let f = null; try { f = JSON.parse(window.sessionStorage.getItem('__fault') || 'null'); } catch (e) {}
          if (f && (f.all || (f.keys || []).includes(k))) throw new DOMException('Synthetic quota (test)', 'QuotaExceededError'); }
        return orig.call(this, k, v); }; })();"""
    def failing():
        ctx, pg, errs = new(); ctx.add_init_script(FAULTS); pg.goto(URL); open_file(pg, CONTROL)
        pg.goto(URL + '#results'); pg.wait_for_timeout(150); before = plan_json(pg)
        pg.evaluate("sessionStorage.setItem('__fault', JSON.stringify({all: true}))")
        fill(pg, '[data-whatif="prices.0"]', 140)
        pg.click('[data-action="apply-price"][data-k="0"]'); pg.click('[data-action="apply-price"][data-k="0"]'); pg.wait_for_timeout(200)
        check('storage failure: applying a price shows the red Not saved warning', pg.is_visible('#save-warning') and 'not saved' in pg.inner_text('#save-warning').lower())
        check('storage failure: the stored copy is the old plan, untouched', plan_json(pg) == before)
        check('storage failure: the plan on screen has the new price (so the backup download holds it)', '$140 each' in (pg.goto(URL + '#step-evidence') or pg.wait_for_timeout(150) or pg.inner_text('[data-terms="golf"]')))
        pg.click('[data-action="toggle-save"]')
        check('storage failure: the save line says not saved', 'Not saved' in pg.inner_text('#save-line'), pg.inner_text('#save-line'))
        check('storage failure: no page errors', not errs, errs)
        ctx.close()
    section('storage failure', failing)
    b.close()

for n, ok, det in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok or not det else f'  [{det}]'))
print(f'{sum(ok for _, ok, _ in results)}/{len(results)} checks passed')
sys.exit(0 if results and all(ok for _, ok, _ in results) else 1)
