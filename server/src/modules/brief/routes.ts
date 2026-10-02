import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBriefEnvelope, PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * PR Brief module (spec 0018). Transport only.
 *   GET  /pulls/:id/brief → the cached brief, or `brief: null` — never a 404,
 *                           and never an LLM call (AC-20).
 *   POST /pulls/:id/brief → generate (one model call), persist, respond with
 *                           the full envelope.
 *
 * No `response:` schema, as everywhere in this repo — the handler's return
 * type is the contract, and the tests `.parse()` it.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<PrBriefResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.read(workspaceId, req.params.id);
    },
  );

  // Tight per-route limit: each call spends one model generation inline, and
  // this is the only LLM-backed POST that runs synchronously rather than
  // enqueueing a job. Matches `reviews/routes.ts`. The global bucket is 120/min
  // (`app.ts`), which would let one client drive 120 paid generations a minute.
  // Inert under test: `app.ts` skips registering the limiter when
  // `nodeEnv === 'test'`, so `inject()` is unaffected.
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<PrBriefEnvelope> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id, req.log);
    },
  );
}
