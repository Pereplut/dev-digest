/**
 * Onboarding HTTP module (spec 0017).
 *
 *   GET  /repos/:id/onboarding → the tour (always 200, five sections)
 *   POST /repos/:id/onboarding → start a generation (lands in a later commit)
 *
 * Transport only — parsing, context, status codes; everything else is the
 * service. `opts.service` lets a test inject a stub service without a DB
 * (production registration passes none, so `new OnboardingService(container)`
 * is the default — the same shape `repo-intel/routes.ts` uses for its own
 * locally-constructed service).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';

export interface OnboardingRoutesOptions {
  service?: OnboardingService;
}

export default async function onboardingRoutes(
  appBase: FastifyInstance,
  opts: OnboardingRoutesOptions = {},
) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = opts.service ?? new OnboardingService(container);

  app.get('/repos/:id/onboarding', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getTour(workspaceId, req.params.id);
  });
}
