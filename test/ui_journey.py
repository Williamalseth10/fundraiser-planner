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
    check('golf: loss if canceled is $1,400 and nobody-comes loss is $1,200', 'Loss if nobody comes or you cancel\n$1,400' in golf and 'If nobody comes: $1,200' in golf and 'If you cancel after the deadline: $1,400' in golf, golf[:900])
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

    # ---- storage failures (fault injection; DECISION_LOG row 73) ----
    # Before the app loads, wrap Storage.setItem so writes throw a quota error on command. sessionStorage['__fault'] holds
    # {"all": true} or {"keys": [...]}; it survives reloads in the tab and is read on every write, so tests can toggle it.
    FAULTS = """(() => { const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k !== '__fault') { let f = null; try { f = JSON.parse(window.sessionStorage.getItem('__fault') || 'null'); } catch (e) {}
          if (f && (f.all || (f.keys || []).includes(k))) throw new DOMException('Synthetic quota (test)', 'QuotaExceededError'); }
        return orig.call(this, k, v); }; })();"""
    def faults(pg, spec): pg.evaluate("s => sessionStorage.setItem('__fault', JSON.stringify(s))", spec)
    def stored(pg, key='bfp-plan-v1'):
        raw = pg.evaluate(f"localStorage.getItem('{key}')")
        try: return json.loads(raw).get('eventName') if raw else None
        except ValueError: return raw
    def warning(pg): return pg.inner_text('#save-warning') if pg.is_visible('#save-warning') else ''
    def fresh_plan(pg, name):
        pg.goto(URL); pg.click('#app [data-action="start-blank"]'); pg.wait_for_function("location.hash === '#step-event'")
        pg.fill('[data-path="eventName"]', name); pg.press('[data-path="eventName"]', 'Tab'); pg.wait_for_timeout(80)
    def open_panel(pg):
        if not pg.is_visible('#save-panel'): pg.click('[data-action="toggle-save"]'); pg.wait_for_timeout(40)

    # (a) an ordinary edit that can't be saved: persistent warning, export still has the latest edit, recovery clears it
    c5 = b.new_context(accept_downloads=True); c5.add_init_script(FAULTS); p5 = c5.new_page()
    fresh_plan(p5, 'Fictional saved plan A')
    check('control: with storage working there is no unsaved warning', warning(p5) == '' and stored(p5) == 'Fictional saved plan A')
    faults(p5, {'all': True})
    p5.fill('[data-path="eventName"]', 'Fictional unsaved plan B'); p5.press('[data-path="eventName"]', 'Tab'); p5.wait_for_timeout(80)
    check('failed save: stored plan is unchanged (still A)', stored(p5) == 'Fictional saved plan A')
    check('failed save: a warning says the changes are not saved', 'not saved' in warning(p5).lower(), warning(p5))
    check('failed save: no message claims saving is working', 'saves in this browser as you go' not in p5.inner_text('#status'))
    p5.goto(URL + '#results'); p5.wait_for_timeout(80)
    check('failed save: the warning stays on other pages', 'not saved' in warning(p5).lower())
    if p5.is_visible('#save-warning [data-action="download-backup"]'):
        with p5.expect_download() as dl5: p5.click('#save-warning [data-action="download-backup"]')
        latest = json.loads(pathlib.Path(dl5.value.path()).read_text())['eventName']
    else: latest = None
    check('failed save: the warning offers a download holding the latest edit', latest == 'Fictional unsaved plan B', str(latest))
    if p5.is_visible('#save-warning [data-action="warn-export"]'): p5.click('#save-warning [data-action="warn-export"]'); p5.wait_for_timeout(60)
    check('failed save: "Show plan as text" in the warning holds the latest edit', '"Fictional unsaved plan B"' in (p5.input_value('#export-text') if p5.is_visible('#export-text') else ''))
    faults(p5, None)
    p5.goto(URL + '#step-event'); p5.wait_for_timeout(60)
    p5.fill('[data-path="eventName"]', 'Fictional plan C'); p5.press('[data-path="eventName"]', 'Tab'); p5.wait_for_timeout(80)
    check('after storage recovers: the plan saves and the warning clears', stored(p5) == 'Fictional plan C' and warning(p5) == '')
    c5.close()

    # (b) a required backup can't be written, although replacing the plan would succeed: nothing is replaced
    for action, label in [('start-blank', 'start a blank plan'), ('load-demo', 'load the example'), ('import', 'open a file')]:
        c6 = b.new_context(); c6.add_init_script(FAULTS); p6 = c6.new_page()
        fresh_plan(p6, 'Fictional valuable plan')
        faults(p6, {'keys': ['bfp-plan-v1-backup', 'bfp-plan-v1-backup-at']})
        open_panel(p6)
        if action == 'import':
            practice = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'practice-plan-fictional.json'
            p6.set_input_files('input[data-action="import-json"]', str(practice)); p6.wait_for_timeout(200)
        else:
            p6.click(f'#save-panel [data-action="{action}"]'); p6.click(f'#save-panel [data-action="{action}"]'); p6.wait_for_timeout(120)
        msg = p6.inner_text('#status')
        check(f'backup fails ({label}): the stored plan is not replaced', stored(p6) == 'Fictional valuable plan', str(stored(p6)))
        check(f'backup fails ({label}): the plan stays on screen', p6.evaluate("document.querySelector('[data-path=\"eventName\"]') ? document.querySelector('[data-path=\"eventName\"]').value : document.title") == 'Fictional valuable plan' or 'Fictional valuable plan' in p6.inner_text('#app'), p6.inner_text('#app')[:120])
        check(f'backup fails ({label}): the person is told and offered a download', 'backup' in msg.lower() and 'could not' in msg.lower() and 'download' in msg.lower(), msg)
        check(f'backup fails ({label}): no message claims a backup was kept', 'kept as a backup' not in msg and 'was kept' not in msg, msg)
        c6.close()

    # (c) "no backup needed" is not reported as a failure: replacing an untouched example needs no backup
    c7 = b.new_context(); c7.add_init_script(FAULTS); p7 = c7.new_page(); p7.goto(URL)
    faults(p7, {'keys': ['bfp-plan-v1-backup', 'bfp-plan-v1-backup-at']})
    p7.click('#app [data-action="start-blank"]'); p7.wait_for_timeout(120)
    check('no backup needed: a first blank plan starts normally', p7.evaluate("location.hash") == '#step-event' and 'could not' not in p7.inner_text('#status').lower(), p7.inner_text('#status'))
    c7.close()

    # (d) restore can't write: nothing changes, nothing claims success
    c8 = b.new_context(); c8.add_init_script(FAULTS); p8 = c8.new_page()
    fresh_plan(p8, 'Fictional plan one')
    open_panel(p8); p8.click('#save-panel [data-action="start-blank"]'); p8.click('#save-panel [data-action="start-blank"]'); p8.wait_for_timeout(100)
    p8.fill('[data-path="eventName"]', 'Fictional plan two'); p8.press('[data-path="eventName"]', 'Tab'); p8.wait_for_timeout(80)
    check('control: before the restore test, plan two is saved and plan one is the backup', stored(p8) == 'Fictional plan two' and stored(p8, 'bfp-plan-v1-backup') == 'Fictional plan one')
    faults(p8, {'all': True})
    open_panel(p8); p8.click('[data-action="restore-backup"]'); p8.click('[data-action="restore-backup"]'); p8.wait_for_timeout(100)
    msg = p8.inner_text('#status')
    check('restore write fails: stored plan and backup are unchanged', stored(p8) == 'Fictional plan two' and stored(p8, 'bfp-plan-v1-backup') == 'Fictional plan one')
    check('restore write fails: the current plan stays on screen', p8.evaluate("JSON.stringify(document.querySelector('[data-path=\"eventName\"]') && document.querySelector('[data-path=\"eventName\"]').value)") == '"Fictional plan two"')
    check('restore write fails: reported as not restored, with a download offered', 'could not' in msg.lower() and 'restored.' not in msg.lower() and 'download' in msg.lower(), msg)
    faults(p8, None)
    p8.click('[data-action="restore-backup"]'); p8.click('[data-action="restore-backup"]'); p8.wait_for_timeout(100)
    check('control: restore works once storage works', stored(p8) == 'Fictional plan one' and stored(p8, 'bfp-plan-v1-backup') == 'Fictional plan two')
    c8.close()

    # (e) an unreadable saved plan that can't be kept aside is never overwritten, and the note says so truthfully
    c9 = b.new_context(); c9.add_init_script(FAULTS); p9 = c9.new_page(); p9.goto(URL)
    p9.evaluate("localStorage.setItem('bfp-plan-v1', '{not json')"); faults(p9, {'keys': ['bfp-plan-v1-unreadable']})
    p9.reload(); p9.wait_for_timeout(120)
    note = p9.inner_text('#status')
    check('unreadable plan, aside-copy fails: the note does not claim it was kept aside', 'kept aside in this browser, not deleted' not in note, note)
    p9.click('#app [data-action="start-blank"]'); p9.click('#app [data-action="start-blank"]'); p9.wait_for_timeout(100)
    p9.fill('[data-path="eventName"]', 'Typed after'); p9.press('[data-path="eventName"]', 'Tab'); p9.wait_for_timeout(80)
    check('unreadable plan, aside-copy fails: the unreadable saved copy is not overwritten', p9.evaluate("localStorage.getItem('bfp-plan-v1')") == '{not json')
    check('unreadable plan, aside-copy fails: new typing shows the unsaved warning', 'not saved' in warning(p9).lower(), warning(p9))
    c9.close()

    # ---- "most you could lose" is not presented as a maximum when selling more loses more (DECISION_LOG row 74) ----
    neg = json.loads((pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'practice-plan-fictional.json').read_text())
    sale = dict(neg['options'][1], id='sale', name='Fictional $10 sale with $15 supplier cost', capacity=100, price=10,
                venueQuote={'flatFee': 0, 'perParticipant': 15, 'minimumParticipants': 0, 'minimumSpend': 0},
                deposit={'amount': 0, 'creditedTowardBill': True, 'refundable': True}, fixedCosts=[], perParticipantCosts=[],
                volunteerHours=0, cancellationOwed=0, quoteVerified=True, costsVerified=True,
                scenarioParticipants={'conservative': 10, 'middle': 50, 'optimistic': 100})
    neg['scenarioSettings'] = {k: {'label': k, 'statuses': ['collected', 'committed'], 'extraRevenuePerParticipant': 0, 'otherRevenue': 0, 'costContingencyPct': 0}
                               for k in ('conservative', 'middle', 'optimistic')}  # as in the review's fixture: no assumed income
    neg.update(isDemo=False, eventName='Fictional negative-margin sale', options=[sale], sponsorships=[], volunteerHoursAvailable=100,
               settings={'fundraisingTarget': 0, 'volunteerHourValue': None},
               evidence={'surveyResponses': 10, 'paidRegistrations': {'sale': 0}, 'paidCashReceived': {'sale': 0}, 'namedHighIntent': {'sale': 10},
                         'surveyDefinitelyAtPrice': {'sale': 0}, 'surveyProbablyAtPrice': {'sale': 0}})
    c10 = b.new_context(); p10 = c10.new_page(); p10.goto(URL); open_panel(p10)
    p10.set_input_files('input[data-action="import-json"]', files=[{'name': 'neg.json', 'mimeType': 'application/json', 'buffer': json.dumps(neg).encode()}]); p10.wait_for_timeout(200)
    p10.goto(URL + '#results'); p10.wait_for_timeout(120)
    card = p10.locator('article.sum .card').nth(1).inner_text()
    check('negative margin: still High financial risk', 'High financial risk' in p10.inner_text('article.sum'))
    check('negative margin: likely case is -$250 and high case -$500, as in the review', 'Likely case (your estimate)\n−$250' in p10.inner_text('article.sum') and 'high case −$500' in p10.inner_text('article.sum'))
    check('negative margin: a $0 loss figure is never shown without saying holding it can lose more', ('\n$0' not in card or 'Holding it can lose more' in card) and 'Most you could lose' not in card, card)
    check('negative margin: the loss card names the -$500 at 100 items', '−$500' in card and '100' in card, card)
    # capture "Copy board summary" text (both the clipboard API and the fallback copy path)
    p10.evaluate("""() => { window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } });
      document.execCommand = () => { const el = document.activeElement; window.__copied = el && el.value; return true; }; }""")
    p10.click('[data-action="copy-memo"]'); p10.wait_for_timeout(80)
    memo = p10.evaluate("window.__copied") or ''
    check('negative margin: the board summary does not call the $0 case the most you could lose', 'Most you could lose under the terms entered: $0' not in memo and '−$500' in memo, memo[memo.find('Cash needed'):][:300])
    c10.close()

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
