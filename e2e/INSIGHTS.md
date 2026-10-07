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

### 2026-09-20 — [tool] The mutating flow's closing re-navigation is flaky, and the step that fails MOVES
**Context:** adding `09-conventions` (spec 0007) renumbered the mutating flow to `10-`; it then failed where it had passed 9/9 before, which read as a regression from the new neighbour.
**Insight:** it is not caused by the neighbour. Removing `09-conventions` entirely — restoring the exact pre-change adjacency — still fails, and fails at a *different* step: `✗ back on the PR list` instead of `✗ PR detail route again`. Both are `wait --url` timeouts in the same closing "re-navigate from scratch" sequence, and under heavy load it failed at the flow's *first* step instead. A wandering failure point is a timing race, not a deterministic break; the API served every one of those requests 200.
**Apply:** don't attribute a `10-pr-finding-actions` failure to your change until you have re-run with your flow removed and compared *which* step failed. Its closing re-navigation needs a `wait --load networkidle` between the click and the `wait --url`; until then treat 9/10 with only that flow red as a known flake.
**Evidence:** `e2e/flows/10-pr-finding-actions.flow.json` (the closing `open`/`find … click`/`wait --url` sequence); runs with and without `e2e/flows/09-conventions.flow.json` failed at different steps of it.

### 2026-09-20 — [measured] The hermetic stack needs ~2 GB free; below that flows fail as `wait --url` timeouts
**Context:** three flows failed on a 7.9 GB WSL2 box while `./scripts/dev.sh` and six unrelated containers were up; load average peaked at 189 and background tasks were OOM-killed.
**Insight:** `./scripts/e2e.sh` adds a Postgres container, a Fastify API, a second `next dev` and Chrome to whatever is already running. Starved, `next dev`'s first compile of a route outruns the 60 s `E2E_STEP_TIMEOUT`, so the failure always surfaces as `wait --url` right after `open` — which looks like a broken route, not a resource problem. Stopping the unrelated containers took load 189 → 5 and the same suite went 7/10 → 9/10, with the two "broken" pages (`/settings/api-keys`, `/pulls/482`) passing untouched.
**Apply:** before believing an e2e failure, check `uptime` and `free -m`. A `wait --url` timeout straight after an `open`, on a page that loads fine in the dev app, is resource starvation — free memory and re-run rather than editing the flow.
**Evidence:** `scripts/e2e.sh` (boots API :3101 + web :3100 + `devdigest-e2e-postgres`); `e2e/run.ts` (`E2E_STEP_TIMEOUT`, default 60000).

### 2026-09-23 — [tool] Piping `e2e.sh` through `tail` throws away its exit code
**Context:** running the suite as `timeout 1500 ./scripts/e2e.sh 2>&1 | tail -45` to keep the output small. The run reported `8/9 flows passed` and the harness reported `exited with code 0`, and I wrote that the script does not fail on a failed flow.
**Insight:** that was wrong, and the mistake is in the invocation, not the script. `scripts/e2e.sh:191` ends with `exit "$E2E_CODE"` and propagates correctly. A shell pipeline's status is the LAST command's — `tail` — and `tail` always succeeds, so without `set -o pipefail` a red run reads as green to anything checking `$?`. The truncation idiom that keeps the output readable is exactly what hides the result.
**Apply:** never judge an e2e run by the exit code of a piped invocation. Either read `N/M flows passed` from the text, or run `set -o pipefail; ./scripts/e2e.sh 2>&1 | tail -n 45`. The same applies to any long-running check piped through `tail`, `head` or `grep`.
**Evidence:** `scripts/e2e.sh:185-191` (`(cd e2e && npm test)` then `exit "$E2E_CODE"`); a run printing `8/9 flows passed` reported exit 0 through the pipe.

### 2026-09-23 — [odd] The same step failing in one flow and passing in another, in one run, is a flake
Extends: "a `wait --url` timeout straight after an `open` … is resource starvation"
**Context:** after the intent-layer UI change, `02-repo-pulls-detail` failed on `wait --url /pulls/482` — the flow most likely to break if the PR detail page regressed, since the change adds a card to `OverviewTab`.
**Insight:** flows `04` and `05` open the same page with the SAME two steps (`find text … click`, then `wait --url /pulls/482`) and passed in that run. A deterministic regression cannot pass and fail the same step on the same stack in the same run, so the page was fine; a re-run with no code change gave 9/9. `02` differs in doing hover-and-popover steps on the severity chips just before the click, which is a plausible interceptor.
**Apply:** before blaming a change for an e2e failure, look for a sibling flow exercising the same step. If one passed, it is timing — re-run rather than reading the diff. This is cheaper than the `uptime`/`free -m` check in the entry above and works when the box is not obviously loaded.
**Evidence:** `e2e/flows/02-repo-pulls-detail.flow.json` (hover + popover steps precede the row click), `e2e/flows/04-pr-findings.flow.json` (same click + wait, no hover); run 1 → 8/9, run 2 unchanged → 9/9.

