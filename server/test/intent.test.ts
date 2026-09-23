/**
 * deriveIntent (spec 0008) — the step where everything meets, and the only part
 * that can fail.
 *
 * The contract under test is fail-open: whatever goes wrong, the function
 * returns `undefined` and the review runs without the slot. So most of these
 * tests break something on purpose and assert that nothing propagates.
 *
 * No Docker: the LLM and the repository are stubs.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveIntent } from '../src/modules/reviews/intent.js';
import type { Container } from '../src/platform/container.js';
import type { ReviewRepository, PullRow } from '../src/modules/reviews/repository.js';

const runLog = { step: <T,>(_l: string, fn: () => Promise<T>) => fn(), info: () => {} };

const pull = (over: Partial<PullRow> = {}): PullRow =>
  ({
    id: 'pr-1',
    title: 'Add readiness probe',
    body: 'Closes #12. Adds GET /health/ready.',
    branch: 'feat/probe',
    headSha: 'sha1',
    ...over,
  }) as PullRow;

const repoRow = (over: Record<string, unknown> = {}) =>
  ({ fullName: 'Pereplut/dev-digest', clonePath: null, ...over }) as never;

const classification = {
  category: 'feature' as const,
  intent: 'Add a readiness probe.',
  in_scope: ['server/src/app.ts'],
  out_of_scope: [],
  rationale: 'The body says so.',
  evidence: [{ source_kind: 'body' as const, ref: 'body', quote: 'Adds GET /health/ready.' }],
};

function stubs(over: { data?: unknown; throws?: Error; stored?: unknown; storedHash?: string } = {}) {
  const upsert = vi.fn().mockResolvedValue(undefined);
  const completeStructured = vi.fn(async () => {
    if (over.throws) throw over.throws;
    return {
      data: over.data ?? classification,
      model: 'gpt-4.1-mini',
      tokensIn: 900,
      tokensOut: 80,
      costUsd: 0.0004,
      raw: '{}',
      attempts: 1,
    };
  });
  const repo = {
    getIntent: vi.fn().mockResolvedValue(over.stored),
    getIntentInputHash: vi.fn().mockResolvedValue(over.storedHash ?? null),
    upsertIntent: upsert,
  } as unknown as ReviewRepository;
  // `resolveFeatureModel` reads the workspace's override through
  // SettingsRepository, so the stub needs a db whose select chain resolves to
  // no rows — i.e. "no override", which falls back to the registry default.
  const noRows = { from: () => ({ where: () => Promise.resolve([]) }) };
  const container = {
    db: { select: () => noRows },
    llm: vi.fn().mockResolvedValue({ completeStructured }),
  } as unknown as Container;
  return { repo, container, upsert, completeStructured };
}

const DIFF = 'diff --git a/server/src/app.ts b/server/src/app.ts\n+++ b/server/src/app.ts\n+x\n';

describe('deriveIntent', () => {
  it('classifies, verifies the quote, and persists the row', async () => {
    const { repo, container, upsert } = stubs();
    const out = await deriveIntent(container, repo, 'ws', pull(), repoRow(), DIFF, runLog);

    expect(out?.promptIntent.category).toBe('feature');
    expect(out?.call.reused).toBe(false);
    expect(upsert).toHaveBeenCalledOnce();
    const row = upsert.mock.calls[0]?.[1];
    expect(row.evidence[0].valid).toBe(true); // the quote is really in the body
    expect(row.confidence).toBe('medium'); // body + valid quote, no spec
    expect(row.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  /** The whole point of decision D2. */
  it('returns undefined when the provider throws, and does not persist', async () => {
    const { repo, container, upsert } = stubs({ throws: new Error('502 upstream') });
    const out = await deriveIntent(container, repo, 'ws', pull(), repoRow(), DIFF, runLog);
    expect(out).toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns undefined when the model returns something the schema rejects', async () => {
    const { repo, container } = stubs({ data: { category: 'rewrite' } });
    // The provider port validates against the schema; simulate its rejection.
    const c = {
      ...container,
      llm: vi.fn().mockResolvedValue({
        completeStructured: vi.fn().mockRejectedValue(new Error('schema validation failed')),
      }),
    } as unknown as Container;
    expect(await deriveIntent(c, repo, 'ws', pull(), repoRow(), DIFF, runLog)).toBeUndefined();
  });

  it('redacts the error so a provider echo of the prompt cannot reach the log', async () => {
    const lines: string[] = [];
    const log = { step: runLog.step, info: (m: string) => lines.push(m) };
    const leak = new Error(`400\nprompt was: ${'SECRET'.repeat(80)}`);
    const { repo, container } = stubs({ throws: leak });
    await deriveIntent(container, repo, 'ws', pull(), repoRow(), DIFF, log);
    expect(lines.join()).toContain('Intent skipped');
    expect(lines.join()).not.toContain('SECRET');
    expect(lines[0]!.length).toBeLessThan(240);
  });

  it('reuses a stored intent when the input hash matches, without calling the model', async () => {
    const { completeStructured } = stubs();
    const first = stubs();
    const out1 = await deriveIntent(first.container, first.repo, 'ws', pull(), repoRow(), DIFF, runLog);
    const hash = first.upsert.mock.calls[0]?.[1].inputHash as string;

    const stored = {
      pr_id: 'pr-1',
      intent: 'Add a readiness probe.',
      in_scope: [],
      out_of_scope: [],
      category: 'feature',
      confidence: 'medium',
      rationale: null,
      sources: [{ kind: 'body', ref: 'body', chars: 30, truncated: false, status: 'used' }],
      evidence: [],
      head_sha: 'sha1',
      model: 'gpt-4.1-mini',
      cost_usd: 0.0004,
      derived_at: '2026-09-23T00:00:00.000Z',
    };
    const second = stubs({ stored, storedHash: hash });
    const out2 = await deriveIntent(second.container, second.repo, 'ws', pull(), repoRow(), DIFF, runLog);

    expect(out1?.call.reused).toBe(false);
    expect(out2?.call.reused).toBe(true);
    expect(second.completeStructured).not.toHaveBeenCalled();
    expect(second.upsert).not.toHaveBeenCalled();
    expect(completeStructured).not.toHaveBeenCalled();
  });

  it('does not reuse when the body changed under the same head sha', async () => {
    const first = stubs();
    await deriveIntent(first.container, first.repo, 'ws', pull(), repoRow(), DIFF, runLog);
    const hash = first.upsert.mock.calls[0]?.[1].inputHash as string;

    const second = stubs({ stored: { category: 'feature' }, storedHash: hash });
    await deriveIntent(
      second.container,
      second.repo,
      'ws',
      pull({ body: 'Completely rewritten description.' }),
      repoRow(),
      DIFF,
      runLog,
    );
    expect(second.completeStructured).toHaveBeenCalledOnce();
  });

  it('bands an empty body as low', async () => {
    const { repo, container, upsert } = stubs({
      data: { ...classification, category: 'unknown', evidence: [] },
    });
    await deriveIntent(container, repo, 'ws', pull({ body: null }), repoRow(), DIFF, runLog);
    expect(upsert.mock.calls[0]?.[1].confidence).toBe('low');
  });

  it('keeps a quote the verifier rejected, marked invalid', async () => {
    const { repo, container, upsert } = stubs({
      data: {
        ...classification,
        evidence: [{ source_kind: 'body', ref: 'body', quote: 'never appeared anywhere' }],
      },
    });
    await deriveIntent(container, repo, 'ws', pull(), repoRow(), DIFF, runLog);
    const row = upsert.mock.calls[0]?.[1];
    expect(row.evidence).toHaveLength(1);
    expect(row.evidence[0].valid).toBe(false);
    expect(row.confidence).toBe('low'); // an unverified quote cannot lift the band
  });

  it('takes a linked spec from the diff without touching the filesystem', async () => {
    const diff =
      'diff --git a/specs/0008.md b/specs/0008.md\n+++ b/specs/0008.md\n' +
      '+The probe returns 503 when the database is unreachable.\n';
    const { repo, container, upsert } = stubs({
      data: {
        ...classification,
        evidence: [
          { source_kind: 'spec', ref: 'specs/0008.md', quote: 'returns 503 when the database' },
        ],
      },
    });
    await deriveIntent(
      container,
      repo,
      'ws',
      pull({ body: 'Implements [the spec](specs/0008.md).' }),
      repoRow({ clonePath: null }), // no clone at all: it must still work
      diff,
      runLog,
    );
    const row = upsert.mock.calls[0]?.[1];
    expect(row.sources.find((s: { kind: string }) => s.kind === 'spec').status).toBe('used');
    expect(row.evidence[0].valid).toBe(true);
    expect(row.confidence).toBe('high');
  });

  it('marks a symlinked spec unreadable and caps the band at medium', async () => {
    const root = await mkdtemp(join(tmpdir(), 'intent-'));
    await mkdir(join(root, 'specs'), { recursive: true });
    await writeFile(join(root, 'outside.md'), 'secrets');
    await symlink(join(root, 'outside.md'), join(root, 'specs', 'linked.md'));

    const { repo, container, upsert } = stubs({
      data: {
        ...classification,
        evidence: [{ source_kind: 'body', ref: 'body', quote: 'Adds GET /health/ready.' }],
      },
    });
    await deriveIntent(
      container,
      repo,
      'ws',
      pull({ body: 'Closes #12. Adds GET /health/ready. See [plan](specs/linked.md).' }),
      repoRow({ clonePath: join(root, 'specs') }),
      DIFF,
      runLog,
    );
    const row = upsert.mock.calls[0]?.[1];
    const spec = row.sources.find((s: { kind: string }) => s.kind === 'spec');
    expect(spec.status).toBe('unreadable');
    expect(row.confidence).toBe('medium'); // capped, even though the body quote is valid
  });
});
