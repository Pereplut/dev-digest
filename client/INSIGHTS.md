# Insights — client

Append-only log of non-obvious client learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — [dep|fix|measured|odd|tool|llm] title` then **Context / Insight / Apply / Evidence** (`file:line` required).
Written via the [`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill.

---

### 2026-09-15 — [dep] Trace documents written before migration 0010 have no cost
**Context:** adding the COST tile to the run trace drawer.
**Insight:** `run_traces.trace` is a stored jsonb snapshot, so `stats.cost_usd` is simply absent for older runs; the `agent_runs` row (`RunSummary.cost_usd` from `usePrRuns`) is the reliable source, and an unfinished run must never show a price.
**Apply:** read run cost from the run row first and fall back to `trace.stats.cost_usd`; never assume new `RunStats` fields exist on old traces.
**Evidence:** `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:32`.
