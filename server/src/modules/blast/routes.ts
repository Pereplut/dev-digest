import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * L04 — Blast radius module. Transport only.
 *   GET /pulls/:id/blast → which symbols a PR changes, which callers reach
 *                          them, and which HTTP endpoints/cron jobs those
 *                          callers sit behind. Reads a finished index; no
 *                          model call, no clone parsing on this path.
 *
 * The response shape is the handler's return type, as everywhere in this
 * repo — no `response:` schema. That the payload really satisfies the
 * contract is asserted in the tests, which run `BlastRadius.parse()` on it.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadius> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.forPull(workspaceId, req.params.id);
    },
  );
}
