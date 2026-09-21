/**
 * Conventions HTTP module (spec 0007).
 *
 *   GET   /repos/:id/conventions         → candidates + the latest scan (the poll target)
 *   POST  /repos/:id/conventions/extract → enqueue an extraction (202 + scan id)
 *   GET   /repos/:id/conventions/skill   → the server-computed skill defaults
 *   POST  /repos/:id/conventions/skill   → create the skill from the edited draft
 *   PATCH /conventions/:id               → accept / reject / edit one candidate
 *
 * Job-handler registration lives here, like repo-intel's: the plugin runs once
 * at app boot, so an enqueued `conventions-extract` always has a handler.
 * Transport only — parsing, context, status codes; everything else is the service.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ConventionPatch, ConventionSkillDraft } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EXTRACT_JOB_KIND } from './constants.js';
import { ConventionsService } from './service.js';

/** JobHandler receives only the payload, so tenancy travels inside it. */
interface ExtractPayload {
  workspaceId: string;
  repoId: string;
  scanId: string;
}

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService(container);

  container.jobs.register(EXTRACT_JOB_KIND, async (payload: unknown) => {
    const { workspaceId, repoId, scanId } = payload as ExtractPayload;
    try {
      await service.runExtraction(workspaceId, repoId, scanId);
    } catch (err) {
      // Record the failure on the scan row so the page can show it — the `jobs`
      // table is write-only and nothing reads a job's status.
      await service.failScan(scanId, err instanceof Error ? err.message : 'Extraction failed');
      throw err;
    }
  });

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.page(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const { scan, jobId } = await service.startExtraction(workspaceId, req.params.id);
      reply.code(202);
      return { status: 'accepted', scan, job_id: jobId };
    },
  );

  app.get('/repos/:id/conventions/skill', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.skillDefaults(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: ConventionSkillDraft } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const skill = await service.createSkill(workspaceId, req.params.id, req.body);
      reply.code(201);
      return skill;
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionPatch } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.patch(workspaceId, req.params.id, req.body);
    },
  );
}
