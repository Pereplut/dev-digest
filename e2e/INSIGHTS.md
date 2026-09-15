# Insights — e2e

Append-only log of non-obvious e2e learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — title` then **Context / Insight / Apply**.

---

### 2026-09-15 — Flows 02/04/05 assume a single seeded repo
**Context:** flows fail when run with `npm test` against a normal dev DB.
**Insight:** the home route redirects to the *first* repo, so any extra imported repo sends flows to the wrong PR list.
**Apply:** use `./scripts/e2e.sh` (fresh, ephemeral Postgres) — and never `docker compose down -v` to "reset" the dev DB.
