# Booster Fundraiser Planner

A free, browser-only planner that helps booster clubs, PTAs and other small volunteer groups decide whether a fundraiser (a golf outing, a run or tournament, a dinner or gala, an auction or raffle night, or a product sale) is worth committing to **before** anyone signs a contract or orders stock.

Volunteers enter real quotes, costs, sponsor commitments, money actually received and supporter-survey totals. The planner shows cash needed before the event, the loss if nobody comes or the event is canceled under the entered terms (and, when holding it could lose more, the worst point on the firm-money chart), how many sign-ups or sales are needed to break even, which assumptions matter, and what to verify before signing. "Not enough evidence to decide yet" is a normal, valid result. No result is a guarantee.

**Volunteers: start with [`docs/START_HERE.md`](docs/START_HERE.md)**, or open the planner and choose **How to use**.

The two built-in examples (a golf outing; a gala vs. a cookie dough sale) are **fictional**. Every number in them is made up.

## Use it
Open `index.html` (or `dist/booster-fundraiser-planner.html` after a build) in any modern browser. It is a single file: no install, no account, no server, no tracking, and it makes no network requests. Plans save in that browser only. Use **Save & backup → Download backup file** to keep a copy.

## How the code is organized
| Path | What it is | Edit rules |
|---|---|---|
| `src/engine.js` | All the money math. Pure functions, integer cents, no screen code. | Every change needs a test in `test/*.test.js`. |
| `src/app.js` | The website: home, 10-step wizard, results, "How to use" guide, saving, backups, import, print. | Escape everything shown on the page with `esc()`. Validate anything loaded (`validatePlan`). |
| `src/index.src.html` | Page skeleton and all CSS (light, dark, print). | System fonts only, no external requests. |
| `src/demo-data.js` | The fictional examples and the blank plan. | Keep examples labeled as made up. |
| `scripts/build.js` | Inlines the three scripts into one HTML file. | |
| `index.html`, `dist/` | **Generated.** Never edit by hand; run the build. | |
| `test/` | Engine tests (Node) and browser tests (Python + Playwright). | |
| `docs/START_HERE.md` | The volunteer guide and checklist (mirrors the in-app guide). | |
| `DECISION_LOG.md` | Why every rule and behavior is the way it is. | Add a row for each behavior change. |
| `AI_COLLABORATORS.md` | Rules for anyone (human or AI) proposing changes. | |
| `DATA_MODEL_AND_PLAN.md` | Saved-plan format, storage keys, decision order. | |

Inside `src/app.js`: `STEPS` lists the wizard steps and their `step*()` renderers; `viewHome`, `viewWizard`, `viewResults` and `viewGuide` are the pages; `renderSummary`, `renderComparison` and `renderDetail` draw the results; `surveyText` and `boardMemo` produce copyable text; `validatePlan`, `importJson`, `backupSaved` and `loadSavedPlan` protect saved work.

## Build and test
Requirements: Node 18+ (tested with 22). Browser tests also need Python 3 and Playwright for Python with Chromium (tested with Playwright 1.56.0).

```
node --test test/*.test.js     # engine tests (must pass)
node scripts/build.js          # regenerates index.html and dist/
python3 test/ui_smoke.py       # browser: every step, phone width, examples
python3 test/ui_review.py      # browser: import safety, injected markup, keyboard access
python3 test/ui_journey.py     # browser: full session, reload, backup file, restore, print, widths, dark mode
```
Optional: pass a folder to `ui_smoke.py` or `ui_journey.py` to save screenshots (and a print PDF from the journey).

CI (`.github/workflows/ci.yml`) runs the engine tests, the build and an `index.html` freshness check on every push and pull request, plus a `browser` job that runs the three browser tests on GitHub's standard free runner.

## Financial rules (summary; details and reasons in `DECISION_LOG.md`)
- **Integer cents** throughout the engine. Negative or non-numeric money inputs count as 0.
- **Firm break-even** counts only ticket or sales money plus sponsorship that is **collected** or **committed in writing**. Add-ons, other income and auction or raffle estimates appear in the low/likely/high scenarios and in a separately labeled conditional break-even, never in the firm number.
- **Cash in hand** is money actually received, entered from records, never price × people. Tickets already paid keep the amount received if the price changes.
- **In-kind donations** are never cash. They reduce only the cost they replace, up to that cost, and two gifts can't reduce one cost twice.
- **Evidence stays separate:** paid sign-ups, named "yes" answers for the current offer, anonymous "yes" and "maybe". Survey interest is never turned into predicted attendance.
- **Evidence belongs to the offer:** changing the price, group price, kind of event or survey details makes earlier answers stale until they are re-asked or explicitly confirmed.
- **Verification resets:** changing a quote number unchecks "I have this quote in writing". Changing a cost unchecks "These costs are real quotes". Changing money due before the event unchecks the treasurer's confirmation.
- **Warnings stay visible:** uncovered cash gaps, unknown cancellation terms, uncertain auction money, plans that can lose money (including when net drops again at higher counts), and plans that only work because of assumptions.
- **Statuses never say "go".** The strongest is "Supported by current evidence (not a guarantee)".

## Saved plans and safety
- Saved in the browser's local storage only. It is not a cloud backup and doesn't sync between devices.
- An example, a blank plan or an opened file first keeps the current plan as a backup; if a real plan can't be backed up, nothing is replaced. "Restore previous plan" swaps them back, only if both writes succeed.
- A failed save shows a red "Not saved" warning on every page, with Download backup file and Show plan as text (both hold the latest edits), until a save works again.
- Opened files are type-checked and dry-run before anything is replaced. A failed import changes nothing, neither the plan on screen nor the saved copy.
- A saved plan that fails the check at startup is kept aside (`bfp-plan-v1-unreadable`). If that copy can't be made, the app won't write over it and says changes aren't being saved.
- Everything displayed is escaped. Imported text can't run as code (covered by `ui_review.py`).

## Published website and future changes
The [live planner](https://williamalseth10.github.io/fundraiser-planner/) is published through GitHub Pages from `main` / root. On November 13, 2026, main was `450b3a5e5e124f3944e09963f2ffe54c35c013cc`; the successful deployment and served HTML were verified. Publication is complete; do not repeat setup.

New production changes still require William's approval. Local review changes are not live. After approval, rollback means reverting the specific approved batch on main, preserving saved-plan keys and schema. Do not disable hosting as a routine rollback.

The website and downloaded HTML file keep separate saved plans. Transfer using Download backup file and Open a backup file. Local HTML opens offline; the hosted page still needs initial first-party delivery.
