import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseFromFindingInput, EvalCasePatch } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';
import { toEvalBatchRecordDto, toEvalCaseDto, toEvalRunRecordDto } from './helpers.js';

/**
 * evals module (spec 0019). Transport only — no drizzle, no business logic.
 *   POST   /eval-cases                     → turn an accepted/dismissed finding into an eval case
 *   GET    /agents/:id/eval-cases          → an agent's eval cases, newest first
 *   PATCH  /eval-cases/:id                 → rename / fix an expectation
 *   DELETE /eval-cases/:id                 → delete a case (+ its runs, cascade)
 *   POST   /agents/:id/eval-runs           → queue a batch sweep of an agent's cases
 *   GET    /agents/:id/eval-runs           → an agent's batches, newest first
 *   GET    /eval-runs/:batchId             → one batch + its per-case runs
 *   POST   /eval-runs/:batchId/cancel      → cancel a live batch
 *   GET    /agents/:id/eval-dashboard       → per-agent dashboard (spec 0020)
 *   GET    /agents/:id/eval-runs/compare    → compare two of this agent's batches (spec 0020)
 *
 * Progress streams over the EXISTING `GET /runs/:id/events` (reviews module) —
 * a batch id is just another id to that route, which does no DB lookup. No new
 * SSE route here (spec 0019 Decisions: "Reusing GET /runs/:id/events").
 */
const BatchIdParams = z.object({ batchId: z.string().uuid() });

/** spec 0020 AC-20 — two named query params, each a uuid. */
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  // ---- Case creation --------------------------------------------------------
  app.post('/eval-cases', { schema: { body: EvalCaseFromFindingInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const row = await service.createCaseFromFinding(workspaceId, req.body);
    reply.status(201);
    return toEvalCaseDto(row);
  });

  // ---- Case read / edit / delete --------------------------------------------
  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rows = await service.listCases(workspaceId, req.params.id);
    return rows.map(toEvalCaseDto);
  });

  app.patch(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCasePatch } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const row = await service.patchCase(workspaceId, req.params.id, req.body);
      return toEvalCaseDto(row);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await service.deleteCase(workspaceId, req.params.id);
    return { ok: true };
  });

  // ---- Run a batch sweep ------------------------------------------------
  // Tight per-route limit: each call fans out to real LLM calls, one per case
  // — matches POST /pulls/:id/review (reviews/routes.ts:46).
  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const { batchId } = await service.queueBatch(workspaceId, req.params.id, req.log);
      reply.status(202);
      return { batch_id: batchId };
    },
  );

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rows = await service.listBatches(workspaceId, req.params.id);
    return rows.map(toEvalBatchRecordDto);
  });

  // ---- Dashboard + compare (spec 0020) --------------------------------------
  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.dashboard(workspaceId, req.params.id);
  });

  app.get(
    '/agents/:id/eval-runs/compare',
    { schema: { params: IdParams, querystring: CompareQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const { a, b } = req.query;
      return service.compare(workspaceId, req.params.id, a, b);
    },
  );

  app.get('/eval-runs/:batchId', { schema: { params: BatchIdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const { batch, runs } = await service.getBatch(workspaceId, req.params.batchId);
    return { batch: toEvalBatchRecordDto(batch), runs: runs.map(toEvalRunRecordDto) };
  });

  app.post(
    '/eval-runs/:batchId/cancel',
    { schema: { params: BatchIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await service.cancelBatch(workspaceId, req.params.batchId);
      return { ok: true };
    },
  );
}
