# Insights — server

Append-only log of non-obvious server learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — [dep|fix|measured|odd|tool|llm] title` then **Context / Insight / Apply / Evidence** (`file:line` required).
Written via the [`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill.

---

### 2026-09-15 — [dep] Migrations are not applied on boot
**Context:** `relation ... does not exist` errors on first run.
**Insight:** the API never auto-migrates; pgvector itself is enabled by migration `0000`.
**Apply:** run `pnpm db:migrate` after pulling anything that touches `src/db/`.
**Evidence:** `server/src/db/migrate.ts:17` (migrator used only by `pnpm db:migrate` and the Testcontainers harness; `src/server.ts` never calls it).

### 2026-09-15 — [odd] Repo-intel context degrades silently
**Context:** reviews looked diff-only despite `REPO_INTEL_ENABLED=true`.
**Insight:** repo map / blast-radius sections populate only once the repo is **indexed**; unindexed repos fall back to diff-only with no error.
**Apply:** check index state before debugging missing prompt context.
**Evidence:** `server/src/modules/reviews/run-executor.ts:372` (a degraded or empty map returns `undefined`, so the prompt omits the repo-map slot).

### 2026-09-15 — [dep] Seeded run costs for PR #482 are asserted by tests and e2e
**Context:** seeding completed `agent_runs` with cost so the PR list and Timeline show values.
**Insight:** the seed inserts General 0.0149 + Security 0.0011 only while PR #482 has no runs; the PR list integration test expects the round total 0.016, and e2e flows 02/04 wait for `$0.016` / `$0.015`.
**Apply:** changing those seeded costs means updating `test/integration.it.test.ts` and `e2e/flows/02-*`, `04-*` together; re-seeding a dev DB that already has runs adds nothing.
**Evidence:** `server/src/db/seed.ts:223-237`, `server/test/integration.it.test.ts:154`.

### 2026-09-15 — [odd] Runs made while a pre-cost branch was checked out have NULL cost forever
**Context:** PR list showed `$0.011` for PR #1 but `—` for PRs #2/#3, all reviewed with `deepseek/deepseek-v4-flash` (which is priced).
**Insight:** the dev API is a long-lived `tsx watch` over the working tree, so checking out a branch without the cost feature (`fix/e2e-separate-next-build` @ `0d15e02`, based on old `main`) silently ran executor code that never writes `cost_usd`, while the DB kept migration 0010. Those `done` runs got `cost_usd = NULL`, and their `run_traces.trace->'stats'` has no `cost_usd` key at all — the tell that pre-feature code wrote them (current code always writes the key, even as null).
**Apply:** when a PR's cost is `—`, check `(trace->'stats') ? 'cost_usd'` and `git reflog --date=iso` against `agent_runs.ran_at` before debugging pricing; re-run the review on a branch that has the feature. Don't review PRs while a branch missing a DB-backed feature is checked out.
**Evidence:** `server/src/modules/reviews/run-executor.ts:271` (writes `cost_usd`; 0 `cost` mentions at `0d15e02`); `server/src/modules/pulls/routes.ts:155` (NULL run → no total → `—`).

### 2026-09-15 — [dep] Seeded PR #482 finding counts are asserted by tests and e2e too
Extends: "Seeded run costs for PR #482 are asserted by tests and e2e"
**Context:** adding the PR list FINDINGS column (spec 0002), counted over the same latest review round as COST.
**Insight:** only the seeded General run is linked to the seed review (1 CRITICAL + 1 WARNING); the Security run has no review. The integration test expects `{CRITICAL:1, WARNING:1, SUGGESTION:0}` with 2 round runs, and e2e flows 02/04 hover the chips by the accessible name "1 critical, 1 warning".
**Apply:** changing seeded #482 findings, their severities, or the review ↔ run link means updating the integration test and both e2e flows together.
**Evidence:** `server/src/db/seed.ts:156-168`, `server/test/integration.it.test.ts:239`, `e2e/flows/02-repo-pulls-detail.flow.json:11`, `e2e/flows/04-pr-findings.flow.json:16`.

