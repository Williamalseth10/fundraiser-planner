# Data model and implementation plan

## Architecture
- `src/engine.js`: the pure, deterministic financial engine. It has no DOM, no randomness, and no AI. Money is handled in integer cents. It runs in both Node and the browser.
- `src/demo-data.js`: the two **fictional** examples (golf; gala vs. product sale) and a blank plan.
- `src/app.js` + `src/index.src.html`: a vanilla-JS website. Home, a 10-step wizard, results, and a "How to use" guide, switched by the URL hash (`#home`, `#step-quote`, `#results`, `#guide`). There is no framework and no runtime dependency.
- `scripts/build.js`: inlines everything into `dist/booster-fundraiser-planner.html`, a single file that opens offline by double-clicking, and copies it to `index.html` for GitHub Pages.
- Tests: `test/*.test.js` (engine, `node --test`) and `test/ui_*.py` (browser, Playwright + Chromium).

## Storage (browser only)
| Key | What |
|---|---|
| `bfp-plan-v1` | The current plan, saved after every change once the person has started a plan. |
| `bfp-plan-v1-backup` | One previous plan, kept automatically before an example, a blank plan or an opened file replaces the current one. Example plans never overwrite a real backup. "Restore previous plan" swaps the two. |
| `bfp-plan-v1-backup-at` | When the backup was kept. |
| `bfp-plan-v1-unreadable` | A saved plan that failed the safety check at startup, kept aside so later typing can't overwrite it. |

Every write reports whether it worked. A failed save shows a red "Not saved" warning until a save succeeds; replacing a real plan requires its backup to be written first; restore changes the plan only if both writes succeed. If an unreadable plan can't be copied aside, its key is locked and never written over (row 73).

Nothing is sent anywhere. The page makes no network requests. Backups the person controls are JSON files they download.

## State (exported as JSON, `schemaVersion: 1`)
```
Plan {
  isDemo, eventName,
  settings: { fundraisingTarget, volunteerHourValue|null },
  volunteerHoursAvailable|null,
  snapshot: { format, dateWindow, locationArea, included, beneficiary, fallbackPrice },
  scenarioSettings: { conservative|middle|optimistic: {
      label, statuses: ['collected'|'committed'|'hoped'], extraRevenuePerParticipant, otherRevenue, costContingencyPct } },
  options: [ EventOption ],
  sponsorships: [ Sponsorship ],
  evidence: { surveyResponses, paidRegistrations{optId:n}, paidCashReceived{optId:$|null},
              namedHighIntent{optId:n}, surveyDefinitelyAtPrice{optId:n}, surveyProbablyAtPrice{optId:n},
              offerTerms{optId: {kind, price, groupSize, groupPrice, format, date, place, included, supports}},
              surveyIssuedTerms{optId: same shape} }
}
EventOption {
  id, name, kind: golf_tee_times|golf_shotgun|participation|ticketed|auction|product|generic,
  capacity, groupSize, wholeGroupsOnly,
  price, groupPrice|null, groupShare (0..1)   (older plans: foursomePrice/foursomeShare, migrated on load),
  scenarioProceeds { conservative, middle, optimistic } (auction/raffle estimates; never in break-even), cancellationOwed|null,
  venueQuote: { flatFee, perParticipant, minimumParticipants, minimumSpend },
  deposit: { amount, creditedTowardBill, refundable },
  perParticipantCosts: [{id,label,amount}], fixedCosts: [{id,label,amount,paidUpfront}],
  volunteerHours, quoteVerified, costsVerified, upfrontFundingConfirmed,
  scenarioParticipants: { conservative, middle, optimistic }
}
Sponsorship { id, label, amount, status: collected|committed|hoped, type: cash|inKind, replacesCostId?, optionId? }
```

## Core rules (all covered by tests)
- **Feasible headcounts:** 0 up to capacity, in whole groups when required. Never rounded up. Counts below the number already paid aren't scanned.
- **Venue bill:** `max(flatFee + perParticipant × max(n, minimumParticipants), minimumSpend)`. A non-refundable credited deposit sets a floor on the bill.
- **Deposit:** always cash needed up front. Credited: part of the bill. Separate and non-refundable: an extra cost. Refundable and separate: not a cost.
- **In-kind:** never revenue. It reduces only the one-time cost it replaces, up to that cost's amount, never below zero.
- **Money inputs:** negative or non-numeric values count as 0 in the engine.
- **Firm money** (`firmContext`): ticket money (money actually received for tickets already paid, plus the current price for the rest) and collected or committed sponsorship and in-kind, with the conservative cost cushion. No add-ons, other income or auction estimates. Used for break-even, the target, the chart and the cash-needed card.
- **Exposure** (`decide().exposure`): cash needed before the event and the shortfall against cash in hand (firm basis); loss if nobody comes; loss if canceled after the deadline (amount owed + costs already paid; `null` when not entered); `largestLoss`, the larger of those two cases only, which is **not** a maximum; and `worstOnChart`, the lowest point of the firm-money chart, shown when holding the event could lose more (row 74).
- **Decision**, checked in this order:
  1. Firm money can't cover costs even at capacity, but the organizer's low-case assumptions would → **High financial risk**.
  2. Firm money can't cover costs even at capacity → **Not viable as currently configured**.
  3. No written quote, or no evidence at all → **Not enough evidence to decide yet**.
  4. Break-even > paid + named "yes" answers for the current offer → **Not enough evidence to decide yet**.
  5. Net falls below zero again above break-even → **High financial risk**.
  6. The conservative scenario loses money → **High financial risk**.
  7. Firm money loses money at the low number (only assumptions make it positive) → **High financial risk**.
  8. Otherwise: **Numbers hold up so far, but open items remain** if anything is on the must-verify list, else **Supported by current evidence (not a guarantee)**.

## Next steps (proposed)
1. One real session: the organizer enters a real quote with someone watching (see `PILOT_KIT.md`), and you record what was confusing.
2. Publish only with William's approval (see `README.md`, "Publishing").
3. Revisit cancellation dates (what is owed at each date) once a real contract shows that structure.
