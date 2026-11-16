# Deleting an option must never make the saved plan unreadable after a reload (DECISION_LOG row 86).
# Run after `node scripts/build.js`:   python3 test/ui_option_delete.py
# Fresh browser context, fictional example data, real clicks.
import sys, json, pathlib
from playwright.sync_api import sync_playwright

URL = (pathlib.Path(__file__).resolve().parent.parent / 'dist' / 'booster-fundraiser-planner.html').as_uri()
results = []
def check(name, ok, detail=''): results.append((name, bool(ok), detail))

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context().new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.click('#app [data-action="start-demo"][data-demo="golf"]'); pg.wait_for_timeout(300)
    pg.goto(URL + '#step-event'); pg.fill('[data-path="eventName"]', 'Edited example (fictional)'); pg.press('[data-path="eventName"]', 'Tab'); pg.wait_for_timeout(150)
    pg.goto(URL + '#step-sponsors'); pg.wait_for_timeout(150)
    pg.select_option('[data-path="sponsorships.0.optionId"]', 'alt'); pg.wait_for_timeout(150)   # a sponsor tied only to the option we delete
    pg.goto(URL + '#step-options'); pg.wait_for_timeout(150)
    pg.click('[data-action="del-option"][data-i="2"]'); pg.click('[data-action="del-option"][data-i="2"]'); pg.wait_for_timeout(200)
    saved = json.loads(pg.evaluate("localStorage.getItem('bfp-plan-v1')"))
    check('the option is removed', [o['id'] for o in saved['options']] == ['tee', 'shotgun'])
    check('its survey and payment numbers are kept in the file, not erased', 'alt' in saved['evidence']['namedHighIntent'] and 'alt' in saved['evidence']['paidRegistrations'])
    check('the person is told what happened to them', 'stay in your saved file but no longer count' in pg.inner_text('#status'))
    pg.reload(); pg.wait_for_timeout(400)
    check('after a reload the plan loads normally (no "could not be read")', not pg.is_visible('#status') or 'could not be read' not in pg.inner_text('#status'))
    check('nothing was set aside as unreadable', pg.evaluate("localStorage.getItem('bfp-plan-v1-unreadable') === null"))
    pg.goto(URL + '#step-event'); pg.wait_for_timeout(200)
    check('the edited plan is on screen, not the example', pg.input_value('[data-path="eventName"]') == 'Edited example (fictional)')
    pg.goto(URL + '#step-sponsors'); pg.wait_for_timeout(200)
    check('the sponsor tied to the removed option says it counts for no option', 'option removed: counts for no option' in pg.eval_on_selector('[data-path="sponsorships.0.optionId"]', 'e => e.options[e.selectedIndex].text'))
    pg.goto(URL + '#results'); pg.wait_for_timeout(200)
    check('results still work', 'Regular tee times' in pg.inner_text('#app'))
    check('no page errors', not errs, errs)
    b.close()

for n, ok, det in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok or not det else f'  [{det}]'))
print(f'{sum(ok for _, ok, _ in results)}/{len(results)} checks passed')
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
