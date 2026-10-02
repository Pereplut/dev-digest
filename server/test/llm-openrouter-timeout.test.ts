/**
 * The OpenRouter provider is the DEFAULT review path (every seeded agent uses
 * `provider: 'openrouter'`), and it was the only one with no enforced time
 * bound: `openai.ts`/`anthropic.ts` wrap their SDK call in `withTimeout`, while
 * OpenRouter relied on the OpenAI SDK's own `timeout` option inside
 * reviewer-core. `server/INSIGHTS.md` (2026-09-27) records that bound failing in
 * production — a run past 1000s with a 90s client timeout configured, producing
 * nothing and leaving the row stuck `running`.
 *
 * These tests drive the real `TimeBoundedOpenRouterProvider` against stub inner
 * providers. Two cases carry the weight: the never-settling call (it hangs to
 * the test timeout if `withTimeout` is removed) and the abort-on-timeout case
 * (a race alone frees the caller but keeps paying for the generation).
 *
 * The stubs are typed `LLMProvider` values, not `as unknown as` casts.
 * `server/INSIGHTS.md` (2026-09-18) calls that cast "an unchecked contract, not
 * a typed one", and this file proved it: the first version of the adapter
 * omitted the required `id`, every test here passed, and only `pnpm typecheck`
 * on the container wiring caught it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import type {
  LLMProvider,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { TimeBoundedOpenRouterProvider } from '../src/adapters/llm/openrouter.js';
import { TimeoutError } from '../src/platform/resilience.js';

afterEach(() => {
  vi.useRealTimers();
});

function completion(): CompletionResult {
  return { text: 'ok', model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 };
}

/** A real `StructuredRequest` — `schema` and `schemaName` are required. */
function structuredRequest(timeoutMs?: number): StructuredRequest<Record<string, never>> {
  return { model: 'm', messages: [], schema: z.object({}), schemaName: 'test', timeoutMs };
}

/** Base double: every port method present, overridden per test. */
function inner(over: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: 'openrouter',
    async listModels() {
      return [];
    },
    async complete() {
      return completion();
    },
    completeStructured<T>(): Promise<StructuredResult<T>> {
      return Promise.reject(new Error('not stubbed'));
    },
    async embed() {
      return [];
    },
    ...over,
  };
}

/** An inner provider whose completion never settles — the hang, reproduced. */
function hangingInner(): LLMProvider {
  return inner({
    complete: vi.fn(() => new Promise<CompletionResult>(() => {})),
    completeStructured: vi.fn(() => new Promise<StructuredResult<never>>(() => {})),
  });
}

