# Data model and implementation plan

## Architecture
- `src/engine.js`: the pure, deterministic financial engine. It has no DOM, no randomness, and no AI. Money is handled in integer cents. It runs in both Node and the browser.
- `src/demo-data.js`: the **fictional** demo state and a blank state.
- `src/app.js` + `src/index.src.html`: a vanilla-JS UI with three steps. There is no framework and no build dependencies.
- `scripts/build.js`: inlines everything into `dist/booster-fundraiser-planner.html`, a single file that opens offline by double-clicking.
- `test/engine.test.js` (`node --test test/*.test.js`) and `test/ui_smoke.py` (headless Chromium).

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
              offerTerms{optId: {kind, price, groupSize, groupPrice, format, date, place, included}} }
}
EventOption {
  id, name, kind: golf_tee_times|golf_shotgun|participation|ticketed|auction|product|generic,
  capacity, groupSize, wholeGroupsOnly,
  price, groupPrice|null, groupShare (0..1)   (older plans: foursomePrice/foursomeShare, migrated on load),
  scenarioProceeds { conservative, middle, optimistic } (auction/raffle estimates; never in break-even), cancellationOwed|null,
  venueQuote: { flatFee, perParticipant, minimumParticipants, minimumSpend },
  deposit: { amount, creditedTowardBill, refundable },
  perParticipantCosts: [{id,label,amount}], fixedCosts: [{id,label,amount,paidUpfront}],
  volunteerHours, quoteVerified, costsVerified,
  scenarioParticipants: { conservative, middle, optimistic }
}
Sponsorship { id, label, amount, status: collected|committed|hoped, type: cash|inKind, replacesCostId?, optionId? }
```

## Core rules (all covered by tests)
- **Feasible headcounts:** 0 up to capacity, in whole groups when required. The app never rounds up.
- **Venue bill:** `max(flatFee + perParticipant × max(n, minimumParticipants), minimumSpend)`. A non-refundable credited deposit sets a floor on the bill.
- **Deposit:** a credited deposit counts as upfront cash only. A non-credited, non-refundable deposit is a separate expense.
- **In-kind:** never counted as revenue. It reduces only the fixed-cost line it replaces, and only up to that line's amount.
- **Sponsorship:** each scenario counts only the statuses the organizer ticks. Break-even and decision checks always use collected and committed sponsorship only.
- **Contingency:** applies to estimated (non-venue) costs only.
- **Break-even and target:** found by scanning every feasible count, which handles nonlinear costs. The app also reports when net dips again at a higher headcount.
- **Decision:** in order, the possible results are not viable as configured → not enough evidence (quote unverified, no evidence, or break-even > paid + named high-intent) → high risk (conservative net < 0) → supported by current evidence.

## Next steps (proposed)
1. Pilot with one real club: enter real quotes, run the survey, and record whether the output changed a decision.
2. Add cancellation-term modeling (what is owed at each cancellation date) once real contract terms are available.
3. Optionally publish as a private hosted page with saved state. This needs your approval.
4. Fix UX problems found in Gemini's review of the working prototype.
