"""Check next actions with a small phone viewport and actual browser focus."""
from copy import deepcopy
import json

from playwright.sync_api import expect

from plan_fixtures import ROOT


def check_action_focus(browser, url):
    plan = json.loads((ROOT / 'test/fixtures/golf-control-fictional.json').read_text())
    original = plan['options'][0]
    alternative = deepcopy(original)
    alternative.update(id='alternate', name='Afternoon offer', capacity=0, deposit={'amount': 1000})
    plan['options'].append(alternative)
    for group in plan['evidence'].values():
        if isinstance(group, dict) and original['id'] in group:
            group[alternative['id']] = deepcopy(group[original['id']])

    with browser.new_context(viewport={'width': 375, 'height': 667}) as context:
        page = context.new_page()
        page.goto(url)
        page.locator('header [data-action="toggle-save"]').click()
        page.locator('[data-action="import-json"]').set_input_files({
            'name': 'fictional-offers.json', 'mimeType': 'application/json', 'buffer': json.dumps(plan).encode(),
        })
        expect(page.locator('#status')).to_contain_text('Plan imported')
        page.locator('[data-nav="results"]').click()
        offer = page.locator('.club-option').filter(has=page.get_by_role('heading', name=alternative['name']))
        link = offer.get_by_role('link', name='Check capacity against the number already paid.')
        link.focus()
        link.press('Enter')
        expect(page.get_by_role('tab', selected=True)).to_contain_text(alternative['name'])
        capacity = page.locator('[data-path="options.1.capacity"]')
        expect(capacity).to_be_focused()
        expect(capacity).to_be_in_viewport()
        capacity.fill('100')
        capacity.press('Tab')

        page.locator('[data-nav="results"]').click()
        offer.get_by_role('link', name='Confirm whether the deposit', exact=False).click()
        credit = page.locator('[data-path="options.1.deposit.creditedTowardBill"]')
        expect(credit).to_be_focused()
        expect(credit).to_be_in_viewport()
        credit.select_option('true')
        page.locator('[data-nav="results"]').click()
        offer.get_by_role('link', name='Confirm whether the deposit', exact=False).press('Enter')
        refund = page.locator('[data-path="options.1.deposit.refundable"]')
        expect(refund).to_be_focused()
        expect(refund).to_be_in_viewport()
        page.reload()
        expect(refund).to_be_focused()
        stored = json.loads(page.evaluate("localStorage.getItem('bfp-plan-v1')"))
        assert stored['options'][0] == original
        assert stored['evidence'] == plan['evidence']
