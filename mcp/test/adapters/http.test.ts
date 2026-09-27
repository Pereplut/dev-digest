import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ApiUnreachableError, HttpClient } from '../../src/adapters/http/client.js';
import { HttpDevDigestApi } from '../../src/adapters/http/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('adapters/http/client — ring 4, the only file that calls fetch', () => {
  it('maps a network failure to ApiUnreachableError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new HttpClient({ baseUrl: 'http://localhost:9999', fetchImpl });
    await expect(client.get('/repos')).rejects.toBeInstanceOf(ApiUnreachableError);
  });

  it('maps a non-2xx response to ApiRequestError carrying the API body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'not_found', message: 'nope' } }, 404));
    const client = new HttpClient({ baseUrl: 'http://localhost:3001', fetchImpl });
    const err = await client.get('/agents/missing').catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(404);
    expect((err as ApiRequestError).body?.error.message).toBe('nope');
  });

  it('returns the parsed JSON body on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: '1' }]));
    const client = new HttpClient({ baseUrl: 'http://localhost:3001', fetchImpl });
    await expect(client.get('/repos')).resolves.toEqual([{ id: '1' }]);
  });
});

describe('adapters/http/index — HttpDevDigestApi mapping', () => {
  it('maps repos from snake_case wire fields to the plain RepoSummary shape', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 'r1', owner: 'acme', name: 'web', full_name: 'acme/web' }]));
    const api = new HttpDevDigestApi({ baseUrl: 'http://localhost:3001', fetchImpl });
    await expect(api.listRepos()).resolves.toEqual([{ id: 'r1', owner: 'acme', name: 'web', fullName: 'acme/web' }]);
  });

  it('returns null for a 404 pull lookup instead of throwing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: 'not_found', message: 'not found' } }, 404));
    const api = new HttpDevDigestApi({ baseUrl: 'http://localhost:3001', fetchImpl });
    await expect(api.getPullByNumber('repo-1', 999)).resolves.toBeNull();
  });
});
