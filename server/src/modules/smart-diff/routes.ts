import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * L03 — Smart Diff module. Transport only.
 *   GET /pulls/:id/smart-diff → the PR's files grouped by role, with the latest
 *                               review's finding lines per file.
 *
 * The response shape is the handler's return type, as everywhere in this repo —
 * no `response:` schema. That the payload really satisfies the contract is
 * asserted in the tests, which run `SmartDiff.parse()` on it.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(app.container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiffResponse> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.forPull(workspaceId, req.params.id);
    },
  );
}
