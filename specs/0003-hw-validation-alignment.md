---
title: Homework validation alignment
status: done  # draft | approved | in-progress | done
lesson: L01
packages: [server, client, reviewer-core, e2e]
---

## Problem
The L01 homework checklist (`HW_validation.txt`, 24 criteria) grades three things:
- **Agent docs:** `CLAUDE.md` content and the `engineering-insights` loop.
- **Features:** the cost and findings UI.
- **Process:** 5 phases, and real per-package `docs/` and `specs/`.

An audit on 2026-09-15 found these criteria already met: 9, 10, 13, 14 and 23. Every other
criterion was partly met or missing.

## Scope / non-goals
- **In scope:**
  - Every missing or partial criterion.
  - Package sub-specs:
    - [`server/specs/0001`](../server/specs/0001-pr-list-cost-all-runs.md)
    - [`client/specs/0001`](../client/specs/0001-review-runs-severity-filter.md)
    - [`reviewer-core/specs/0001`](../reviewer-core/specs/0001-run-cost-per-call.md)
    - [`e2e/specs/0001`](../e2e/specs/0001-findings-severity-flows.md)
- **Non-goals:**
  - Renaming the skill folder (see Decisions).
  - Fixing code for lint warnings.
  - A severity filter on the PR list page.

## Decisions
| # | Decision |
|---|---|
| 8 | **Intentional exception.** The skill stays at `.claude/skills/engineering-insights/SKILL.md` (hyphen). Claude Code skill names allow only lowercase letters, digits and hyphens, and the hook, CLAUDE.md and INSIGHTS headers all link the hyphenated path. |
| 11 | Old entries without `file:line` get an in-place, evidence-only backfill, which the skill allows once. |
| 12 | PR list COST = sum of `cost_usd` over **all** `status='done'` runs of the PR. It replaces the "latest round" rule of spec 0001. |
| 20 | The PR list FINDINGS column and popover show the **latest single run**: the newest `done` run that has a `kind='review'` review. The popover is titled "N findings in this run". |
| 4 | ESLint 9 (flat config) is added to all four packages with a `lint` script. Rules that fail on existing code start as warnings. `eslint-config-next` 15.5 caps ESLint at version 9. |

## Design
- **Criteria 1–7, 15:**
  - The root `CLAUDE.md` gets these sections: Tech stack, Packages (with roles), Run, Verify, Naming conventions, Do not touch (migrations, lockfiles), and a 5-phase Workflow.
  - The spec template gets a `## Phases` log.
- **Criteria 12, 20:** `PrMeta.findings_round_run_ids` becomes `findings_run_id`. The server computes COST with a grouped sum and picks the latest run with a review. See the server spec.
- **Criteria 16–19, 21, 22:**
  - Severity pills with a click filter in `FindingsPanel`.
  - Read-only `FindingsPopover` items.
  - Accept and Reject always visible on each `FindingCard`.
  - See the client spec.
- **Criterion 24:** real docs and specs in every package, indexed from each `docs/README.md` and `specs/README.md`.

## Acceptance criteria
- [x] Every criterion from 1 to 24 passes the checks in `HW_validation.txt`, except 8, which is covered by the exception above.
- [x] Every INSIGHTS entry has a date header, a `[tag]` and a `path:line` evidence line (scripted audit: 0 failing entries).
- [x] `lint`, `typecheck` and tests pass in every package, and `./scripts/e2e.sh` passes 7/7 flows.

## Test plan
- **Automated:** the server unit and integration tests, client vitest, e2e flows 02 and 04 (see the package specs), and lint in CI.
- **Manual check on the dev app:**
  - COST vs `select sum(cost_usd) … where status='done'`.
  - Popover title, and no buttons in the popover.
  - Pill counts vs cards, and the filter toggle.
  - Accept and Reject on every finding.
  - Findings and COST in the trace drawer.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-15 | Read `HW_validation.txt`, all CLAUDE.md, INSIGHTS and specs; audited the code per criterion |
| Planning | 2026-09-15 | Plan approved; decisions above |
| Implementation | 2026-09-15 | CLAUDE.md/INSIGHTS/docs/specs; server list query + contract; client pills, filter, read-only popover, Accept/Reject, i18n; e2e flows 02/04; ESLint in 4 packages + CI |
| Validation | 2026-09-15 | server typecheck/lint ✓, unit 103/103, integration 30/30 · client build/typecheck/lint ✓, vitest 76/76 · reviewer-core typecheck/lint ✓, 24/24 · e2e typecheck/lint ✓, flows 7/7 · manual: API cost = SQL sum for PRs #1–#4; filter toggle, trace COST + findings |
| Completion | 2026-09-15 | Package specs done; docs in each `docs/`; INSIGHTS wrap-up (server, client, reviewer-core, e2e) |
