---
title: Browser coverage for findings severity UI and run cost
status: done  # draft | approved | in-progress | done
lesson: L01
packages: [e2e]
parent: specs/0003-hw-validation-alignment.md
---

## Problem
Homework criteria 12, 16–18, 20 and 22 describe user-visible behavior on two pages. Unit tests
cover the components, but nothing proved them in a real browser against the real API and seed.

## Scope / non-goals
- **In scope:** extend flows `02-repo-pulls-detail` and `04-pr-findings`, and document the new `wait --fn` and `scrollintoview` locators.
- **Non-goals:**
  - clicking Accept / Reject (mutates the seed)
  - live review runs (model calls)
  - visual regression

## Design
Deterministic steps only (see [`docs/locators.md`](../docs/locators.md)):
- **Flow 02 (PR list):**
  1. `$0.016` (sum of all done runs)
  2. hover chips "1 critical, 1 warning"
  3. `wait --text "2 FINDINGS IN THIS RUN"`
  4. preview text: the Stripe title and `src/api/users.ts:45-52`
- **Flow 04 (PR → Agent runs):**
  1. "REVIEW RUNS"
  2. pills "1 CRITICAL" and "1 WARNING"
  3. "Reject" visible
  4. `scrollintoview` the pill
  5. click `--name "1 warning" --exact`
  6. `wait --fn` until the Stripe card is gone, and the N+1 card stays
  7. click again → the Stripe card is back
  8. `scrollintoview` the Timeline chips, then the existing hover ("2 FINDINGS IN THIS RUN")

## Acceptance criteria
- [x] `./scripts/e2e.sh` passes 7/7 with the extended flows.
- [x] A filter step leaves the page in its initial state for the following steps.

## Test plan
Run `./scripts/e2e.sh` locally. CI runs `.github/workflows/e2e-web.yml`.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-15 | Flows covered the cost and the timeline popover, not the pills, the filter or Reject |
| Planning | 2026-09-15 | `--exact` confirmed in `agent-browser find --help`; `wait --fn` for disappearance |
| Implementation | 2026-09-15 | flows 02 and 04, README locator notes |
| Validation | 2026-09-15 | First runs 6/7. The pill click was a silent miss below the fold (app inner scroll container), diagnosed with a temporary debug flow and fixed with `scrollintoview`. Final run 7/7. |
| Completion | 2026-09-15 | `docs/locators.md` and e2e INSIGHTS updated |
