# Insights — server

Append-only log of non-obvious server learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — [dep|fix|measured|odd|tool|llm] title` then **Context / Insight / Apply / Evidence** (`file:line` required).
Written via the [`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill.

---

### 2026-09-15 — Migrations are not applied on boot
**Context:** `relation ... does not exist` errors on first run.
**Insight:** the API never auto-migrates; pgvector itself is enabled by migration `0000`.
**Apply:** run `pnpm db:migrate` after pulling anything that touches `src/db/`.

### 2026-09-15 — Repo-intel context degrades silently
**Context:** reviews looked diff-only despite `REPO_INTEL_ENABLED=true`.
**Insight:** repo map / blast-radius sections populate only once the repo is **indexed**; unindexed repos fall back to diff-only with no error.
**Apply:** check index state before debugging missing prompt context.

### 2026-09-15 — [dep] Seeded run costs for PR #482 are asserted by tests and e2e
**Context:** seeding completed `agent_runs` with cost so the PR list and Timeline show values.
**Insight:** the seed inserts General 0.0149 + Security 0.0011 only while PR #482 has no runs; the PR list integration test expects the round total 0.016, and e2e flows 02/04 wait for `$0.016` / `$0.015`.
**Apply:** changing those seeded costs means updating `test/integration.it.test.ts` and `e2e/flows/02-*`, `04-*` together; re-seeding a dev DB that already has runs adds nothing.
**Evidence:** `server/src/db/seed.ts:223-237`, `server/test/integration.it.test.ts:154`.
