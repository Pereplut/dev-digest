/**
 * The REAL OpenAI and Anthropic providers must forward `StructuredRequest.signal`
 * to their SDK's per-request `RequestOptions`, or cancelling a run leaves the
 * HTTP call running to completion.
 *
 * This is the gap `run-executor-cancel.test.ts` cannot close: that suite registers
 * a hand-written provider under the key `openai`, so the class shipped in
 * `adapters/llm/openai.ts` is never exercised by it. Here the class is the thing
 * under test, with only its SDK client stubbed.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { APIUserAbortError as OpenAIAbortError } from 'openai';
import { APIUserAbortError as AnthropicAbortError } from '@anthropic-ai/sdk';
import { OpenAIProvider } from '../src/adapters/llm/openai.js';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';

const Schema = z.object({ ok: z.boolean() });
const base = { model: 'test-model', schema: Schema, schemaName: 'Probe', messages: [] };

function stubOpenAI(provider: OpenAIProvider, create: (body: unknown, options?: unknown) => unknown) {
  (provider as unknown as { client: unknown }).client = {
    chat: { completions: { create } },
  };
}

function stubAnthropic(
  provider: AnthropicProvider,
  create: (body: unknown, options?: unknown) => unknown,
) {
  (provider as unknown as { client: unknown }).client = { messages: { create } };
}

const openAiOk = () =>
  Promise.resolve({
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });

const anthropicOk = () =>
  Promise.resolve({
    content: [{ type: 'tool_use', input: { ok: true } }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });

describe('OpenAIProvider.completeStructured', () => {
  it('forwards the caller signal as the SDK request option', async () => {
    const provider = new OpenAIProvider('test-key');
    const seen: unknown[] = [];
    stubOpenAI(provider, (_body, options) => {
      seen.push(options);
      return openAiOk();
    });

    const controller = new AbortController();
    await provider.completeStructured({ ...base, signal: controller.signal });

    expect(seen).toHaveLength(1);
    expect((seen[0] as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it('omits the key entirely when the caller passes no signal', async () => {
    const provider = new OpenAIProvider('test-key');
    const seen: unknown[] = [];
    stubOpenAI(provider, (_body, options) => {
      seen.push(options);
      return openAiOk();
    });

    await provider.completeStructured({ ...base });

    // Absent, not `{ signal: undefined }` — the shape the rest of the file uses.
    expect(Object.prototype.hasOwnProperty.call(seen[0], 'signal')).toBe(false);
  });

  it('does not retry an aborted call', async () => {
    const provider = new OpenAIProvider('test-key');
    let calls = 0;
    // The SDK's real error class, not a stand-in: what makes `withRetry` give up
    // is that `APIUserAbortError` carries no `status`, and that is the SDK's
    // property to change. A hand-rolled `{ status: undefined }` double would
    // keep this test green through an SDK bump that broke cancellation.
    stubOpenAI(provider, () => {
      calls += 1;
      return Promise.reject(new OpenAIAbortError());
    });

    await expect(
      provider.completeStructured({ ...base, signal: new AbortController().signal }),
    ).rejects.toThrow('Request was aborted.');
    expect(calls).toBe(1);
  });

  it('pins the SDK error shape `withRetry` depends on', () => {
    expect(new OpenAIAbortError().status).toBeUndefined();
  });
});

describe('AnthropicProvider.completeStructured', () => {
  it('forwards the caller signal as the SDK request option', async () => {
    const provider = new AnthropicProvider('test-key');
    const seen: unknown[] = [];
    stubAnthropic(provider, (_body, options) => {
      seen.push(options);
      return anthropicOk();
    });

    const controller = new AbortController();
    await provider.completeStructured({ ...base, signal: controller.signal });

    expect(seen).toHaveLength(1);
    expect((seen[0] as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it('omits the key entirely when the caller passes no signal', async () => {
    const provider = new AnthropicProvider('test-key');
    const seen: unknown[] = [];
    stubAnthropic(provider, (_body, options) => {
      seen.push(options);
      return anthropicOk();
    });

    await provider.completeStructured({ ...base });

    expect(Object.prototype.hasOwnProperty.call(seen[0], 'signal')).toBe(false);
  });

  it('does not retry an aborted call', async () => {
    const provider = new AnthropicProvider('test-key');
    let calls = 0;
    stubAnthropic(provider, () => {
      calls += 1;
      return Promise.reject(new AnthropicAbortError());
    });

    await expect(
      provider.completeStructured({ ...base, signal: new AbortController().signal }),
    ).rejects.toThrow('Request was aborted.');
    expect(calls).toBe(1);
  });

  it('pins the SDK error shape `withRetry` depends on', () => {
    expect(new AnthropicAbortError().status).toBeUndefined();
  });
});
