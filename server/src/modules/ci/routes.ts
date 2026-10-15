import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';

/**
 * `ci` module (spec 0022). Transport only: validate → one service call → reply.
 *
 *   POST /agents/:id/export-ci          → CiExport
 *   GET  /agents/:id/ci/installations   → CiInstallation[]
 *   POST /agents/:id/ci/update          → CiUpdateResult
 *   POST /ci/refresh                    → CiRefreshResult (pull-based ingest)
 *   GET  /ci/runs[?agent_id=]           → CiRun[]
 *
 * There is intentionally no inbound push endpoint: CI results only ever arrive
 * by this server polling GitHub's Actions API.
 */
const CiRunsQuery = z.object({ agent_id: z.string().uuid().optional() });

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new CiService(container);

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.exportCi(workspaceId, req.params.id, req.body);
    },
  );

  app.get('/agents/:id/ci/installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listInstallations(workspaceId, req.params.id);
  });

  app.post('/agents/:id/ci/update', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.updateAll(workspaceId, req.params.id);
  });

  app.post('/ci/refresh', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.refresh(workspaceId);
  });

  app.get('/ci/runs', { schema: { querystring: CiRunsQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.query.agent_id);
  });
}
