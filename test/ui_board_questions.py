"""Check the board's two event-specific questions on screen, in copies, and in print."""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from plan_fixtures import ROOT, fixture_bytes


def exercise(browser, path, plan, expected):
    context = browser.new_context(viewport={"width": 375, "height": 812})
    page = context.new_page()
    # Capture a copy through the button's normal handler without accessing a real clipboard.
    page.add_init_script("""Object.defineProperty(navigator, 'clipboard', {
      value: {writeText: async (text) => { window.testCopy = text; }}})""")
    page.goto(path.as_uri())
    page.click('header [data-action="toggle-save"]')
    page.set_input_files('input[data-action="import-json"]', {
        'name': 'fictional.json', 'mimeType': 'application/json', 'buffer': json.dumps(plan).encode(),
    })
    expect(page.locator('[data-path="eventName"]')).to_have_value(plan['eventName'])
    if page.is_visible('#save-panel'):
        page.click('header [data-action="toggle-save"]')
    page.locator('[data-nav="results"]').click()
    question = page.locator('.board-question').first
    expect(question).to_contain_text(expected)
    lines = question.locator('li').all_text_contents()
    assert lines and page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('[data-action="copy-brief"]').click()
    assert all(line in page.evaluate('window.testCopy') for line in lines)
    page.emulate_media(media='print')
    expect(question).to_be_visible()
    assert question.locator('li').all_inner_texts() == lines
    page.emulate_media(media='screen')
    page.locator('[href="#results"]').filter(has_text='Full analysis').click()
    page.locator('[data-action="copy-memo"]').click()
    assert all(line in page.evaluate('window.testCopy') for line in lines)
    context.close()


def main():
    local_html = Path(os.getenv('PLANNER_TEST_HTML', ROOT / 'dist' / 'booster-fundraiser-planner.html')).resolve()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_BIN'))
        golf = json.loads(fixture_bytes('golf'))
        golf['options'] = golf['options'][:2]
        for option in golf['options']:
            option.update(quoteVerified=True, costsVerified=True)
            golf['evidence']['paidRegistrations'][option['id']] = 8
        golf['evidence']['paidCashReceived'] = {'tee': 970.25, 'shotgun': 970.25}
        exercise(browser, local_html, golf, 'At 8 paid golfers and $970.25 in ticket receipts')
        auction = json.loads(fixture_bytes('auction'))
        option = auction['options'][0]
        option['clubHistoryResearch'] = {'lots': [
            {'id': 'seats', 'name': 'Donated tickets', 'donated': True, 'estimatedNet': 900, 'includedInLikely': True},
            {'id': 'gear', 'name': 'Club kit', 'donated': True, 'estimatedNet': 600, 'includedInLikely': True},
        ]}
        auction['criteria'] = {'minNet': 500}
        exercise(browser, local_html, auction, '$200 below the $500 board minimum')
        browser.close()
    print('Golf and auction questions match the copied brief, full board summary and mobile print view.')


if __name__ == '__main__':
    main()
