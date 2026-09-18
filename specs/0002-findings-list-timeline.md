---
title: Findings on PR list and timeline
status: done  # draft | approved | in-progress | done
lesson: L01
packages: [server, client, e2e]
---

## Problem
Reviewers see a PR's score and cost, but not *what* the agents found until they open the PR.
`PrMeta` and `RunSummary` only carry `findings_count` / `blockers`. There are no per-severity
counts, and the list never shows findings. A first version (`97b6edc`, `0953fdc`) was reverted by `c6af1e4`.
It also counted dismissed findings and used "latest review" rather than the review round.

## Scope / non-goals
In scope (mockups `findings_1.PNG`, `findings_2.PNG`):
1. **PR list:** a FINDINGS column between SCORE and STATUS.
   - It shows a severity chip (icon + count) for each of CRITICAL / WARNING / SUGGESTION. Zero counts are hidden, and `—` means nothing to show.
   - Hovering or focusing the chips opens a popover titled "N findings" that lists them.
2. **PR page → Agent runs → Timeline:** the same chips under each run's agent name, next to "· N blockers".
   - A popover titled "N findings in this run".
3. **Popover item:** severity icon, title, category, `file:lines`, confidence, and a 2-line excerpt.

Non-goals:
- the per-row Run Review button, Triage queue, Review all, auto-review header status
- a severity filter or `?severity=` deep link
- merging duplicate findings across agents
- backfilling reviews that have no `run_id`

## Design
> **Amended 2026-09-15 by [spec 0003](0003-hw-validation-alignment.md):**
> - the list counts and popover now use the **latest single run** with a review (`PrMeta.findings_run_id` replaced `findings_round_run_ids`)
> - the list popover is titled "N findings in this run"
> - popover previews are read-only (no click-through)
> - the Review runs card gained severity pills + a filter ([client spec 0001](../client/specs/0001-review-runs-severity-filter.md))
>
> The round-based rules below are historical.

- **PR list value = latest review round**, the same round as COST (spec 0001): each agent's newest `done` run.
  - Findings of those runs' `kind='review'` reviews are counted, joined via `reviews.run_id`.
  - `dismissed_at IS NULL` only: pending and accepted findings count, dismissed ones don't.
  - Duplicates across agents are counted as they are.
- **Computed on read**, because dismissing or accepting a finding changes the counts.
  - One grouped query in `GET /repos/:id/pulls`, sharing the cost round query.
  - New indexes on `reviews(run_id)` and `findings(review_id)` (migration 0011).
- **Contracts** (both vendored copies):
  - `FindingsCounts {CRITICAL, WARNING, SUGGESTION}`.
  - `PrMeta.findings_counts` (nullish; null = no done run), list endpoint only.
  - `PrMeta.findings_round_run_ids` (nullish): the round's run ids, so the popover lists exactly the counted findings.
- **List popover data:** lazily from the existing `GET /pulls/:id/reviews`, fetched on first open and cached as `["reviews", prId]`.
  - The client keeps reviews whose `run_id` is in the round, then drops dismissed findings.
- **Timeline:** built on the client from the reviews the tab already loads, matched by `run_id`. No server change.
  - A run without a matched review keeps the old "N finding(s)" text and has no popover.
- **UI:** shared `client/src/components/findings-summary/`.
  - `SeverityCounts`: compact `SeverityBadge` chips.
  - `FindingsPopover`: portal to `document.body` with `position: fixed`, so list containers can't clip it. Opens on hover or focus, closes on Escape, and stops click propagation so the row doesn't navigate.
- **Freshness:** finding accept/dismiss and run delete also invalidate `["pulls"]`.
- **Known behaviour:**
  - `agent_runs.blockers` / `findings_count` are fixed at run time. After a dismissal, the timeline can show fewer chips than "N blockers".
  - Reviews written before migration 0008 have no `run_id` and count 0.

## Acceptance criteria
- Seeded PR #482 shows 1 critical + 1 warning in the list, and hovering lists both findings with `file:lines` and confidence.
- Dismissing a finding lowers the list and timeline counts right away. Accepting doesn't change them.
- A newer failed run doesn't hide an agent's previous findings. A newer done run replaces them.
- A PR without done runs shows `—`. Chips never show a zero.
- Clicking chips or popover content never triggers the row's navigation. The popover works from the keyboard (focus opens it, Escape closes it).
- No extra model calls. The list payload grows only by counts and run ids.

## Test plan
- **server unit:** `rollupSeverities` tallies grouped rows into the contract shape and ignores unknown severities.
- **server integration:** `GET /repos/:id/pulls` counts cover:
  - the seeded round
  - dismissed findings excluded
  - newer done vs failed runs
  - a done run without a review
  - summary reviews ignored
  - null for a PR without runs
- **client:**
  - findings-summary helpers, SeverityCounts, FindingsPopover (hover/focus/Escape, no click bubbling)
  - PRRow FINDINGS cell and popover
  - RunHistory chips, fallback text and popover
- **e2e:**
  - flow 02: list header FINDINGS and the #482 popover content
  - flow 04: the timeline popover "2 findings in this run"
