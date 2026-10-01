/**
 * Onboarding HTTP module (spec 0017).
 *
 *   GET  /repos/:id/onboarding → the tour (always 200, five sections)
 *   POST /repos/:id/onboarding → start a generation (202 + job_id, or 409
 *                                 under a blocking precondition — AC-10)
 *
 * Transport only — parsing, context, status codes; everything else is the
 * service. `opts.service` lets a test inject a stub service without a DB
 * (production registration passes none, so `new OnboardingService(container)`
 * is the default — the same shape `repo-intel/routes.ts` uses for its own
 * locally-constructed service). Job-handler registration lives here, like
 * `conventions/routes.ts`: this plugin runs once at app boot, so an enqueued
 * `onboarding-generate` job always has a handler.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ONBOARDING_JOB_KIND } from './constants.js';
import { OnboardingService } from './service.js';

export interface OnboardingRoutesOptions {
  service?: OnboardingService;
}

/** `JobHandler` receives only the payload, so tenancy and identity travel inside it. */
interface OnboardingJobPayload {
  workspaceId: string;
  repoId: string;
  generationId: string;
}

export default async function onboardingRoutes(
  appBase: FastifyInstance,
  opts: OnboardingRoutesOptions = {},
) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = opts.service ?? new OnboardingService(container);

  // `runGeneration` persists its own failure on the `onboarding` row before
  // rethrowing (service.ts), so — unlike `conventions/routes.ts`'s handler —
  // nothing extra needs catching here; `JobRunner` records the `jobs` row's
  // own failure regardless.
  container.jobs.register(ONBOARDING_JOB_KIND, async (payload: unknown) => {
    const { workspaceId, repoId, generationId } = payload as OnboardingJobPayload;
    await service.runGeneration(workspaceId, repoId, generationId);
  });

  app.get('/repos/:id/onboarding', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getTour(workspaceId, req.params.id);
  });

  app.post('/repos/:id/onboarding', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const { jobId } = await service.startGeneration(workspaceId, req.params.id);
    reply.code(202);
    return { job_id: jobId };
  });
}
