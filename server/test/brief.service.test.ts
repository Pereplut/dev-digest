/**
 * `BriefService` (spec 0018, S7/S12) — tenancy, the single grounded model
 * call, the budget, and envelope assembly. No Postgres.
 *
 * `Container`, `ReviewRepository` and `BriefRepository` are REAL instances
 * (never `as unknown as` — server/INSIGHTS.md 2026-09-18/2026-09-28): a
 * subclass overrides only the getters `BriefService` reads, and the fake
 * `LLMProvider` is a full, real implementation of the `LLMProvider`
 * interface, not a partial cast. `RepoIntel` is a plain interface with no
 * private fields, so the stub only implementing `getBlastRadius` (the one
 * method this service calls) can be cast up to it directly — the same
 * reasoning `blast-service.test.ts` documents.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage, LLMProvider, PrIntentRecord, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { BriefService } from '../src/modules/brief/service.js';
import { BriefRepository } from '../src/modules/brief/repository/brief.repo.js';
import { NotFoundError } from '../src/platform/errors.js';
import { ReviewRepository, type PullRow } from '../src/modules/reviews/repository.js';
import { Container } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { RepoIntel, BlastResult } from '../src/modules/repo-intel/types.js';
import type { Tokenizer } from '../src/adapters/tokenizer/index.js';

const UNUSED_DB = null as unknown as Db;

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

/** `tokenizer.count` = string length, so test fixtures can reason about the
 *  8000-token budget directly in characters. */
const LENGTH_TOKENIZER: Tokenizer = { count: (t: string) => t.length };

/** A settings `db` whose `select().from().where()` resolves to `rows` —
 *  real enough for `resolveFeatureModel`'s `SettingsRepository` to read,
 *  the one `Container` member this service does not let a test skip. */
function settingsDb(rows: { key: string; value: unknown }[] = []): Db {
  return { select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }) } as unknown as Db;
}

function throwingSettingsDb(err: Error): Db {
  return {
    select: () => ({ from: () => ({ where: () => Promise.reject(err) }) }),
  } as unknown as Db;
}

function pull(over: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Add rate limiting',
    author: 'a',
    branch: 'b',
    base: 'main',
    headSha: 'sha1',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: 'Closes #42',
    openedAt: null,
    updatedAt: null,
    ...over,
  };
}

function prFile(over: { path: string; additions?: number; deletions?: number; patch?: string | null }) {
  return {
    id: `f-${over.path}`,
    prId: 'pr-1',
    path: over.path,
    additions: over.additions ?? 1,
    deletions: over.deletions ?? 0,
    patch: over.patch ?? null,
  };
}

function intentRecord(over: Partial<PrIntentRecord> = {}): PrIntentRecord {
  return {
    pr_id: 'pr-1',
    intent: 'Add a rate limiter.',
    in_scope: ['src/middleware/ratelimit.ts'],
    out_of_scope: [],
    category: 'feature',
    confidence: 'medium',
    rationale: null,
    sources: [],
    evidence: [],
    head_sha: 'sha1',
    model: 'gpt-4.1-mini',
    cost_usd: null,
    derived_at: new Date().toISOString(),
    ...over,
  };
}

const EMPTY_BLAST_RESULT: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [] };

/** `RepoIntel` implements only `getBlastRadius` — the sole method `BriefService` calls. */
function stubRepoIntel(getBlastRadius: RepoIntel['getBlastRadius']): RepoIntel {
  return { getBlastRadius } as RepoIntel;
}

/** A full, real `LLMProvider` — every port method implemented, not a
 *  partial cast (C10). */
function fakeLlm(opts: {
  data?: unknown;
  throws?: Error;
  capture?: { messages: ChatMessage[] }[];
} = {}): { provider: LLMProvider; completeStructured: ReturnType<typeof vi.fn> } {
  const completeStructured = vi.fn(async (req: StructuredRequest<unknown>) => {
    opts.capture?.push({ messages: req.messages });
    if (opts.throws) throw opts.throws;
    return {
      data: opts.data ?? { summary: 'A summary.', risks: [], review_focus: [] },
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: '{}',
      attempts: 1,
    } satisfies StructuredResult<unknown>;
  });
  const provider: LLMProvider = {
    id: 'openai',
    listModels: async () => [],
    complete: async () => {
      throw new Error('complete() must not be used by the brief service');
    },
    completeStructured: completeStructured as unknown as LLMProvider['completeStructured'],
    embed: async () => {
      throw new Error('embed() must not be used by the brief service');
    },
  };
  return { provider, completeStructured };
}

