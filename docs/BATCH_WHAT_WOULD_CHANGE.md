# Review batch: "What would need to change?" and contract dates (Nov 14–15, 2026)

> **Correction round (Nov 15):** two independently reproduced findings in `7678bc5` are fixed in the follow-up commit (row 82):
> 1. Preview and apply now give identical money for every option, including product options with inherited grouping. Inherited grouping is shown, never dropped.
> 2. Mixed single/group pricing is described per kind of sale, at the real marginal cost.
>
> The test totals below are updated. `TEST_RESULTS.txt` in the package names the exact corrected revision.

**Status: local review batch. Not pushed, not merged, not deployed.** Production stays at `main` `87ff527` until William approves this batch and the deployment is verified.

Baseline checked before starting:
- `main` and `origin/main` are `87ff527defae71f0ba2ecc496c28eba3d0e764ba` (merge of PR #2; implementation `4967eb5`).
- GitHub's Tests run on `87ff527` passed, and the "pages build and deployment" run for `87ff527` succeeded.
- Nothing newer exists.
- The live site couldn't be fetched from this container, because its network blocks `github.io`. The deployment was confirmed through those GitHub runs instead.
- Baseline locally: 79/79 engine tests, smoke passed, 13/13 review, clarity passed, 77/77 journey.

## What changed, and why it helps a volunteer
1. **What would need to change?** (results page, under the answers). Pick an option and a number: the low, likely or high case, or any number. You see:
   - firm money at that number;
   - how much more firm sponsorship would **break even**, and separately reach the **goal**;
   - how many people or sales would do it, but only when more of them actually raise firm money;
   - for a free or below-cost offer, it says "More … won't help here";
   - if no number up to capacity reaches the goal, it says so and gives the shortfall.

   You can also type one or two **prices** to compare at the same number. It warns that it can't know whether people would still come at that price. Paid tickets keep the money received. **Nothing changes the plan** unless you press **Use $X in my plan** and confirm. That goes through the normal edit path, so survey answers for the old price stop counting. The low, likely and high numbers are not changed.

   It also compares **every option at its own likely number**: firm money, cash needed first, loss if nobody comes or you cancel, and volunteer hours, marked "less" or "fewer". It makes no recommendation.
2. **Contract dates and terms** (quote step, per option):
   - **Fields:** quote date, quote expiry, deposit due, final headcount (or order quantity) due, last day to cancel, quote reference, and short cancellation and weather notes.
   - **Results, print and board summary:** each item is shown as known, **unknown** or **passed**, using today's **local** date. The amount owed is kept separate from the deadline.
   - **What it never does:** change the money or the status, or interpret the notes. The screen says that tiered terms and weather exceptions need a person to read them, and that a complete list doesn't make a contract safe or approved.
   - **Quote check:** changing a date or the quote reference unchecks "I have this quote in writing".
3. **Board summary:** it now starts with "Prepared [local date] … not a record of board approval" and lists each option's contract items.
4. **Save confidence:** Save & backup says "Last saved in this browser at [time]", but only after this page's own save of a change succeeded. After **Download backup file** it says the download was *started* and that the planner can't tell whether the file was kept.
5. **Price preview = applied price** (row 82). Both use one engine function. A blank group-price box keeps an existing group deal; group size, whole groups and share are never changed. A product option that inherited grouping shows it, with a warning. The "one more sale" row says which kind of sale (single or full group) loses money, instead of a blanket "each extra one loses money".
6. **Bug fixed:** the backup file name used the UTC date. At 11:30 pm on Nov 14 in Los Angeles it said `2026-11-15`; it now uses the local date.
7. **Phones:** results tables were up to 1,044px wider than the screen and couldn't be reached by keyboard. They now take focus (arrow keys scroll them) and show "Scroll the table sideways…" on phones. On phones the pinned first column wraps instead of covering the screen.

Decision log rows 77–82 give the reasons. The statuses, break-even and every existing financial rule are unchanged. `decide()` changed only the wording of one reason (row 82).

## Schema and storage
- New optional `option.contract` (see `DATA_MODEL_AND_PLAN.md`). `schemaVersion` stays **1**: the field is additive and optional.
- Older saved plans and backup files load unchanged; verified with `docs/practice-plan-fictional.json`, which has no contract field.
- A file with an impossible date (for example `2027-02-30`) or non-text notes is refused whole and changes nothing.
- **No new storage keys.** The what-if boxes, the "last saved" time and the "download started" note are on screen only.

## Tests
| Suite | Baseline `87ff527` | This batch |
|---|---|---|
| Engine (`node --test test/*.test.js`) | 79/79 | **94/94** (15 new in `test/what-would-change.test.js`) |
| `ui_smoke.py` | passed | passed |
| `ui_review.py` | 13/13 | 13/13 |
| `ui_clarity.py` | passed | passed |
| `ui_journey.py` | 77/77 | 77/77 |
| `ui_whatif.py` (new) | n/a | **100/100** |

**Fails before, passes after (new tests run against an untouched export of `87ff527`):**
- Engine: 11 of the 12 new tests fail. The control-case test passes there too, because those figures were already right; it guards them.
- `ui_whatif.py`: every section fails at its first new feature (6 of the 12 checks it reached passed; those are control figures and imports, already correct).
- The UTC file-name bug was shown directly: baseline `fundraiser-plan-2026-11-15.json`, this batch `fundraiser-plan-2026-11-14.json`.

**What `ui_whatif.py` exercises, with real clicks in fresh browser contexts (separate storage) and fictional data:**
- **The control case:** conservative $1,640, middle $5,020, optimistic $7,200; cash needed $1,800; $5,000 in hand; break-even 32; goal at 72; no separate deposit expense.
- **What-if at each case and at 50:** 50 is shown as 48, rounded down to whole foursomes, and says so.
- **Prices and applying:**
  - two typed prices: $150 with a $560 foursome price gives $1,960; $110 with no discount ($440) gives $1,400;
  - reloading discards the boxes, and the plan stays byte-identical;
  - applying a price takes two clicks; survey answers go stale; scenarios and paid money are unchanged.
- **Negative margin:** a $10 sale with $15 cost stays at 50 items, −$250, and says "won't help"; there's no headcount suggestion, and the −$500 at 100 is still named.
- **Dates:** entered by keyboard, survive a refresh, and are checked with a fixed clock at 11:30 pm Los Angeles time (deposit due "today", an expired quote, 168 days ahead). The board summary text is checked, and the backup file name uses the local date.
- **Backups:**
  - a backup file holding dates downloads, reopens identical, and restores identical;
  - an old file without dates opens fine;
  - two malformed files are refused, with no change;
  - the made-up practice file never replaces the real plan in the backup.
- **Phone, keyboard and print:**
  - 375px with no sideways page scroll; tab order through the what-if boxes; keyboard scrolling of the side-by-side table;
  - print shows the what-if panel and the contract list, but not the apply buttons.
- **Storage failure:** with browser storage refusing writes (fault injection), applying a price shows the red "Not saved" warning, and the stored copy stays the old plan.

**Not run:** real phones and tablets, Safari, Firefox, screen readers, a physical printer, zoom, and real users. The live site was not opened (blocked here). No GitHub Actions run exists for this batch, because nothing was pushed.

## Remaining limitations
- Price comparison keeps the headcount fixed. Turnout at other prices is unknowable from this data; there is no "optimal price" on purpose.
- Contract dates are a checklist. Unknown dates do **not** add to "Must verify before signing", so existing plans keep their status; whether they should is William's call (row 78). The "today" in "in 17 days" updates when the page re-renders, not at midnight.
- The what-if basis for "another number" is the break-even basis (collected and committed sponsorship, conservative cost cushion). For a chosen case it is that case's own firm sponsorship. The panel states which it used.
- On phones, the results tables still scroll sideways; a card layout is in the backlog.

## Other opportunities assessed
| # | Problem | Today | Proposal | Value | Risk | Decision |
|---|---|---|---|---|---|---|
| 1 | Deadlines (headcount, cancellation) lock in minimums | Amount owed only | Contract dates checklist | High | Low | **Done (priority 2)** |
| 2 | A wrongly dated backup looks newer than it is | UTC date in file name | Local date | Medium | Very low | **Done (bug fix)** |
| 3 | Missing costs by event type (golf: hole-in-one insurance, carts; gala: service charge on minimum; product: shipping, unsold returns) | Hints and supplier/venue questions | A short "commonly forgotten costs" checklist per event type that the organizer ticks as "included / not needed / added", never prefilled with amounts | High: omissions are the main way plans look better than they are | Low–medium: wording only, no math | **Defer: next batch, #1** |
| 4 | Treasurer wants one "decision record" with who chose what | Board summary text | An optional "organizer's preferred option" and a "decision recorded on [date] by [role]" line, never implying approval unless typed | Medium | Medium: new fields, wording around approval | Defer: #2 |
| 5 | Product sales: unsold-item returns | Treated as a minimum order | A "returnable unsold items?" yes/no with the return terms as a note | Medium | Medium: changes product math if modeled | Defer: needs a real supplier sheet first |
| 6 | Several plans at once (this year vs. last year) | One plan plus one backup | Named-plan library | Medium | **High**: storage, migration, restore | Defer: only after real use shows the need |
| 7 | Phone results tables | Scroll sideways (now keyboard reachable) | Per-option stacked cards on phones | Medium | Medium: layout and print | Defer: #3 |

## Competitors (from their own pages, by web search on Nov 14, 2026; **none of them used or tested**)
- **Zeffy:** a free ticket-price calculator. Its documented approach is (total event cost + fundraising goal) ÷ expected paid attendees, which gives a suggested price, a break-even count and three scenarios. Zeffy also publishes average ticket prices from its platform. Sources: [zeffy.com/blog/how-to-price-tickets-for-a-fundraising-event](https://www.zeffy.com/blog/how-to-price-tickets-for-a-fundraising-event), [zeffy.com/research/nonprofit-ticket-price-benchmarks](https://www.zeffy.com/research/nonprofit-ticket-price-benchmarks).
- **Givebutter:** a free event budget template (projected against actual figures, with variance) and a budgeting guide. Source: [givebutter.com/freebies/nonprofit-event-budget-template](https://givebutter.com/freebies/nonprofit-event-budget-template).
- **GolfStatus:** golf tournament management: registration and payments, sponsorship packages and invoicing, event websites, live scoring and check-in. Sources: [golfstatus.com/features](https://golfstatus.com/features), [golfstatus.com/faqs](https://golfstatus.com/faqs).

Where this planner differs, by design:
- It doesn't assume attendance to set a price.
- It handles minimum headcounts, minimum bills and non-refundable deposits.
- It keeps paid tickets at the money actually received.
- It ties survey answers to the exact offer.
- It keeps hoped-for sponsors out of firm money.
- It shows sponsorship gaps exactly and price changes only as labeled comparisons.

It does **not** do registration, payments or event-day management, and shouldn't.

## Independent verification (another reviewer)
1. Check out the review commit (its full SHA is in `TEST_RESULTS.txt` in the package) and confirm its parent is `87ff527defae71f0ba2ecc496c28eba3d0e764ba`.
2. `node --test test/*.test.js` should give 94 passed. Then run `node scripts/build.js && git diff --exit-code index.html`; there should be no diff.
3. `pip install playwright==1.56.0 && python -m playwright install chromium`, then run `test/ui_smoke.py`, `ui_review.py`, `ui_clarity.py`, `ui_whatif.py` and `ui_journey.py`. All should pass.
4. **Manual check:** Save & backup → Open a backup file → `test/fixtures/golf-control-fictional.json` → Results → What would need to change:
   - pick the Conservative case: $1,640, the goal $3,360 short, 80 players;
   - type Price A 150 and a foursome price of 560: $1,960.
5. Optional: open `test/what-would-change.test.js` against the baseline export to see the 11 failures.
