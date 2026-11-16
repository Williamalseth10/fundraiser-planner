# Research, interest and "Ready to commit?": implementation plan

Baseline: `main` `15b988fe0422df6aa1e83b7282b6a4f07a01848d` (PR #3; same files as the reviewed `323a1bd`). **Batch 1 is implemented in this branch. Batches 2 and 3 are plans only.** Nothing is published.

Principles across all three batches:
- Research is a record of what the organizer found out. **It never changes a number, a status or the evidence counts** unless the organizer explicitly applies something (Batch 2), through the same edit paths and invalidation rules as typing it.
- No attendance prediction, no conversion rates, no willingness-to-pay curve, no probability of success, and no "recommended price".
- Unknown stays unknown (`null`), never 0.
- Browser-only, integer cents, `schemaVersion` 1 with additive optional fields.

## Batch 1: Research records (implemented)
### Data model (optional `plan.research`; older plans need none)
```
research: {
  audiences:   [{ id, name, category, unit, reach|null, contacted|null, responded|null, basis, source, sourceDate,
                  overlapsWith:[audienceId], optionIds:[optionId], notes }],
  comparables: [{ id, name, eventType, location, eventDate, sourceUrl, sourceRef, checkedDate, sourceQuality,
                  format, included, pricingTier, priceSingle|null, priceGroup|null, groupSize|null, feesPerPerson|null,
                  feesNote, resultAttendance|null, resultVerified, resultNote, comparability, differences, optionIds:[optionId] }],
  links:       [{ id, optionId, assumption, researchIds:[audienceId|comparableId], note }]
}
```
- **Engine (pure, no DOM):** `audienceSummary`, `comparableSummary`, `researchProblems`, `researchKind`. They never read or write the money model, and `decide()` / `project()` are untouched.
- **UI:** a **Research** page (`#research`), reached from the menu, the results page and one-line hints on the survey, evidence and scenario steps. It is not added to the 10-step wizard (progressive disclosure). It has three sections with add, edit and remove and clear empty states:
  1. Audience worksheet.
  2. Similar events.
  3. What supports your assumptions.

  A "Problems" box lists broken references.
- **Results, print and board summary:** each option gets "Research on file (not used in any calculation)". The board summary gets a research section.

### Requirement map: Batch 1
| Requirement | Feature | Status |
|---|---|---|
| A. Audience categories (parents, alumni, businesses, golfers, community, other) | `category` select per group | Implemented |
| A. Reach, counting unit, source, date, notes | `reach`, `unit`, `source`, `sourceDate`, `notes` | Implemented |
| A. Reach vs contacted vs survey responses vs named commitments vs paid | Separate `reach` / `contacted` / `responded` fields; named "yes" and paid shown read-only from step 8, labeled as the plan's evidence | Implemented |
| A. Overlap flagged; no undeduplicated sum shown as unique people | `overlapsWith`; totals are per unit, labeled "sum of estimates, not unique people", with an overlap warning; no total across units | Implemented |
| A. Businesses/households never become golfers | Units never converted or summed across; no conversion anywhere | Implemented |
| A. Not auto-added to evidence or scenarios | No code path writes evidence or scenarios from research; tested | Implemented |
| A. No names, contacts, student or sensitive data | Fields are counts and short notes; on-screen warning; no name fields | Implemented (can't stop someone typing a name in notes; warned) |
| A. Unknown stays unknown | Blank = `null`, shown as "unknown"; sums report "N groups unknown" | Implemented |
| A. No forecasts or conversion rates | None computed | Implemented |
| B. Name/type, location, date, source URL/reference, date checked | Fields | Implemented |
| B. Individual price, group price, group size | Fields | Implemented |
| B. Included benefits, required fees, early-bird vs regular, format | `included`, `feesPerPerson` + `feesNote`, `pricingTier`, `format` | Implemented |
| B. Advertised prices separate from verified results | Price fields vs `resultAttendance` + `resultVerified` + `resultNote` | Implemented |
| B. Source quality; differences affecting comparability | `sourceQuality`, `comparability`, `differences` | Implemented |
| B. No demand inferred from price, capacity or "sold out" | Nothing computed from them; result shown only as recorded, marked verified or not | Implemented |
| B. Ranges only for comparable units and inclusions, with sample size and limitations | **Corrected (row 85):** no combined range. A side-by-side list per option shows each observation's price basis, date, tier, inclusions, fees, provenance, verification and source, with notes on what differs. A safe range needs structured matching of package, admission basis, tier, year and verification. | **Deferred** (the range); list implemented |
| B. No recommended market price | None | Implemented |
| B. Manual entry, no scraping or API | Manual | Implemented |
| B. Safe URLs and escaped text; imports untrusted | Links only for `http(s)`, `rel="noopener noreferrer"`; everything escaped; `validatePlan` type-checks research | Implemented |
| C. Link research to options | `optionIds` on audiences and comparables | Implemented |
| C. Reference research for an assumption without changing it | `links` with the current value shown read-only | Implemented |
| C. Sourced vs organizer estimate vs fictional | **Corrected (row 85):** explicit `provenance` plus a separate `verification`; a source or URL never promotes a record; older records show "not recorded"; fictional records are kept out of real-plan summaries | Implemented |
| C. Research summary in board summary and print | Yes | Implemented |
| C. Progressive disclosure | Separate page; hints only | Implemented |
| C. Add, edit, remove; empty states | Yes | Implemented |
| D. Survives save, refresh, download, import, restore | Stored in the plan, so it rides every existing path; tested | Implemented |
| D. Older plans usable | `research` optional | Implemented |
| D. Schema compatibility documented | `DATA_MODEL_AND_PLAN.md`, decision log row 84 | Implemented |
| D. Malformed import never partially overwrites | Existing all-or-nothing import plus research validation | Implemented |
| D. Missing or deleted references visible | `researchProblems` → Problems box and results note, each with a remove action | Implemented |
| D. Unknown fields not erased | Records are edited in place; unknown keys survive save, export and import (tested) | Implemented |
| D. Financial results unchanged by research | Tested: same projections, decide and evidence with and without research | Implemented |

## Batch 2: Interest and scenarios (implemented on branch `batch2-interest-scenarios`; row 87)
Reconciled with the Batch 2 brief. The rule is: reuse what works, add only what is missing.

| Requirement | Existing functionality | Change (smallest coherent) |
|---|---|---|
| 1. Responses tied to a specific offer (price, package, date, option) | Per-option counts (`namedHighIntent`, `surveyDefinitelyAtPrice`, `surveyProbablyAtPrice`) plus `offerTerms` = price, group price and size, kind, description, date, place, inclusions, cause | **Reuse.** No second set of interest records, which would duplicate or contradict these counts |
| 1. Separate contacted / responses / interested / named / paid / money received | Responses (whole survey), named "yes", anonymous "yes", "maybe", paid, money received | **Add** `evidence.surveyContacted` (whole survey, `null` = unknown) and a per-option funnel on the evidence step that labels each stage and never adds stages together |
| 1. No contact lists or demographic inference | Counts only; survey Q8 names stay in the organizer's records | None (rule kept) |
| 1. Offer change marks interest stale, without erasing history or payments | `evidenceStatus` flags stale; but re-asking meant typing over the old counts, losing them | **Add** "Keep these as a past round": moves the option's interest counts and their offer terms to `evidence.offerHistory[optionId]` and clears the current counts. **Paid registrations and money received are never moved or changed.** Past rounds are listed per offer and never summed with current answers |
| 2. Document why low/likely/high; link research | Batch 1 research notes can cite research for `conservative/middle/optimistic` | **Reuse.** The scenario step shows each number's notes and cited research, with "Add a reason", which opens a note on the Research page; labeled "your scenario, not a prediction" |
| 2. Research never changes inputs, evidence or status | Tested in Batch 1 | Extended to the new data |
| 3. 50/75/100% capacity shortcuts with preview and Apply | None | **Add** engine `capacityShortcuts()`: whole groups rounded down, capacity, minimums and deposit floor via `project()`. The preview shows players, revenue, costs, net (with the chosen case's assumptions), firm-money net and cash shortfall. "Use N as low/likely/high" asks twice; the applied result equals the preview (same engine call). Paid and receipts untouched; no shortcut below the number already paid |
| 4. Shotgun vs tee times: incremental cost, extra paid golfers or firm sponsorship to cover it | `compareOptions` (each at its own likely number) and the what-if panel. Neither shows the extra cost at the **same** turnout | **Add** engine `compareAtSameTurnout()`: costs and net of two options at one requested number (each rounded to its own whole groups); the extra cost; the extra firm sponsorship that closes the gap; and the smallest number of additional paying players on the costlier option that would close it (exact scan, so group pricing and minimums are handled), or "can't be recovered within capacity". It is labeled as a requirement, not a forecast, with any expected benefit of a format kept out of the numbers |
| Board summary | Existing per-option sections | **Add** the funnel, past rounds, scenario reasons and the same-turnout comparison, concisely |

## Batch 3: "Ready to commit?" (implemented on branch `batch3-ready-to-commit`; row 90)
| Requirement | Existing feature reused | Change (smallest coherent) |
|---|---|---|
| 1. One concise section per option: numbers require / we know / uncertain / next | `decide()` (missing items, exposure, status), `project()` on firm money, `evidenceStatus()`, `contractChecklist()`, research notes | **Add** engine `readiness()` and one "Ready to commit?" section on the results page (not a new page, not a wizard step). No second status: `decide()`'s status is unchanged and not restated |
| 2. Minimum acceptable net proceeds | `settings.fundraisingTarget` is a hoped-for goal and is always a number, so its meaning differs | **Add** `criteria.minNet` (blank = unknown). Compared with firm money at the likely number; the low number is shown beside it but doesn't decide |
| 2. Maximum acceptable loss; cancellation vs low turnout; unknown terms stay unknown | `decide().exposure`: `lossIfCanceled` (null when terms are unknown) and `worstOnChart` (lowest firm net at or above the paid count) | **Add** `criteria.maxLoss`, compared with each exposure separately and named on screen |
| 2. Volunteer hours available vs needed; no dollar value | `volunteerHoursAvailable` (blank = unknown) and each option's `volunteerHours` | **Reuse.** The hour value setting is not used |
| 2. Decision deadline | Contract dates are per option and set by the venue | **Add** `criteria.decideBy` (calendar date). Timing only; a passed date changes no other result |
| 3. Met / unmet / unknown with values and a reason | n/a | Each criterion shows its threshold, the compared value, the scenario and the basis |
| 3. Threshold vs attendance evidence vs cash vs contract | `decide()` counts paid plus named for the current offer; cash in hand is collected plus money received | Shown as separate facts. Named answers are "not payment"; promised sponsorship "isn't cash yet" |
| 3. Missing or stale evidence, unverified quotes, unknown terms, cash shortfall, unsupported attendance | `decide().missing` | **Reuse** it, plus: likely number not reached by paid plus named; no reason recorded for the likely number; contract dates not entered or passed. **A number is never assumed to come from a capacity shortcut** (this replaces suggestion (b) below) |
| 4. Next actions; never approve, guarantee, predict or cancel | n/a | Ordered: quote and contract details; re-ask about the current offer; cover the cash due first; adjust price, costs or scope; volunteers; agree the criteria; a passed deadline; take the summary to the board (always last) |
| 5. Board summary and print | `boardMemo()`, print CSS | The same words from one function (`readyWords`), plus a criteria line; print shows the criteria as text instead of input boxes |
| Preserve: units, receipts, offer history, stale evidence, mixed units, below-paid, backup and import | Unchanged code paths | `criteria` is validated on import (all or nothing); older plans open with criteria unknown |
| **Learned in Batch 2** | (a) Past rounds must be shown, never counted; Batch 3's "evidence supports" uses current-offer counts only. (b) Capacity shortcuts are not evidence: Batch 3 should flag a likely number that equals a 50/75/100% shortcut and has no cited reason as an assumption to validate. (c) The same-turnout comparison is the right input for "is the extra format worth it?"; keep its "not a forecast" wording. (d) From the review of `b496eae` (row 88): Batch 3 must reuse its guards. Never compare options that count different things, never give recovery figures below the number already paid, and treat equal costs as "not applicable", not "nothing needed". | Plan |

## Order of work
Batch 1, then review, then Batch 2 (it needs Batch 1's records for sources), then review, then Batch 3 (it reads both).