class TestContainer extends Container {
  constructor(
    private readonly stubReviewRepo: ReviewRepository,
    private readonly stubRepoIntelImpl: RepoIntel,
    db: Db,
    llm: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>> = {},
  ) {
    super(testConfig(), db, { llm, tokenizer: LENGTH_TOKENIZER });
  }
  override get reviewRepo(): ReviewRepository {
    return this.stubReviewRepo;
  }
  override get repoIntel(): RepoIntel {
    return this.stubRepoIntelImpl;
  }
}

function fakeRunLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** A real `ReviewRepository` instance with only the methods this service
 *  calls overridden; everything else stays real and would fail loudly if
 *  ever touched. */
function fakeReviewRepo(over: {
  pull?: PullRow | undefined;
  files?: ReturnType<typeof prFile>[];
  findings?: { file: string; startLine: number }[];
  intent?: PrIntentRecord | undefined;
}): ReviewRepository {
  const repo = new ReviewRepository(UNUSED_DB);
  repo.getPull = async () => over.pull;
  repo.getPrFiles = async () => over.files ?? [];
  repo.latestReviewFindings = async () => over.findings ?? [];
  repo.getIntent = async () => over.intent;
  return repo;
}

/** A real `BriefRepository` instance with `upsertBrief` overridden to
 *  capture what would have been persisted, instead of touching Postgres. */
function fakeBriefRepo() {
  const repo = new BriefRepository(UNUSED_DB);
  const upsertBrief = vi.fn().mockResolvedValue(undefined);
  repo.upsertBrief = upsertBrief;
  return { repo, upsertBrief };
}

describe('BriefService.generate — tenancy', () => {
  it('404s on an unknown pull request before any facade or model call', async () => {
    const { provider, completeStructured } = fakeLlm();
    const reviewRepo = fakeReviewRepo({ pull: undefined });
    const getBlastRadius = vi.fn(async () => EMPTY_BLAST_RESULT);
    const container = new TestContainer(reviewRepo, stubRepoIntel(getBlastRadius), settingsDb(), {
      openai: provider,
    });
    const { repo } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await expect(service.generate('ws-1', 'unknown-pr', fakeRunLog())).rejects.toThrow(NotFoundError);
    expect(getBlastRadius).not.toHaveBeenCalled();
    expect(completeStructured).not.toHaveBeenCalled();
  });
});

describe('BriefService.generate — AC-1, AC-4, AC-5 (single call, budget)', () => {
  it('makes exactly one completeStructured call, and a second generation also makes exactly one', async () => {
    const { provider, completeStructured } = fakeLlm();
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord(),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    expect(completeStructured).toHaveBeenCalledTimes(1);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    expect(completeStructured).toHaveBeenCalledTimes(2); // one MORE call, not reset, not doubled
  });

  it('small fixture: every fact block survives, no budget-driven missing_inputs', async () => {
    const capture: { messages: ChatMessage[] }[] = [];
    const { provider } = fakeLlm({ capture });
    const reviewRepo = fakeReviewRepo({
      pull: pull({ body: 'Closes #42' }),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord({ sources: [{ kind: 'spec', ref: 'specs/0001-a.md', chars: 10, truncated: false, status: 'used' }] }),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.missing_inputs).toEqual([]);

    const totalTokens = capture[0]!.messages.reduce((n, m) => n + m.content.length, 0);
    expect(totalTokens).toBeLessThanOrEqual(8000);
  });

  it('oversized fixture: a giant specs block is dropped, the rest survives, and the total still fits', async () => {
    const capture: { messages: ChatMessage[] }[] = [];
    const { provider } = fakeLlm({ capture });
    const giantSpecPath = 'specs/' + 'x'.repeat(9000) + '.md';
    const reviewRepo = fakeReviewRepo({
      pull: pull({ body: 'Closes #42' }),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord({ sources: [{ kind: 'spec', ref: giantSpecPath, chars: 9000, truncated: false, status: 'used' }] }),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());

    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.missing_inputs).toEqual([{ input: 'specs' }]);

    const content = capture[0]!.messages.map((m) => m.content).join('\n');
    expect(content).not.toContain(giantSpecPath);
    const totalTokens = capture[0]!.messages.reduce((n, m) => n + m.content.length, 0);
    expect(totalTokens).toBeLessThanOrEqual(8000);
  });
});

describe('BriefService.generate — AC-3 (no diff hunk body)', () => {
  it('never puts a file patch in the prompt; the path is present as a positive control', async () => {
    const capture: { messages: ChatMessage[] }[] = [];
    const { provider } = fakeLlm({ capture });
    const distinctivePatch = '@@ -1,3 +1,3 @@\n-DISTINCTIVE_OLD_LINE\n+DISTINCTIVE_NEW_LINE';
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/distinctive-path.ts', patch: distinctivePatch })],
      intent: intentRecord(),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());

    const content = capture[0]!.messages.map((m) => m.content).join('\n');
    expect(content).not.toContain('DISTINCTIVE_NEW_LINE');
    expect(content).not.toContain('DISTINCTIVE_OLD_LINE');
    expect(content).toContain('src/distinctive-path.ts');
  });
});

