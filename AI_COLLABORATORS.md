# Guide for AI collaborators (Claude, Gemini, Grok, others)

William owns this project and decides what gets merged. Claude is the lead implementer. Gemini focuses on design, usability, accessibility and survey wording. Grok focuses on market research and checking business assumptions. Anyone may propose code changes.

## How to propose a change
1. Read `PROJECT_BRIEF.md`, the latest rows of `DECISION_LOG.md`, and the file you want to change.
2. Make the smallest change that solves one problem.
3. Give William either a **pull request** or a **complete replacement for one function or one file**, with the file path. Partial snippets with "..." can't be applied safely.
4. Say what you changed, why, and how you checked it.
5. Add a row to `DECISION_LOG.md` for anything that changes behavior or the math.

## Rules that don't change without William's explicit OK
- **No invented data.** No made-up course prices, regional benchmarks, attendance rates, conversion percentages or "typical" sponsorship amounts. The example data stays labeled as fictional.
- **No predicting attendance** from survey interest or demographics. Interest is shown beside the plan, never converted into expected headcount.
- **Break-even uses only collected or committed sponsorship**, and only paid sign-ups plus named "yes" answers count as evidence.
- **"Not enough evidence to decide yet" stays a valid result.** It's the default until a written quote and real supporter answers exist.
- **In-kind donations are never cash.** They only reduce a cost they replace.
- **The math lives only in `src/engine.js`**, uses integer cents, and every change comes with a test in `test/engine.test.js`.
- **Privacy:** no student or minor data, no names or contact details stored in the planner, no tracking or analytics, no accounts.
- **No legal or tax claims:** nothing about tax deductibility, nonprofit eligibility or guaranteed results.
- **Nothing gets sent or bought:** no emails or messages, no payments, no paid services, no publishing without William's approval.
- **No new dependencies or frameworks** unless the reason is written in the decision log.

## Technical notes
- Plain HTML, CSS and JavaScript. No build tools besides `node scripts/build.js`.
- `index.html` is generated, so edit the files in `src/` instead.
- The site must work at phone width (375px) without sideways scrolling, in light and dark mode, and with a keyboard.
- Run `node --test test/*.test.js` before proposing. If you can't run code, say so plainly rather than claiming tests passed.

## Where to find things in `src/app.js`
- `STEPS`: the 10 wizard steps (title, help text, and the function that draws each one)
- `step*()` functions: one per wizard step
- `viewHome()`, `viewWizard()`, `viewResults()`: the three pages
- `renderSummary()`, `renderComparison()`, `renderDetail()`: the results sections
- `surveyText()`: the supporter survey text
- `boardMemo()`: the "Copy board summary" text
