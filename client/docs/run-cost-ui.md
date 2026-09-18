# Run cost UI

How the studio shows review cost. Server side: [`server/docs/run-cost.md`](../../server/docs/run-cost.md).

## Where it shows
| Place | Component | Value |
|---|---|---|
| PR list → COST column | `PRRow` → `RunCostBadge costUsd partial` | `PrMeta.cost_usd`: sum over **all successful (`done`) runs** of the PR. `partial` when `cost_complete === false`. |
| PR → Agent runs → Timeline tile | `RunHistory` → `RunCostBadge costUsd status` | That run's `RunSummary.cost_usd`, under its start time |
| Run trace drawer → Stats | `TraceBody` → `<Stat label="COST">` | The run row first, then `trace.stats.cost_usd` as a fallback |

## `RunCostBadge` states (`src/components/run-cost-badge`)
| Input | Renders |
|---|---|
| `costUsd ≥ 0.001` | `$0.014` (3 decimals) |
| `0 < costUsd < 0.001` | `$0.00042` (2 significant digits) |
| `costUsd === 0` | `$0.000` (a free model, not missing data) |
| `null` / negative / NaN | `—` (unknown, never `$0.00`) |
| `status` given and not `done` | `—` (an unfinished run never shows a price) |
| `partial` with a known value | `≥$0.014`, with the tooltip `list.costPartial` |

`formatUsd` (`format.ts`) is the only USD formatter. Use it rather than `toFixed`.

## Trace drawer cost source
`TraceBody.tsx` computes `run && run.status !== "done" ? null : (run?.cost_usd ?? stats.cost_usd ?? null)`.
- `run_traces.trace` is a stored jsonb snapshot, so traces written before migration `0010` have no `stats.cost_usd`.
- The `agent_runs` row (`usePrRuns`) is therefore the reliable source.
