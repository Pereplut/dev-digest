import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ConventionScan, ConventionsPage, Skill } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/** Fail with the server's own payload rather than a property access on undefined. */
function ok<T>(res: { statusCode: number; json: () => unknown; body: string }, status = 200): T {
  if (res.statusCode !== status) {
    throw new Error(`expected ${status}, got ${res.statusCode}: ${res.body}`);
  }
  return res.json() as T;
}

/**
 * A throwaway checkout, written per-run into a temp dir. The SEEDED repo is
 * fictional and has `clone_path: null`, so the only way to exercise the real
 * proof step (which reads files from disk) is to give a repo a real directory.
 * Nothing is committed to the repository for this.
 */
const USERS_TS = [
  'import { db } from "./db";', // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  const posts = await db.posts.findMany({ userId: id });', // 5
  '  return { user, posts };', // 6
  '}', // 7
].join('\n');

async function makeCheckout(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dd-conv-'));
  await writeFile(join(dir, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
  await writeFile(join(dir, '.prettierrc'), '{ "singleQuote": true }');
  await mkdir(join(dir, 'src', 'api'), { recursive: true });
  await writeFile(join(dir, 'src', 'api', 'users.ts'), USERS_TS);
  return dir;
}

/** One real candidate, one whose snippet is nowhere in the file. */
const EXTRACTION_FIXTURE = {
  candidates: [
    {
      category: 'async',
      rule: 'Always use async/await instead of .then() chains',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 4,
      evidence_end_line: 5,
      evidence_snippet: 'const user = await db.users.find(id);',
      confidence: 0.91,
    },
    {
      category: 'structure',
      rule: 'Redis access goes through a singleton',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 4,
      evidence_end_line: 4,
      evidence_snippet: 'export const redis = new Redis(config.redisUrl);',
      confidence: 0.8,
    },
  ],
};

d('conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;

    clonePath = await makeCheckout();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'conv-fixture',
        fullName: 'acme/conv-fixture',
        clonePath,
      })
      .returning({ id: t.repos.id });
    repoId = repo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  function makeApp(structured: unknown = EXTRACTION_FIXTURE, llm?: MockLLMProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({}),
        github: new MockGitHubClient(),
        llm: {
          openrouter:
            llm ??
            new MockLLMProvider('openai', {
              structuredBySchema: { ConventionExtraction: structured },
            }),
        },
      },
    });
  }

  /** Poll the page until the scan leaves `running`, exactly as the UI does. */
  async function waitForScan(
    app: Awaited<ReturnType<typeof makeApp>>,
  ): Promise<ConventionsPage> {
    for (let i = 0; i < 60; i++) {
      const page = ok<ConventionsPage>(
        await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` }),
      );
      if (page.scan && page.scan.status !== 'running') return page;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('scan never finished');
  }

  it('extracts, proves each candidate against real files, and persists the result', async () => {
    const app = await makeApp();
    const accepted = ok<{ scan: ConventionScan }>(
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` }),
      202,
    );
    expect(accepted.scan.status).toBe('running');

    const page = await waitForScan(app);
    expect(page.scan!.status).toBe('done');
    expect(page.scan!.candidate_count).toBe(2);
    // The second fixture candidate cites a snippet that is not in the file.
    expect(page.scan!.rejected_count).toBe(1);
    // tsconfig.json + .prettierrc were found by the config probe (criterion 39).
    expect(page.scan!.sample_file_count).toBeGreaterThanOrEqual(3);

    const proved = page.candidates.find((c) => c.category === 'async');
    expect(proved).toBeDefined();
    expect(proved!.evidence_valid).toBe(true);
    expect(proved!.status).toBe('pending');
    // The snippet is re-read from the file, so it carries the file's indentation.
    expect(proved!.evidence_snippet).toContain('  const user = await db.users.find(id);');

    const disproved = page.candidates.find((c) => c.category === 'structure');
    expect(disproved!.evidence_valid).toBe(false);
    expect(disproved!.status).toBe('rejected');
    expect(disproved!.rejected_reason).toBe('snippet_not_found');

    await app.close();
  });

  it('survives a restart: a fresh app still serves the persisted candidates', async () => {
    const app = await makeApp();
    const page = ok<ConventionsPage>(
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` }),
    );
    expect(page.candidates.length).toBe(2);
    await app.close();
  });

  it('a re-scan preserves an accept/reject decision and does not duplicate rows', async () => {
    const app = await makeApp();
    const before = ok<ConventionsPage>(
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` }),
    );
    const target = before.candidates.find((c) => c.evidence_valid)!;

    ok(
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${target.id}`,
        payload: { status: 'accepted' },
      }),
    );

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const after = await waitForScan(app);

    expect(after.candidates.length).toBe(before.candidates.length);
    const again = after.candidates.find((c) => c.id === target.id)!;
    expect(again.status).toBe('accepted');
    await app.close();
  });

  it('edits a candidate rule', async () => {
    const app = await makeApp();
    const page = ok<ConventionsPage>(
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` }),
    );
    const updated = ok<{ rule: string }>(
      await app.inject({
        method: 'PATCH',
        url: `/conventions/${page.candidates[0]!.id}`,
        payload: { rule: 'Prefer await over promise chains' },
      }),
    );
    expect(updated.rule).toBe('Prefer await over promise chains');
    await app.close();
  });

  /**
   * Regression: the proof step used to read ANY model-supplied path inside the
   * clone, so a candidate citing `.git/config` had its credential line re-read
   * from disk and stored as evidence. Only sampled files may be opened now.
   */
  it('never reads a file outside the sample, even one that exists in the clone', async () => {
    // A real, readable file in the checkout that the sampler never picks.
    await mkdir(join(clonePath, '.git'), { recursive: true });
    await writeFile(
      join(clonePath, '.git', 'config'),
      ['[core]', '\trepositoryformatversion = 0', '[remote "origin"]', '\turl = https://x-access-token:SECRET@github.com/acme/conv-fixture'].join('\n'),
    );

    const app = await makeApp({
      candidates: [
        {
          category: 'structure',
          rule: 'Remotes are configured in git config',
          evidence_path: '.git/config',
          evidence_start_line: 1,
          evidence_end_line: 4,
          // Boilerplate that really is on line 1 — proof would pass if the file were read.
          evidence_snippet: '[core]',
          confidence: 0.9,
        },
      ],
    });

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const page = await waitForScan(app);

    const leak = page.candidates.find((c) => c.evidence_path === '.git/config');
    expect(leak).toBeDefined();
    expect(leak!.evidence_valid).toBe(false);
    expect(leak!.rejected_reason).toBe('file_not_found');
    // The credential must appear nowhere in the response.
    expect(JSON.stringify(page)).not.toContain('SECRET');
    expect(JSON.stringify(page)).not.toContain('x-access-token');

    await app.close();
  });

  /**
   * Regression: a candidate auto-rejected by failed proof used to stay rejected
   * for ever, because the upsert preserved the stored status once the evidence
   * became valid again. A MACHINE rejection must be retractable; a USER one not.
   */
  it('returns a machine-rejected candidate to pending once its evidence proves out', async () => {
    const rule = 'Posts are fetched with findMany';
    const bogus = {
      category: 'async' as const,
      rule,
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 5,
      evidence_end_line: 5,
      evidence_snippet: 'this text is nowhere in the file',
      confidence: 0.7,
    };
    // Same path + rule ⇒ same fingerprint ⇒ merges into the same row.
    const good = { ...bogus, evidence_snippet: 'const posts = await db.posts.findMany({ userId: id });' };

    const failing = await makeApp({ candidates: [bogus] });
    await failing.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const first = await waitForScan(failing);
    const rejectedRow = first.candidates.find((c) => c.rule === rule)!;
    expect(rejectedRow.status).toBe('rejected');
    expect(rejectedRow.rejected_reason).toBe('snippet_not_found');
    await failing.close();

    const passing = await makeApp({ candidates: [good] });
    await passing.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const second = await waitForScan(passing);
    const revived = second.candidates.find((c) => c.id === rejectedRow.id)!;
    expect(revived.evidence_valid).toBe(true);
    expect(revived.rejected_reason).toBeNull();
    expect(revived.status).toBe('pending');
    await passing.close();
  });

  /**
   * Regression: `rejected_reason` is the marker that tells a MACHINE rejection
   * from a human one, and the merge resets a marked row to `pending` once its
   * evidence proves out. `patch()` used to leave the marker in place, so a user
   * who accepted an auto-rejected candidate had that choice silently undone by
   * the next scan — the one thing the fingerprint merge exists to prevent.
   */
  it('keeps a user ACCEPT on a candidate the machine had rejected', async () => {
    const rule = 'Users are fetched by id';
    const bogus = {
      category: 'async' as const,
      rule,
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 4,
      evidence_end_line: 4,
      evidence_snippet: 'nothing in the file looks like this',
      confidence: 0.6,
    };
    const good = { ...bogus, evidence_snippet: 'const user = await db.users.find(id);' };

    const failing = await makeApp({ candidates: [bogus] });
    await failing.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const first = await waitForScan(failing);
    const row = first.candidates.find((c) => c.rule === rule)!;
    expect(row.status).toBe('rejected');
    expect(row.rejected_reason).toBe('snippet_not_found');

    // The user overrules the machine.
    ok(
      await failing.inject({
        method: 'PATCH',
        url: `/conventions/${row.id}`,
        payload: { status: 'accepted' },
      }),
    );
    await failing.close();

    // Next scan proves the evidence. The row must stay ACCEPTED, not go pending.
    const passing = await makeApp({ candidates: [good] });
    await passing.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const second = await waitForScan(passing);
    const after = second.candidates.find((c) => c.id === row.id)!;
    expect(after.evidence_valid).toBe(true);
    expect(after.status).toBe('accepted');
    await passing.close();
  });

  /**
   * Regression: a clone URL carries a PAT and git echoes the full remote in its
   * stderr, so an error raised during extraction can contain the token. The
   * scan's `error` is served to the browser, so it must be redacted on write —
   * the conventions path used to skip the `platform/jobs.ts` chokepoint.
   */
  it('redacts a credential out of a failed scan error before storing it', async () => {
    class ThrowingLLM extends MockLLMProvider {
      override async completeStructured(): Promise<never> {
        throw new Error(
          'fatal: could not read from https://x-access-token:ghp_SUPERSECRET@github.com/acme/conv-fixture',
        );
      }
    }

    const app = await makeApp(EXTRACTION_FIXTURE, new ThrowingLLM('openai'));
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const page = await waitForScan(app);

    expect(page.scan!.status).toBe('failed');
    expect(page.scan!.error).not.toContain('ghp_SUPERSECRET');
    expect(page.scan!.error).not.toContain('x-access-token');
    expect(page.scan!.error).toContain('***@github.com');
    // Nothing anywhere in the response carries the token.
    expect(JSON.stringify(page)).not.toContain('ghp_SUPERSECRET');
    await app.close();
  });

  /**
   * Regression: two candidates collapsing to one fingerprint in a single batch
   * upsert abort the statement with SQLSTATE 21000 and fail the whole scan.
   */
  it('survives a model returning two candidates that share a fingerprint', async () => {
    const base = {
      category: 'async' as const,
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 4,
      evidence_end_line: 4,
      evidence_snippet: 'const user = await db.users.find(id);',
    };
    const app = await makeApp({
      candidates: [
        { ...base, rule: 'Always await database calls', confidence: 0.6 },
        // Differs only by case and trailing punctuation — same fingerprint.
        { ...base, rule: 'always await database calls.', confidence: 0.95 },
      ],
    });

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const page = await waitForScan(app);

    expect(page.scan!.status).toBe('done');
    const matches = page.candidates.filter((c) => /await database calls/i.test(c.rule));
    expect(matches).toHaveLength(1);
    // The higher-confidence duplicate wins.
    expect(matches[0]!.confidence).toBeCloseTo(0.95);
    await app.close();
  });

  it('refuses to extract from a repo with no local checkout', async () => {
    const app = await makeApp();
    const [bare] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `no-clone-${Date.now()}`,
        fullName: `acme/no-clone-${Date.now()}`,
        clonePath: null,
      })
      .returning({ id: t.repos.id });

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${bare!.id}/conventions/extract`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('no local checkout');

    // No scan row was written for the refused request.
    const page = ok<ConventionsPage>(
      await app.inject({ method: 'GET', url: `/repos/${bare!.id}/conventions` }),
    );
    expect(page.scan).toBeNull();
    await app.close();
  });

  it('creates a skill from the edited draft, with evidence files and source=extracted', async () => {
    const app = await makeApp();
    const page = ok<ConventionsPage>(
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` }),
    );
    const accepted = page.candidates.filter((c) => c.evidence_valid);

    const defaults = ok<{ name: string; body: string; accepted_count: number }>(
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill` }),
    );
    expect(defaults.name).toBe('conv-fixture-conventions');

    // The user edits the body before saving — criterion 41.
    const skill = ok<Skill>(
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/skill`,
        payload: {
          name: `conv-fixture-conventions-${Date.now()}`,
          description: 'Edited description',
          type: 'convention',
          body: '# edited by the user\n\nSome rule.',
          enabled: true,
          candidate_ids: accepted.map((c) => c.id),
        },
      }),
      201,
    );

    expect(skill.source).toBe('extracted');
    expect(skill.type).toBe('convention');
    expect(skill.body).toBe('# edited by the user\n\nSome rule.');
    expect(skill.evidence_files).toEqual(['src/api/users.ts']);
    expect(skill.token_count).toBeGreaterThan(0);

    // It really is in the skills table, so it shows up in Skills Lab.
    const [row] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.id, skill.id));
    expect(row!.source).toBe('extracted');
    await app.close();
  });
});
