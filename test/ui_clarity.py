"""First-use wording guards: loss scope and transfer between website and file."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
url = (Path(__file__).resolve().parent.parent / 'index.html').as_uri()
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context().new_page()
    page.goto(url)
    home = page.locator('main').inner_text()
    assert 'worst case' not in home.lower(), 'Home must not promise a maximum loss'
    assert 'loss scenarios' in home
    page.get_by_role('link', name='How to use', exact=True).first.click()
    expect(page.locator('main')).to_contain_text('website and downloaded HTML file keep separate saved plans')
    guide = page.locator('main').inner_text()
    assert 'website and downloaded HTML file keep separate saved plans' in guide
    assert 'Download backup file' in guide and 'Open a backup file' in guide
    browser.close()
print('PASS first-use loss scope and website/file transfer guidance')

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context().new_page()
    page.goto(url)
    page.locator('[data-action="start-blank"]').click()
    page.goto(url + '#step-options')
    page.locator('[data-path="options.0.kind"]').select_option('product')
    page.goto(url + '#step-quote')
    page.locator('[data-path="options.0.quoteVerified"]').check()
    page.get_by_role('button', name='Use individual-item sales', exact=True).click()
    expect(page.get_by_role('button', name='Use individual-item sales', exact=True)).to_have_count(0)
    expect(page.locator('[data-path="options.0.quoteVerified"]')).not_to_be_checked()
    page.reload()
    expect(page.get_by_role('button', name='Use individual-item sales', exact=True)).to_have_count(0)
    expect(page.locator('[data-path="options.0.quoteVerified"]')).not_to_be_checked()
    browser.close()
print('PASS individual-item correction click, quote reconfirmation and refresh persistence')
