# Insights — repo-wide

Append-only log of non-obvious, cross-package learnings. Package-specific ones
go in `<pkg>/INSIGHTS.md`. Newest at the bottom.

Entry format:

```markdown
### YYYY-MM-DD — Short title
**Context:** what you were doing / what broke.
**Insight:** the non-obvious fact.
**Apply:** what to do differently next time.
```

---

### 2026-09-15 — `@devdigest/shared` exists in two copies
**Context:** Setting up per-package CLAUDE.md files.
**Insight:** `server/src/vendor/shared` is aliased by server and reviewer-core;
`client/src/vendor/shared` is a separate copy and has already drifted
(`adapters.ts`, `trace.ts`, `knowledge.ts`, `eval-ci.ts`, `productionize.ts`).
**Apply:** a contract change the UI consumes must be mirrored into the client copy by hand.

### 2026-09-15 — Mixed package managers
**Context:** Running tests across packages.
**Insight:** `server/` and `client/` use pnpm; `reviewer-core/` and `e2e/` use npm (they ship `package-lock.json`).
**Apply:** use the manager matching the lockfile; don't add a second lockfile.

### 2026-09-15 — CI path filters encode cross-package aliases
**Context:** Reading `TESTING.md`.
**Insight:** e.g. `reviewer-core/**` triggers `server-unit` because the server type-checks against `../reviewer-core/src`.
**Apply:** when adding a new path alias, add the matching `paths:` filter to the consuming package's workflow.
