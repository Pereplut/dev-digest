/**
 * GET /repos/:id/pulls/:number — resolve a PR by its GitHub number.
 *
 * The UI's route is keyed by PR number, but every PR API was keyed by the row
 * uuid, so the detail page had to fetch the whole PR list first just to
 * translate one into the other (plan item C4). This endpoint removes that hop.
 *
 * What is actually worth asserting is the SCOPING, not the happy path: PR
 * numbers are per-repo counters, so two repos can both have #77 and the lookup
 * must not cross between them.
 *
 * A MockGitHubClient is injected everywhere on purpose — the detail path calls
 * container.github(), and a developer's real secrets.json would otherwise make
 * this suite hit github.com.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrDetail } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('GET /repos/:id/pulls/:number (Testcontainers pg)', () => {
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

  /** A repo with one PR at `number`. Repo names are unique per call. */
  async function setupRepoWithPr(number: number) {
    const name = `by-number-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number,
        title: `PR ${number} in ${name}`,
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  const appWithMockGitHub = async () =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });

  it('resolves a PR by number without going through the PR list', async () => {
    const { repo, pr } = await setupRepoWithPr(77);
    const app = await appWithMockGitHub();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls/77` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrDetail;
    expect(body.id).toBe(pr.id);
    expect(body.number).toBe(77);
  });

  it('does NOT resolve a same-numbered PR belonging to another repo', async () => {
    const a = await setupRepoWithPr(77);
    const b = await setupRepoWithPr(77);
    expect(a.pr.id).not.toBe(b.pr.id);
    const app = await appWithMockGitHub();

    const fromA = (
      await app.inject({ method: 'GET', url: `/repos/${a.repo.id}/pulls/77` })
    ).json() as PrDetail;
    const fromB = (
      await app.inject({ method: 'GET', url: `/repos/${b.repo.id}/pulls/77` })
    ).json() as PrDetail;

    expect(fromA.id).toBe(a.pr.id);
    expect(fromB.id).toBe(b.pr.id);
  });

  it('404s for a number that does not exist in the repo', async () => {
    const { repo } = await setupRepoWithPr(77);
    const app = await appWithMockGitHub();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls/9999` });
    expect(res.statusCode).toBe(404);
  });

  it('422s on a non-numeric PR number', async () => {
    const { repo } = await setupRepoWithPr(77);
    const app = await appWithMockGitHub();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls/not-a-number` });
    expect(res.statusCode).toBe(422);
  });
});