describe('BriefService.generate — AC-2 (model resolution)', () => {
  it('passes the resolver-chosen model, not a literal default', async () => {
    const capture: { messages: ChatMessage[] }[] = [];
    const sentinelProvider = fakeLlm({ capture });
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord(),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb([{ key: 'feature_models', value: { risk_brief: { provider: 'anthropic', model: 'claude-sentinel' } } }]),
      { anthropic: sentinelProvider.provider },
    );
    const { repo } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    const envelope = await service.generate('ws-1', 'pr-1', fakeRunLog());
    expect(envelope.model).toBe('claude-sentinel');
    expect(sentinelProvider.completeStructured).toHaveBeenCalledTimes(1);
    expect(sentinelProvider.completeStructured.mock.calls[0]![0].model).toBe('claude-sentinel');
  });

  it('propagates a resolver failure instead of falling back to a literal model', async () => {
    const { provider, completeStructured } = fakeLlm();
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord(),
    });
    const resolverError = new Error('settings db unavailable');
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      throwingSettingsDb(resolverError),
      { openai: provider },
    );
    const { repo } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await expect(service.generate('ws-1', 'pr-1', fakeRunLog())).rejects.toThrow('settings db unavailable');
    expect(completeStructured).not.toHaveBeenCalled();
  });
});

describe('BriefService.generate — AC-14 (model failure becomes a 502)', () => {
  it('wraps a provider throw as an ExternalServiceError (statusCode 502)', async () => {
    const { provider } = fakeLlm({ throws: new Error('upstream 500') });
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord(),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await expect(service.generate('ws-1', 'pr-1', fakeRunLog())).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(upsertBrief).not.toHaveBeenCalled();
  });
});

describe('BriefService.generate — missing inputs (AC-16, AC-17, AC-18, AC-19)', () => {
  it('AC-16: generates with no pr_intent row, storing the forced placeholder', async () => {
    const { provider } = fakeLlm();
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/a.ts' })],
      intent: undefined,
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.missing_inputs).toContainEqual({ input: 'intent' });
    expect(envelope.intent).toEqual({ intent: '', in_scope: [], out_of_scope: [] });
  });

  it('control: an existing intent row adds neither the entry nor the placeholder', async () => {
    const { provider } = fakeLlm();
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord({ intent: 'Add a readiness probe.' }),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.missing_inputs).not.toContainEqual({ input: 'intent' });
    expect(envelope.intent.intent).toBe('Add a readiness probe.');
  });

  it('AC-17: a degraded blast still generates, sends the summary, and records the reason', async () => {
    const capture: { messages: ChatMessage[] }[] = [];
    const { provider } = fakeLlm({ capture });
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord(),
    });
    const degraded: BlastResult = { ...EMPTY_BLAST_RESULT, degraded: true, reason: 'no_data' };
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => degraded),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.missing_inputs).toContainEqual({ input: 'blast', reason: 'no_data' });
    expect(envelope.blast.degraded).toBe(true);

    const content = capture[0]!.messages.map((m) => m.content).join('\n');
    expect(content).toContain(envelope.blast.summary);
  });

  it('AC-18: no linked issue and no used spec source adds both entries', async () => {
    const { provider } = fakeLlm();
    const reviewRepo = fakeReviewRepo({
      pull: pull({ body: 'No ticket reference here.' }),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord({ sources: [] }),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.missing_inputs).toContainEqual({ input: 'issue' });
    expect(envelope.missing_inputs).toContainEqual({ input: 'specs' });
  });

  it('control: an issue reference and a used spec source add neither entry', async () => {
    const { provider } = fakeLlm();
    const reviewRepo = fakeReviewRepo({
      pull: pull({ body: 'Closes #42' }),
      files: [prFile({ path: 'src/a.ts' })],
      intent: intentRecord({
        sources: [{ kind: 'spec', ref: 'specs/0001-a.md', chars: 10, truncated: false, status: 'used' }],
      }),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.missing_inputs).not.toContainEqual({ input: 'issue' });
    expect(envelope.missing_inputs).not.toContainEqual({ input: 'specs' });
  });

  it('AC-19: empty files[] and an empty blast map still persist a non-empty summary with empty lists', async () => {
    const { provider } = fakeLlm({
      data: {
        summary: 'Nothing changed that the index can see.',
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'low', file_refs: ['src/invented.ts'] }],
        review_focus: [{ file: 'src/invented.ts', line: 1, reason: 'r' }],
      },
    });
    const reviewRepo = fakeReviewRepo({
      pull: pull(),
      files: [],
      intent: intentRecord(),
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo, upsertBrief } = fakeBriefRepo();
    const service = new BriefService(container, repo);

    await service.generate('ws-1', 'pr-1', fakeRunLog());
    const envelope = upsertBrief.mock.calls[0]![1];
    expect(envelope.summary).toBe('Nothing changed that the index can see.');
    expect(envelope.risks).toEqual({ risks: [] });
    expect(envelope.review_focus).toEqual([]);
  });
});

