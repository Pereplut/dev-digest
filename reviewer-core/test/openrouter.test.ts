import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import type { StructuredRequest } from '@devdigest/shared';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * OpenRouterProvider — the only first-party LLM provider, and until now the
 * only one with no tests anywhere (plan item H2). Both consumers depend on it:
 * the GitHub Action runs reviewer-core directly, and the studio server resolves
 * its `openrouter` path through it.
 *
 * Two seams, two techniques:
 *  - `listModels()` uses global `fetch`, so it stubs cleanly with stubGlobal.
 *  - `completeStructured()` goes through an OpenAI SDK client the constructor
 *    builds itself, with NO injection point — so the tests below replace the
 *    private `client` field. That cast is a deliberate test seam, and it is
 *    also the finding: this provider has the same "no way to substitute the
 *    external system" shape that plan item B2 fixed for ast-grep. An optional
 *    `client` in OpenRouterProviderOptions would remove the need for it.
 */

const Schema = z.object({ verdict: z.string(), n: z.number() });
type Out = z.infer<typeof Schema>;

function request(over: Partial<StructuredRequest<Out>> = {}): StructuredRequest<Out> {
  return {
    model: 'deepseek/deepseek-v4-flash',
    schema: Schema,
    schemaName: 'Review',
    messages: [{ role: 'user', content: 'review this' }],
    ...over,
  };
}

/** One chat.completions response. `usage.cost` is OpenRouter's USD extension. */
function completion(
  content: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number },
) {
  return { choices: [{ message: { content } }], usage };
}

type CreateArgs = Record<string, unknown>;

/**
 * Replace the SDK client with a stub that returns `responses` in order, and
 * hand back the array of arguments it was called with.
 */
function stubClient(provider: OpenRouterProvider, responses: unknown[]): CreateArgs[] {
  const calls: CreateArgs[] = [];
  const create = async (args: CreateArgs) => {
    calls.push(args);
    if (responses.length === 0) throw new Error('stub: create() called more times than expected');
    return responses.shift();
  };
  (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client =
    { chat: { completions: { create } } };
  return calls;
}

/*
 * The impl declares fetch's own parameters on purpose. vi.fn infers the mock's
 * type from what it is given, so a zero-arg impl would type mock.mock.calls as
 * the empty tuple and reading calls[0][0] back would not compile — the same
 * trap recorded in client/INSIGHTS.md for the api.ts tests.
 */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const mock = vi.fn(
    async (..._args: Parameters<typeof fetch>) =>
      ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
      }) as unknown as Response,
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenRouterProvider — construction', () => {
  it('defaults to the openrouter id, and can present as openai', () => {
    expect(new OpenRouterProvider('k').id).toBe('openrouter');
    expect(new OpenRouterProvider('k', { id: 'openai' }).id).toBe('openai');
  });

  it('only implements completeStructured', async () => {
    const p = new OpenRouterProvider('k');
    await expect(p.complete({ model: 'm', messages: [] })).rejects.toThrow(
      /only implements completeStructured/,
    );
    await expect(p.embed(['a'])).rejects.toThrow(/only implements completeStructured/);
  });
});

