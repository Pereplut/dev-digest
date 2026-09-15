---
title: Run cost badge
status: in-progress  # draft | approved | in-progress | done
lesson: L01
packages: [server, client, e2e]
---

## Problem
Reviewers can't see what an agent review costs. Every LLM call already returns
`costUsd` and the engine sums it per run (`reviewer-core/src/review/run.ts`), but
the server drops it when finishing the run (`server/src/modules/reviews/run-executor.ts`),
and `agent_runs` has no cost column (removed in migration `0009`).

## Scope / non-goals
In scope:
1. **PR list:** a COST column between Status and Updated.
2. **PR page, Agent runs → Timeline:** the run's cost under its start time.
3. **Run trace drawer:** a COST stat tile between Tokens and Findings.
4. Current Anthropic and OpenAI model prices in `server/src/adapters/llm/pricing.ts`.

Non-goals:
- the FINDINGS column and per-row "Run Review" button shown in the mockup
- cost in the verdict banner or the Review runs accordion
- the cost of failed or cancelled runs, which is spent but not tracked
- backfilling runs recorded before this feature
- the severity filter (the other half of L01)

## Design
- **Persistence:** `agent_runs.cost_usd double precision`, where null means "unknown price".
  - The executor stores the engine's `ReviewOutcome.costUsd` for done runs.
  - Failed and cancelled runs store null.
  - The trace document's `stats.cost_usd` gets the same value.
- **Cost source:** no extra model calls.
  - OpenRouter uses the provider-reported `usage.cost`, falling back to PriceBook (live prices) and then the static table.
  - OpenAI and Anthropic use the static `estimateCost` table.
  - If any call in a run has an unknown price, the run's cost is null.
- **Contracts** (both vendored copies):
  - `RunSummary.cost_usd` (nullable)
  - `RunStats.cost_usd` (nullish; old traces don't have it)
  - `PrMeta.cost_usd` and `PrMeta.cost_complete` (nullish, list endpoint only)
- **PR list value = latest review round:** the sum over each agent's newest `done` run on the PR.
  - A failed newest run doesn't hide that agent's previous done run.
  - `cost_usd` is the sum of known costs, or null if none are known.
  - `cost_complete` is false when some run in the round has no price.
- **Formatting (`formatUsd`)**, one rule everywhere:
  - null, negative or NaN → `—`
  - `0` → `$0.000` (free model)
  - ≥ 0.001 → 3 decimals (`$0.014`, `$0.060`)
  - below that → 2 significant digits (`$0.00042`)
- **UI:** `RunCostBadge` (`client/src/components/run-cost-badge/`).
  - It shows `—` unless the run is `done`.
  - A partial PR total renders as `≥$0.014` with a tooltip.
  - The drawer tile uses `formatUsd`, preferring the run row's cost and falling back to `trace.stats.cost_usd`.

## Acceptance criteria
- Every completed run with a known price shows its cost in the Timeline and the drawer, and both show the same value.
- A run without data shows `—`, never `$0.00`. A running, failed or cancelled run never shows a price.
- Costs have at least 3 digits after the point (`$0.012`, not `$0.01`).
- The PR list COST column shows the latest review round's total, `≥` when partial, and `—` when no run has a price.
- Reviews make no extra model calls.
- For one real OpenRouter run, the cost matches the run log and the OpenRouter dashboard Activity entry for session `owner/repo#N:Agent`.

## Test plan
- **reviewer-core:** run cost is the sum of per-call costs, and one null makes it null.
- **server unit:** `RunTrace` still parses a trace without `stats.cost_usd`, and the pricing table has a current model id.
- **server integration:**
  - a review run persists cost to `agent_runs`, `trace.stats` and `GET /pulls/:id/runs`
  - `GET /repos/:id/pulls` sums the latest round, ignores older and failed runs, flags partial rounds, and returns null for PRs without runs
- **client:**
  - `RunCostBadge` covers formatter cases and status gating
  - PRRow COST cell
  - RunHistory cost under the time
  - drawer COST tile
- **e2e:** the seeded PR #482 shows `$0.016` in the list and `$0.015` in the Timeline (flows 02 and 04).
- **Manual:** compare one real run against the OpenRouter dashboard.
