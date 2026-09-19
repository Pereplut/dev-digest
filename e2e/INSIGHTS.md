# Insights — e2e

Append-only log of non-obvious e2e learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — [dep|fix|measured|odd|tool|llm] title` then **Context / Insight / Apply / Evidence** (`file:line` required).
Written via the [`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill.

---

### 2026-09-15 — [dep] Flows 02/04/05 assume a single seeded repo
**Context:** flows fail when run with `npm test` against a normal dev DB.
**Insight:** the home route redirects to the *first* repo, so any extra imported repo sends flows to the wrong PR list.
**Apply:** use `./scripts/e2e.sh` (fresh, ephemeral Postgres) — and never `docker compose down -v` to "reset" the dev DB.
**Evidence:** `client/src/app/page.tsx:16-17` (`router.replace` to `repos[0]`).

### 2026-09-15 — [tool] `wait --text` matches rendered text, including CSS `text-transform`
**Context:** the new "Cost" column step in flow 02 timed out although the column rendered.
**Insight:** agent-browser matches the page's rendered text, so a header styled `textTransform: "uppercase"` reads "COST", not the i18n string "Cost".
**Apply:** assert the text as displayed (check the component's styles for `textTransform`), or wait on a value in the cell instead of its header.
**Evidence:** `e2e/flows/02-repo-pulls-detail.flow.json:8`; `client/src/app/repos/[repoId]/pulls/styles.ts:104`.

### 2026-09-15 — [tool] On WSL/Ubuntu, `agent-browser install` alone leaves Chrome unable to start
**Context:** every flow failed on its first `open` step, before any assertion.
**Insight:** the downloaded Chrome for Testing needs system libraries that aren't installed by default (`libnspr4`, `libnss3`, `libasound2`); it exits with code 127 and the runner only reports "Command failed: agent-browser open".
**Apply:** install with `agent-browser install --with-deps` (needs sudo), or `sudo apt-get install -y libnss3 libnspr4 libasound2t64`; diagnose with `agent-browser open about:blank` and `ldd <chrome> | grep "not found"`.
**Evidence:** `e2e/README.md:53` (setup step without `--with-deps`).

### 2026-09-15 — [tool] Hover cards are testable with `find role button hover --name "<aria-label>"`
**Context:** asserting the FINDINGS popover on the PR list (flow 02) and the timeline (flow 04) without CSS selectors.
**Insight:** agent-browser's `find` accepts `hover` as its action, and `--name` matches the accessible name from `aria-label`. A `role="button"` trigger named "1 critical, 1 warning" opens the portalled card, and the following `wait --text` finds the card's content.
**Apply:** give hover-only UI a focusable `role="button"` trigger with an `aria-label`, hover it by name, then assert text that exists only inside the card (not text also rendered elsewhere on the page).
**Evidence:** `e2e/flows/02-repo-pulls-detail.flow.json:11`, `e2e/flows/04-pr-findings.flow.json:16` — both PASS in `./scripts/e2e.sh` (7/7).

### 2026-09-15 — [tool] `find … focus` is listed in agent-browser's help but rejected
**Context:** checking that keyboard focus opens the FINDINGS popover.
**Insight:** `agent-browser find role button focus --name "1 critical"` fails with "Unknown subaction: focus", although `agent-browser find --help` lists `focus` as an action. `hover` and `click` work.
**Apply:** to test focus behaviour, use `eval` with `el.focus()` (React's `onFocus` fires), then `press Escape` / `press Enter`. Don't put `find … focus` in a flow.
**Evidence:** `e2e/README.md:32` (the allowed `find role|text|label` locators). Confirmed against the dev app on :3000.

### 2026-09-15 — [tool] `find … click` silently misses controls below the fold (inner scroll container)
**Context:** flow 04's severity-pill click passed (`✓ Done`) but the filter never applied, so the following `wait --fn` timed out — only on the hermetic stack, where Timeline tiles push the Review runs card below the fold.
**Insight:** the studio scrolls a nested container, not the window; agent-browser's `find role button click` (and `hover`, and `scroll down`) don't bring the target into view there, so the click lands nowhere while still exiting 0. Reproduced on the dev app with `set viewport 1280 420` (pill at y=529 stayed `aria-pressed=false`); after `scrollintoview 'button[aria-label="1 warning"]'` (pill at y=223) the same click set it to `true`.
**Apply:** before clicking anything that can be below the fold, add a `scrollintoview '<css>'` step, and always follow a click with an assertion of its effect (`wait --text` / `wait --fn`) — never trust the click's exit code alone.
**Evidence:** `e2e/flows/04-pr-findings.flow.json:20` (the `scrollintoview` step).

### 2026-09-15 — [tool] `find role … --name X --exact` really is exact; `wait --fn` accepts negated expressions
**Context:** suspected that `--exact` ignored `--name`, since the Timeline chip trigger "1 critical, 1 warning" contains the pill name "1 warning".
**Insight:** with a decoy `role="button"` named "1 critical, 1 warning" injected before the pill, `--name "1 warning" --exact` clicked the pill (decoy 0 clicks) while the same command without `--exact` clicked the decoy. `wait --fn "!document.body.innerText.includes('…')"` resolves as soon as the text is gone.
**Apply:** use `--exact` whenever one control's accessible name is a substring of another's; `wait --fn` is the deterministic way to assert disappearance.
**Evidence:** `e2e/flows/04-pr-findings.flow.json:21-22` (exact click + `wait --fn`).

### 2026-09-18 — [tool] Inner-container scroll state persists across steps, so a scroll fix can regress a later step
Extends: "`find … click` silently misses controls below the fold (inner scroll container)"
**Context:** after adding a `scrollintoview` so flow 04's severity pill could be clicked, the flow's *previously passing* Timeline hover step started failing.
**Insight:** the scroll position of the nested container carries over from step to step. Scrolling down to reach one target leaves a later target above the fold, where `hover` won't find it — so the fix for one step broke another, costing a second full hermetic run.
**Apply:** treat scroll position as flow state: give every below-the-fold interaction its own `scrollintoview`, including the ones that used to pass, and re-run the whole flow after any scroll change — not just the step you fixed.
**Evidence:** `e2e/flows/04-pr-findings.flow.json:20` (scroll down to the pill), `:26` (scroll back up to the Timeline chips); `e2e/docs/locators.md:22`.

### 2026-09-18 — [tool] A temporary `NNz-` flow is the debugger for bugs that only reproduce on the hermetic stack
**Context:** flow 04's pill bug reproduced only under `./scripts/e2e.sh` (different viewport/layout than the dev app), where there is no interactive browser to inspect.
**Insight:** `run.ts` runs `*.flow.json` in lexical order, so a throwaway `04z-debug-pill.flow.json` runs right after `04-`, reusing the booted stack and the same session state. Having it `eval` the suspect state into a fixed on-page banner and then screenshot gives a readable diagnosis; `test-results/` is gitignored, so the artifact never reaches git.
**Apply:** to debug a hermetic-only failure, add an `NNz-`-suffixed flow next to the failing one, render state into a banner, read the screenshot, then delete the flow.
**Evidence:** `e2e/run.ts:54-56` (`readdirSync(...).filter(...).sort()`); `.gitignore:23` (`test-results/`).