describe('OpenRouterProvider — listModels', () => {
  it('converts per-token prices to USD per 1M and sorts cheapest output first', async () => {
    const fetchMock = stubFetch({
      data: [
        { id: 'pricey', name: 'Pricey', context_length: 8000, pricing: { prompt: '0.000002', completion: '0.000008' } },
        { id: 'cheap', name: 'Cheap', context_length: 4000, pricing: { prompt: '0.0000001', completion: '0.0000004' } },
      ],
    });

    const models = await new OpenRouterProvider('secret-key').listModels();

    expect(models.map((m) => m.id)).toEqual(['cheap', 'pricey']);
    // toBeCloseTo, not toEqual: 0.0000001 * 1e6 is 0.09999999999999999 in
    // binary float. The conversion is inherently lossy; the UI rounds.
    expect(models[0]!.pricing!.promptPerM).toBeCloseTo(0.1, 10);
    expect(models[0]!.pricing!.completionPerM).toBeCloseTo(0.4, 10);
    expect(models[1]!.pricing).toEqual({ promptPerM: 2, completionPerM: 8 });
    expect(models[0]!.label).toBe('Cheap');
    expect(models[0]!.contextLength).toBe(4000);
    expect(models[0]!.provider).toBe('openrouter');

    // hits the configured base URL and authenticates with the key
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://openrouter.ai/api/v1/models');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
  });

  it('treats OpenRouter’s -1 price sentinel as unknown pricing, not as a negative price', async () => {
    // openrouter/auto and friends are variable-priced and report -1. Left as a
    // number they would render as $-1000000 and sort to the top of "cheapest".
    stubFetch({
      data: [
        { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
        { id: 'real', pricing: { prompt: '0.000001', completion: '0.000002' } },
      ],
    });

    const models = await new OpenRouterProvider('k').listModels();

    expect(models.find((m) => m.id === 'openrouter/auto')!.pricing).toBeNull();
    // unknown pricing sorts last (Infinity), so the priced model leads
    expect(models[0]!.id).toBe('real');
  });

  it('treats absent or unparseable pricing as unknown', async () => {
    stubFetch({ data: [{ id: 'nopricing' }, { id: 'garbage', pricing: { prompt: 'n/a', completion: 'n/a' } }] });

    const models = await new OpenRouterProvider('k').listModels();

    expect(models.every((m) => m.pricing === null)).toBe(true);
    expect(models.find((m) => m.id === 'nopricing')!.label).toBeNull();
    expect(models.find((m) => m.id === 'nopricing')!.contextLength).toBeNull();
  });

  it('returns [] when the payload has no data array', async () => {
    stubFetch({});
    await expect(new OpenRouterProvider('k').listModels()).resolves.toEqual([]);
  });

  it('throws with the status when /models fails', async () => {
    stubFetch({}, { ok: false, status: 401 });
    await expect(new OpenRouterProvider('k').listModels()).rejects.toThrow(
      'OpenRouter /models returned 401',
    );
  });

  it('honours a custom baseURL', async () => {
    const fetchMock = stubFetch({ data: [] });
    await new OpenRouterProvider('k', { baseURL: 'https://example.test/v9' }).listModels();
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://example.test/v9/models');
  });
});

describe('OpenRouterProvider — completeStructured', () => {
  it('parses the first valid response and reports the real API cost', async () => {
    const p = new OpenRouterProvider('k');
    stubClient(p, [
      completion('{"verdict":"request_changes","n":2}', {
        prompt_tokens: 100,
        completion_tokens: 20,
        cost: 0.00042,
      }),
    ]);

    const res = await p.completeStructured(request());

    expect(res.data).toEqual({ verdict: 'request_changes', n: 2 });
    expect(res.attempts).toBe(1);
    expect(res.tokensIn).toBe(100);
    expect(res.tokensOut).toBe(20);
    // usage.cost is the REAL generation cost and wins over any estimator
    expect(res.costUsd).toBe(0.00042);
    expect(res.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('falls back to the injected estimator when the API reports no cost', async () => {
    const estimateCost = vi.fn(() => 0.5);
    const p = new OpenRouterProvider('k', { estimateCost });
    stubClient(p, [completion('{"verdict":"approve","n":0}', { prompt_tokens: 7, completion_tokens: 3 })]);

    const res = await p.completeStructured(request());

    expect(res.costUsd).toBe(0.5);
    expect(estimateCost).toHaveBeenCalledWith('deepseek/deepseek-v4-flash', 7, 3);
  });

  it('reports null cost when there is neither an API cost nor an estimator', async () => {
    const p = new OpenRouterProvider('k');
    stubClient(p, [completion('{"verdict":"approve","n":0}')]);

    await expect(p.completeStructured(request())).resolves.toMatchObject({ costUsd: null });
  });

  it('surfaces a 200-with-no-choices as an error, including the body message', async () => {
    const p = new OpenRouterProvider('k');
    stubClient(p, [{ choices: [], error: { message: 'upstream provider refused' } }]);

    await expect(p.completeStructured(request())).rejects.toThrow(
      'OpenRouter returned no choices for Review: upstream provider refused',
    );
  });

  it('repairs an invalid first response, accumulating tokens across attempts', async () => {
    const p = new OpenRouterProvider('k');
    const calls = stubClient(p, [
      completion('not json at all', { prompt_tokens: 10, completion_tokens: 5 }),
      completion('{"verdict":"comment","n":1}', { prompt_tokens: 12, completion_tokens: 6 }),
    ]);

    const res = await p.completeStructured(request());

    expect(res.attempts).toBe(2);
    expect(res.data).toEqual({ verdict: 'comment', n: 1 });
    // tokens are summed over BOTH round-trips, so cost reflects the repair
    expect(res.tokensIn).toBe(22);
    expect(res.tokensOut).toBe(11);

    // the retry carries the bad output back plus a reprompt
    const retryMessages = calls[1]!.messages as { role: string; content: string }[];
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[1]).toMatchObject({ role: 'assistant', content: 'not json at all' });
    expect(retryMessages[2]!.role).toBe('user');
    expect(retryMessages[2]!.content).toMatch(/JSON/i);
  });

  it('gives up after maxRetries + 1 attempts', async () => {
    const p = new OpenRouterProvider('k');
    const calls = stubClient(p, [completion('nope'), completion('still nope')]);

    await expect(p.completeStructured(request({ maxRetries: 1 }))).rejects.toThrow(
      'OpenRouter structured output failed schema validation for Review',
    );
    expect(calls).toHaveLength(2);
  });

  it('sends OpenRouter-only body fields, and omits them when presenting as openai', async () => {
    const asRouter = new OpenRouterProvider('k');
    const routerCalls = stubClient(asRouter, [completion('{"verdict":"approve","n":0}')]);
    await asRouter.completeStructured(request({ sessionId: 'sess-1' }));

    expect(routerCalls[0]!.session_id).toBe('sess-1');
    expect(routerCalls[0]!.usage).toEqual({ include: true });
    expect(routerCalls[0]!.temperature).toBe(0);
    expect(routerCalls[0]).not.toHaveProperty('max_tokens');

    const asOpenai = new OpenRouterProvider('k', { id: 'openai' });
    const openaiCalls = stubClient(asOpenai, [completion('{"verdict":"approve","n":0}')]);
    await asOpenai.completeStructured(request({ sessionId: 'sess-1', maxTokens: 256 }));

    expect(openaiCalls[0]).not.toHaveProperty('session_id');
    expect(openaiCalls[0]).not.toHaveProperty('usage');
    expect(openaiCalls[0]!.max_tokens).toBe(256);
  });
});
