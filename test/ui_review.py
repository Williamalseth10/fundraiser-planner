# Browser regression checks for the ChatGPT review (F2, F3, F4, F5 card, F9, F10). Run after `node scripts/build.js`:
#   python3 test/ui_review.py
# Uses only synthetic data. The script-injection check sets a harmless local flag; nothing leaves the page.
import sys, json, pathlib
from playwright.sync_api import sync_playwright

page_path = pathlib.Path(__file__).resolve().parent.parent / 'dist' / 'booster-fundraiser-planner.html'
URL = page_path.as_uri()
results = []
def check(name, cond): results.append((name, bool(cond)))

def plan(**over):
    """A complete, valid plan (the reviewer's fixture), with overrides applied by dotted path."""
    sc = lambda label: {'label': label, 'statuses': ['collected', 'committed'], 'extraRevenuePerParticipant': 0, 'otherRevenue': 0, 'costContingencyPct': 0}
    p = {
        'schemaVersion': 1, 'isDemo': False, 'eventName': 'Synthetic plan',
        'settings': {'fundraisingTarget': 0, 'volunteerHourValue': None}, 'volunteerHoursAvailable': 10,
        'snapshot': {'format': 'Synthetic scramble', 'dateWindow': 'Synthetic date', 'locationArea': 'Synthetic area', 'included': 'Synthetic lunch', 'beneficiary': 'Synthetic club', 'fallbackPrice': ''},
        'scenarioSettings': {'conservative': sc('Conservative'), 'middle': sc('Middle'), 'optimistic': sc('Optimistic')},
        'options': [{'id': 'golf', 'name': 'Synthetic golf', 'kind': 'golf_tee_times', 'capacity': 20, 'groupSize': 1, 'wholeGroupsOnly': False,
                     'price': 100, 'groupPrice': None, 'groupShare': 0,
                     'venueQuote': {'flatFee': 1000, 'perParticipant': 0, 'minimumParticipants': 0, 'minimumSpend': 0},
                     'deposit': {'amount': 0, 'creditedTowardBill': True, 'refundable': False},
                     'perParticipantCosts': [], 'fixedCosts': [], 'volunteerHours': 0, 'cancellationOwed': 0,
                     'quoteVerified': True, 'costsVerified': True, 'scenarioParticipants': {'conservative': 10, 'middle': 10, 'optimistic': 20}}],
        'sponsorships': [],
        'evidence': {'surveyResponses': 10, 'paidRegistrations': {'golf': 1}, 'paidCashReceived': {'golf': 100},
                     'namedHighIntent': {'golf': 0}, 'surveyDefinitelyAtPrice': {'golf': 0}, 'surveyProbablyAtPrice': {'golf': 0}},
    }
    for path, v in over.items():
        o = p; ks = path.split('.')
        for k in ks[:-1]: o = o[int(k)] if isinstance(o, list) else o[k]
        o[ks[-1]] = v
    return p

