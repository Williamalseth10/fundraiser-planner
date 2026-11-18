"""The two close golf offers must use the same ranking basis on screen, in print and in the copy."""
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from plan_fixtures import ROOT


def check_figures(page):
    expect(page.locator('.recommendation .sum-title')).to_contain_text('Take Offer A')
    for name, comparison, scenario in [('Offer A', '$4,150', '$4,150'), ('Offer B', '$4,130', '$4,180')]:
        card = page.locator('.club-option').filter(has=page.get_by_role('heading', name=name, exact=True))
        primary = card.locator('.comparison-net strong')
        expect(primary).to_be_visible()
        expect(primary).to_contain_text(comparison)
        label = card.locator('dt').filter(has_text=re.compile(r'^Likely scenario net$', re.I))
        expect(label.locator('xpath=following-sibling::dd[1]')).to_have_text(scenario)
    offer_b = page.locator('.club-option').filter(has=page.get_by_role('heading', name='Offer B', exact=True))
    expect(offer_b).to_contain_text(re.compile(r'cushion[^.]*\$0[^.]*\$50', re.I))


def main():
    html = Path(os.getenv('PLANNER_TEST_HTML', ROOT / 'dist' / 'booster-fundraiser-planner.html')).resolve()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_BIN'))
        context = browser.new_context(viewport={'width': 375, 'height': 812})
        page = context.new_page()
        page.add_init_script("""Object.defineProperty(navigator, 'clipboard', {
          value: {writeText: async (text) => { window.testCopy = text; }}})""")
        page.goto(html.as_uri())
        page.locator('header [data-action="toggle-save"]').click()
        page.locator('input[data-action="import-json"]').set_input_files(
            ROOT / 'test' / 'fixtures' / 'close-golf-offers-fictional.json')
        expect(page.locator('#status')).to_contain_text('Plan imported')
        page.locator('[data-nav="results"]').click()
        check_figures(page)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.locator('[data-action="copy-brief"]').click()
        page.wait_for_function("typeof window.testCopy === 'string'")
        text = page.evaluate('window.testCopy')
        assert 'Take Offer A' in text
        assert re.search(r'comparison net[^\n]*\$4,130', text, re.I)
        assert re.search(r'likely scenario net[^\n]*\$4,180', text, re.I)
        assert re.search(r'cushion[^.]*\$0[^.]*\$50', text, re.I)
        page.emulate_media(media='print')
        check_figures(page)
        browser.close()
    print('Close golf offers use the same comparison net on screen, in the copy and in print.')


if __name__ == '__main__':
    main()
