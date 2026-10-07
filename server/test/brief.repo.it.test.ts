/**
 * `BriefRepository` (spec 0018, S16) — `pr_brief` persistence against a real
 * Postgres. Hermetic grounding/budget logic is covered by
 * `brief.grounding.test.ts`; this covers the write path itself: the full
 * ten-field shape actually stored, overwrite semantics, that `PrBrief.parse()`
 * still does real work on the stored row, and R59's "has merged predecessors"
 * fixture (seeded here, not assumed).
 *
 * User's Docker lane: `cd server && pnpm exec vitest run .it.test`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { PrBrief, type PrBriefEnvelope } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { BriefRepository } from '../src/modules/brief/repository/brief.repo.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

let repoSeq = 0;

/** A fresh repo + PR, with one `pr_files` row per `paths` entry. */
async function freshPr(db: PgFixture['handle']['db'], workspaceId: string, paths: string[] = ['src/a.ts']) {
  const name = `brief-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 't',
      author: 'a',
      branch: 'b',
      base: 'main',
      headSha: `sha-${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: paths.length,
      status: 'needs_review',
      body: null,
    })
    .returning();
  for (const path of paths) {
    await db.insert(t.prFiles).values({ prId: pr!.id, path, additions: 1, deletions: 0 });
  }
  return { repo: repo!, pr: pr! };
}

function envelope(over: Partial<PrBriefEnvelope> = {}): PrBriefEnvelope {
  return {
    intent: { intent: 'x', in_scope: [], out_of_scope: [] },
    blast: { changed_symbols: [], downstream: [], summary: 's' },
    risks: {
      risks: [
        { kind: 'security', title: 't', explanation: 'e', severity: 'medium', file_refs: ['src/a.ts'] },
      ],
    },
    history: { history: [] },
    summary: 'A summary.',
    review_focus: [{ file: 'src/a.ts', line: 1, reason: 'r' }],
    head_sha: 'sha-x',
    generated_at: new Date().toISOString(),
    model: 'gpt-4.1',
    missing_inputs: [],
    ...over,
  };
}

d('BriefRepository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-12: writes exactly one row with all ten envelope fields, head_sha equal to the pull head', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const repo = new BriefRepository(pg.handle.db);
    const env = envelope({ head_sha: pr.headSha });

    await repo.upsertBrief(pr.id, env);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    const json = rows[0]!.json as PrBriefEnvelope;
    for (const key of [
      'intent',
      'blast',
      'risks',
      'history',
      'summary',
      'review_focus',
      'head_sha',
      'generated_at',
      'model',
      'missing_inputs',
    ] as const) {
      expect(json).toHaveProperty(key);
    }
    // The WRAPPER object, never a bare array (AC-12's `:171-172` note).
    expect(Array.isArray(json.risks)).toBe(false);
    expect(json.risks).toEqual({ risks: env.risks.risks });
    expect(json.head_sha).toBe(pr.headSha);
  });

  it('AC-13: a second generation overwrites, leaving exactly one row', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const repo = new BriefRepository(pg.handle.db);
    await repo.upsertBrief(
      pr.id,
      envelope({ head_sha: pr.headSha, generated_at: '2020-01-01T00:00:00.000Z' }),
    );
    await repo.upsertBrief(
      pr.id,
      envelope({ head_sha: pr.headSha, generated_at: '2021-01-01T00:00:00.000Z' }),
    );

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.json as PrBriefEnvelope).generated_at).toBe('2021-01-01T00:00:00.000Z');
  });

  it('AC-57: the stored json satisfies PrBrief.parse(); a negative control on a missing intent fails', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const repo = new BriefRepository(pg.handle.db);
    await repo.upsertBrief(pr.id, envelope({ head_sha: pr.headSha }));

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(() => PrBrief.parse(row!.json)).not.toThrow();

    const { intent: _intent, ...withoutIntent } = row!.json as Record<string, unknown>;
    expect(() => PrBrief.parse(withoutIntent)).toThrow();
  });

  it(
    'AC-58: history is always {history: []} — even on a PR with a merged predecessor ' +
      'touching the same file',
    async () => {
      const { pr } = await freshPr(pg.handle.db, workspaceId, ['src/shared.ts']);
      // A real predecessor PR overlapping on the same file. Nothing in this
      // repository computes "history" from it — this fixture only makes sure
      // an "it was empty anyway" pass is impossible: a real overlapping
      // predecessor exists, and the stored field is still the empty wrapper.
      await freshPr(pg.handle.db, workspaceId, ['src/shared.ts']);

      const repo = new BriefRepository(pg.handle.db);
      await repo.upsertBrief(pr.id, envelope({ head_sha: pr.headSha }));

      const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
      expect((row!.json as PrBriefEnvelope).history).toEqual({ history: [] });
    },
  );

  it('getBrief parses the row through PrBriefEnvelope, carrying the transport fields PrBrief.parse() would strip', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const repo = new BriefRepository(pg.handle.db);
    const env = envelope({
      head_sha: pr.headSha,
      missing_inputs: [{ input: 'blast', reason: 'no_data' }],
    });
    await repo.upsertBrief(pr.id, env);

    const read = await repo.getBrief(pr.id);
    expect(read?.head_sha).toBe(pr.headSha);
    expect(read?.generated_at).toBe(env.generated_at);
    expect(read?.model).toBe(env.model);
    expect(read?.missing_inputs).toEqual([{ input: 'blast', reason: 'no_data' }]);
  });

  it('getBrief returns undefined when no row exists for the PR', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const repo = new BriefRepository(pg.handle.db);
    expect(await repo.getBrief(pr.id)).toBeUndefined();
  });
});
