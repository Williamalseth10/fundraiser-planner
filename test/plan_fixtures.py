"""Load older fictional plans through the same backup-file picker a volunteer uses."""
import functools
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = {'golf': 'DEMO_STATE', 'gala': 'DEMO_GALA', 'auction': 'DEMO_AUCTION'}


@functools.cache
def fixture_bytes(kind):
    return subprocess.check_output(
        ['node', '-e', "process.stdout.write(JSON.stringify(require('./test/fixtures/plans')[process.argv[1]]))",
         FIXTURES[kind]],
        cwd=ROOT,
    )


def import_fixture(page, kind):
    data = fixture_bytes(kind)
    started_on_home = page.locator('.home-card').is_visible()
    if not page.is_visible('#save-panel'):
        page.click('header [data-action="toggle-save"]')
    # Reimporting a fixture can keep the same name and success message. Wait
    # for this file's own completion message before closing the panel.
    page.locator('#status').evaluate('''status => {
        window.fixtureImportDone = false;
        const observer = new MutationObserver(() => {
            if (status.textContent.includes('Plan imported')) {
                window.fixtureImportDone = true;
                observer.disconnect();
            }
        });
        observer.observe(status, {childList: true, characterData: true, subtree: true});
    }''')
    page.set_input_files('input[data-action="import-json"]', {
        'name': kind + '-fixture.json',
        'mimeType': 'application/json',
        'buffer': data,
    })
    page.wait_for_function(
        """name => JSON.parse(localStorage.getItem('bfp-plan-v1') || 'null')?.eventName === name
                  && window.fixtureImportDone""",
        arg=json.loads(data)['eventName'],
        timeout=5000,
    )
    if started_on_home:
        page.wait_for_url('**#step-event')
        page.locator('[data-path="eventName"]').wait_for()
    if page.is_visible('#save-panel'):
        page.click('header [data-action="toggle-save"]')


def choose_replacement(page):
    # The Save panel takes the organizer back to the format chooser. Replacing
    # a saved plan requires a fresh confirmation there.
    page.get_by_role('button', name='Start over with a blank plan').click()
    start = page.locator('#app [data-action="start-blank"]')
    start.click()
    start.click()
