import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { SkillDraft, SkillSource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, ValidationError } from '../../platform/errors.js';
import { MAX_IMPORT_UPLOAD_BYTES } from './constants.js';
import { SkillsService } from './service.js';

/**
 * Skills module (spec 0006). Transport only.
 *   GET    /skills?q                              → Skill[] (token_count + card stats)
 *   GET    /skills/:id                            → Skill
 *   POST   /skills                                → create (v1)
 *   PUT    /skills/:id                            → edit (content → vN+1) / toggle enabled
 *   DELETE /skills/:id                            → delete
 *   GET    /skills/:id/versions                   → SkillVersion[] (newest first)
 *   POST   /skills/:id/versions/:version/restore  → Skill (restored as a NEW version)
 *   GET    /skills/:id/stats                      → SkillStats
 *   POST   /skills/import/preview                 → SkillImportPreview (multipart `file`; persists nothing)
 */

const ListQuery = z.object({ q: z.string().max(200).optional() });

const CreateSkillBody = SkillDraft.extend({ source: SkillSource.optional() });

const UpdateSkillBody = SkillDraft.partial().extend({ enabled: z.boolean().optional() });

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * Read the single uploaded `file` part. @fastify/multipart's own errors are
 * turned into AppErrors so every failure is a structured 4xx.
 */
async function readUpload(req: FastifyRequest): Promise<{ filename: string; bytes: Uint8Array }> {
  try {
    const part = await req.file();
    if (!part || part.fieldname !== 'file') {
      throw new ValidationError('Upload a single file in the "file" field');
    }
    const bytes = await part.toBuffer();
    return { filename: part.filename, bytes };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError('file_too_large', `File is larger than ${MAX_IMPORT_UPLOAD_BYTES} bytes`, 413);
    }
    if (e.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      throw new AppError('unsupported_media_type', 'Expected a multipart/form-data upload', 415);
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      throw new AppError(e.code ?? 'bad_upload', e.message ?? 'Invalid upload', e.statusCode);
    }
    throw err;
  }
}

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  // Scoped to this plugin (modules are registered without fastify-plugin), so
  // only the import route accepts multipart bodies.
  await app.register(multipart, {
    limits: { fileSize: MAX_IMPORT_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
  });

  app.get('/skills', { schema: { querystring: ListQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.query.q);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.delete(workspaceId, req.params.id);
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.versions(workspaceId, req.params.id);
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.restore(workspaceId, req.params.id, req.params.version);
    },
  );

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.stats(workspaceId, req.params.id);
  });

  app.post('/skills/import/preview', async (req) => {
    // Drain the upload first: a rejected upload never costs a DB round trip.
    const { filename, bytes } = await readUpload(req);
    const { workspaceId } = await getContext(app.container, req);
    return service.previewImport(workspaceId, filename, bytes);
  });
}
