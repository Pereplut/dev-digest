/**
 * The OpenRouter provider is the DEFAULT review path (every seeded agent uses
 * `provider: 'openrouter'`), and it was the only one with no enforced time
 * bound: `openai.ts`/`anthropic.ts` wrap their SDK call in `withTimeout`, while
 * OpenRouter relied on the OpenAI SDK's own `timeout` option inside
 * reviewer-core. `server/INSIGHTS.md` (2026-09-27) records that bound failing in
 * production — a run past 1000s with a 90s client timeout configured, producing
 * nothing and leaving the row stuck `running`.
 *
 * These tests drive the real `TimeBoundedOpenRouterProvider` against a stub
 * inner provider. The never-settling case is the one that matters: it fails
 * (hangs to the test timeout) if the `withTimeout` wrapper is removed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type {
  LLMProvider,
  CompletionRequest,
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
  return { text: 'ok', model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0 } as CompletionResult;
}

/** An inner provider whose completion never settles — the hang, reproduced. */
function hangingInner(): LLMProvider {
  return {
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn(() => new Promise<CompletionResult>(() => {})),
    completeStructured: vi.fn(() => new Promise<StructuredResult<unknown>>(() => {})),
    embed: vi.fn().mockResolvedValue([]),
  } as unknown as LLMProvider;
}

describe('TimeBoundedOpenRouterProvider', () => {
  it('rejects a never-settling complete() instead of hanging forever', async () => {
    vi.useFakeTimers();
    const provider = new TimeBoundedOpenRouterProvider(hangingInner());

    const p = provider.complete({ model: 'm', messages: [], timeoutMs: 1_000 } as CompletionRequest);
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it('rejects a never-settling completeStructured() — the review path', async () => {
    vi.useFakeTimers();
    const provider = new TimeBoundedOpenRouterProvider(hangingInner());

    const p = provider.completeStructured({
      model: 'm',
      messages: [],
      timeoutMs: 1_000,
    } as unknown as StructuredRequest<unknown>);
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it('does NOT bound a call that settles in time — a slow review still completes', async () => {
    // The successful Performance review this fix was written against took
    // 470s. A bound that kills work which completes is worse than no bound.
    vi.useFakeTimers();
    const inner = {
      listModels: vi.fn().mockResolvedValue([]),
      complete: vi.fn(
        () =>
          new Promise<CompletionResult>((resolve) => {
            setTimeout(() => resolve(completion()), 5_000);
          }),
      ),
      completeStructured: vi.fn(),
      embed: vi.fn(),
    } as unknown as LLMProvider;
    const provider = new TimeBoundedOpenRouterProvider(inner);

    const p = provider.complete({ model: 'm', messages: [], timeoutMs: 60_000 } as CompletionRequest);
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(p).resolves.toMatchObject({ text: 'ok' });
  });

  it("honours the caller's timeoutMs over the adapter default", async () => {
    vi.useFakeTimers();
    const provider = new TimeBoundedOpenRouterProvider(hangingInner());

    // 50ms, far below the 15-minute default: if the default won instead, this
    // would not reject within the advanced window.
    const p = provider.complete({ model: 'm', messages: [], timeoutMs: 50 } as CompletionRequest);
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(51);
    await assertion;
  });

  it('delegates listModels and embed untouched', async () => {
    const inner = {
      listModels: vi.fn().mockResolvedValue([{ id: 'm', provider: 'openrouter' }]),
      complete: vi.fn(),
      completeStructured: vi.fn(),
      embed: vi.fn().mockResolvedValue([[0.1]]),
    } as unknown as LLMProvider;
    const provider = new TimeBoundedOpenRouterProvider(inner);

    await expect(provider.listModels()).resolves.toHaveLength(1);
    await expect(provider.embed(['x'])).resolves.toEqual([[0.1]]);
    expect(inner.listModels).toHaveBeenCalledTimes(1);
    expect(inner.embed).toHaveBeenCalledTimes(1);
  });

  it("reports the inner provider's id, so the decorator is not observable as a different provider", () => {
    // `LLMProvider.id` is required and is what `buildLlm`'s cache, cost
    // attribution and the per-provider `signal` support key off. The first
    // version of this adapter omitted it: every test here passed (the stubs are
    // structural casts, which is an unchecked contract — server/INSIGHTS.md
    // 2026-09-18) while `pnpm typecheck` failed on the container wiring.
    const provider = new TimeBoundedOpenRouterProvider(hangingInner());
    expect(provider.id).toBe('openrouter');
  });

  it('calls the inner provider exactly once — no retry multiplication', async () => {
    // openai.ts composes withRetry(withTimeout(...)); this adapter deliberately
    // does not, because the OpenRouter SDK already retries internally. Wrapping
    // again would turn one review into several paid calls.
    const inner = {
      listModels: vi.fn(),
      complete: vi.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 })),
      completeStructured: vi.fn(),
      embed: vi.fn(),
    } as unknown as LLMProvider;
    const provider = new TimeBoundedOpenRouterProvider(inner);

    await expect(
      provider.complete({ model: 'm', messages: [], timeoutMs: 1_000 } as CompletionRequest),
    ).rejects.toThrow('rate limited');
    expect(inner.complete).toHaveBeenCalledTimes(1);
  });
});
