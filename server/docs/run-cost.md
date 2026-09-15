# Run cost

How a review run's USD cost is produced, stored and served. Spec:
[`specs/0001-run-cost-badge.md`](../../specs/0001-run-cost-badge.md).

## Where the number comes from
No extra model calls: cost is a by-product of the calls a review already makes.

1. **Per LLM call**, the provider adapter returns `costUsd: number | null` (`StructuredResult` in `src/vendor/shared/adapters.ts`).
   - **OpenRouter** (`reviewer-core/src/llm/openrouter.ts`) uses the provider-reported `usage.cost`, summed over repair retries. Otherwise it calls the injected estimator: `PriceBook` (live `/models` prices, `src/platform/price-book.ts`), which falls back to the static table.
   - **OpenAI / Anthropic** (`src/adapters/llm/openai.ts`, `anthropic.ts`) use the static table `estimateCost` in `src/adapters/llm/pricing.ts`.
   - An unknown model gives `null`, never `0`.
2. **Per run**, `reviewPullRequest` sums the calls into `ReviewOutcome.costUsd` (`reviewer-core/src/review/run.ts`). If any call's cost is `null`, the whole run's cost is `null`.
3. **Persisted** by `ReviewRunExecutor` (`src/modules/reviews/run-executor.ts`):
   - `agent_runs.cost_usd` (`double precision`, migration `0010`)
   - the trace document's `stats.cost_usd`
   - Failed and cancelled runs store `null`. Money spent before a failure is not tracked.

## Where it is served
| Route | Field | Meaning |
|---|---|---|
| `GET /pulls/:id/runs` | `RunSummary.cost_usd` | The run's cost (`null` = unknown or unfinished) |
| `GET /runs/:id/trace` | `RunTrace.stats.cost_usd` | Same value. Absent in traces written before migration `0010`. |
| `GET /repos/:id/pulls` | `PrMeta.cost_usd`, `PrMeta.cost_complete` | Latest review round (see below) |

**Latest review round** (`src/modules/pulls/routes.ts`):
- One `SELECT DISTINCT ON (pr_id, agent_id)` over `status = 'done'` runs, ordered newest first, so each agent contributes its newest completed run. A failed newer run doesn't hide the previous one.
- Rows are summed per PR in JS.
- `cost_usd` is the sum of known costs (`null` if none).
- `cost_complete` is `false` when some run in the round has no price, so the UI shows `≥`.
- The `(pr_id, agent_id, ran_at)` index backs this query, which runs on every PR list refetch.

## Keeping prices right
- `pricing.ts` records when its OpenAI and Anthropic prices were last verified. Re-check them against the providers' pricing pages when adding models.
- A model missing from the table makes its runs show `—` and PR totals `≥`.
- To check a real run, compare `select cost_usd, tokens_in, tokens_out from agent_runs where id = …` with the OpenRouter dashboard Activity entry for session `owner/repo#N:Agent`. Add up the generations if the run had repair retries.
