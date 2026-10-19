# Browser smoke test for the built site. Usage: python3 test/ui_smoke.py [screenshot_dir]
import sys, pathlib
from playwright.sync_api import sync_playwright

page_path = pathlib.Path(__file__).resolve().parent.parent / 'dist' / 'booster-fundraiser-planner.html'
URL = page_path.as_uri()
shots = sys.argv[1] if len(sys.argv) > 1 else None
errors = []

def watch(pg):
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

def no_hscroll(pg, where):
    sw, cw = pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]')
    assert sw <= cw + 1, f'{where}: page scrolls sideways ({sw} > {cw})'

def shot(pg, name):
    if shots: pg.screenshot(path=f'{shots}/{name}.png', full_page=True)

PER_OPTION = {'quote', 'prices', 'costs', 'scenarios'}
STEP_IDS = ['event', 'options', 'quote', 'prices', 'costs', 'sponsors', 'survey', 'evidence', 'scenarios', 'volunteers']

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, label in [(1280, 'desktop'), (375, 'mobile')]:
        pg = b.new_context(viewport={'width': w, 'height': 900}).new_page(); watch(pg)
        pg.goto(URL)
        assert pg.is_visible('text=Try a golf example'), 'home page CTA missing'
        no_hscroll(pg, f'{label} home'); shot(pg, f'{label}-home')
        assert not pg.is_visible('#demo-banner'), 'no example banner on the home page'
        pg.click('text=Try a golf example')
        pg.wait_for_function("location.hash === '#step-event'", timeout=3000)
        assert pg.is_visible('#demo-banner'), 'example banner must show in the planner'
        for k, sid in enumerate(STEP_IDS):
            pg.wait_for_function(f"location.hash === '#step-{sid}'", timeout=3000)
            pg.wait_for_timeout(50)
            assert pg.evaluate("document.activeElement.id") == 'step-title' or k == 0, f'focus not on title at {sid}'
            no_hscroll(pg, f'{label} step {sid}')
            if sid in ('quote', 'scenarios'): shot(pg, f'{label}-step-{sid}')
            if sid in PER_OPTION:
                assert 'Option 1 of 3' in pg.text_content('.stepcard .eyebrow'), f'{sid}: should start on option 1'
                for n in range(2):  # Next walks through the other two options before leaving the step
                    btn = pg.locator('.stepnav .btn:not(.ghost)')
                    assert btn.inner_text().startswith('Next: '), f'{sid}: Next should go to the next option'
                    btn.click(); pg.wait_for_timeout(30)
                    assert f'Option {n + 2} of 3' in pg.text_content('.stepcard .eyebrow')
                    assert pg.evaluate('location.hash') == f'#step-{sid}'
            pg.click('.stepnav .btn:not(.ghost)')
        pg.wait_for_function("location.hash === '#results'", timeout=3000); pg.wait_for_timeout(50)
        assert 'Not enough evidence to decide yet' in pg.inner_text('#app')
        no_hscroll(pg, f'{label} results'); shot(pg, f'{label}-results')
        pg.go_back(); pg.wait_for_function("location.hash === '#step-volunteers'", timeout=3000)
        pg.close()

    pg = b.new_context(viewport={'width': 1280, 'height': 900}).new_page(); watch(pg)
    pg.goto(URL); pg.click('text=Try a golf example')
    # survey uses one price per option from the prices step
    pg.goto(URL + '#step-survey')
    survey = pg.inner_text('#survey')
    assert 'Q4a.' in survey and '$125 per player' in survey and '$460 for a full foursome of 4' in survey, 'single-price survey question missing'
    assert 'skip Q3, then answer Q4 for those' in survey, 'non-golfers must not skip the non-golf price question'
    # keyboard: editing a field and pressing Tab keeps focus on the next field after the page redraws
    pg.goto(URL + '#step-quote')
    pg.fill('input[data-path="options.0.venueQuote.perParticipant"]', '57')
    pg.press('input[data-path="options.0.venueQuote.perParticipant"]', 'Tab'); pg.wait_for_timeout(80)
    assert pg.evaluate("document.activeElement.dataset.path") == 'options.0.venueQuote.minimumParticipants', 'focus lost after edit'
    # in-kind dropdown shows cost names, not ids
    pg.goto(URL + '#step-sponsors')
    assert 'Signage & printing' in pg.inner_text('select[data-path="sponsorships.3.replacesCostId"]')
    # read-aloud box is on the results page
    pg.goto(URL + '#results')
    assert 'What to tell the board' in pg.inner_text('#app')
    # second example: gala with auction vs. product sale uses each type's own words
    pg.goto(URL + '#home'); pg.click('[data-demo="gala"]'); pg.click('[data-demo="gala"]')
    pg.wait_for_function("location.hash === '#step-event'", timeout=3000)
    pg.goto(URL + '#step-quote'); pg.click('.tab >> nth=1'); pg.wait_for_timeout(50)
    assert 'Supplier cost per item' in pg.inner_text('#app'), 'product sale should use supplier wording'
    pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(50)
    assert 'Auction and raffle money' in pg.inner_text('#app'), 'auction option should ask for auction money per scenario'
    pg.goto(URL + '#step-survey'); pg.wait_for_timeout(50)
    gs = pg.text_content('#survey')
    assert 'per item, would your household buy' in gs and '( ) Yes, 2 items' in gs and 'full table of 8' in gs and 'foursome' not in gs.lower(), 'survey should fit gala and product sale'
    assert 'No, none of them  -> skip to Q6' in gs, 'mixed plans must not skip the product question on a single No'
    pg.goto(URL + '#results'); pg.wait_for_timeout(50)
    rt = pg.inner_text('#app')
    assert 'items sold to break even' in rt and 'leaves out auction and raffle money' in rt and 'no auction bids' in rt
    # back to the golf example for the remaining checks
    pg.goto(URL + '#home'); pg.click('[data-demo="golf"]'); pg.click('[data-demo="golf"]')
    pg.wait_for_function("location.hash === '#step-event'", timeout=3000)
    # editing recomputes: shotgun price below cost -> not viable
    pg.goto(URL + '#step-prices'); pg.click('.tab >> nth=1')
    pg.fill('input[data-path="options.1.price"]', '60'); pg.press('input[data-path="options.1.price"]', 'Tab')
    pg.fill('input[data-path="options.1.groupPrice"]', '240'); pg.press('input[data-path="options.1.groupPrice"]', 'Tab')
    pg.goto(URL + '#results')
    assert 'Not viable as currently configured' in pg.inner_text('#app')
    # fill-from-evidence
    pg.goto(URL + '#step-scenarios'); pg.click('.tab >> nth=0')
    pg.click('[data-action="fill-evidence"]')
    assert pg.input_value('input[data-path="options.0.scenarioParticipants.conservative"]') == '0'
    assert pg.input_value('input[data-path="options.0.scenarioParticipants.middle"]') == '6'
    # autosave survives reload; home offers "Continue my plan"
    pg.reload(); pg.goto(URL + '#home')
    assert pg.is_visible('text=Continue my plan'), 'saved plan not detected'
    # export shows JSON text
    pg.click('[data-action="toggle-save"]'); pg.click('[data-action="export"]')
    assert '"options"' in pg.input_value('#export-text')
    # start over needs a second click, then shows a blank plan
    pg.click('#save-panel [data-action="start-blank"]'); pg.click('#save-panel [data-action="start-blank"]')
    pg.wait_for_function("location.hash === '#step-event'", timeout=3000)
    assert not pg.is_visible('#demo-banner')
    b.close()

if errors:
    print('JS ERRORS:', *errors, sep='\n'); sys.exit(1)
print('UI smoke test passed')
