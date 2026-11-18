"""Follow the live UI from a possible format to a decision for an unpriced event."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from plan_fixtures import ROOT
from ui_action_focus import check_action_focus


def check_golf_deposit(browser, url):
    plan = json.loads((ROOT / 'test' / 'fixtures' / 'golf-control-fictional.json').read_text())
    plan['criteria'] = {'minNet': 3000, 'maxLoss': 10000, 'decideBy': '2026-11-22'}
    a = plan['options'][0]
    a['name'] = 'Offer A'
    a['contract'] = {'quoteDate': '2026-11-13', 'quoteExpires': '2026-12-01', 'quoteSource': 'Fictional quote'}
    b = deepcopy(a)
    b.update(id='second', name='Offer B')
    b['fixedCosts'][0]['amount'] += 500
    plan['options'].append(b)
    a['deposit'] = {'amount': 1000}
    for field in plan['evidence'].values():
        if isinstance(field, dict) and a['id'] in field:
            field['second'] = deepcopy(field[a['id']])
    context = browser.new_context(timezone_id='UTC')
    page = context.new_page()
    page.clock.set_fixed_time(datetime(2026, 11, 18, 12, tzinfo=timezone.utc))
    page.goto(url)
    page.locator('header [data-action="toggle-save"]').click()
    page.locator('input[data-action="import-json"]').set_input_files({
        'name': 'fictional-offers.json', 'mimeType': 'application/json', 'buffer': json.dumps(plan).encode(),
    })
    expect(page.locator('[data-path="eventName"]')).to_have_value(plan['eventName'])
    if page.locator('#save-panel').is_visible():
        page.locator('header [data-action="toggle-save"]').click()
    page.locator('[data-nav="results"]').click()
    expect(page.locator('.recommendation')).to_contain_text('deposit', ignore_case=True)
    page.goto(url + '#step-quote/golf')
    credit = page.locator('[data-path="options.0.deposit.creditedTowardBill"]')
    refund = page.locator('[data-path="options.0.deposit.refundable"]')
    expect(credit).to_have_value('')
    expect(refund).to_have_value('')
    refund.select_option('false')
    for answer, winner, net in [('false', 'Offer B', '$4,520'), ('true', 'Offer A', '$5,020')]:
        credit.select_option(answer)
        page.locator('[data-path="options.0.quoteVerified"]').check()
        page.locator('[data-nav="results"]').click()
        panel = page.locator('.recommendation')
        expect(panel).to_contain_text('Take ' + winner + ' to the board for review')
        expect(panel).to_contain_text(net)
        page.goto(url + '#step-quote/golf')
    page.reload()
    expect(credit).to_have_value('true')
    expect(refund).to_have_value('false')
    saved = json.loads(page.evaluate("localStorage.getItem('bfp-plan-v1')"))
    assert saved['evidence'] == plan['evidence']
    context.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_BIN'))
        context = browser.new_context(viewport={'width': 375, 'height': 812})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        html = Path(os.getenv('PLANNER_TEST_HTML', ROOT / 'dist' / 'booster-fundraiser-planner.html'))
        url = html.resolve().as_uri()
        page.goto(url)
        page.locator('main a[href="#ideas"]').first.click()
        expect(page.get_by_role('heading', name='Find a fundraiser to explore')).to_be_visible()
        page.locator('[data-idea-signal="donations"]').check()
        auction = page.locator('[data-action="choose-event-idea"][data-kind="auction"]')
        expect(auction).to_be_visible()
        assert page.evaluate("localStorage.getItem('bfp-plan-v1')") is None
        auction.click()
        expect(page.locator('#step-title')).to_be_visible()
        page.locator('[data-nav="results"]').click()
        expect(page.locator('#club-choice')).to_be_visible()
        expect(page.locator('.recommendation')).to_contain_text('Gather evidence before choosing')
        page.reload()
        expect(page.locator('.recommendation')).to_contain_text('Gather evidence before choosing')
        plan = json.loads(page.evaluate("localStorage.getItem('bfp-plan-v1')"))
        assert len(plan['options']) == 1 and plan['options'][0]['kind'] == 'auction'
        assert all(value is None for value in plan['options'][0]['scenarioParticipants'].values())
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.emulate_media(media='print')
        expect(page.locator('#club-choice')).to_be_visible()
        assert not errors, errors
        print('Event finder → blank auction → evidence request → reopen and print passed.')
        check_action_focus(browser, url)
        print('Phone and keyboard actions focus the matching option, capacity and first unanswered deposit term.')
        check_golf_deposit(browser, url)
        print('Missing, confirmed and reopened golf deposit answers passed.')
        browser.close()


if __name__ == '__main__':
    main()
