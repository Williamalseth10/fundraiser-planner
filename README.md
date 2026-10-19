# Booster Fundraiser Planner

A free website that helps booster clubs, PTAs and other 501(c)(3)s decide whether a fundraiser is worth it **before** they sign a contract. Organizers enter their real quotes and ask their supporters a short survey. The site then shows break-even, cash needed up front and the worst case in plain numbers, and it says "Not enough evidence to decide yet" until there's enough real information.

The built-in example is a golf outing comparing regular tee times with a shotgun start. **All example numbers are made up.**

## Use it
Open `index.html` in any browser. It runs entirely in the browser, with no accounts, no server and no tracking. Plans save in the visitor's own browser and can be exported as a file.

## How the code is organized
| Path | What it is | Who should edit it |
|---|---|---|
| `src/engine.js` | All the money math. Pure functions, no screen code. | Only with matching tests in `test/engine.test.js` |
| `src/app.js` | The website: homepage, the 10-step wizard, results | Anyone |
| `src/index.src.html` | Page layout and all styling (CSS) | Anyone |
| `src/demo-data.js` | The made-up golf example | Keep it clearly labeled as fictional |
| `scripts/build.js` | Combines everything into `index.html` | Rarely |
| `index.html` | **Generated.** Don't edit it directly; run the build instead. | Nobody |
| `test/` | Engine tests (`node --test`) and a browser check (Playwright) | Add tests with every math change |
| `PROJECT_BRIEF.md`, `DECISION_LOG.md` | What the product is and why decisions were made | Add a row for each important change |
| `AI_COLLABORATORS.md` | Rules for Claude, Gemini, Grok and anyone else proposing changes | |

## Making a change
```
node --test test/*.test.js     # must pass
node scripts/build.js          # regenerates index.html
python3 test/ui_smoke.py       # optional browser check (needs Playwright)
```
Every push and pull request runs the engine tests and the build automatically (see `.github/workflows/ci.yml`).

## Publishing as a website (GitHub Pages)
Settings → Pages → "Deploy from a branch" → `main` / root. The site appears at `https://<your-username>.github.io/<repo-name>/`. This makes the site **public**, so check that nothing in the repo is private first. The example data is fictional by design.