### 2026-10-01 — [dep] The mutating flow was renumbered 10 → 11 for spec 0017's new onboarding-tour flow
**Context:** spec 0017 (Onboarding Generator) added a read-only `onboarding-tour` flow that must sort before the one mutating flow (`e2e/AGENTS.md`'s "mutating flows sort last" rule), and `10-` was already taken.
**Insight:** `10-pr-finding-actions.flow.json` is now `11-pr-finding-actions.flow.json`; the new flow is `10-onboarding-tour.flow.json`. This is the same renumber shape spec 0007 did before it (`09-pr-finding-actions` → `10-`). The entries above dated 2026-09-20 and 2026-09-23 that cite `10-pr-finding-actions.flow.json` by name are now stale — left as-is because this file is append-only; this entry is the forward pointer.
**Apply:** when reading an older entry here that names `10-pr-finding-actions`, it means today's `11-pr-finding-actions`. A future renumber should add the same kind of pointer rather than editing history.
**Evidence:** `e2e/flows/11-pr-finding-actions.flow.json` (renamed from `10-`), `e2e/flows/10-onboarding-tour.flow.json` (new); `e2e/AGENTS.md:23`, `e2e/README.md:45,117`.

### 2026-10-02 — [odd] A browser assertion that a file card is expanded proves nothing when the file auto-expands anyway
**Context:** spec 0018's AC-48 — clicking a PR Brief review-focus row opens Files changed with that file's card expanded. The e2e flow asserts the card's content is visible after landing.
**Insight:** the seeded target is `src/middleware/ratelimit.ts` at `additions: 84` (`server/src/db/seed.ts:128`), and `AUTO_EXPAND_MAX_LINES` is **200** (`client/src/components/diff-viewer/constants.ts:4`), so that card is open on arrival whether or not the deep link did anything. The assertion passes identically against a build where `focusPath` is never read. The flow's author spotted this unprompted and reported it rather than letting it stand as coverage. What actually proves causation is a unit test with a **300-line** fixture, where expansion can only come from `focusPath` (`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx:352-353`) — the e2e flow is left asserting the landing, which is all it can honestly claim.
**Apply:** when asserting that an interaction *caused* a UI state, check what the default state would have been with the interaction removed — seeded fixtures in this repo are small, and most of them fall under the auto-expand threshold, so "the card is open" is usually true for free. Put the causation claim in a unit test where the fixture can be built to make the default the opposite, and let the browser flow assert only navigation and presence.
**Evidence:** `e2e/flows/13-pr-brief.flow.json`; `client/src/components/diff-viewer/constants.ts:4` (`AUTO_EXPAND_MAX_LINES = 200`); `server/src/db/seed.ts:127-131` (all four seeded `pr_files` are under it); `DiffTab.test.tsx:352-353` (the 300-line fixture that does prove it).

### 2026-10-06 — [odd] "12/12 flows passed" counts ELIGIBLE flows: the summary and the exit code both ignore skipped ones
**Context:** spec 0018's validation run. `./scripts/e2e.sh` printed `12/12 flows passed` while `e2e/flows/` holds **13** `*.flow.json` files — which reads as one flow quietly dropped.
**Insight:** it is correct, not a drop. `run.ts` `continue`s past any flow with `mutates: true` unless `E2E_ALLOW_MUTATING=1`, pushing it onto `skipped` and never into `results`; `summarize(results)` and `process.exit(results.every(ok))` then both see only the eligible flows. So the denominator is "flows attempted", and a run can exit 0 having attempted none. The skip is printed loudly (`⊘ <name> … skipped: mutating flow`) and a trailing block repeats the count — those two lines, not the ratio, are what tell you the suite was complete.
**Apply:** read `N/M` together with the `⊘` lines and with `ls e2e/flows/*.flow.json | wc -l`. `M` equal to the file count means every flow ran; `M` short by exactly the mutating flows is the normal state; `M` short by anything else means flows failed to load. Never treat the ratio or the exit code alone as "the suite passed".
**Evidence:** `e2e/run.ts:117-121` (the `mutates && !ALLOW_MUTATING` skip), `:130` (`summarize(results)`), `:135-137` (the skipped block and the `results`-only exit code); measured 2026-10-06 — 13 flow files, 12 attempted, `12-pr-finding-actions` skipped as mutating.