### 2026-09-15 — [tool] The dev API's `tsx watch` can get stuck on a half-edited file
**Context:** while `routes.ts` was being edited in several steps, the dev API on :3001 answered the PR list with 500 `ReferenceError: count is not defined`, although typecheck, the integration tests and the e2e stack all passed with the same code.
**Insight:** `tsx watch` restarted its child between the edit that used `count()` and the edit that imported it, then stopped reloading: the child's start time predated the import, and `touch`-ing the file didn't restart it. Only killing the `pnpm dev` tree and starting it again served the current code.
**Apply:** when the dev API throws for a symbol that exists on disk, compare the `tsx` child's start time (`ps -o lstart`) with the edit, and restart `pnpm dev` instead of debugging the code.
**Evidence:** `server/src/modules/pulls/routes.ts:3` (the `count` import the stale process lacked); error lines in `/tmp/dd/api.log`.

### 2026-09-15 — [dep] PR #482 list values now depend on run ORDER and the review link, not on the round
Supersedes: "Seeded PR #482 finding counts are asserted by tests and e2e too"
**Context:** homework spec 0003 changed the PR list to COST = all done runs and FINDINGS = the latest single run with a review (`PrMeta.findings_run_id` replaced `findings_round_run_ids`).
**Insight:** the seed inserts General (with the review) before Security (no review), so Security is the newest done run, yet FINDINGS resolve to General only because the latest-run query requires a `kind='review'` review. `$0.016` is now 0.0149 + 0.0011 over all done runs. Linking a review to the Security run, or reordering the seed, flips the list to that run's counts (and the "2 FINDINGS IN THIS RUN" title in e2e flow 02).
**Apply:** when touching the seed's #482 runs/reviews, re-check `integration.it.test.ts` (cost + findings tests) and e2e flows 02/04 together; the list is no longer "every agent's newest run".
**Evidence:** `server/test/integration.it.test.ts:156` (0.016), `:261` (`findings_run_id` = seeded General); `server/src/db/seed.ts:268-272` (review linked to General only); `e2e/flows/02-repo-pulls-detail.flow.json:12`.

### 2026-09-18 — [measured] A file-level `eslint-disable` + `@ts-nocheck` module passes every quality gate silently
**Context:** building a deliberately bad fixture module (`server/src/modules/export/`, 4 files, +364 lines) to test the review engine.
**Insight:** each file opened with `/* eslint-disable */` then `// @ts-nocheck`, and the module was never registered in `src/modules/index.ts`. `pnpm typecheck` exited 0, `pnpm lint` exited 0 with **the same 6 pre-existing warnings**, and tests stayed 103/103 — although the code contains hardcoded secrets, `sql.raw` string concatenation, path traversal and an open proxy. tsc honours `@ts-nocheck`, ESLint honours the file-level disable, and an unregistered module is never imported by a test.
**Apply:** "lint is clean" does not mean new code was linted — compare the warning *count* against the baseline, and grep a new module for `@ts-nocheck` / `eslint-disable` before trusting CI. Only the review engine catches a PR like this.
**Evidence:** `server/src/modules/index.ts` (no reference to the module); commit `e2fabbd` on `demo/export-service`.

### 2026-09-18 — [tool] `skip-worktree` is per-clone index state, not a repo fact
**Context:** `server/AGENTS.md` claimed `package.json` was `skip-worktree`; an audit subagent had propagated the claim.
**Insight:** `git ls-files -v server/package.json` returns `H`, not `S`, in this clone — all four `package.json` files are `H`. The flag lives in a clone's index and travels with nobody. CI keeps the workaround anyway (`pnpm exec eslint .` rather than `pnpm lint`).
**Apply:** verify git-state claims with `git ls-files -v`, never from a doc; the doc now says "may be `skip-worktree` in some clones".
**Evidence:** `server/AGENTS.md:25`; `.github/workflows/server-unit.yml:68` (`pnpm exec eslint .`), `:101` (comment on the differing committed `package.json`).
