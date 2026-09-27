/**
 * GET /pulls/:id/smart-diff — the reviewer-ordered projection of a PR's files.
 *
 * The grouping itself is proved without Postgres (smart-diff-classify /
 * smart-diff-build). What needs a real DB is everything this route adds on top:
 * that the response satisfies the CONTRACT, that "latest review" means the newest
 * DONE run that actually has a review, that dismissed findings are excluded, and
 * that a PR in another workspace is invisible.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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

  /** A PR carrying one file per role, in a deliberately unhelpful GitHub order. */
  async function setupPr(ws = workspaceId) {
    const name = `smart-diff-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: 'deadbeef',
        additions: 10,
        deletions: 2,
        filesCount: 5,
        status: 'open',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 92, deletions: 24, patch: null },
      { prId: pr!.id, path: 'README.md', additions: 4, deletions: 1, patch: null },
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0, patch: null },
      { prId: pr!.id, path: 'src/index.ts', additions: 12, deletions: 2, patch: null },
      { prId: pr!.id, path: 'test/ratelimit.test.ts', additions: 30, deletions: 0, patch: null },
    ]);
    return { repo: repo!, pr: pr! };
  }

  /** A review attached to a run, so the "latest reviewed run" rule can see it. */
  async function addReview(
    prId: string,
    opts: { status: 'done' | 'failed'; ranAt: Date; findings: { file: string; startLine: number; dismissed?: boolean }[] },
  ) {
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId, status: opts.status, ranAt: opts.ranAt })
      .returning();
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, runId: run!.id, kind: 'review' })
      .returning();
    if (opts.findings.length > 0) {
      await pg.handle.db.insert(t.findings).values(
        opts.findings.map((f) => ({
          reviewId: review!.id,
          file: f.file,
          startLine: f.startLine,
          endLine: f.startLine,
          severity: 'WARNING',
          category: 'bug',
          title: 'x',
          rationale: 'y',
          confidence: 0.8,
          ...(f.dismissed ? { dismissedAt: new Date() } : {}),
        })),
      );
    }
    return { run: run!, review: review! };
  }

  const app = async () =>
    buildApp({ config: config(), db: pg.handle.db, overrides: { github: new MockGitHubClient() } });

  async function get(prId: string) {
    return (await app()).inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
  }

  it('groups the PR in reviewer order and validates against the contract', async () => {
    const { pr } = await setupPr();

    const res = await get(pr.id);
    expect(res.statusCode).toBe(200);

    // AC 8 — the response really satisfies SmartDiff, not just our TS types.
    const body = SmartDiff.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual([
      'core',
      'tests',
      'wiring',
      'docs',
      'boilerplate',
    ]);
    expect(body.groups.find((g) => g.role === 'boilerplate')!.files[0]!.path).toBe('pnpm-lock.yaml');
    expect(body.split_suggestion).toEqual({
      too_big: false,
      total_lines: 249,
      proposed_splits: [],
    });
  });

  it('groups before any review has run, with no finding lines and no model call', async () => {
    const { pr } = await setupPr();
    const body = SmartDiff.parse((await get(pr.id)).json());
    expect(body.groups.length).toBe(5);
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(
      true,
    );
  });

  it('carries the latest review open findings as line numbers on their file', async () => {
    const { pr } = await setupPr();
    await addReview(pr.id, {
      status: 'done',
      ranAt: new Date('2026-01-01T10:00:00Z'),
      findings: [
        { file: 'src/middleware/ratelimit.ts', startLine: 52 },
        { file: 'src/middleware/ratelimit.ts', startLine: 28 },
      ],
    });

    const body = SmartDiff.parse((await get(pr.id)).json());
    const core = body.groups.find((g) => g.role === 'core')!;
    expect(core.files.find((f) => f.path === 'src/middleware/ratelimit.ts')!.finding_lines).toEqual([
      28, 52,
    ]);
    expect(body.groups.find((g) => g.role === 'docs')!.files[0]!.finding_lines).toEqual([]);
  });

  it('excludes a dismissed finding', async () => {
    const { pr } = await setupPr();
    await addReview(pr.id, {
      status: 'done',
      ranAt: new Date('2026-01-01T10:00:00Z'),
      findings: [
        { file: 'src/middleware/ratelimit.ts', startLine: 10 },
        { file: 'src/middleware/ratelimit.ts', startLine: 20, dismissed: true },
      ],
    });

    const body = SmartDiff.parse((await get(pr.id)).json());
    const core = body.groups.find((g) => g.role === 'core')!;
    expect(core.files.find((f) => f.path === 'src/middleware/ratelimit.ts')!.finding_lines).toEqual([
      10,
    ]);
  });

  it('a newer FAILED run does not hide the last good review', async () => {
    const { pr } = await setupPr();
    await addReview(pr.id, {
      status: 'done',
      ranAt: new Date('2026-01-01T10:00:00Z'),
      findings: [{ file: 'src/middleware/ratelimit.ts', startLine: 42 }],
    });
    await addReview(pr.id, {
      status: 'failed',
      ranAt: new Date('2026-01-02T10:00:00Z'),
      findings: [{ file: 'src/middleware/ratelimit.ts', startLine: 999 }],
    });

    const body = SmartDiff.parse((await get(pr.id)).json());
    const core = body.groups.find((g) => g.role === 'core')!;
    expect(core.files.find((f) => f.path === 'src/middleware/ratelimit.ts')!.finding_lines).toEqual([
      42,
    ]);
  });

  it('returns an empty payload, not an error, for a PR with no files persisted', async () => {
    const name = `smart-diff-empty-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 2,
        title: 'Never fetched',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'c',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'open',
      })
      .returning();

    const res = await get(pr!.id);
    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());
    expect(body.groups).toEqual([]);
    expect(body.split_suggestion.total_lines).toBe(0);
  });

  it('404s for a PR in another workspace', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${seq++}` })
      .returning();
    const { pr } = await setupPr(other!.id);

    // The request resolves the DEFAULT workspace, so this PR must be invisible.
    expect((await get(pr.id)).statusCode).toBe(404);
  });

  it('422s on a non-uuid id', async () => {
    expect((await get('not-a-uuid')).statusCode).toBe(422);
  });
});
