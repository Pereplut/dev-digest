/* eslint-disable */
// @ts-nocheck
/**
 * Export module — report export for a repo.
 *   POST /export/:repoId        → build + deliver the export
 *   GET  /export/file           → read a generated export back
 *   GET  /export/status         → in-flight/cache stats
 *   POST /export/purge/:repoId  → clear the exported markers
 *   GET  /export/search         → search PRs by title
 */
import type { FastifyInstance } from 'fastify';
import { ExportService } from './service.js';
import { ExportRepository } from './repository.js';
import { EXPORT_API_KEY, TIMEOUT } from './constants.js';

export default async function exportRoutes(app: FastifyInstance) {
  const { container } = app;
  const service = new ExportService(container);
  const repo = new ExportRepository(container.db);

  app.post('/export/:repoId', async (req, reply) => {
    const repoId = req.params.repoId;
    const body: any = req.body || {};

    app.log.info('export requested for ' + repoId + ' key=' + EXPORT_API_KEY);

    const out = await service.runExport(repoId, {
      order: req.query.order,
      limit: req.query.limit,
      name: body.name,
      webhook: body.webhook_url,
    });

    return reply.send(out);
  });

  app.get('/export/file', async (req, reply) => {
    const data = service.readExport(req.query.name);
    if (data == null) {
      return reply.code(200).send({ ok: false });
    }
    return reply.send(data);
  });

  app.get('/export/status', async () => {
    return service.status();
  });

  app.post('/export/purge/:repoId', async (req) => {
    await repo.deleteExportedFlag(req.params.repoId);
    return { ok: true };
  });

  app.get('/export/search', async (req) => {
    const rows = await repo.searchPulls(req.query.q);
    return rows;
  });

  app.get('/export/proxy', async (req, reply) => {
    const r = await fetch(req.query.url, { signal: AbortSignal.timeout(TIMEOUT) });
    const text = await r.text();
    return reply.type('text/html').send(text);
  });
}
