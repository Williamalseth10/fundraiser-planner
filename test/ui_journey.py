# End-to-end browser journey for a first-time volunteer (DECISION_LOG.md rows 61 onward). Run after `node scripts/build.js`:
#   python3 test/ui_journey.py [screenshot_dir]
# A complete synthetic session: start blank, enter golf, ticketed and product-sale options, compare, refresh, reopen,
# download a backup, open it again, replace with an example and restore, print. Also checks phone/tablet/desktop widths,
# dark mode, field help, visible focus, and that the page makes no network requests. All data is fictional.
import sys, json, pathlib, tempfile
from playwright.sync_api import sync_playwright

page_path = pathlib.Path(__file__).resolve().parent.parent / 'dist' / 'booster-fundraiser-planner.html'
URL = page_path.as_uri()
shots = sys.argv[1] if len(sys.argv) > 1 else None
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
def shot(pg, name):
    if shots: pg.screenshot(path=f'{shots}/{name}.png', full_page=True)

def fill(pg, path, value):
    sel = f'[data-path="{path}"]'
    pg.fill(sel, str(value)); pg.press(sel, 'Tab'); pg.wait_for_timeout(60)

def no_hscroll(pg):
    sw, cw = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    return sw <= cw + 1

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    errors, outside = [], []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('request', lambda r: outside.append(r.url) if not r.url.startswith(('file:', 'data:', 'blob:')) else None)

    # ---- open, understand, start blank ----
    pg.goto(URL)
    home = pg.inner_text('#app')
    check('home explains where the plan is kept', 'only in this browser, on this device' in home and 'not backed up online' in home)
    pg.click('#app [data-action="start-blank"]'); pg.wait_for_function("location.hash === '#step-event'")
    check('blank plan shows no example banner', not pg.is_visible('#demo-banner'))
    fill(pg, 'eventName', 'Practice plan (fictional)')
    fill(pg, 'settings.fundraisingTarget', 2000)

    # ---- three options of different kinds ----
    pg.goto(URL + '#step-options'); pg.wait_for_timeout(60)
    pg.click('[data-action="add-option"]'); pg.wait_for_timeout(40)
    pg.click('[data-action="add-option"]'); pg.wait_for_timeout(40)
    fill(pg, 'options.0.name', 'Golf scramble')
    fill(pg, 'options.1.name', 'Spaghetti dinner')
    pg.select_option('[data-path="options.1.kind"]', 'ticketed'); pg.wait_for_timeout(60)
    fill(pg, 'options.2.name', 'Candle sale')
    pg.select_option('[data-path="options.2.kind"]', 'product'); pg.wait_for_timeout(60)

    # golf: viable numbers with a written quote, evidence entered below
    q = {'venueQuote.perParticipant': 40, 'venueQuote.minimumParticipants': 40, 'capacity': 100, 'groupSize': 1, 'deposit.amount': 500, 'cancellationOwed': 800}
    pg.goto(URL + '#step-quote'); pg.wait_for_timeout(60)
    for k, v in q.items(): fill(pg, f'options.0.{k}', v)
    help_ok = pg.evaluate("""() => { const i = document.querySelector('[data-path="options.0.venueQuote.minimumParticipants"]');
      const id = i.getAttribute('aria-describedby'); return !!id && /even if fewer come/.test(document.getElementById(id).textContent); }""")
    check('financial fields carry a plain explanation linked to the input', help_ok)
    pg.check('[data-path="options.0.quoteVerified"]'); pg.wait_for_timeout(60)
    # ticketed: free admission with a per-guest charge and a big rental -> not viable
    pg.click('.tab >> nth=1'); pg.wait_for_timeout(40)
    fill(pg, 'options.1.venueQuote.flatFee', 3000); fill(pg, 'options.1.venueQuote.perParticipant', 12); fill(pg, 'options.1.capacity', 120)
    # product: supplier minimum, no evidence -> not enough evidence
    pg.click('.tab >> nth=2'); pg.wait_for_timeout(40)
    check('product option uses supplier wording', 'Supplier cost per item' in pg.inner_text('#app'))
    fill(pg, 'options.2.venueQuote.perParticipant', 9); fill(pg, 'options.2.venueQuote.minimumParticipants', 100); fill(pg, 'options.2.capacity', 400)

    pg.goto(URL + '#step-prices'); pg.wait_for_timeout(60)
    fill(pg, 'options.0.price', 100)
    pg.click('.tab >> nth=1'); pg.wait_for_timeout(40); fill(pg, 'options.1.price', 15)
    pg.click('.tab >> nth=2'); pg.wait_for_timeout(40); fill(pg, 'options.2.price', 18)

    pg.goto(URL + '#step-costs'); pg.wait_for_timeout(60)
    pg.click('[data-action="add-row"][data-i="0"][data-key="fixedCosts"]'); pg.wait_for_timeout(60)
    fill(pg, 'options.0.fixedCosts.0.label', 'Prizes'); fill(pg, 'options.0.fixedCosts.0.amount', 600)
    pg.check('[data-path="options.0.fixedCosts.0.paidUpfront"]'); pg.wait_for_timeout(60)
    pg.check('[data-path="options.0.costsVerified"]'); pg.wait_for_timeout(60)

    pg.goto(URL + '#step-sponsors'); pg.wait_for_timeout(60)
    pg.click('[data-action="add-sponsor"]'); pg.wait_for_timeout(60)
    fill(pg, 'sponsorships.0.label', 'Hardware store (fictional)'); fill(pg, 'sponsorships.0.amount', 1000)
    pg.select_option('[data-path="sponsorships.0.status"]', 'collected'); pg.wait_for_timeout(60)
    pg.select_option('[data-path="sponsorships.0.optionId"]', index=1); pg.wait_for_timeout(60)  # golf only

    pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(60)
    fill(pg, 'evidence.surveyResponses', 60)
    golf_id = pg.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1')).options[0].id")
    fill(pg, f'evidence.paidRegistrations.{golf_id}', 30)
    fill(pg, f'evidence.paidCashReceived.{golf_id}', 3000)
    fill(pg, f'evidence.namedHighIntent.{golf_id}', 20)
    pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(60)
    fill(pg, 'options.0.scenarioParticipants.conservative', 40); fill(pg, 'options.0.scenarioParticipants.middle', 50); fill(pg, 'options.0.scenarioParticipants.optimistic', 70)
    pg.click('.tab >> nth=1'); pg.wait_for_timeout(40)
    fill(pg, 'options.1.scenarioParticipants.conservative', 60); fill(pg, 'options.1.scenarioParticipants.middle', 80); fill(pg, 'options.1.scenarioParticipants.optimistic', 100)
    pg.goto(URL + '#step-volunteers'); pg.wait_for_timeout(60)
    fill(pg, 'volunteerHoursAvailable', 100)

    # ---- compare ----
    pg.goto(URL + '#results'); pg.wait_for_timeout(120)
    sums = pg.locator('article.sum')
    golf, dinner, candles = (sums.nth(k).inner_text() for k in range(3))
    check('golf: numbers clear break-even, labeled as not a guarantee', 'Numbers hold up so far' in golf or 'Supported by current evidence' in golf, golf[:200])
    check('golf: cash needed before the event is $1,100 (deposit + prizes)', '$1,100' in golf, golf[:600])
    # Canceling: $800 owed + $600 prizes already paid = $1,400. Nobody comes: $1,600 minimum bill + $600 prizes - $1,000 collected = $1,200.
    check('golf: most you could lose is $1,400 (cancel) and nobody-comes loss is $1,200', 'Most you could lose\n$1,400' in golf and 'If nobody comes: $1,200' in golf and 'If you cancel after the deadline: $1,400' in golf, golf[:900])
    check('dinner (free-ish, big rental): not viable', 'Not viable as currently configured' in dinner, dinner[:200])
    check('candles (no evidence): not enough evidence to decide', 'Not enough evidence to decide yet' in candles, candles[:200])
    check('candle sale counts items, not people', 'items sold' in candles)
    check('product: unknown cancellation shows "or more", not a guess', 'or more' in candles and 'not entered yet' in candles)
    check('side-by-side comparison present', pg.is_visible('text=Side by side'))
    check('no rounded "≈" headline figures', '≈' not in pg.inner_text('#app').split('Detailed numbers')[0])
    shot(pg, 'journey-results-desktop')

    # ---- save, refresh, reopen ----
    pg.reload(); pg.wait_for_timeout(120)
    check('refresh keeps the plan', 'Practice plan (fictional)' in pg.inner_text('#app'))
    pg.goto(URL + '#home'); pg.wait_for_timeout(60)
    check('home offers Continue my plan', pg.is_visible('text=Continue my plan'))

    # ---- download a backup, open it again ----
    pg.click('[data-action="toggle-save"]'); pg.wait_for_timeout(60)
    check('save panel says it is not cloud backup', 'not stored online' in pg.inner_text('#save-panel'))
    with pg.expect_download() as dl:
        pg.click('#save-panel [data-action="download-backup"]')
    path = dl.value.path(); saved = json.loads(pathlib.Path(path).read_text())
    check('backup file downloads with a dated name and the full plan', dl.value.suggested_filename.startswith('fundraiser-plan-') and saved['eventName'] == 'Practice plan (fictional)' and len(saved['options']) == 3)

    # ---- an example replaces the plan; the plan is kept and can be restored ----
    pg.click('#save-panel [data-action="load-demo"]'); pg.click('#save-panel [data-action="load-demo"]'); pg.wait_for_timeout(80)
    check('example replaced the plan', 'Fictional Example' in pg.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1')).eventName"))
    check('the replaced plan was kept as a backup', pg.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1-backup')).eventName") == 'Practice plan (fictional)')
    pg.click('[data-action="toggle-save"]'); pg.wait_for_timeout(60)
    check('save panel names the backup', 'Practice plan (fictional)' in pg.inner_text('#backup-line'))
    pg.click('[data-action="restore-backup"]'); pg.click('[data-action="restore-backup"]'); pg.wait_for_timeout(80)
    check('restore brings the plan back', pg.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1')).eventName") == 'Practice plan (fictional)')
    check('restore keeps the example as the new backup (swap is reversible)', 'Fictional Example' in pg.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1-backup')).eventName"))

    # ---- open the downloaded file: nothing lost ----
    pg.click('#save-panel [data-action="start-blank"]'); pg.click('#save-panel [data-action="start-blank"]'); pg.wait_for_timeout(80)
    pg.click('[data-action="toggle-save"]'); pg.wait_for_timeout(40)
    pg.set_input_files('input[data-action="import-json"]', path); pg.wait_for_timeout(200)
    check('opening the backup file reports success', 'Plan imported' in pg.inner_text('#status'))
    reopened = pg.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1'))")
    check('reopened plan matches the downloaded file exactly', reopened == saved)
    pg.click('[data-action="toggle-save"]')

    # ---- board summary and print ----
    pg.goto(URL + '#results'); pg.wait_for_timeout(100)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    memo = pg.evaluate("(() => { window.__memo = null; return true; })()")
    check('print button present', pg.is_visible('[data-action="print"]'))
    pg.evaluate("window.dispatchEvent(new Event('beforeprint'))")
    check('printing opens every detail section', pg.evaluate("[...document.querySelectorAll('#app details')].every((d) => d.open)"))
    pg.emulate_media(media='print')
    check('print hides buttons and the menu', not pg.is_visible('[data-action="copy-memo"]') and not pg.is_visible('header.site'))
    if shots: pg.pdf(path=f'{shots}/journey-print.pdf')
    pg.emulate_media(media='screen'); pg.evaluate("window.dispatchEvent(new Event('afterprint'))")
    check('after printing, sections close again', pg.evaluate("[...document.querySelectorAll('#app details.detail')].filter((d) => d.open).length") <= 1)

    # ---- example data prints as fictional ----
    pg.goto(URL + '#home'); pg.click('[data-demo="golf"]'); pg.click('[data-demo="golf"]'); pg.wait_for_function("location.hash === '#step-event'")
    pg.goto(URL + '#results'); pg.wait_for_timeout(80); pg.emulate_media(media='print')
    check('example banner still shows when printed', pg.is_visible('#demo-banner'))
    pg.emulate_media(media='screen')

    # ---- keyboard focus is visible ----
    pg.goto(URL + '#step-quote'); pg.wait_for_timeout(60)
    pg.focus('[data-path="options.0.venueQuote.flatFee"]'); pg.keyboard.press('Tab')
    outline = pg.evaluate("getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth")
    check('keyboard focus shows a visible outline', outline.startswith('solid') and not outline.endswith(' 0px'), outline)

    check('no JavaScript errors during the journey', not errors, '; '.join(errors))
    check('the page made no network requests (fonts, analytics or otherwise)', not outside, ', '.join(outside[:5]))
    ctx.close()

    # ---- an unreadable saved plan is kept aside, never overwritten by later typing ----
    c3 = b.new_context(); p3 = c3.new_page(); p3.goto(URL)
    p3.evaluate("localStorage.setItem('bfp-plan-v1', '{not json')"); p3.reload(); p3.wait_for_timeout(120)
    check('unreadable saved plan: the person is told, not silently shown the example', 'could not be read safely' in p3.inner_text('#status'))
    p3.click('#app [data-action="start-blank"]'); p3.click('#app [data-action="start-blank"]'); p3.wait_for_timeout(80)
    p3.fill('[data-path="eventName"]', 'Typed after'); p3.press('[data-path="eventName"]', 'Tab'); p3.wait_for_timeout(80)
    check('unreadable saved plan is kept aside after new typing', p3.evaluate("localStorage.getItem('bfp-plan-v1-unreadable')") == '{not json')
    c3.close()

    # ---- examples never push a real plan out of the backup; opening a panel isn't an edit ----
    c4 = b.new_context(); p4 = c4.new_page(); p4.goto(URL)
    p4.click('[data-action="toggle-save"]'); p4.wait_for_timeout(60)
    check('opening Save & backup on a fresh page saves nothing', p4.evaluate("localStorage.getItem('bfp-plan-v1')") is None)
    p4.click('[data-action="toggle-save"]')
    p4.click('#app [data-action="start-blank"]'); p4.wait_for_timeout(60)
    p4.fill('[data-path="eventName"]', 'Real plan'); p4.press('[data-path="eventName"]', 'Tab'); p4.wait_for_timeout(80)
    p4.click('[data-action="toggle-save"]'); p4.wait_for_timeout(40)
    p4.click('#save-panel [data-action="load-demo"]'); p4.click('#save-panel [data-action="load-demo"]'); p4.wait_for_timeout(80)
    practice = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'practice-plan-fictional.json'
    p4.click('[data-action="toggle-save"]'); p4.wait_for_timeout(40)
    p4.set_input_files('input[data-action="import-json"]', str(practice)); p4.wait_for_timeout(200)
    check('the fictional practice file opens', 'Plan imported' in p4.inner_text('#status') and 'Practice file' in p4.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1')).eventName"))
    check('example then file: the backup is still the real plan', p4.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1-backup')).eventName") == 'Real plan')
    c4.close()

    # ---- widths and dark mode: no sideways scrolling on any page ----
    for w, scheme in [(375, 'light'), (768, 'dark'), (1280, 'dark')]:
        c2 = b.new_context(viewport={'width': w, 'height': 900}, color_scheme=scheme); p2 = c2.new_page()
        p2.goto(URL); p2.click('[data-demo="gala"]'); p2.wait_for_function("location.hash === '#step-event'")
        bad = [h for h in ['#home', '#guide', '#step-quote', '#step-sponsors', '#step-evidence', '#step-scenarios', '#results'] if not (p2.goto(URL + h) or p2.wait_for_timeout(60) or no_hscroll(p2))]
        check(f'{w}px {scheme}: no sideways scrolling', not bad, ', '.join(bad))
        if w != 1280 or scheme == 'dark':
            bg = p2.evaluate("getComputedStyle(document.body).backgroundColor")
            check(f'{w}px {scheme}: page follows the colour scheme', (bg == 'rgb(14, 20, 18)') == (scheme == 'dark'), bg)
        shot(p2, f'journey-results-{w}-{scheme}')
        c2.close()
    b.close()

for n, ok, det in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok or not det else f'  [{det}]'))
print(f'{sum(ok for _, ok, _ in results)}/{len(results)} checks passed')
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
