---
name: api-versioning
description: >-
  Use when a PR changes a public API: check that breaking changes ship as a new
  version or behind a compatible alias, and that the old version keeps working
  until it is formally deprecated.
type: convention
---

**API versioning.** Public API consumers upgrade on their own schedule. A change
that breaks them must be versioned, not shipped in place.

**Flag:**
- A breaking change (removed/renamed field, new required input, changed status
  or method) made to an existing versioned route (`/v1/...`) instead of adding
  `/v2/...` or a compatible alias.
- A new version that silently changes behaviour of the old one (shared handler
  edited without a version switch).
- Removing an old version without a deprecation period: no `Deprecation` /
  `Sunset` header, no changelog entry, no migration note.
- A version chosen by an unvalidated header or query param that falls back to
  the latest version (clients get breaking changes by default).

**Good:** keep `/v1/users/:id` returning the old shape, add `/v2/users/:id`
with the new one, mark v1 with `Deprecation: true` and a `Sunset` date, and
document the migration.

**Severity:** CRITICAL for an in-place breaking change to a published version;
WARNING for a missing deprecation signal; SUGGESTION for documentation gaps.

**Do not flag:** internal routes used only by the app's own client in the same
deploy, or additive changes (new optional fields, new routes).
