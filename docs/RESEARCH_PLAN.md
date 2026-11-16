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

## Batch 2: Interest and scenarios (plan only)
| Requirement | Design | Status |
|---|---|---|
| Responses tied to price, format and offer version | Interest records `{ optionId, offerTerms (from `E.offerTerms`), yes, maybe, no, named, source, date }`; an offer version is the recorded terms. Current vs stale reuses `evidenceStatus` logic. | Deferred |
| No combining respondents across offers | Totals only within one offer version; across versions show side by side, never summed | Deferred |
| Evidence-linked low/middle/high | Proposed values shown beside each scenario with the evidence they come from (e.g. low = paid; middle = paid + named for the current offer); organizer clicks "Use" per value | Deferred |
| 50/75/100% capacity shortcuts | `normalizeParticipants(cap × p)` (whole groups, rounded down, never above capacity); shown as buttons; labeled as shortcuts, not evidence | Deferred |
| Explicit action before applying | Two-click confirm, same pattern as "Use $X in my plan" | Deferred |
| Invalidation on price or offer change | Existing `evidenceStatus` / `offerTerms`; applied scenario records which offer version it came from and is flagged when stale | Deferred |
| Shotgun vs tee times: extra cost and revenue needed | Engine function comparing two options at the same headcount: Δcost, Δrevenue, and the extra firm money needed. **No extra attendance assumed.** | Deferred |
| No WTP curve or success probability | None | Deferred (rule) |

## Batch 3: "Ready to commit?" (plan only)
| Requirement | Design | Status |
|---|---|---|
| One page: numbers require / evidence supports / remains at risk / next | `#decide` page per option built from `decide()`, `whatWouldChange()`, research and criteria; no new status logic | Deferred |
| Organizer decision dates and criteria | `plan.criteria = { decideBy, minPaid, minFirmSponsorship, minCollectedCash, maxExposure, minVolunteerHours, quoteQuestionsResolved }` | Deferred |
| Met / unmet / unknown | Pure engine evaluation; blank criterion = unknown, not met | Deferred |
| Criteria met ≠ approval or success | Fixed wording, the same as today's statuses | Deferred (rule) |
| No silent change to status rules | Criteria shown beside the status, never fed into `decide()` | Deferred (rule) |
| "Why does it say that?" | Expandable explanation per conclusion from the existing reasons and inputs | Deferred |
| Printable board brief | One page per option: calculations, research, assumptions and open questions in four labeled blocks | Deferred |

## Order of work
Batch 1, then review, then Batch 2 (it needs Batch 1's records for sources), then review, then Batch 3 (it reads both).
