# Project brief: Booster Fundraiser Planner (working name)

## User
- **Primary user (hypothesis):** the volunteer event chair, treasurer, or parent coordinator who builds the numbers for a booster club or small nonprofit.
- **Decision-maker (hypothesis):** the club board or officers, sometimes with the athletic director.
- **First pilot segment (hypothesis, from Grok):** high-school athletic booster clubs that are thinking about an annual golf outing, or already run one, and don't know how many players or sponsors will turn up.

## Problem
Working out profit from a known headcount is easy. The hard part comes before signing: who in *this* supporter base would actually play, in which format, at what price, how many paying participants are realistic, whether sponsorship makes the event viable, and whether the return justifies the cash risk and the volunteer hours. Course contracts (player minimums, non-refundable deposits) can lock in losses before any of that is known.

## Product
**Scope (updated 2026-10-19):** universal for small fundraisers. Event types: golf (tee times or shotgun), other sign-up events (runs, tournaments), ticketed events (dinners, galas, trivia), auction or raffle nights, and product sales. Golf remains the first real pilot.

A **pre-event decision assistant**, not an event-management platform. It answers three questions: is this worth committing to, under which option, and what has to be verified first? "Not enough evidence to decide yet" is a valid answer, and it is the default answer until real quotes and real demand evidence are entered.

## MVP (built in this first version)
1. **Options and costs.** Regular tee times, shotgun start, and one generic alternative event. Each option has editable capacity, group size, individual and foursome prices, a venue quote (flat fee, per-participant charge, minimum participants, minimum spend), deposit terms (credited or not, refundable or not), per-participant costs, fixed costs (marked paid-upfront or not), volunteer hours, and verification checkboxes.
2. **Transparent scenarios.** Conservative, middle, and optimistic participant counts are entered by the organizer, along with which sponsorship statuses count, add-on revenue, and a contingency on estimated costs. The output covers revenue, expenses, net, upfront cash versus cash in hand, worst case if nobody registers, contractual floor, break-even and target participants found by scanning every feasible headcount, and capacity flags.
3. **Demand evidence.** An event-snapshot survey generator (8 questions, draft only), entry or CSV import of aggregate counts, and raw evidence headcounts shown beside the scenario inputs. Paid registrations, named high-intent leads, anonymous "definitely" answers, and "probably" answers are kept apart. None of them is converted into predicted attendance.
4. **Decision brief.** A rule-based status, exposure cards, plain-language reasons, ranked sensitivity tests, a "must verify before committing" list, a copyable board summary in Markdown, and a print view.

## Key assumptions (unverified)
- Organizers can get written course quotes before signing, and will take the time to do so.
- A short, clearly described survey yields usable signal. Stated intent usually overstates real sign-ups, so it is treated as weak evidence.
- One person enters the numbers. No collaboration features are needed for v1.
- Golf cost structures fit the formula `max(flat + perHead × max(n, minHeads), minSpend)`, with a deposit floor when the deposit is non-refundable.

## Explicitly excluded
Registration and payments, live scoring, pairings, sponsor CRM, hosted surveys, email or SMS sending, accounts and authentication, databases, live AI features, regional "benchmark" course prices (no verified data exists), automatic attendance prediction, and any tax-deductibility, nonprofit-eligibility, or legal-compliance claims. We also aren't building anything that competes with execution tools such as GolfStatus, Kismet, or GolfFund.

## Data and privacy
The app stores only aggregate counts. No student or minor records. Names collected through the optional survey Q8 stay in the organizer's own records. Data lives in the browser page and leaves only through the user's own JSON export.