describe('TimeBoundedOpenRouterProvider', () => {
  it('rejects a never-settling complete() instead of hanging forever', async () => {
    vi.useFakeTimers();
    const provider = new TimeBoundedOpenRouterProvider(hangingInner());

    const p = provider.complete({ model: 'm', messages: [], timeoutMs: 1_000 });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it('rejects a never-settling completeStructured() — the review path', async () => {
    vi.useFakeTimers();
    const provider = new TimeBoundedOpenRouterProvider(hangingInner());

    const p = provider.completeStructured(structuredRequest(1_000));
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it('ABORTS the in-flight call when the bound fires, so the timeout stops the spend', async () => {
    // A `Promise.race` alone frees the caller while OpenRouter keeps generating
    // and keeps billing — server/INSIGHTS.md (2026-09-27) records that exact gap
    // for cancel. OpenRouter is the one provider honouring `signal`, so the
    // bound must reach the HTTP request, not just the await.
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const provider = new TimeBoundedOpenRouterProvider(
      inner({
        completeStructured: vi.fn((req: StructuredRequest<unknown>) => {
          seen = req.signal;
          return new Promise<StructuredResult<never>>(() => {});
        }),
      }),
    );

    const p = provider.completeStructured(structuredRequest(1_000));
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
    expect(seen!.aborted).toBe(true);
  });

  it("chains the caller's own signal, so an external cancel still aborts the SDK", async () => {
    // The run-level AbortController must keep working through the decorator.
    //
    // Two details are load-bearing, both found by mutating the chain away and
    // watching this test pass anyway:
    //   - a DISTINCT abort reason, asserted. This is what separates the cancel
    //     path from the timeout path. With the chain dropped the call still
    //     rejects — eventually, via TimeoutError — so `rejects.toBeDefined()`
    //     passed, and `seen.aborted` went true as well, because `seen` was then
    //     the adapter's OWN controller, which the catch aborts. Both assertions
    //     were satisfied by the bug.
    //   - REAL timers with a short bound. Fake timers also kill that mutant,
    //     but by hanging: vitest's own 5s test timeout does not fire while they
    //     are installed, so the suite stalls instead of going red. Here a
    //     broken chain fails in ~1s on the reason.
    // The stub honours the signal rather than hanging, so the promise settles
    // and withTimeout's `finally` clears its timer.
    let seen: AbortSignal | undefined;
    const provider = new TimeBoundedOpenRouterProvider(
      inner({
        completeStructured: vi.fn((req: StructuredRequest<unknown>) => {
          seen = req.signal;
          return new Promise<StructuredResult<never>>((_, reject) => {
            req.signal?.addEventListener('abort', () => reject(req.signal!.reason), { once: true });
          });
        }),
      }),
    );
    const outer = new AbortController();

    const p = provider.completeStructured({ ...structuredRequest(1_000), signal: outer.signal });
    expect(seen?.aborted).toBe(false);
    outer.abort(new Error('cancelled by the run'));
    await expect(p).rejects.toThrow('cancelled by the run');
    expect(seen?.aborted).toBe(true);
  });

  it('does NOT bound a call that settles in time — a slow review still completes', async () => {
    // The successful Performance review this fix was written against took
    // 470s. A bound that kills work which completes is worse than no bound.
    vi.useFakeTimers();
    const provider = new TimeBoundedOpenRouterProvider(
      inner({
        complete: vi.fn(
          () =>
            new Promise<CompletionResult>((resolve) => {
              setTimeout(() => resolve(completion()), 5_000);
            }),
        ),
      }),
    );

    const p = provider.complete({ model: 'm', messages: [], timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(p).resolves.toMatchObject({ text: 'ok' });
  });

  it("honours the caller's timeoutMs over the adapter default", async () => {
    vi.useFakeTimers();
    const provider = new TimeBoundedOpenRouterProvider(hangingInner());

    // 50ms, far below the 15-minute default: if the default won instead, this
    // would not reject within the advanced window.
    const p = provider.complete({ model: 'm', messages: [], timeoutMs: 50 });
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(51);
    await assertion;
  });

  it('delegates listModels and embed untouched', async () => {
    const listModels = vi.fn().mockResolvedValue([{ id: 'm', provider: 'openrouter' }]);
    const embed = vi.fn().mockResolvedValue([[0.1]]);
    const provider = new TimeBoundedOpenRouterProvider(inner({ listModels, embed }));

    await expect(provider.listModels()).resolves.toHaveLength(1);
    await expect(provider.embed(['x'])).resolves.toEqual([[0.1]]);
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("reports the INNER provider's id, including the 'openai' base-URL variant", () => {
    // `LLMProvider.id` keys `buildLlm`'s cache, cost attribution and the
    // per-provider `signal` support. The inner provider sets it from
    // `opts.id ?? 'openrouter'` (reviewer-core/src/llm/openrouter.ts:47), so a
    // hardcoded literal here would misreport the OpenAI-compatible variant.
    expect(new TimeBoundedOpenRouterProvider(inner()).id).toBe('openrouter');
    expect(new TimeBoundedOpenRouterProvider(inner({ id: 'openai' })).id).toBe('openai');
  });

  it('calls the inner provider exactly once — no retry multiplication', async () => {
    // openai.ts composes withRetry(withTimeout(...)); this adapter deliberately
    // does not, because the OpenRouter SDK already retries internally. Wrapping
    // again would turn one review into several paid calls.
    const complete = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    const provider = new TimeBoundedOpenRouterProvider(inner({ complete }));

    await expect(provider.complete({ model: 'm', messages: [], timeoutMs: 1_000 })).rejects.toThrow(
      'rate limited',
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
