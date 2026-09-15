# Cost aggregation

How the engine turns per-call LLM costs into one run cost. It makes no extra model calls: cost is
read from calls the review already makes. Server persistence and display:
[`server/docs/run-cost.md`](../../server/docs/run-cost.md).

## Per call: `LLMProvider.completeStructured` → `costUsd`
`src/llm/openrouter.ts`:
- **Provider-reported cost:** OpenRouter returns `usage.cost` (USD, an OpenRouter extension, `:96-98`). It is added up across the structured-output **repair retries** of one logical call.
- **Estimate when absent:** `costFromApi ?? estimateCost(model, tokensIn, tokensOut) ?? null` (`:107`).
  - `estimateCost` is **injected** by the server (`PriceBook` → static `pricing.ts`), so the engine never holds a price table.
- **Unknown model:** `null`. It is never `0`, because `0` means a free model.

## Per run: `reviewPullRequest` (`src/review/run.ts`)
```ts
let costUsd: number | null = 0;                                          // :159
// for every chunk call (map) and the reduce call:
costUsd = costUsd == null || res.costUsd == null ? null : costUsd + res.costUsd;   // :184
return { …, costUsd };                                                   // :216
```
- **Null wins.** A single unpriced call makes the whole run `null`, not a partial sum, so the UI shows `—` rather than an amount that is too low.
- **A `—` run usually means a pricing gap.** Add the model to `server/src/adapters/llm/pricing.ts`; don't special-case the sum.
- **Map-reduce runs** (large diffs sliced by `sliceDiff`) add up every chunk call.

## Tests
`test/run.test.ts` stubs the `LLMProvider` and covers two cases:
- a priced sum over calls
- the null-propagation rule
