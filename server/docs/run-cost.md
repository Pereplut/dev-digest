# Run cost

How a review run's USD cost is produced, stored and served. Spec:
[`specs/0001-run-cost-badge.md`](../../specs/0001-run-cost-badge.md). The PR list rule is
amended by [`specs/0001-pr-list-cost-all-runs.md`](../specs/0001-pr-list-cost-all-runs.md).

## Where the number comes from
Cost is a by-product of the calls a review already makes, so there are no extra model calls.

1. **Per LLM call**, the provider adapter returns `costUsd: number | null` (`StructuredResult` in `src/vendor/shared/adapters.ts`).
   - **OpenRouter** (`reviewer-core/src/llm/openrouter.ts`) uses the cost the provider reports in `usage.cost`, summed over repair retries. When that is missing, it calls the injected estimator: `PriceBook` (live `/models` prices, `src/platform/price-book.ts`), which falls back to the static table.
   - **OpenAI / Anthropic** (`src/adapters/llm/openai.ts`, `anthropic.ts`) use the static table `estimateCost` in `src/adapters/llm/pricing.ts`.
   - An unknown model gives `null`, never `0`.
2. **Per run**, `reviewPullRequest` sums the calls into `ReviewOutcome.costUsd` (`reviewer-core/src/review/run.ts`). If any call's cost is `null`, the whole run's cost is `null` (see [reviewer-core docs](../../reviewer-core/docs/cost-aggregation.md)).
3. **Persisted** by `ReviewRunExecutor` (`src/modules/reviews/run-executor.ts`) in:
   - `agent_runs.cost_usd` (`double precision`, migration `0010`)
   - the trace document's `stats.cost_usd`

   Failed and cancelled runs store `null`. Money spent before a failure is not tracked.

## Where it is served
| Route | Field | Meaning |
|---|---|---|
| `GET /pulls/:id/runs` | `RunSummary.cost_usd` | The run's cost (`null` = unknown or unfinished). Shown on each Timeline tile. |
| `GET /runs/:id/trace` | `RunTrace.stats.cost_usd` | The same value, shown as the COST stat in the trace drawer. Absent in traces written before migration `0010`. |
| `GET /repos/:id/pulls` | `PrMeta.cost_usd`, `PrMeta.cost_complete` | Total over **all successful runs** of the PR (see below) |

### PR list total: all successful runs
Computed in `src/modules/pulls/routes.ts` with one query:

```sql
SELECT pr_id, sum(cost_usd), count(*), count(cost_usd)
FROM agent_runs
WHERE workspace_id = $1 AND pr_id IN (…) AND status = 'done'
GROUP BY pr_id
```

- **Every `done` run counts.** That includes re-runs by the same agent and runs whose agent was later deleted (`agent_id` NULL), because that money was spent.
- **Failed, cancelled and running runs never count.**
- **`cost_usd`** is the sum of known costs, or `null` when no done run has a price. The driver returns `sum` as a string, so it is converted with `Number()`.
- **`cost_complete`** is `false` when `count(cost_usd) < count(*)`, meaning some done run has no price. The UI then shows `≥$…`.
- **A PR with no done run** gets `cost_usd = null` and `cost_complete = null`, and the UI shows `—`.
- **Seed:** PR #482 has General 0.0149 + Security 0.0011, so its list total is `$0.016`. `server/test/integration.it.test.ts` and e2e flow 02 assert this.

This replaced the earlier "latest review round" rule (each agent's newest done run) to satisfy
the homework criterion "the sum of all successful runs per PR".

## Known data gap: migrations `0009` / `0010`

`0009_complex_runaways.sql` **drops** `agent_runs.cost_usd`; `0010_lethal_karen_page.sql`
re-adds it as `double precision`. Migrations here are append-only and never hand-edited, so the
pair stays in the history: **replaying `0000`→`0011` from scratch destroys every cost recorded
before `0009`**, and nothing can recover those values.

Measured on the dev database (2026-09-18, read-only):

| total runs | done | cost present | cost NULL | earliest | latest |
|---:|---:|---:|---:|---|---|
| 25 | 25 | 19 | 6 | 2026-09-15 | 2026-09-17 |

Every row post-dates the pair, and the 6 NULLs are explained by the INSIGHTS entry "Runs made
while a pre-cost branch was checked out have NULL cost forever" — not by the migration. So no
valuable cost history is at risk here. Two caveats: this covers one clone's database only, and
by definition it cannot see rows `0009` had already removed.

### Pre-flight before converting `cost_usd` to `numeric`

`double precision` is the wrong type for money: the PR-list total is produced by `sum(cost_usd)`
in SQL, so binary-float accumulation makes it non-reproducible. When the column is converted to
`numeric(12,6)`, run this audit **first, against every environment being migrated** — not just a
dev box — so the call is made on data rather than assumption:

```sql
select count(*)                    as total_runs,
       count(cost_usd)             as with_cost,
       count(*) - count(cost_usd)  as null_cost,
       min(ran_at)::date           as earliest,
       max(ran_at)::date           as latest
from agent_runs;
```

If `with_cost` is non-trivial anywhere, back the column up before the conversion.

## Keeping prices right
- `pricing.ts` records when its OpenAI and Anthropic prices were last verified. Re-check them against the providers' pricing pages when adding models.
- A model missing from the table makes its runs show `—` and PR totals `≥`.
- To check a real run, compare `select cost_usd, tokens_in, tokens_out from agent_runs where id = …` with the OpenRouter dashboard's Activity entry for session `owner/repo#N:Agent`. If the run had repair retries, add up its generations.
- To check a PR total, compare it with `select sum(cost_usd) from agent_runs where pr_id = … and status = 'done'`.
