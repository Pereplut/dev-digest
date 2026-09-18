import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrDetail, PrMeta, PrReviewComment } from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams, RepoPullNumberParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/**
 * F1 — pulls module. Transport layer only: parses requests and delegates all
 * business logic to PullsService.
 *   GET  /repos/:id/pulls    → list PRs for a repo (synced from GitHub, persisted)
 *   GET  /pulls/:id          → full PR detail (files, commits, body, linked issue)
 *   GET  /pulls/:id/comments → inline review comments (proxied live to GitHub)
 *   POST /pulls/:id/comments → create one inline comment
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL and
 * owned by A2 — this module only imports/reads.
 *
 * `req.log` is handed to the service so its local-first fallbacks (no token,
 * offline, GitHub error) keep logging against the request, not a global.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container);

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id, req.log);
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.detail(workspaceId, req.params.id, req.log);
  });

  // Addressed the way the UI's route is keyed (repo + PR number), so the
  // detail page no longer loads the whole PR list just to resolve a uuid.
  app.get(
    '/repos/:id/pulls/:number',
    { schema: { params: RepoPullNumberParams } },
    async (req): Promise<PrDetail> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.detailByNumber(workspaceId, req.params.id, req.params.number, req.log);
    },
  );

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listComments(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createComment(workspaceId, req.params.id, req.body);
    },
  );
}
