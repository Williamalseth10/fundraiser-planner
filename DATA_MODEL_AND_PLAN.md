# Data model and implementation plan

## Architecture
- `src/engine.js`: the pure, deterministic financial engine. It has no DOM, no randomness, and no AI. Money is handled in integer cents. It runs in both Node and the browser.
- `src/blank-plan.js` supplies the empty starting plan. `test/fixtures/plans.js` supplies fictional plans for automated tests. The published HTML includes only the empty starting plan.
- `src/app.js` + `src/index.src.html`: a vanilla-JS website. Home, a 10-step wizard, decision brief, full analysis, research and a volunteer guide use URL hash routes (`#home`, `#step-quote`, `#decision`, `#results`, `#research`, `#guide`). There is no framework and no runtime dependency.
- `scripts/build.js`: inlines everything into `dist/booster-fundraiser-planner.html`, a single file that opens offline by double-clicking, and copies it to `index.html` for GitHub Pages.
- Tests: `test/*.test.js` (engine, `node --test`) and `test/ui_*.py` (browser, Playwright + Chromium).

## Storage (browser only)
| Key | What |
|---|---|
| `bfp-plan-v1` | The current plan, saved after every change once the person has started a plan. |
| `bfp-plan-v1-backup` | One previous plan, kept before a new plan or opened file replaces saved work. An older imported or saved fictional plan cannot displace a real backup. "Restore previous plan" swaps the two. |
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
  evidence: { surveyResponses, surveyContacted?|null (row 87), paidRegistrations{optId:n}, paidCashReceived{optId:$|null},
              namedHighIntent{optId:n}, surveyDefinitelyAtPrice{optId:n}, surveyProbablyAtPrice{optId:n},
              offerTerms{optId: {kind, price, groupSize, groupPrice, format, date, place, included, supports}},
              surveyIssuedTerms{optId: same shape},
              offerHistory?{optId: [{ id, archivedOn, terms (as offerTerms)|null, named, definitely, probably, surveyResponses|null, surveyContacted|null }]} (row 87; past rounds, never counted) }
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
  scenarioParticipants: { conservative, middle, optimistic },
  contract?: { quoteDate, quoteExpires, depositDue, headcountDue, cancelBy: 'YYYY-MM-DD'|''|null,
               quoteSource, cancellationNotes, weatherNotes: short text }   (optional, row 78; never used in the math)
}
Sponsorship { id, label, amount, status: collected|committed|hoped, type: cash|inKind, replacesCostId?, optionId? }
research? {                                   (optional; research summaries do not supply the current financial projection)
  audiences:   [{ id, name, provenance?: observation|estimate|fictional, verification?: unchecked|checked|conflicting,
                  category: parents|alumni|businesses|golfers|community|staff|other,
                  unit: people|households|businesses|organizations|other, reach|null, contacted|null, responded|null,
                  source, sourceDate, overlapsWith:[audienceId], optionIds:[optionId], notes }],
  comparables: [{ id, name, provenance?, verification?, eventType, location, eventDate, sourceUrl, sourceRef, checkedDate,
                  sourceQuality: official|secondhand|ai|personal|unknown, format, included, pricingTier: early|regular|single|unknown,
                  priceSingle|null, priceGroup|null, groupSize|null, groupPriceBasis?: advertised|derived|unknown,
                  feesPerPerson|null, feesNote, advertisedCapacity?|null (a limit, not attendance),
                  resultAttendance|null (reported participation, not paid registrations), resultVerified (reported in writing),
                  resultNote, comparability: close|partial|not|unknown, differences (differences and limitations), optionIds:[optionId] }],
  links:       [{ id, optionId, assumption: price|groupPrice|capacity|conservative|middle|optimistic|sponsorship|costs|other,
                  researchIds:[audienceId|comparableId], note }]
}
```

**Schema note (row 78):** `contract` is optional and additive, so `schemaVersion` stays 1 and older plans and files load unchanged. Dates are calendar text (`YYYY-MM-DD`), compared as calendar days against the local date. A file with an impossible date or non-text notes is refused whole and changes nothing. The "What would need to change?" boxes and the save-time line are screen-only: they are never written to the plan or to storage.

**Batch 2 note (row 87):** `surveyContacted` and `offerHistory` are optional; past rounds are listed but never added to current answers or used by `decide()`. Entries for a removed option are kept and ignored (row 86). Engine additions: `interestFunnel`, `capacityShortcuts`, `compareAtSameTurnout`, all built on `project()`. Row 88: `compareAtSameTurnout` withholds the comparison when the two options count different things (`unitOf`), keeps `project()`'s warnings, and gives no recovery figures when costs are equal or either side is below its paid registrations.

**Batch 3 note (row 90):** optional `criteria = { minNet, maxLoss, decideBy }`. `null` or blank means not set (unknown, never met); 0 is a real value; `decideBy` is a calendar date (`YYYY-MM-DD`). Nothing is defaulted, `schemaVersion` stays 1, and plans without it open unchanged. Volunteer hours reuse `volunteerHoursAvailable` and each option's `volunteerHours`. `settings.fundraisingTarget` (a hoped-for goal) is separate from `criteria.minNet` (the smallest amount worth doing).

**Research schema note (rows 84-85):** provenance and verification are explicit; a missing provenance reads as "not recorded (older record)" and a missing verification as "not checked", and neither is ever inferred from a source or URL. In a real plan, fictional records are listed but left out of every summary. There is no combined price range: similar events are listed side by side. `research` is optional and additive, so `schemaVersion` stays 1, older plans and files load unchanged, and nothing is migrated. Every known research field is type-checked on import; a bad record refuses the whole file. Unknown extra fields are kept. References to a missing option or record are allowed and shown as broken, never dropped. Research summaries (`audienceSummary`, `comparableSummary`, `researchProblems`, `researchKind`) never read or change the money model.

## Club decision and historical records

The idea finder matches selected resources to a fixed catalogue and offers up to three formats with a first research task. Selecting a format uses the same empty option structure as the existing chooser. `recommendEvents` assesses priced options separately. It uses the existing decision brief and readiness checks, then ranks qualifying options by firm net at their own likely counts. A tied rank is shared. An alternative with missing evidence keeps the overall comparison open.

`board-questions.js` reads the current plan. The golf comparison requires two checked quotes and matching recorded paid counts and receipts. It shows the shotgun-specific sponsorship needed for parity and the gap to the minimum separately. The auction question removes one largest donated lot already counted in likely proceeds, holds the other inputs constant and compares the resulting net with the board minimum. The computed answers do not modify the saved budget.

| Optional field | Meaning |
| --- | --- |
| `options[].clubHistoryResearch.golfWeeks`, `golfAsOf`, `golf[]` | The current lead time and the date it was confirmed, plus prior dated registration checkpoints. The club compares paid counts at the same weeks out using a source and an explicit comparability choice. |
| `options[].clubHistoryResearch.lots[]` | Planned auction items, their organizer-estimated net proceeds, donated and included-in-likely flags, and per-item `comps[]` with past date, source, sold or confirmed-unsold outcome, bid and fees. Unknown fees leave the historical net unknown. |
| `options[].forecastDraft` | Event date, board’s independent net estimate, chosen prior event ID and organizer declaration that the decision is pending. Cleared when the capture succeeds. |
| `research.clubHistory[].forecast` | Frozen event name, scheduled date, pre-decision declaration, `boardNet`, prior comparator snapshot and `amounts`. Original capture date, estimated turnout and net stay on the historical record. |
| `research.clubHistory[].actualAmounts`, `actualNet`, `finalizedOn` | Final admissions or product sales, cash sponsorship, other proceeds and event costs. All four known amounts yield a net. A separately reported ledger net can stand alone. Conflicting totals must be reconciled before confirmation. |
| `research.clubHistory[].fromPriorPlan` | A completed record added from another plan backup. Its option ID is never treated as a link to the current plan. |

The forecast uses the likely `project()` result. `ticketSales + sponsorship + other − costs` equals its saved net in cents. Other includes scenario add-ons and net auction proceeds. Each actual category has a signed difference from its frozen estimate. A positive cost difference means an overrun. Editing final inputs clears their confirmation.

Scoring uses pre-decision captures with a future event date fixed at the time, a source, elapsed event and confirmed final accounts. Manually re-entered estimates and legacy snapshots without recorded decision timing remain readable. Duplicate event names on the same calendar date are withheld. The planner reports mean absolute dollar error, overestimates and sample size. Board, planner and prior-comparable errors use the same subset of events with all three frozen estimates. The browser clock, accounts, comparable selection and pre-decision declaration come from the organizer.

## Core rules (all covered by tests)
- **Feasible headcounts:** 0 up to capacity, in whole groups when required. Never rounded up. Counts below the number already paid aren't scanned.
- **Venue bill:** `max(flatFee + perParticipant × max(n, minimumParticipants), minimumSpend)`. A non-refundable credited deposit sets a floor on the bill.
- **Deposit:** always cash needed up front. Credited: part of the bill. Separate and non-refundable: an extra cost. Refundable and separate: not a cost. For a positive deposit, an unanswered credit or refund question leaves the offer open for review. A zero deposit requires neither answer. Older explicit yes/no answers retain their stored meaning.
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

- **What would need to change** (`whatWouldChange`, row 77): at one chosen number, firm money, the extra firm sponsorship for break-even and for the goal (exact, because sponsorship is the same at every number), and a headcount answer only when a higher feasible number raises firm money. Typed-in prices are compared at the same number; no price is solved for. The preview and "Use … in my plan" share `hypotheticalPrice()` (row 82): group settings are never changed, and a blank group price keeps an existing group deal. `pricingMargins()` costs a single sale and a full-group sale separately, each from the actual venue-bill change (n→n+1 and n→n+group size) plus its per-person costs (row 83). `compareOptions` puts every option at its own likely number on firm money.
- **Contract checklist** (`contractChecklist`, row 78): pure, with today's date passed in. It reports each date as unknown, upcoming, today or passed, and keeps the amount owed separate from the deadline.

## Next steps (proposed)
1. One real session: the organizer enters a real quote with someone watching (see `PILOT_KIT.md`), and you record what was confusing.
2. GitHub Pages hosts the previously approved release. Obtain William’s approval before publishing this review batch (see `README.md`).
3. Revisit cancellation dates (what is owed at each date) once a real contract shows that structure.
