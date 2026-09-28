/**
 * `GET /pulls/:id/blast` (spec 0012 §1) — the route wires `getContext` +
 * `BlastService`, transport only. Hermetic: a raw Fastify instance with the
 * blast plugin registered and a real `Container` subclass standing in for
 * Postgres (never `as unknown as Container` — see blast-service.test.ts's
 * header for why). Not `*.it.test.ts`: no `test/helpers/pg.ts`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  validatorCompiler,
  serializerCompiler,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import { BlastRadius, type AuthProvider } from '@devdigest/shared';
import blastRoutes from '../src/modules/blast/routes.js';
import { AppError } from '../src/platform/errors.js';
import { ReviewRepository, type PullRow } from '../src/modules/reviews/repository.js';
import { Container } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { RepoIntel, BlastResult } from '../src/modules/repo-intel/types.js';

const UNUSED_DB = null as unknown as Db;
const PR_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-0000000000ff';

function testConfig(): AppConfig {
  return {
    databaseUrl: 'postgres://unused',
    apiPort: 0,
    apiHost: '127.0.0.1',
    webPort: 0,
    cloneDir: '/tmp/unused',
    secretsPath: '/tmp/unused-secrets.json',
    nodeEnv: 'test',
    logLevel: 'silent',
    webOrigin: 'http://localhost:0',
    embeddingsEnabled: false,
    repoIntelEnabled: true,
    promptLogVerbose: false,
    promptLogVerboseIgnored: false,
    promptLogEnabled: false,
  };
}

function pull(over: Partial<PullRow> = {}): PullRow {
  return {
    id: PR_ID,
    workspaceId: WORKSPACE_ID,
    repoId: 'repo-1',
    number: 42,
    title: 't',
    author: 'a',
    branch: 'b',
    base: 'main',
    headSha: 'sha1',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...over,
  };
}

/** RepoIntel implements only `getBlastRadius` — the sole method the route path calls. */
function stubRepoIntel(getBlastRadius: RepoIntel['getBlastRadius']): RepoIntel {
  return { getBlastRadius } as RepoIntel;
}

const AUTH: AuthProvider = {
  currentUser: async () => ({ id: 'user-1', email: 'u@x.com', name: 'U' }),
  currentWorkspace: async () => ({ id: WORKSPACE_ID, name: 'W' }),
};

class TestContainer extends Container {
  constructor(
    private readonly stubReviewRepo: ReviewRepository,
    private readonly stubRepoIntel: RepoIntel,
  ) {
    super(testConfig(), UNUSED_DB, { auth: AUTH });
  }
  override get reviewRepo(): ReviewRepository {
    return this.stubReviewRepo;
  }
  override get repoIntel(): RepoIntel {
    return this.stubRepoIntel;
  }
}

async function buildTestApp(container: Container): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      reply.status(422).send({ error: { code: 'validation_error', message: 'Request validation failed' } });
      return;
    }
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    reply.status(500).send({ error: { code: 'internal_error', message: 'unexpected' } });
  });
  app.decorate('container', container);
  await app.register(blastRoutes);
  return app;
}

describe('GET /pulls/:id/blast', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('200s with a payload that satisfies BlastRadius, degraded fields absent on the happy path', async () => {
    const reviewRepo = new ReviewRepository(UNUSED_DB);
    reviewRepo.getPull = async () => pull();
    reviewRepo.getPrFiles = async () => [
      { id: 'f1', prId: PR_ID, path: 'a.ts', additions: 1, deletions: 0, patch: null },
    ];
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: [{ file: 'b.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 3, rank: 1 }],
      impactedEndpoints: ['GET /x'],
    };
    app = await buildTestApp(new TestContainer(reviewRepo, stubRepoIntel(async () => result)));

    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/blast` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => BlastRadius.parse(body)).not.toThrow();
    expect(body.downstream[0].symbol).toBe('rateLimit');
    expect(body.degraded).toBeUndefined();
  });

  it('carries degraded + reason through to the payload when the facade reports them', async () => {
    const reviewRepo = new ReviewRepository(UNUSED_DB);
    reviewRepo.getPull = async () => pull();
    reviewRepo.getPrFiles = async () => [];
    const result: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'index_partial',
    };
    app = await buildTestApp(new TestContainer(reviewRepo, stubRepoIntel(async () => result)));

    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/blast` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => BlastRadius.parse(body)).not.toThrow();
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('index_partial');
  });

  it('404s for an unknown pull request, before the index is read', async () => {
    const getBlastRadius = async (): Promise<BlastResult> => {
      throw new Error('must not be reached');
    };
    const reviewRepo = new ReviewRepository(UNUSED_DB);
    reviewRepo.getPull = async () => undefined;
    reviewRepo.getPrFiles = async () => {
      throw new Error('must not be reached');
    };
    app = await buildTestApp(new TestContainer(reviewRepo, stubRepoIntel(getBlastRadius)));

    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/blast` });

    expect(res.statusCode).toBe(404);
  });

  it('422s for a non-uuid :id', async () => {
    const reviewRepo = new ReviewRepository(UNUSED_DB);
    reviewRepo.getPull = async () => pull();
    reviewRepo.getPrFiles = async () => [];
    app = await buildTestApp(
      new TestContainer(reviewRepo, stubRepoIntel(async () => ({
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
      }))),
    );

    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });

    expect(res.statusCode).toBe(422);
  });
});
