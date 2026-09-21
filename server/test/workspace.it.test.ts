/**
 * GET /workspace — the clone-directory + cloned-repos overview.
 *
 * Written as a CHARACTERIZATION test before the module is extracted into a
 * service + repository (plan item B1): it pins the response shape produced by
 * the current inline implementation, so the refactor has something to be
 * measured against. The workspace module had zero coverage of any kind (plan
 * item H2), which is exactly why refactoring it blind would have been unsafe.
 *
 * Needs Postgres (the route selects repos), so it is an `.it.test.ts` per
 * server/AGENTS.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

interface WorkspaceRepoSummary {
  id: string;
  full_name: string;
  clone_path: string | null;
  last_polled_at: string | null;
  cloned: boolean;
}
interface WorkspaceResponse {
  workspaceId: string;
  cloneDir: string;
  repos: WorkspaceRepoSummary[];
}

d('GET /workspace (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns the workspace id and the configured clone dir', async () => {
    const cfg = config();
    const app = await buildApp({ config: cfg, db: pg.handle.db });

    const res = await app.inject({ method: 'GET', url: '/workspace' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as WorkspaceResponse;
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.cloneDir).toBe(cfg.cloneDir);
    expect(Array.isArray(body.repos)).toBe(true);
  });

  it('reports `cloned` from whether a clone path is set, and echoes last_polled_at', async () => {
    const polledAt = new Date('2026-06-01T00:00:00.000Z');
    const [withClone] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'ws-cloned',
        fullName: 'acme/ws-cloned',
        clonePath: '/tmp/clones/acme/ws-cloned',
        lastPolledAt: polledAt,
      })
      .returning();
    const [withoutClone] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ws-bare', fullName: 'acme/ws-bare' })
      .returning();

    const app = await buildApp({ config: config(), db: pg.handle.db });
    const body = (await app.inject({ method: 'GET', url: '/workspace' })).json() as WorkspaceResponse;

    const cloned = body.repos.find((r) => r.id === withClone!.id);
    expect(cloned).toMatchObject({
      full_name: 'acme/ws-cloned',
      clone_path: '/tmp/clones/acme/ws-cloned',
      cloned: true,
      last_polled_at: polledAt.toISOString(),
    });

    const bare = body.repos.find((r) => r.id === withoutClone!.id);
    expect(bare).toMatchObject({
      full_name: 'acme/ws-bare',
      clone_path: null,
      cloned: false,
      last_polled_at: null,
    });
  });
});
