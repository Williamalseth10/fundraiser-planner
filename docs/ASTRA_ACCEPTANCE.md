# Fundraiser Planner acceptance — current report, November 13, 2026

## Outcome
Live save/recovery acceptance substantially advanced using a separate cloud Chrome profile. A real product-sale usability defect was found and corrected locally. This candidate is not published; final local browser regression acceptance remains incomplete. Do not read the earlier report as current coverage: it is preserved as ASTRA_ACCEPTANCE_FIRST_PASS_HISTORICAL.md.

Production baseline: main 450b3a5e5e124f3944e09963f2ffe54c35c013cc, served HTML previously verified byte-identical, implementation 06fcff5791a1b3a29c06cf4e39814813e5967672. No push, merge, PR or hosting changes were made. This batch includes the earlier 8091d4d wording/doc changes.

## New live checks actually completed
A remote cloud Chrome profile was used instead of the user's normal connected Chrome profile. The initial home showed no saved-plan Continue action; Save & backup explicitly showed no previous backup. Only disposable fictional data was entered. Another ordinary tab was not treated as isolation.

- Started a blank plan; visited all ten wizard screens (including product-specific supplier, price, costs, sponsors, survey, evidence, scenarios and volunteer wording).
- Named plan ASTRA FICTIONAL product control; confirmed the exact name survived refresh.
- Exported current JSON through Show plan as text and inspected its fields.
- Loaded the golf example through its two-click confirmation. The original test plan was shown as the retained backup.
- Restored that plan through confirmation. Its full exported JSON exactly equaled the original; the golf example became the backup.
- Downloaded a backup through the hosted HTTPS site. Reopened that actual downloaded file through Open a backup file. The app reported Plan imported, and full exported JSON again matched the original exactly. This checks the file outcome, not just button visibility.
- Copied board summary and read clipboard text. The summary included the higher-loss warning and the current plan values.
- Changed group size through existing golf controls as a diagnostic setup, then returned to product type. Quote verification reset and old group-offer evidence became stale. Entered one fictional response and explicitly reconfirmed the fictional current offer.
- Exact loss control then showed High financial risk, likely -$250, high -$500, and 'Holding it can lose more: at 100 items ... -$500.' Price $10, supplier $15, capacity 100, low 0/likely 50/high 100; no fixed costs, deposit, minimum, sponsors, add-ons, other income or contingency; cancellation explicitly 0; individual-item group size 1.
- Light-mode desktop screenshot was observed for this control. Earlier baseline live-home screenshot is included in the package. The cloud control screenshot was displayed in the conversation, but no durable image file was exported for the package.

Cloud automation's locator fill changed DOM values without committing app change events. Those attempts were discarded as test evidence. Native keyboard entry plus Tab was used and saved values were verified after navigation/export. One file-chooser operation took several minutes but eventually completed; its result was verified before proceeding.

## Defect P1 (medium): hidden inherited group settings in product sales
Reproduction on LIVE baseline:
1. Start blank (default golf option); change kind to Product sale.
2. Enter selling price 10, supplier cost 15, capacity 100, likely sales 50, high sales 100.
3. Results use 48 likely items and -$240 because groupSize=4 and wholeGroupsOnly=true remain from golf. Product UI hides those controls.
4. JSON export confirms those settings. The result table notes rounding down, but the product UI offers no direct way to correct it. Group pricing can also carry over invisibly.
This can understate losses or distort counts. The existing $500 higher-loss warning is correct; this is a separate UI configuration problem, not an engine arithmetic change.

Local correction: supplier step warns when a product option retains grouping and offers 'Use individual-item sales'. It is an explicit user action, not a silent migration. The action sets group size 1, whole-groups-only false, group price null and group share 0; it leaves costs, individual price and counts intact, unchecks quote verification and uses existing evidence invalidation. Results also warn and link to the supplier step. Existing legitimate group settings are preserved until the organizer acts. No schema/key or engine change.

The earlier loss-scope wording and website/file transfer guidance remain in this batch. No new framework, dependency, service, account, analytics or runtime AI.

## Validation
- 79 Node tests passed: original 77 plus two source-level UI regressions.
- New regression harness executes actual app render/recovery functions in a Node VM without browser startup. It checks warning/action availability, individual-item counting, preservation of prices/costs, cleared group pricing and stale evidence. This is not a browser click test.
- Before-fix run fails; after-fix run passes. Full logs included. Baseline lacks the recovery helper; the first before-fix failure is the missing warning and the second cannot invoke that absent helper.
- Build and syntax checks pass. Final clean export is rebuilt and compared with committed index.html; see TEST_RESULTS.txt for exact commit and logs.
- Earlier 77-test results, current live outcomes and source-level tests are distinct. No new GitHub CI run was triggered.

## Remaining limitations / release gate
Local Chromium remains unavailable: bundled executable missing, browser download was invalid, and system Chromium launch failed with 'socket() failed: Operation not permitted (1)'. No bypass attempted. Full local smoke/review/journey and new UI clarity browser test have not run. The new product recovery button has not been clicked in a browser running this local candidate.

Still incomplete: local candidate visual/keyboard regression checks, malformed imports, storage-write fault injection, gala example journey this session, full golf option-by-option Next/Back journey, full survey-copy validation, responsive candidate checks, zoom, real devices, assistive technology and real-user practice. Live Print was clicked but no preview became inspectable, so print acceptance is NOT passed. No physical printing. Network/privacy coverage is not exhaustive; observed cloud error logs were from a chrome-extension metadata sender, not demonstrated app exceptions.

Recommendation: preserve current production. The critical normal save/download/import/restore flows now have live outcome evidence, but complete the candidate's browser tests before asking to publish it. Mom's real usability session and checking an actual course quote remain necessary; automated testing is not a real financial recommendation.

## Recovery / handoff
Package contains standalone app, matching generated HTML, full source/tests/docs, fictional practice JSON, current report, truthful test results, patch and prior screenshot. Original packages are preserved separately. Review the diff from baseline 450b3a5 before any approved publication. Rollback is return/revert to that baseline without changing storage keys or disabling hosting. New production changes still require William's separate batch approval.
