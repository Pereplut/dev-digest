---
title: Run cost from per-call LLM usage
status: done  # draft | approved | in-progress | done
lesson: L01
packages: [reviewer-core]
parent: specs/0001-run-cost-badge.md
---

## Problem
The run cost badge (root spec 0001) needs a USD cost for each review run. The engine is the only
place that sees every LLM call of a run (map chunks, reduce, and structured-output repair
retries), but it returned no cost.

## Scope / non-goals
- **In scope:**
  - `costUsd` on each `completeStructured` result.
  - The summing rule in `reviewPullRequest`.
  - Injecting the estimator.
- **Non-goals:**
  - Storing prices in the engine.
  - Persistence (server).
  - Display (client).
  - Tracking money spent by failed runs.

## Design
Details in [`docs/cost-aggregation.md`](../docs/cost-aggregation.md).
- **OpenRouter adapter:** uses `usage.cost` summed over repair retries. When that is missing, it calls the injected `estimateCost(model, in, out)`, and falls back to `null`.
- **`reviewPullRequest`:** keeps a running sum that becomes `null` as soon as any call is `null`, and exposes it as `ReviewOutcome.costUsd`.
- **No extra model calls.**

## Acceptance criteria
- [x] A run whose calls are all priced returns the exact sum.
- [x] One unpriced call makes the run cost `null`.
- [x] The engine has no price table; the estimator is injected by the server.

## Test plan
- `test/run.test.ts`: a stubbed `LLMProvider` with priced and unpriced calls.
- The server integration test checks that `agent_runs.cost_usd` and `trace.stats.cost_usd` are persisted.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-15 | Cost was dropped between the engine and the server (root spec 0001) |
| Planning | 2026-09-15 | Null-propagation rule chosen over partial sums |
| Implementation | 2026-09-15 | `src/review/run.ts:159-216`, `src/llm/openrouter.ts:96-107` |
| Validation | 2026-09-15 | `npm test`, plus server integration tests |
| Completion | 2026-09-15 | Documented in `docs/cost-aggregation.md` (written retroactively for the homework, spec 0003) |
