import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { withTimeout, TimeoutError } from '../../platform/resilience.js';

/**
 * OpenRouter adapter — a time bound around the provider that lives in
 * `reviewer-core` (shared with the CI runner, so it cannot import this
 * package's `platform/`; `reviewer-core/src` may import only
 * `@devdigest/shared` and the stdlib).
 *
 * WHY THIS EXISTS. `openai.ts` and `anthropic.ts` each wrap their SDK call in
 * `withTimeout`; OpenRouter had no such wrapper, and its only bound was the
 * OpenAI SDK's own `timeout` option inside `reviewer-core/src/llm/openrouter.ts`.
 * That bound does not hold: `server/INSIGHTS.md` (2026-09-27) records a run
 * sitting at 1000s+ with a 90s client timeout configured, producing nothing,
 * `cost_usd: 0`, `duration_ms: null`, and the row stuck `running`. Every seeded
 * agent uses `provider: 'openrouter'`, so this is the DEFAULT review path, not
 * an edge case — the entry's closing line was that this provider needs the same
 * `withTimeout` treatment the other two get. This is that.
 *
 * A TIME BOUND ALONE IS HALF THE FIX. `withTimeout` is a `Promise.race`: it
 * frees the caller, but the HTTP request keeps running and keeps being billed —
 * the same gap `server/INSIGHTS.md` (2026-09-27) records for cancel, "it does
 * not stop the spend". OpenRouter is the ONE provider that honours
 * `StructuredRequest.signal` (`vendor/shared/adapters.ts`), so this is the only
 * place both halves can be combined, and `completeStructured` does: it passes a
 * signal down and aborts it when the bound fires. The race stays as the outer
 * guarantee, because an SDK that ignores its own 90s timeout cannot be trusted
 * to honour an abort either.
 *
 * NO `withRetry` HERE, deliberately. `openai.ts` composes
 * `withRetry(() => withTimeout(...))`, but the OpenRouter provider's own
 * docstring says the SDK already "retries on timeout/5xx/429 with backoff".
 * Wrapping it again would multiply one logical review into several paid model
 * calls — the same hazard spec 0017's AC-13 had to close when `JobRunner`'s
 * `withRetry` turned one generation into up to three. A bound that costs more
 * money than the hang it prevents is not a fix.
 */

/**
 * Per-CALL ceiling, not per-run. A review of a large diff is a map-reduce over
 * chunks, so a 60-minute run is many calls and is not by itself pathological.
 *
 * The two measurements that bracket this number, both from the dev database:
 *   - a SUCCESSFUL single-pass Performance review took 470_058 ms (7.8 min),
 *     so anything at or below ~8 minutes would kill work that completes;
 *   - the recorded hang ran past 1000 s (16.7 min) and never returned.
 *
 * 15 minutes sits between them: generous enough for the slowest call observed
 * to succeed, tight enough that a hung call fails instead of occupying a
 * `running` row until someone notices. It is a judgement call on two data
 * points, not a measured optimum — raise it if a legitimate call is ever
 * killed, and say so here when you do.
 *
 * A caller that knows better still wins: `req.timeoutMs` overrides this.
 */
const DEFAULT_TIMEOUT = 900_000;

export class TimeBoundedOpenRouterProvider implements LLMProvider {
  /**
   * Delegated, not asserted. Callers key behaviour off this (`buildLlm`'s
   * cache, cost attribution, the per-provider `signal` support recorded in
   * `vendor/shared/adapters.ts`), and the inner provider's id is configurable —
   * `reviewer-core/src/llm/openrouter.ts:47` sets it from `opts.id ?? 'openrouter'`,
   * so the OpenAI-compatible-base-URL variant reports `'openai'`. Hardcoding
   * `'openrouter'` here would make the decorator observable as a provider it is
   * not the moment that variant is wired through it.
   */
  get id(): LLMProvider['id'] {
    return this.inner.id;
  }

  constructor(private readonly inner: LLMProvider) {}

  /**
   * Not time-bounded: `listModels` is a small catalogue GET on the settings
   * path, not a review call, and the hang this adapter exists for is in
   * completion. Bounding it would add a failure mode without closing one.
   */
  async listModels(): Promise<ModelInfo[]> {
    return this.inner.listModels();
  }

  /**
   * Bounded but NOT abortable: `CompletionRequest` has no `signal`, so there is
   * nothing to cancel with. In practice this path is unreachable — the inner
   * provider throws `NOT_SUPPORTED` for `complete()` and `embed()`
   * (`reviewer-core/src/llm/openrouter.ts:166,169`), review goes through
   * `completeStructured` — so the bound here is symmetry, not a fix.
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return withTimeout(this.inner.complete(req), req.timeoutMs ?? DEFAULT_TIMEOUT);
  }

  /** The live review path: bounded AND aborted, so a timeout stops the spend. */
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const ms = req.timeoutMs ?? DEFAULT_TIMEOUT;
    const onTimeout = new AbortController();
    // Chained, so an external cancel (the run's own AbortController, spec
    // 0029-30) still reaches the SDK; ours only adds the timeout reason.
    const signal = req.signal
      ? AbortSignal.any([req.signal, onTimeout.signal])
      : onTimeout.signal;

    try {
      return await withTimeout(this.inner.completeStructured({ ...req, signal }), ms);
    } catch (err) {
      if (err instanceof TimeoutError) onTimeout.abort(err);
      throw err;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.inner.embed(texts);
  }
}