def fresh(b, width=1200):
    pg = b.new_context(viewport={'width': width, 'height': 900}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.click('[data-demo="golf"]'); pg.wait_for_function("location.hash === '#step-event'")
    return pg, errs

def import_plan(pg, text):
    if not pg.is_visible('#save-panel'): pg.click('[data-action="toggle-save"]')
    pg.set_input_files('input[data-action="import-json"]', files=[{'name': 'p.json', 'mimeType': 'application/json', 'buffer': text.encode()}])
    pg.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch()

    # F2: editing "maybe" must not confirm older, unrecorded named answers
    pg, errs = fresh(b)
    import_plan(pg, json.dumps(plan(**{'evidence.namedHighIntent': {'golf': 9}})))
    pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(60)
    pg.fill('input[data-path="evidence.surveyProbablyAtPrice.golf"]', '1'); pg.press('input[data-path="evidence.surveyProbablyAtPrice.golf"]', 'Tab'); pg.wait_for_timeout(80)
    st = pg.evaluate("JSON.parse(localStorage.getItem('bfp-plan-v1'))")
    check('F2: editing "maybe" does not record terms for older unrecorded answers', not (st['evidence'].get('offerTerms') or {}).get('golf'))
    check('F2: older answers still shown as needing confirmation', pg.locator('[data-terms="golf"].warn-callout').count() == 1)
    pg.close()

    # F2b: answers entered for the first time use the terms the survey was copied with, not today's
    pg, errs = fresh(b)
    import_plan(pg, json.dumps(plan(**{'options.0.price': 50})))
    pg.goto(URL + '#step-survey'); pg.wait_for_timeout(60)
    pg.click('[data-action="copy-survey"]'); pg.wait_for_timeout(60)            # survey sent at $50
    pg.goto(URL + '#step-prices'); pg.wait_for_timeout(60)
    pg.fill('input[data-path="options.0.price"]', '100'); pg.press('input[data-path="options.0.price"]', 'Tab'); pg.wait_for_timeout(80)
    pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(60)
    pg.fill('input[data-path="evidence.namedHighIntent.golf"]', '9'); pg.press('input[data-path="evidence.namedHighIntent.golf"]', 'Tab'); pg.wait_for_timeout(80)
    check('F2b: answers to a $50 survey are stale against a $100 offer', pg.locator('[data-terms="golf"].warn-callout').count() == 1)
    pg.close()

    # F3: imported text must never run as code (rejected at import, and escaped if it gets in another way)
    pg, errs = fresh(b)
    payload = '<img src=x onerror="window.__reviewCanary=1">'
    import_plan(pg, json.dumps(plan(**{'evidence.namedHighIntent': {'golf': payload}})))
    check('F3: import with markup in a count is rejected', 'Could not import' in pg.inner_text('#status'))
    pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(80)
    check('F3: canary not set after rejected import', not pg.evaluate('window.__reviewCanary === 1'))
    bad = plan(**{'evidence.namedHighIntent': {'golf': payload}, 'eventName': payload, 'options.0.name': payload})
    pg.evaluate("p => localStorage.setItem('bfp-plan-v1', JSON.stringify(p))", bad)   # simulate a tampered saved plan
    pg.reload(); pg.wait_for_timeout(100)
    for h in ['#step-scenarios', '#step-evidence', '#results', '#step-options']:
        pg.goto(URL + h); pg.wait_for_timeout(80)
    check('F3: a tampered saved plan never runs injected code', not pg.evaluate('window.__reviewCanary === 1'))
    pg.close()

    # F4: an import that fails must leave the plan and the saved copy exactly as they were
    pg, errs = fresh(b)
    pg.goto(URL + '#results'); pg.wait_for_timeout(80)
    before = pg.evaluate("localStorage.getItem('bfp-plan-v1')")
    broken = plan(eventName='BROKEN IMPORT'); broken['evidence']['surveyResponses'] = {'toString': None}
    import_plan(pg, json.dumps(broken))
    check('F4: broken import reported as failed', 'Could not import' in pg.inner_text('#status'))
    check('F4: saved plan unchanged after failed import', pg.evaluate("localStorage.getItem('bfp-plan-v1')") == before)
    pg.goto(URL + '#results'); pg.wait_for_timeout(80)
    check('F4: results still render after failed import', 'BROKEN IMPORT' not in pg.inner_text('#app') and not errs)
    pg.close()

    # F5: the main cash card uses firm money; a hoped-for in-kind gift doesn't erase the requirement
    pg, errs = fresh(b)
    p5 = plan(**{'options.0.venueQuote.flatFee': 0,
                 'options.0.fixedCosts': [{'id': 'prizes', 'label': 'Prizes', 'amount': 1000, 'paidUpfront': True}],
                 'sponsorships': [{'id': 'maybe', 'label': 'Maybe prizes', 'type': 'inKind', 'status': 'hoped', 'amount': 1000, 'replacesCostId': 'prizes', 'optionId': ''}]})
    p5['scenarioSettings']['middle']['statuses'].append('hoped')
    import_plan(pg, json.dumps(p5))
    pg.goto(URL + '#results'); pg.wait_for_timeout(80)
    card = pg.locator('.card', has_text='Cash needed before event day').first.inner_text()
    check('F5: cash card shows the firm $1,000 requirement', '$1,000' in card)
    pg.close()

    # F9: "use my survey numbers" ignores stale answers
    pg, errs = fresh(b)
    import_plan(pg, json.dumps(plan(**{'options.0.price': 50, 'evidence.namedHighIntent': {'golf': 9}, 'evidence.paidCashReceived': {'golf': 50}})))
    pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(60)
    pg.click('[data-action="confirm-terms"][data-i="0"]'); pg.click('[data-action="confirm-terms"][data-i="0"]'); pg.wait_for_timeout(60)  # answers at $50
    pg.goto(URL + '#step-prices'); pg.wait_for_timeout(60)
    pg.fill('input[data-path="options.0.price"]', '100'); pg.press('input[data-path="options.0.price"]', 'Tab'); pg.wait_for_timeout(80)
    pg.goto(URL + '#step-scenarios'); pg.wait_for_timeout(60)
    pg.click('[data-action="fill-evidence"]'); pg.wait_for_timeout(60)
    check('F9: likely case uses paid + current answers only (1)', pg.input_value('input[data-path="options.0.scenarioParticipants.middle"]') == '1')
    pg.close()

    # F10: keyboard users can reach the import control
    pg, errs = fresh(b)
    pg.click('[data-action="toggle-save"]'); pg.focus('[data-action="export"]'); pg.keyboard.press('Tab')
    check('F10: Tab after Export reaches the plan import control', pg.evaluate("document.activeElement.dataset.action") == 'import-json')
    pg.goto(URL + '#step-evidence'); pg.wait_for_timeout(60)
    pg.click('#app details.qs summary >> text=Import counts')
    check('F10: CSV import control is focusable', pg.evaluate("(() => { const i = document.querySelector('input[data-action=\"import-csv\"]'); i.focus(); return document.activeElement === i; })()"))
    pg.close()

    b.close()

for n, c in results: print(('PASS ' if c else 'FAIL ') + n)
sys.exit(0 if all(c for _, c in results) else 1)
