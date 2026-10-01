/**
 * `onboarding/routes.ts` — hermetic HTTP-level tests, no DB.
 *
 * Builds a minimal Fastify instance registering ONLY the onboarding plugin,
 * with a stubbed `OnboardingService` injected through the plugin's own
 * `opts.service` (production registration passes none, so `app.ts`'s module
 * loop still gets the real, container-backed service unchanged). `container`
 * is a real `Container` with only `auth` overridden (`MockAuthProvider`), so
 * `getContext` resolves tenancy without touching Postgres.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { OnboardingTour } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import onboardingRoutes from '../src/modules/onboarding/routes.js';
import type { OnboardingService } from '../src/modules/onboarding/service.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function buildTestApp() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
  });
  const container = new Container(config, {} as never, { auth: new MockAuthProvider() });
  app.decorate('container', container);
  return { app, container };
}

const FIVE_SECTIONS: OnboardingTour['sections'] = [
  { kind: 'architecture', title: 'Architecture', body: 'x', diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
  { kind: 'critical_paths', title: 'Critical Paths', body: 'x', diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
  { kind: 'run_locally', title: 'Run Locally', body: 'x', diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
  { kind: 'reading_path', title: 'Reading Path', body: 'x', diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
  { kind: 'first_tasks', title: 'First Tasks', body: 'x', diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
];

describe('GET /repos/:id/onboarding', () => {
  it('returns 200 with five sections, in order (AC-3, AC-4)', async () => {
    const tour: OnboardingTour = {
      sections: FIVE_SECTIONS,
      status: 'not_generated',
      reason: null,
      generated_at: null,
      files_indexed: null,
    };
    const getTour = vi.fn().mockResolvedValue(tour);
    const { app } = buildTestApp();
    await app.register(onboardingRoutes, { service: { getTour } as unknown as OnboardingService });

    const res = await app.inject({ method: 'GET', url: '/repos/11111111-1111-1111-1111-111111111111/onboarding' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OnboardingTour;
    expect(body.sections.map((s) => s.kind)).toEqual([
      'architecture',
      'critical_paths',
      'run_locally',
      'reading_path',
      'first_tasks',
    ]);
    expect(body.status).toBe('not_generated');
    await app.close();
  });

  it('resolves tenancy and forwards workspaceId + repoId to the service', async () => {
    const getTour = vi.fn().mockResolvedValue({
      sections: FIVE_SECTIONS,
      status: 'not_generated',
      reason: null,
      generated_at: null,
      files_indexed: null,
    });
    const { app } = buildTestApp();
    await app.register(onboardingRoutes, { service: { getTour } as unknown as OnboardingService });

    await app.inject({ method: 'GET', url: '/repos/11111111-1111-1111-1111-111111111111/onboarding' });
    expect(getTour).toHaveBeenCalledTimes(1);
    const [workspaceId, repoId] = getTour.mock.calls[0] as [string, string];
    expect(typeof workspaceId).toBe('string');
    expect(repoId).toBe('11111111-1111-1111-1111-111111111111');
    await app.close();
  });

  it('a NotFoundError from the service becomes a 404', async () => {
    const getTour = vi.fn().mockRejectedValue(new NotFoundError('Repository not found'));
    const { app } = buildTestApp();
    await app.register(onboardingRoutes, { service: { getTour } as unknown as OnboardingService });

    const res = await app.inject({ method: 'GET', url: '/repos/11111111-1111-1111-1111-111111111111/onboarding' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('surfaces files_indexed when an index row exists', async () => {
    const getTour = vi.fn().mockResolvedValue({
      sections: FIVE_SECTIONS,
      status: 'done',
      reason: null,
      generated_at: new Date().toISOString(),
      files_indexed: 42,
    });
    const { app } = buildTestApp();
    await app.register(onboardingRoutes, { service: { getTour } as unknown as OnboardingService });

    const res = await app.inject({ method: 'GET', url: '/repos/11111111-1111-1111-1111-111111111111/onboarding' });
    expect((res.json() as OnboardingTour).files_indexed).toBe(42);
    await app.close();
  });
});
