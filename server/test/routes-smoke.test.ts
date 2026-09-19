import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * No-DB route smoke tests via app.inject(). `/health` and the validation/error
 * envelope don't touch the database (postgres-js connects lazily), so these run
 * without Docker. DB-backed routes are covered in integration.test.ts.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('routes (no DB)', () => {
  it('GET /health → ok', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('POST /settings/test-connection (github) returns structured ConnTestResult', async () => {
    const app = await buildApp({
      config,
      overrides: { github: new MockGitHubClient({ login: 'octocat' }) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'github' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('github');
    expect(body.ok).toBe(true);
    expect(body.message).toContain('octocat');
    await app.close();
  });

  it('POST /settings/test-connection (openai) uses injected LLM listModels', async () => {
    const app = await buildApp({
      config,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { models: [{ id: 'gpt-4.1', provider: 'openai' }] }) },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'openai' },
    });
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  // ---- skills (spec 0006): edge rejections that happen before any DB call ----

  function multipart(filename: string, content: Buffer, field = 'file') {
    const boundary = '----devdigest-smoke';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  }

  it('POST /skills with an invalid draft → 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: '', description: 'd', type: 'nope', body: 'b' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('PUT /agents/:id/skills rejects duplicate skill ids → 422', async () => {
    const app = await buildApp({ config });
    const id = '00000000-0000-4000-8000-000000000001';
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${id}/skills`,
      payload: { skills: [{ skill_id: id, enabled: true }, { skill_id: id, enabled: false }] },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('POST /skills/import/preview: non-multipart → 415, oversize → 413', async () => {
    const app = await buildApp({ config });
    const json = await app.inject({ method: 'POST', url: '/skills/import/preview', payload: { a: 1 } });
    expect(json.statusCode).toBe(415);
    expect(json.json().error.code).toBe('unsupported_media_type');

    const big = multipart('big.md', Buffer.alloc(1_048_576 + 10, 'a'));
    const res = await app.inject({ method: 'POST', url: '/skills/import/preview', ...big });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('file_too_large');

    const wrongField = multipart('a.md', Buffer.from('x'), 'upload');
    const wf = await app.inject({ method: 'POST', url: '/skills/import/preview', ...wrongField });
    expect(wf.statusCode).toBe(422);
    await app.close();
  });

  it('returns 422 structured error on invalid body', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'not-a-provider' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});
