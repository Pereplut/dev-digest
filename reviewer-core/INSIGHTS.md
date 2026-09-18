# Insights — reviewer-core

Append-only log of non-obvious engine learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — [dep|fix|measured|odd|tool|llm] title` then **Context / Insight / Apply / Evidence** (`file:line` required).
Written via the [`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill.

---

### 2026-09-15 — [dep] One unpriced LLM call makes the whole run's cost null
**Context:** persisting run cost for the run cost badge (spec 0001).
**Insight:** `reviewPullRequest` sums per-call `costUsd`, but a single `null` (model missing from the server's price table / PriceBook) turns the run total into `null`, not a partial sum.
**Apply:** a run showing "—" usually means a pricing gap — add the model to `server/src/adapters/llm/pricing.ts`, don't special-case the sum.
**Evidence:** `reviewer-core/src/review/run.ts:184`; covered by the cost test in `reviewer-core/test/run.test.ts`.

### 2026-09-15 — [tool] `npm i -D typescript-eslint` can fail with "Found: typescript@undefined" — retry, don't force
**Context:** adding ESLint to reviewer-core (npm 10.9.8); `node_modules/typescript` was present at 5.9.3 in both the lockfile and the hidden lockfile.
**Insight:** the first `npm i -D eslint@9.39.5 @eslint/js@9.39.5 typescript-eslint@8.70.0 globals@17.12.0` failed ERESOLVE on the `typescript >=4.8.4 <6.1.0` peer; the debug log shows `packumentCache … typescript set size:undefined` just before `Found: typescript@undefined`. The identical command succeeded on the next try (the e2e package's install in between had already cached the packument).
**Apply:** when npm reports a peer as `@undefined` although it is installed, re-run the same install before reaching for `--force` / `--legacy-peer-deps` (both would write a worse lockfile).
**Evidence:** `reviewer-core/eslint.config.mjs:5` (the `typescript-eslint` import that needs the dep); npm log `~/.npm/_logs/2026-09-15T21_41_16_176Z-eresolve-report.txt`.

### 2026-09-18 — [fix] Grounding looped over a model-controlled integer range
**Context:** the grounding gate is mandatory and runs on every review, inside the request path.
**Insight:** `rangeIntersects` walked `lo..hi` testing set membership, but `start_line`/`end_line` come straight from LLM output and are unbounded (`Finding` declares them `z.number().int()` with no `.max()`). One finding claiming `end_line: 2_000_000_000` spins ~2e9 iterations. Iterating the hunk-line **set** instead (small, bounded by the diff) is behaviourally identical and bounded — and needs no contract change, so the two vendored `@devdigest/shared` copies stay in sync.
**Apply:** when a loop bound comes from model output, iterate your own bounded collection rather than the model's range; prefer that over tightening a shared schema, which forces a cross-package mirror.
**Evidence:** `reviewer-core/src/grounding.ts:41-49`; `server/src/vendor/shared/contracts/findings.ts:53-54` (still unbounded, deliberately).
