"""Exercise prospective forecasting, closeout, backup and reuse with invented club accounts."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
from plan_fixtures import ROOT, fixture_bytes


def backup_file(plan):
    return {'name': 'event.json', 'mimeType': 'application/json', 'buffer': json.dumps(plan).encode()}


def field(page, path, value):
    control = page.locator(f'[data-path="{path}"]')
    control.fill(str(value))
    control.press('Tab')


def saved(page):
    return json.loads(page.evaluate("localStorage.getItem('bfp-plan-v1')"))


def load(page, plan):
    page.locator('header [data-action="toggle-save"]').click()
    page.locator('input[data-action="import-json"]').set_input_files(backup_file(plan))
    expect(page.locator('#status')).to_contain_text('Plan imported')
    if page.locator('#save-panel').is_visible():
        page.locator('header [data-action="toggle-save"]').click()
    page.locator('[data-nav="research"]').click()
    page.locator('[data-keep="outcome-editor"] > summary').click()


def clock(page, month, day):
    page.clock.set_fixed_time(datetime(2026, month, day, 16, tzinfo=timezone.utc))


def main():
    first_event = json.loads(fixture_bytes('auction'))
    # An isolated test of the real-plan flow, using only invented numbers.
    first_event.update(isDemo=False, eventName='Test spring auction')
    first_event['research'] = {'clubHistory': [
        {'id':'prior', 'optionId':'prior_option', 'name':'Test winter auction', 'kind':'auction', 'captured':False,
         'fictional':False, 'actualNet':-15.25, 'eventDate':'2025-12-01', 'finalizedOn':'2025-12-10', 'source':'Test closed ledger'}
    ]}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_BIN'))
        context = browser.new_context(timezone_id='UTC')
        page = context.new_page()
        path = Path(os.getenv('PLANNER_TEST_HTML', ROOT / 'dist' / 'booster-fundraiser-planner.html'))
        url = path.resolve().as_uri()
        clock(page, 1, 15)
        page.goto(url)
        load(page, first_event)
        draft = 'options.0.forecastDraft'
        field(page, draft + '.eventDate', '2026-03-04')
        field(page, draft + '.boardNet', '5.25')
        page.locator(f'[data-path="{draft}.priorId"]').select_option('prior')
        page.locator(f'[data-path="{draft}.preDecision"]').check()
        page.locator('[data-action="capture-club-result"]').click()
        event = saved(page)['research']['clubHistory'][1]
        assert event['forecast']['prior']['net'] == -15.25 and event['forecast']['boardNet'] == 5.25
        assert event['forecast']['eventDate'] == '2026-03-04' and event['estimatedOn'] == '2026-01-15'
        record = page.locator(f'[data-rec="{event["id"]}"]')
        expect(record).to_contain_text('Event and date locked at capture')
        expect(record.locator('[data-path$=".eventDate"]')).to_have_count(0)
        final = 'research.clubHistory.1'
        field(page, final + '.source', 'Test treasurer ledger')
        field(page, final + '.actualNet', '9.75')
        record.locator('[data-action="confirm-club-actuals"]').click()
        expect(page.locator('#status')).to_contain_text('elapsed event date')
        assert 'finalizedOn' not in saved(page)['research']['clubHistory'][1]
        clock(page, 3, 5)
        record.get_by_text('Final accounts by category', exact=True).click()
        for key, value in dict(ticketSales=20, sponsorship=0, other=-.25, costs=10).items():
            field(page, final + '.actualAmounts.' + key, value)
        record.locator('[data-action="confirm-club-actuals"]').click()
        expect(page.locator('#app')).to_contain_text('All three methods were recorded in advance for the same 1 event')
        expect(record).to_contain_text('Net from all four actual amounts: $9.75')
        field(page, final + '.actualAmounts.costs', '9')
        expect(record).to_contain_text('disagree with the reported final net')
        expect(page.locator('#app')).to_contain_text('No completed pre-decision forecasts')
        field(page, final + '.actualAmounts.costs', '10')
        record.locator('[data-action="confirm-club-actuals"]').click()
        page.locator('header [data-action="toggle-save"]').click()
        with page.expect_download() as download:
            page.locator('#save-panel [data-action="download-backup"]').click()
        portable = json.loads(Path(download.value.path()).read_text())
        assert portable['research']['clubHistory'][1]['forecast'] == event['forecast']
        # The board also considered a different option for this same named and dated event.
        # Keep its proposal in the backup, with no final result. Only the held event should transfer.
        unused = {**portable['research']['clubHistory'][1], 'id': 'unchosen', 'optionId': 'alt'}
        for key in ['finalizedOn', 'actualNet', 'actualCount', 'actualAmounts', 'source']:
            unused.pop(key, None)
        portable['research']['clubHistory'].append(unused)
        other_context = browser.new_context(timezone_id='UTC')
        other = other_context.new_page()
        clock(other, 3, 5)
        other.goto(url)
        next_event = {**first_event, 'eventName':'Test next auction', 'research':{}}
        load(other, next_event)
        chooser=other.locator('[data-action="import-club-outcomes"]')
        chooser.set_input_files(backup_file(portable))
        expect(other.locator('#status')).to_contain_text('2 completed event record(s) added')
        expect(other.locator('#app')).to_contain_text('same 1 event')
        gained = saved(other)
        assert gained['eventName'] == next_event['eventName'] and gained['evidence'] == next_event['evidence']
        assert all(r['fromPriorPlan'] for r in gained['research']['clubHistory'])
        chooser.set_input_files(backup_file(portable))
        expect(other.locator('#status')).to_contain_text('No new completed club events')
        assert saved(other) == gained
        other.reload()
        expect(other.locator('#app')).to_contain_text('same 1 event')
        browser.close()
    print('PASS: pre-decision capture, matched baselines, final amounts, date guard, reconciliation, backup, duplicate-safe carry-forward and reload')


if __name__ == '__main__':
    main()
