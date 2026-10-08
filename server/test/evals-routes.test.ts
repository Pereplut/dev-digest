import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * No-DB route-table assertions for the evals module (spec 0019). postgres-js
 * connects lazily, so building the app and reading its route table never
 * touches Postgres — same pattern as `routes-smoke.test.ts`.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('evals routes (no DB)', () => {
  it('no second SSE route was registered for eval batches (AC-36 — the reused GET /runs/:id/events is the only one)', async () => {
    const app = await buildApp({ config });
    const routes = app.printRoutes();
    // There is exactly one `/events` route in the whole app, and it is the
    // reviews module's, keyed by a generic `:id` — a batch id streams through
    // it unchanged. A second, evals-owned SSE route would show up as its own
    // leaf here.
    const eventsOccurrences = routes.match(/events \(GET/g) ?? [];
    expect(eventsOccurrences).toHaveLength(1);
    expect(routes).toContain('runs/');
    await app.close();
  });

  it('422 for a non-uuid :id at every evals route edge (no business logic reached)', async () => {
    const app = await buildApp({ config });
    for (const req of [
      { method: 'GET' as const, url: '/agents/not-a-uuid/eval-cases' },
      { method: 'PATCH' as const, url: '/eval-cases/not-a-uuid', payload: { name: 'x' } },
      { method: 'DELETE' as const, url: '/eval-cases/not-a-uuid' },
      { method: 'POST' as const, url: '/agents/not-a-uuid/eval-runs' },
      { method: 'GET' as const, url: '/agents/not-a-uuid/eval-runs' },
      { method: 'GET' as const, url: '/eval-runs/not-a-uuid' },
      { method: 'POST' as const, url: '/eval-runs/not-a-uuid/cancel' },
    ]) {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(422);
    }
    await app.close();
  });

  it('422 for a POST /eval-cases body missing finding_id', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  /**
   * spec 0020 S10 — the compare route's `?a=&b=` query, validated before any
   * business logic runs (no DB touched by either case below).
   */
  it('422 for GET /agents/:id/eval-runs/compare with a missing query param', async () => {
    const app = await buildApp({ config });
    const id = '11111111-1111-1111-1111-111111111111';
    const missingBoth = await app.inject({ method: 'GET', url: `/agents/${id}/eval-runs/compare` });
    expect(missingBoth.statusCode).toBe(422);
    const missingB = await app.inject({
      method: 'GET',
      url: `/agents/${id}/eval-runs/compare?a=22222222-2222-2222-2222-222222222222`,
    });
    expect(missingB.statusCode).toBe(422);
    await app.close();
  });

  it('422 for GET /agents/:id/eval-runs/compare with a repeated query param (Fastify parses it as an array, not a string)', async () => {
    const app = await buildApp({ config });
    const id = '11111111-1111-1111-1111-111111111111';
    const res = await app.inject({
      method: 'GET',
      url:
        `/agents/${id}/eval-runs/compare?a=22222222-2222-2222-2222-222222222222` +
        `&a=33333333-3333-3333-3333-333333333333&b=44444444-4444-4444-4444-444444444444`,
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('422 for GET /agents/:id/eval-dashboard with a non-uuid :id', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/agents/not-a-uuid/eval-dashboard' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