describe('BriefService.generate — AC-15 (one structured log record)', () => {
  it('logs model, input tokens, dropped_risks, dropped_focus and the flat missing_inputs list', async () => {
    const { provider } = fakeLlm({
      data: {
        summary: 'A summary.',
        risks: [
          { kind: 'security', title: 'kept', explanation: 'e', severity: 'low', file_refs: ['src/a.ts'] },
          { kind: 'security', title: 'dropped', explanation: 'e', severity: 'low', file_refs: ['src/invented.ts'] },
        ],
        review_focus: [{ file: 'src/invented.ts', line: 1, reason: 'r' }],
      },
    });
    const reviewRepo = fakeReviewRepo({
      pull: pull({ body: 'No ticket reference here.' }),
      files: [prFile({ path: 'src/a.ts' })],
      intent: undefined,
    });
    const container = new TestContainer(
      reviewRepo,
      stubRepoIntel(async () => EMPTY_BLAST_RESULT),
      settingsDb(),
      { openai: provider },
    );
    const { repo } = fakeBriefRepo();
    const service = new BriefService(container, repo);
    const log = fakeRunLog();

    await service.generate('ws-1', 'pr-1', log);

    expect(log.info).toHaveBeenCalledTimes(1);
    const [record] = log.info.mock.calls[0]!;
    expect(record.model).toBeTypeOf('string');
    expect(record.input_tokens).toBeGreaterThan(0);
    expect(record.dropped_risks).toBe(1);
    expect(record.dropped_focus).toBe(1);
    expect(record.missing_inputs).toEqual(expect.arrayContaining(['intent', 'issue', 'specs']));
    // Never a `reason` string in the log line (AC-15) — it is a flat list of
    // `input` values only.
    expect(JSON.stringify(record)).not.toContain('no_data');
  });
});

describe('BriefService.read — AC-21, AC-22, AC-23', () => {
  it('AC-21: no stored row -> brief: null, stale: false', async () => {
    const reviewRepo = fakeReviewRepo({ pull: pull() });
    const container = new TestContainer(reviewRepo, stubRepoIntel(async () => EMPTY_BLAST_RESULT), settingsDb());
    const repo = new BriefRepository(UNUSED_DB);
    repo.getBrief = async () => undefined;
    const service = new BriefService(container, repo);

    const out = await service.read('ws-1', 'pr-1');
    expect(out).toEqual({ brief: null, stale: false });
  });

  it('404s on an unknown pull request', async () => {
    const reviewRepo = fakeReviewRepo({ pull: undefined });
    const container = new TestContainer(reviewRepo, stubRepoIntel(async () => EMPTY_BLAST_RESULT), settingsDb());
    const repo = new BriefRepository(UNUSED_DB);
    const service = new BriefService(container, repo);

    await expect(service.read('ws-1', 'unknown-pr')).rejects.toThrow(NotFoundError);
  });
});
