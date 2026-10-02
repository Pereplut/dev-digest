/**
 * `OnboardingRepository.listOpenFindings` / `listPendingValidCandidates` —
 * the two DB-backed `first_tasks` sources (AC-38, AC-39, AC-40, AC-66,
 * AC-67). Real Postgres: the filtering is expressed in SQL joins and WHERE
 * clauses a hermetic stub cannot exercise meaningfully.
 *
 * User's Docker lane: `cd server && pnpm exec vitest run .it.test`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { OnboardingRepository } from '../src/modules/onboarding/repository/onboarding.repo.js';
import { buildFirstTasks, siblingTestCandidates } from '../src/modules/onboarding/first-tasks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('onboarding first_tasks sources (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let repo: OnboardingRepository;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    repo = new OnboardingRepository(pg.handle.db);

    const [repoRow] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'first-tasks-fixture', fullName: 'acme/first-tasks-fixture' })
      .returning({ id: t.repos.id });
    repoId = repoRow!.id;

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1,
        title: 'Add feature',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'sha1',
      })
      .returning({ id: t.pullRequests.id });

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, kind: 'review' })
      .returning({ id: t.reviews.id });

    const findingBase = {
      reviewId: review!.id,
      startLine: 1,
      endLine: 2,
      severity: 'WARNING',
      category: 'style',
      rationale: 'r',
      confidence: 0.8,
    };
    await pg.handle.db.insert(t.findings).values([
      { ...findingBase, file: 'src/open.ts', title: 'Open finding' }, // open — eligible
      { ...findingBase, file: 'src/accepted.ts', title: 'Accepted finding', acceptedAt: new Date() }, // excluded
      { ...findingBase, file: 'src/dismissed.ts', title: 'Dismissed finding', dismissedAt: new Date() }, // excluded
    ]);

    await pg.handle.db.insert(t.conventions).values([
      {
        workspaceId,
        repoId,
        category: 'style',
        rule: 'Valid pending candidate',
        evidencePath: 'src/valid.ts',
        evidenceStartLine: 1,
        status: 'pending',
        evidenceValid: true,
        fingerprint: 'fp-valid',
      },
      {
        workspaceId,
        repoId,
        category: 'style',
        rule: 'Invalid-evidence candidate',
        evidencePath: 'src/invalid.ts',
        evidenceStartLine: 1,
        status: 'pending',
        evidenceValid: false,
        fingerprint: 'fp-invalid',
      },
      {
        workspaceId,
        repoId,
        category: 'style',
        rule: 'Already-accepted candidate',
        evidencePath: 'src/accepted-rule.ts',
        evidenceStartLine: 1,
        status: 'accepted',
        evidenceValid: true,
        fingerprint: 'fp-accepted',
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-38, AC-39: only the open finding is selected, with file:start_line', async () => {
    const rows = await repo.listOpenFindings(repoId, 10);
    expect(rows.map((r) => r.file)).toEqual(['src/open.ts']);
    expect(rows[0]!.startLine).toBe(1);
  });

  it('AC-66: only the pending candidate with evidence_valid=true is selected', async () => {
    const rows = await repo.listPendingValidCandidates(repoId, 10);
    expect(rows.map((r) => r.evidencePath)).toEqual(['src/valid.ts']);
  });

  it('a repo with no findings/candidates produces the deterministic zero-signals result', async () => {
    const [emptyRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'empty-first-tasks', fullName: 'acme/empty-first-tasks' })
      .returning({ id: t.repos.id });

    const findings = await repo.listOpenFindings(emptyRepo!.id, 10);
    const candidates = await repo.listPendingValidCandidates(emptyRepo!.id, 10);
    const result = buildFirstTasks({
      findings,
      candidates,
      rankedPaths: [],
      existingSiblingPaths: new Set(),
    });
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('AC-67: an untested-file item carries the bare path, matching /^[^:]+$/', async () => {
    const result = buildFirstTasks({
      findings: [],
      candidates: [],
      rankedPaths: ['src/untested.ts'],
      existingSiblingPaths: new Set(),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.anchor).toMatch(/^[^:]+$/);
    expect(siblingTestCandidates('src/untested.ts')).toContain('src/untested.test.ts');
  });
});
