# Insights — server

Append-only log of non-obvious server learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — title` then **Context / Insight / Apply**.

---

### 2026-09-15 — Migrations are not applied on boot
**Context:** `relation ... does not exist` errors on first run.
**Insight:** the API never auto-migrates; pgvector itself is enabled by migration `0000`.
**Apply:** run `pnpm db:migrate` after pulling anything that touches `src/db/`.

### 2026-09-15 — Repo-intel context degrades silently
**Context:** reviews looked diff-only despite `REPO_INTEL_ENABLED=true`.
**Insight:** repo map / blast-radius sections populate only once the repo is **indexed**; unindexed repos fall back to diff-only with no error.
**Apply:** check index state before debugging missing prompt context.
