# Browser checks for research records, Batch 1 (DECISION_LOG row 84). Run after `node scripts/build.js`:
#   python3 test/ui_research.py [screenshot_dir]
# Real clicks and keyboard input, each section in a fresh browser context (separate storage), fictional data only.
# A section that throws is recorded as a failure, so this file also reports cleanly against an older build.
import sys, json, pathlib
from plan_fixtures import import_fixture
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'dist' / 'booster-fundraiser-planner.html').as_uri()
CONTROL = (ROOT / 'test' / 'fixtures' / 'golf-control-fictional.json').read_text()
EXAMPLE = (ROOT / 'docs' / 'research-example-fictional.json').read_text()
PRACTICE = (ROOT / 'docs' / 'practice-plan-fictional.json').read_text()
shots = sys.argv[1] if len(sys.argv) > 1 else None
results = []
def check(name, cond, detail=''): results.append((name, bool(cond), detail))
def section(name, fn):
    try: fn()
    except Exception as e: results.append((f'{name}: section ran to the end', False, f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'))
def P(p): return f'[data-path="{p}"]'
def research_summary(pg, heading):
    return pg.locator('.research .rsum').filter(
        has=pg.get_by_role('heading', name=heading, exact=True)
    ).inner_text()
def fill(pg, sel, v):
    pg.fill(sel, str(v), timeout=5000); pg.press(sel, 'Tab'); pg.wait_for_timeout(100)
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
def show(pg, hash, act=None):
    # Navigate (or run act, e.g. a menu click) and return only after the app has redrawn for the new hash. The app redraws
    # in its 'hashchange' handler, which runs after location.hash changes, so waiting for the hash alone (or a fixed sleep)
    # can read the previous page on a slow machine (post-merge CI run 43894479322). A one-time listener registered after
    # the app's runs after its redraw. A same-hash goto causes no redraw; a fresh load draws before goto() returns.
    if pg.url.startswith(URL) and pg.evaluate('location.hash') != '#' + hash:
        pg.evaluate("window.__shown = false; addEventListener('hashchange', () => setTimeout(() => { window.__shown = true; }), { once: true })")
        act() if act else pg.goto(URL + '#' + hash)
        pg.wait_for_function('window.__shown === true', timeout=10000)  # fails, never hangs, if the page doesn't change
    else:
        act() if act else pg.goto(URL + '#' + hash)
def money_view(pg):  # everything on the results page that comes from the calculations
    show(pg, 'results')
    return {k: pg.inner_text(sel) for k, sel in [('cards', 'article.sum .cards'), ('status', 'article.sum .status-line'), ('detail', 'details.detail table'),
            ('verify', 'article.sum'), ('whatif', '.whatif .wi-cards')]}
def no_hscroll(pg):
    sw, cw = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]'); return sw <= cw + 1
FAULTS = """(() => { const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k !== '__fault') { let f = null; try { f = JSON.parse(window.sessionStorage.getItem('__fault') || 'null'); } catch (e) {}
      if (f && (f.all || (f.keys || []).includes(k))) throw new DOMException('Synthetic quota (test)', 'QuotaExceededError'); }
    return orig.call(this, k, v); }; })();"""

with sync_playwright() as p:
    b = p.chromium.launch()
    def new(**kw):
        ctx = b.new_context(viewport=kw.pop('viewport', {'width': 1280, 'height': 900}), accept_downloads=True, **kw)
        if kw.get('faults'): pass
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); return ctx, pg, errs

    # 1. Entering research by hand: empty states, units, unknown vs zero, overlap, prices and fees, add/edit/delete
    def entry():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, CONTROL)
        before = money_view(pg); evidence_before = stored(pg)['evidence']
        show(pg, 'research', lambda: pg.click('header.site a[data-nav="research"]'))
        t = pg.inner_text('#app')
        check('research page: reached from the menu, says it changes no numbers', 'Nothing on this page changes your numbers' in t)
        check('research page: clear empty states', 'No audience groups yet' in t and 'No similar events yet' in t and 'No notes yet' in t)
        pg.click('[data-action="add-research"][data-kind="audiences"]'); pg.wait_for_timeout(150)
        fill(pg, P('research.audiences.0.name'), 'Team parents (fictional)')
        fill(pg, P('research.audiences.0.reach'), 120)
        fill(pg, P('research.audiences.0.source'), 'FICTIONAL: my own guess from last year')
        a_ = stored(pg)['research']['audiences'][0]
        check('typing a source does not promote an estimate (still estimate, not checked)', a_['provenance'] == 'estimate' and a_['verification'] == 'unchecked' and 'Organizer estimate' in pg.inner_text('details[data-rec] >> nth=0'), a_)
        fill(pg, P('research.audiences.0.responded'), 0)
        a0 = stored(pg)['research']['audiences'][0]
        check('audience: typed values are saved', a0['name'] == 'Team parents (fictional)' and a0['reach'] == 120, a0)
        check('unknown stays unknown: a blank "contacted" is saved as null, not 0', a0['contacted'] is None, a0)
        check('zero stays zero: a typed 0 is saved as 0', a0['responded'] == 0, a0)
        fill(pg, P('research.audiences.0.contacted'), 35); fill(pg, P('research.audiences.0.contacted'), '')
        check('clearing a number turns it back into unknown (null), not 0', stored(pg)['research']['audiences'][0]['contacted'] is None, stored(pg)['research']['audiences'][0])
        pg.click('[data-action="add-research"][data-kind="audiences"]'); pg.wait_for_timeout(150)
        fill(pg, P('research.audiences.1.name'), 'Alumni households (fictional)')
        pg.select_option(P('research.audiences.1.unit'), 'households'); pg.wait_for_timeout(120)
        fill(pg, P('research.audiences.1.reach'), 200)
        pg.click('[data-action="add-research"][data-kind="audiences"]'); pg.wait_for_timeout(150)
        fill(pg, P('research.audiences.2.name'), 'Golf league (fictional)')
        fill(pg, P('research.audiences.2.reach'), 40)
        ids = [x['id'] for x in stored(pg)['research']['audiences']]
        pg.check(f'[data-research-toggle="research.audiences.2.overlapsWith"][value="{ids[0]}"]'); pg.wait_for_timeout(150)
        check('overlap is saved by ticking a box', stored(pg)['research']['audiences'][2]['overlapsWith'] == [ids[0]])
        tot = research_summary(pg, 'Totals by counting unit')
        check('totals are per unit: 160 people and 200 households, never 360', 'people: 160 estimated reach' in tot and 'households: 200 estimated reach' in tot and '360' not in pg.inner_text('#app'), tot)
        check('overlapping people are not called unique', 'not unique people: some groups overlap' in tot, tot)
        check('different units are never added together (said on screen)', 'Different units are never added together' in tot)
        # comparables
        pg.click('[data-action="add-research"][data-kind="comparables"]'); pg.wait_for_timeout(150)
        fill(pg, P('research.comparables.0.name'), 'Rotary scramble (fictional)')
        fill(pg, P('research.comparables.0.priceSingle'), 140)
        pg.select_option(P('research.comparables.0.comparability'), 'close'); pg.wait_for_timeout(120)
        c0 = stored(pg)['research']['comparables'][0]
        check('a new similar event starts as a sourced observation that is NOT checked', c0['provenance'] == 'observation' and c0['verification'] == 'unchecked', c0)
        cmp_ = research_summary(pg, 'Similar events side by side')
        check('fees left blank are shown as unknown, never $0', 'Required fees unknown for 1 of 1' in cmp_ and '$0 per person' not in cmp_, cmp_)
        fill(pg, P('research.comparables.0.feesPerPerson'), 0)
        pg.click('[data-action="add-research"][data-kind="comparables"]'); pg.wait_for_timeout(150)
        fill(pg, P('research.comparables.1.name'), 'PTA golf day (fictional)')
        fill(pg, P('research.comparables.1.priceSingle'), 120); fill(pg, P('research.comparables.1.feesPerPerson'), 5)
        pg.select_option(P('research.comparables.1.comparability'), 'close'); pg.wait_for_timeout(120)
        cmp_ = research_summary(pg, 'Similar events side by side')
        check('similar events are listed side by side, each with its own price and fees', '$140 per person (advertised)' in cmp_ and '$120 per person (advertised)' in cmp_ and '$5 per person' in cmp_, cmp_)
        check('no combined price range is shown, even for two close, fee-known events', '$120–$140' not in cmp_ and '$125–$140' not in cmp_ and 'no combined price range' in cmp_.lower(), cmp_)
        check('both events say they are not checked until the organizer checks them', cmp_.count('Not checked against the source') == 2, cmp_)
        pg.select_option(P('research.comparables.1.verification'), 'checked'); pg.wait_for_timeout(150)
        check('marking an event checked is an explicit choice, saved as such', stored(pg)['research']['comparables'][1]['verification'] == 'checked' and stored(pg)['research']['comparables'][0]['verification'] == 'unchecked')
        # assumption note
        pg.click('[data-action="add-research"][data-kind="links"]'); pg.wait_for_timeout(150)
        cids = [x['id'] for x in stored(pg)['research']['comparables']]
        pg.check(f'[data-research-toggle="research.links.0.researchIds"][value="{cids[0]}"]'); pg.wait_for_timeout(150)
        fill(pg, P('research.links.0.note'), 'Our price is inside the observed range (fictional).')
        link_txt = pg.inner_text('[data-rec] >> nth=-1')
        check('assumption note shows the current value and says it is not changed', 'In your plan now: $125 per player' in link_txt and 'does not change it' in link_txt, link_txt)
        # research changes no money and no evidence
        after = money_view(pg)
        check('research added: every calculated figure on the results page is unchanged', all(before[k] == after[k] for k in ('cards', 'status', 'detail', 'whatif')), [k for k in before if before[k] != after[k]])
        check('research added: the plan’s survey and payment evidence is unchanged', stored(pg)['evidence'] == evidence_before)
        check('results show research on file, labeled as not used in any calculation', 'Research on file' in pg.inner_text('[data-research="golf"]') and 'not used in any calculation' in pg.inner_text('[data-research="golf"]'))
        # refresh
        pg.reload(); pg.wait_for_timeout(250); show(pg, 'research')
        s = stored(pg)['research']
        check('refresh keeps all research', len(s['audiences']) == 3 and len(s['comparables']) == 2 and len(s['links']) == 1 and '$140 per person (advertised)' in pg.inner_text('#app'))
        # delete a cited record: the broken link is shown, then removed on request
        pg.click('summary:has-text("Rotary scramble (fictional)")'); pg.wait_for_timeout(120)
        btn = '[data-action="del-research"][data-kind="comparables"][data-j="0"]'
        pg.click(btn); pg.wait_for_timeout(80)
        check('remove asks to confirm first', len(stored(pg)['research']['comparables']) == 2)
        pg.click(btn); pg.wait_for_timeout(200)
        check('remove deletes the record', [x['name'] for x in stored(pg)['research']['comparables']] == ['PTA golf day (fictional)'])
        prob = pg.inner_text('#app .research-problems') if pg.locator('#app .research-problems').count() else ''
        check('a deleted record still cited by a note is shown as a broken link, not silently dropped', 'cites a research record that was removed' in prob and stored(pg)['research']['links'][0]['researchIds'] == [cids[0]], prob)
        show(pg, 'results')
        check('results show the broken research link too', 'point at a removed record' in pg.inner_text('[data-research="golf"]'))
        show(pg, 'research')
        pg.click('[data-action="fix-research"]'); pg.wait_for_timeout(200)
        check('removing the broken link clears it and keeps the note', pg.locator('#app .research-problems').count() == 0 and stored(pg)['research']['links'][0]['researchIds'] == [] and len(stored(pg)['research']['links']) == 1)
        if shots: pg.screenshot(path=f'{shots}/research-entry.png', full_page=True)
        check('entry: no page errors', not errs, errs)
        ctx.close()
    section('entry', entry)

    # 2. Untrusted text and links
    def safety():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, CONTROL)
        plan = json.loads(CONTROL)
        plan['research'] = {'audiences': [{'id': 'a1', 'name': '<img src=x onerror="window.__pwned=1">Parents', 'unit': 'people', 'category': 'parents', 'reach': 10, 'notes': '<script>window.__pwned=2</script>', 'optionIds': ['golf']}],
            'comparables': [{'id': 'c1', 'name': 'Bad link (fictional)', 'sourceUrl': 'javascript:window.__pwned=3', 'comparability': 'close', 'priceSingle': 100, 'feesPerPerson': 0, 'optionIds': ['golf']},
                            {'id': 'c2', 'name': 'Data link (fictional)', 'sourceUrl': 'data:text/html,<script>alert(1)</script>', 'optionIds': ['golf']},
                            {'id': 'c3', 'name': 'Good link (fictional)', 'sourceUrl': 'https://example.org/fictional?a=1&b="x"', 'optionIds': ['golf']}], 'links': []}
        st = open_file(pg, json.dumps(plan)); check('safety: plan with hostile-looking text imports', 'Plan imported' in st, st)
        show(pg, 'research')
        pg.click('summary:has-text("Bad link")'); pg.click('summary:has-text("Data link")'); pg.click('summary:has-text("Good link")'); pg.wait_for_timeout(150)
        hrefs = pg.eval_on_selector_all('#app a[target=_blank]', 'els => els.map(e => e.getAttribute("href"))')
        check('only http(s) links are clickable; javascript: and data: are shown as text', len(hrefs) >= 1 and set(hrefs) == {'https://example.org/fictional?a=1&b=%22x%22'}, hrefs)
        check('links open safely (noopener noreferrer)', pg.eval_on_selector_all('#app a[target=_blank]', 'els => els.every(e => /noopener/.test(e.rel) && /noreferrer/.test(e.rel))'))
        check('unsafe links are labeled as not opened', 'not opened: only http and https links are clickable' in pg.inner_text('#app'))
        show(pg, 'results'); m = memo(pg)
        check('markup in research text is shown as text and never runs', pg.evaluate('window.__pwned') is None and '<img src=x' in pg.inner_text('[data-research="golf"]'), pg.evaluate('window.__pwned'))
        check('board summary carries the text, not active markup', '<img src=x' in m)
        check('safety: no page errors', not errs, errs)
        ctx.close()
    section('safety', safety)

    # 3. Backup download, reopen, restore, unknown fields kept, older and malformed backups
    def backups():
        ctx, pg, errs = new(); pg.goto(URL)
        plan = json.loads(EXAMPLE); plan['isDemo'] = False
        plan['research']['audiences'][0]['futureField'] = {'kept': True}   # a field this version doesn't know
        plan['research']['futureList'] = [1, 2, 3]
        st = open_file(pg, json.dumps(plan)); check('backup: research plan imports', 'Plan imported' in st, st)
        original = stored(pg)
        check('unknown fields in research are kept, not erased', original['research']['audiences'][0].get('futureField') == {'kept': True} and original['research'].get('futureList') == [1, 2, 3])
        show(pg, 'research')
        pg.click('summary:has-text("Current team parents")'); fill(pg, P('research.audiences.0.notes'), 'Edited note (fictional)')
        edited = stored(pg)
        check('editing a record keeps its unknown fields', edited['research']['audiences'][0].get('futureField') == {'kept': True} and edited['research']['audiences'][0]['notes'] == 'Edited note (fictional)')
        pg.click('[data-action="toggle-save"]')
        with pg.expect_download() as dl: pg.click('#save-panel [data-action="download-backup"]')
        file_text = pathlib.Path(dl.value.path()).read_text(); pg.click('[data-action="toggle-save"]')
        check('downloaded backup holds the research exactly', json.loads(file_text) == edited)
        st = open_file(pg, PRACTICE); check('an older backup without research opens', 'Plan imported' in st, st)
        show(pg, 'research')
        check('older backup: research page shows empty states', 'No audience groups yet' in pg.inner_text('#app'))
        show(pg, 'results')
        check('older backup: results say no research is linked', 'No research linked to this option' in pg.inner_text('#app'))
        st = open_file(pg, file_text)
        check('reopening the downloaded backup restores the research exactly', 'Plan imported' in st and stored(pg) == edited, st)
        # malformed research: refused whole, nothing changes
        good = stored(pg)
        bad_cases = {
            'negative reach': lambda d: d['research']['audiences'][0].__setitem__('reach', -5),
            'unknown unit': lambda d: d['research']['audiences'][0].__setitem__('unit', 'golfers-per-household'),
            'impossible date': lambda d: d['research']['comparables'][0].__setitem__('checkedDate', '2026-02-30'),
            'URL that is not text': lambda d: d['research']['comparables'][0].__setitem__('sourceUrl', {'href': 'x'}),
            'research is a list': lambda d: d.__setitem__('research', []),
            'duplicate record id': lambda d: d['research']['comparables'][0].__setitem__('id', d['research']['audiences'][0]['id']),
            'unsafe option id': lambda d: d['research']['links'][0].__setitem__('optionId', '<b>x</b>'),
            'price as text': lambda d: d['research']['comparables'][0].__setitem__('priceSingle', '150'),
        }
        for name, mutate in bad_cases.items():
            d = json.loads(file_text); mutate(d)
            st = open_file(pg, json.dumps(d))
            check(f'malformed research ({name}) is refused and changes nothing', 'Could not import' in st and stored(pg) == good, st)
        # restore after replacing with the example
        import_fixture(pg, 'golf')
        pg.click('[data-action="toggle-save"]'); pg.click('[data-action="restore-backup"]'); pg.click('[data-action="restore-backup"]'); pg.wait_for_timeout(250)
        check('restore previous plan brings the research back exactly', stored(pg) == good, pg.inner_text('#status'))
        # a deleted option leaves visible broken links
        show(pg, 'step-options')
        pg.click('[data-action="add-option"]'); pg.wait_for_timeout(150)
        pg.click('[data-action="del-option"][data-i="0"]'); pg.click('[data-action="del-option"][data-i="0"]'); pg.wait_for_timeout(200)
        show(pg, 'research')
        prob = pg.inner_text('#app .research-problems') if pg.locator('#app .research-problems').count() else ''
        check('deleting an option shows research linked to it as broken, keeping the records', 'linked to an option that no longer exists' in prob and len(stored(pg)['research']['audiences']) == 4, prob[:300])
        check('backups: no page errors', not errs, errs)
        ctx.close()
    section('backups', backups)

    # 4. Saving fails while research is edited
    def failing():
        ctx = b.new_context(viewport={'width': 1280, 'height': 900}); ctx.add_init_script(FAULTS); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); open_file(pg, CONTROL); show(pg, 'research')
        before = stored(pg)
        pg.evaluate("sessionStorage.setItem('__fault', JSON.stringify({all: true}))")
        pg.click('[data-action="add-research"][data-kind="audiences"]'); pg.wait_for_timeout(150)
        fill(pg, P('research.audiences.0.name'), 'Not saved group (fictional)')
        check('save failure: red Not saved warning appears', pg.is_visible('#save-warning') and 'not saved' in pg.inner_text('#save-warning').lower())
        check('save failure: the stored plan is untouched', stored(pg) == before)
        pg.click('#save-warning [data-action="warn-export"]'); pg.wait_for_timeout(150)
        check('save failure: "Show plan as text" holds the unsaved research', 'Not saved group (fictional)' in pg.input_value('#export-text'))
        pg.evaluate("sessionStorage.removeItem('__fault')"); fill(pg, P('research.audiences.0.name'), 'Saved group (fictional)')
        check('after storage recovers, the research saves and the warning clears', not pg.is_visible('#save-warning') and stored(pg)['research']['audiences'][0]['name'] == 'Saved group (fictional)')
        check('save failure: no page errors', not errs, errs)
        ctx.close()
    section('save failure', failing)

    # 5. Phone width and keyboard
    def phone():
        ctx, pg, errs = new(viewport={'width': 375, 'height': 800}); pg.goto(URL); open_file(pg, EXAMPLE)
        show(pg, 'research')
        check('375px research page: no sideways scrolling (records closed)', no_hscroll(pg))
        pg.focus('details[data-rec] > summary >> nth=0'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
        check('keyboard: Enter opens a record', pg.evaluate("document.querySelector('details[data-rec]').open"))
        for s_ in pg.query_selector_all('details[data-rec]'): s_.evaluate('d => d.open = true')
        pg.wait_for_timeout(150)
        check('375px research page: no sideways scrolling (every record open)', no_hscroll(pg))
        box = '[data-research-toggle="research.audiences.0.optionIds"]'
        pg.focus(box); pg.keyboard.press('Space'); pg.wait_for_timeout(200)
        check('keyboard: Space toggles a link box and focus stays on it', pg.evaluate('document.activeElement.dataset.researchToggle') == 'research.audiences.0.optionIds' and stored(pg)['research']['audiences'][0]['optionIds'] == [])
        check('a record stays open after an edit re-draws the page', pg.evaluate("document.querySelector('details[data-rec]').open"))
        show(pg, 'results')
        check('375px results with research: no sideways scrolling', no_hscroll(pg))
        if shots: show(pg, 'research'); pg.screenshot(path=f'{shots}/research-375.png', full_page=True)
        check('phone: no page errors', not errs, errs)
        ctx.close()
    section('phone', phone)

    # 6. Board summary and print
    def board():
        ctx, pg, errs = new(); pg.goto(URL); open_file(pg, EXAMPLE); show(pg, 'results')
        m = memo(pg)
        check('board summary: research on file per option, labeled fictional and not used in calculations', "Research on file (fictional; organizer's records; not used in any calculation)" in m, m[m.find('Research on'):][:300])
        check('board summary: similar events listed one by one with their status, no combined range', 'no combined price range' in m and 'FICTIONAL PTA charity golf day (Sep 12, 2026): $125 per person (advertised); $480 for a group of 4 (advertised); early-bird price' in m and '$125–$155' not in m, m[m.find('Similar events'):][:900])
        check('board summary: example records are labeled fictional', 'Fictional example; checked against the source' in m or 'fictional example' in m.lower())
        check('board summary: audience section per unit, not unique people, never added across units', '## Audience research' in m and 'Sums are not unique people' in m and 'people: 180 estimated reach' in m and '480 estimated' not in m)
        check('board summary: assumption notes show the current value and cited research', 'Price per person or item ($125 per player in the plan): cites FICTIONAL Rotary spring scramble' in m)
        pg.emulate_media(media='print')
        check('print: research section prints with each option', pg.is_visible('[data-research="golf"]') and 'Research on file' in pg.inner_text('[data-research="golf"]'))
        check('print: the edit link does not print', not pg.is_visible('[data-research="golf"] .noprint'))
        if shots: pg.pdf(path=f'{shots}/research-print.pdf')
        pg.emulate_media(media='screen')
        check('board: no page errors', not errs, errs)
        ctx.close()
    section('board summary and print', board)

    # 7. Fictional analogues of real research, in a REAL plan (row 85)
    ANALOGUES = (ROOT / 'test' / 'fixtures' / 'research-analogues-fictional.json').read_text()
    def analogues():
        ctx, pg, errs = new(); pg.goto(URL); st = open_file(pg, ANALOGUES)
        check('analogues: real-plan file opens (no example banner)', 'Plan imported' in st and not pg.is_visible('#demo-banner'), st)
        before = money_view(pg)
        show(pg, 'research')
        t = research_summary(pg, 'Similar events side by side')
        rows = {r.get_attribute('data-obs'): r.inner_text() for r in pg.query_selector_all('tr[data-obs]')}
        check('a partly comparable event is worded properly', 'Partly comparable' in rows.get('c_duo', ''), rows.get('c_duo'))
        check('mixed real/fictional: the fictional $10 record is not in the real list and no $10-$150 range appears', 'c_fic' not in rows and '$10–$150' not in t and 'Fictional, not compared: FICTIONAL ten-dollar demo' in t, t[:400])
        check('unchecked AI-provided URL: listed as a sourced observation, not checked', 'Sourced observation' in rows.get('c_ai', '') and 'Not checked against the source' in rows.get('c_ai', ''), rows.get('c_ai'))
        check('derived group total: shown as our arithmetic, not an advertised offer', 'your own arithmetic, not an advertised offer' in rows.get('c_derived', '') and 'individual price not recorded' in rows.get('c_derived', ''), rows.get('c_derived'))
        check('duo price is a group of 2 (advertised); no per-person equivalent shown as a ticket', '$300 for a group of 2 (advertised)' in rows.get('c_duo', '') and '$150 per person' not in rows.get('c_duo', ''), rows.get('c_duo'))
        check('conflicting inclusions: marked unresolved, with the wording kept', 'Unresolved or conflicting' in rows.get('c_duo', '') and 'cart wording unclear' in rows.get('c_duo', ''), rows.get('c_duo'))
        check('unknown fees shown as unknown on every row that lacks them', rows.get('c_duo', '').count('unknown') >= 1 and 'Required fees unknown for 6 of 7' in t, t)
        check('mismatched years and tiers are called out', 'different years (2022, 2026, 2027)' in t and 'Pricing tiers differ or are not recorded' in t, t)
        check('advertised capacity is a limit, not attendance', 'capacity 144 (a limit, not attendance)' in rows.get('c_future', ''), rows.get('c_future'))
        check('historical participation is not paid registrations', 'reported participation 90 (not paid registrations)' in rows.get('c_2022', ''), rows.get('c_2022'))
        check('celebrity package: not comparable, no individual price invented', 'Not comparable' in rows.get('c_celebrity', '') and 'individual price not recorded' in rows.get('c_celebrity', ''), rows.get('c_celebrity'))
        tot = research_summary(pg, 'Totals by counting unit')
        check('audience totals leave the fictional group out and show what kind of records they are', 'people: 180 estimated reach' in tot and '9,999' not in tot and '1 fictional group is left out' in tot and '1 sourced, 1 estimate, 1 not checked' in tot, tot)
        after = money_view(pg)
        check('analogues: every calculated figure on the results page is unchanged by research', all(before[k] == after[k] for k in ('cards', 'status', 'detail', 'whatif')))
        res = pg.inner_text('[data-research="golf"]')
        check('results: each observation with provenance and verification, fictional records named as not counted', 'FICTIONAL Engine 9 scramble (Jun 15, 2026): $145 per person (advertised)' in res and 'sourced observation; not checked against the source' in res and 'Fictional audience records, not counted: FICTIONAL demo group' in res and 'FICTIONAL ten-dollar demo' not in res.split('Similar events')[1].split('Fictional')[0], res[:1500])
        m = memo(pg)
        check('board summary: the AI-sourced event stays unchecked, with its source and limits', 'FICTIONAL Engine 9 scramble (Jun 15, 2026)' in m and 'sourced observation; not checked against the source; source: https://example.org/fictional-engine9' in m, m[m.find('Engine 9'):][:500])
        check('board summary: derived totals, capacity and participation keep their meaning', 'your own arithmetic, not an advertised offer' in m and 'advertised capacity 144 (a limit, not attendance)' in m and 'reported participation 90 (as reported; not paid registrations)' in m)
        check('board summary: fictional records stay out of real totals', '9,999' not in m and '1 fictional group left out of these totals' in m)
        pg.emulate_media(media='print')
        check('print: observations and their status print with the option', 'FICTIONAL Park Fund scramble' in pg.inner_text('[data-research="golf"]') and pg.is_visible('[data-research="golf"]'))
        if shots: pg.pdf(path=f'{shots}/research-analogues-print.pdf')
        pg.emulate_media(media='screen')
        if shots: show(pg, 'research'); pg.screenshot(path=f'{shots}/research-analogues.png', full_page=True)
        check('analogues: no page errors', not errs, errs)
        ctx.close()
    section('analogues', analogues)

    # 8. A record saved by 08fed6b (no provenance or verification) is never silently upgraded
    def legacy():
        ctx, pg, errs = new(); pg.goto(URL)
        plan = json.loads(CONTROL); plan['research'] = {'audiences': [{'id': 'old_a', 'name': 'Old group (fictional)', 'unit': 'people', 'category': 'parents', 'reach': 50, 'source': 'flyer', 'overlapsWith': [], 'optionIds': ['golf']}],
            'comparables': [{'id': 'old_c', 'name': 'Old event (fictional)', 'sourceUrl': 'https://example.org/old', 'priceSingle': 120, 'feesPerPerson': 0, 'comparability': 'close', 'optionIds': ['golf']}], 'links': []}
        st = open_file(pg, json.dumps(plan)); check('legacy: an 08fed6b-era research file opens', 'Plan imported' in st, st)
        show(pg, 'research')
        t = pg.inner_text('#app')
        check('legacy: records show "provenance not recorded" and "not checked", not "sourced"', t.count('Provenance not recorded (older record)') >= 2 and 'Sourced observation' not in t.split('Similar events side by side')[0], t[:800])
        pg.click('summary:has-text("Old event (fictional)")'); pg.wait_for_timeout(150)
        check('legacy: the provenance box asks for a choice instead of showing a default', pg.eval_on_selector(P('research.comparables.0.provenance'), 'e => e.options[e.selectedIndex].text') == 'Not recorded (older record): choose one')
        fill(pg, P('research.comparables.0.feesNote'), 'edited (fictional)')
        c = stored(pg)['research']['comparables'][0]
        check('legacy: editing another field does not add provenance or verification', 'provenance' not in c and 'verification' not in c and c['feesNote'] == 'edited (fictional)', c)
        pg.select_option(P('research.comparables.0.provenance'), 'observation'); pg.wait_for_timeout(150)
        check('legacy: the organizer can then choose provenance explicitly', stored(pg)['research']['comparables'][0]['provenance'] == 'observation' and 'verification' not in stored(pg)['research']['comparables'][0])
        bad = json.loads(json.dumps(plan)); bad['research']['comparables'][0]['verification'] = 'verified-by-ai'
        st = open_file(pg, json.dumps(bad)); check('malformed verification value is refused', 'Could not import' in st, st)
        bad = json.loads(json.dumps(plan)); bad['research']['comparables'][0]['groupPriceBasis'] = 'guess'
        st = open_file(pg, json.dumps(bad)); check('malformed group price basis is refused', 'Could not import' in st, st)
        check('legacy: no page errors', not errs, errs)
        ctx.close()
    section('legacy records', legacy)
    b.close()

for n, ok, det in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok or not det else f'  [{det}]'))
print(f'{sum(ok for _, ok, _ in results)}/{len(results)} checks passed')
sys.exit(0 if results and all(ok for _, ok, _ in results) else 1)
