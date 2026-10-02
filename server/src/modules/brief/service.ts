import type { Intent, MissingInput, PrBriefEnvelope, PrBriefResponse } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import type { PinoLike } from '../../platform/run-logger.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { buildBlastRadius } from '../blast/helpers.js';
import { buildSmartDiff } from '../smart-diff/helpers.js';
import { BRIEF_SCHEMA_NAME, BRIEF_TIMEOUT_MS, BRIEF_INPUT_TOKEN_BUDGET } from './constants.js';
import {
  applyBudget,
  buildFactBlocks,
  groundBrief,
  groundingPaths,
  type BriefFactInput,
} from './helpers.js';
import { BriefResponse, BRIEF_SYSTEM_MESSAGE, buildBriefMessages } from './prompt.js';
import { BriefRepository } from './repository/brief.repo.js';

/**
 * PR Brief service (spec 0018). Composes already-computed facts into ONE
 * grounded LLM call, then an envelope the Overview tab can render.
 *
 * `no-cross-module-internals` (AC-56): this file imports no sibling
 * `service.ts`/`repository/**` — only the pure helpers `buildBlastRadius`
 * (blast) and `buildSmartDiff` (smart-diff), and reads data through
 * `container.reviewRepo` / `container.repoIntel`, exactly as `BlastService`
 * and `SmartDiffService` already do for the same two facts.
 */
export class BriefService {
  private readonly repo: BriefRepository;

  constructor(
    private readonly container: Container,
    repo?: BriefRepository,
  ) {
    this.repo = repo ?? new BriefRepository(container.db);
  }

  async read(workspaceId: string, prId: string): Promise<PrBriefResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const stored = await this.repo.getBrief(prId);
    if (!stored) return { brief: null, stale: false };

    return { brief: stored, stale: stored.head_sha !== pull.headSha };
  }

  async generate(workspaceId: string, prId: string, log: PinoLike): Promise<PrBriefEnvelope> {
    const repo = this.container.reviewRepo;

    // Tenancy FIRST: an unknown or cross-workspace PR 404s before anything
    // else runs (`blast/service.ts`'s pattern).
    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, findings, intentRecord] = await Promise.all([
      repo.getPrFiles(prId),
      repo.latestReviewFindings(workspaceId, prId),
      repo.getIntent(prId),
    ]);

    const blastResult = await this.container.repoIntel.getBlastRadius(
      pull.repoId,
      files.map((f) => f.path),
      { indexOnly: true },
    );
    const blast = buildBlastRadius(blastResult);
    const smartDiff = buildSmartDiff(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      findings,
    );

    const missingInputs: MissingInput[] = [];

    // ---- intent (AC-16) ----
    const intent: Intent = intentRecord
      ? { intent: intentRecord.intent, in_scope: intentRecord.in_scope, out_of_scope: intentRecord.out_of_scope }
      : { intent: '', in_scope: [], out_of_scope: [] };
    if (!intentRecord) missingInputs.push({ input: 'intent' });

    // ---- blast (AC-17) ----
    if (blast.degraded) {
      missingInputs.push(blast.reason ? { input: 'blast', reason: blast.reason } : { input: 'blast' });
    }

    // ---- issue + specs (AC-18) — same provenance deriveIntent uses: a bare
    // `#123` match on the PR body, and the spec sources the Intent layer
    // already persisted (paths only, never contents). ----
    const issueRef = pull.body?.match(/#(\d+)\b/)?.[0] ?? null;
    if (!issueRef) missingInputs.push({ input: 'issue' });

    const specPaths = (intentRecord?.sources ?? [])
      .filter((s) => s.kind === 'spec' && s.status === 'used')
      .map((s) => s.ref);
    if (specPaths.length === 0) missingInputs.push({ input: 'specs' });

    // ---- budget (AC-4, AC-5) ----
    const blastCallerLines = blast.downstream.flatMap((d) =>
      d.callers.map((c) => `${c.file}:${c.line} ${c.name}`),
    );
    const smartDiffLines = smartDiff.groups.flatMap((g) =>
      g.files.map((f) => `${g.role}: ${f.path} (+${f.additions}/-${f.deletions})`),
    );
    const fileStats = files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions }));

    const factInput: BriefFactInput = {
      prBody: pull.body ?? '',
      issueRef,
      specPaths,
      files: fileStats,
      blastCallerLines,
      smartDiffLines,
    };
    const blocks = buildFactBlocks(factInput);

    const tokenizer = this.container.tokenizer;
    const intentTextForOverhead = intentRecord ? intent.intent : '';
    const overheadTokens =
      tokenizer.count(BRIEF_SYSTEM_MESSAGE) +
      tokenizer.count(pull.title) +
      tokenizer.count(intentTextForOverhead) +
      tokenizer.count(blast.summary);

    const { kept, droppedNames } = applyBudget(
      blocks,
      overheadTokens,
      BRIEF_INPUT_TOKEN_BUDGET,
      (text) => tokenizer.count(text),
    );
    for (const name of droppedNames) missingInputs.push({ input: name });

    const keptNames = new Set(kept.map((b) => b.name));
    const messages = buildBriefMessages({
      title: pull.title,
      intentText: intentRecord ? intent.intent : null,
      body: keptNames.has('pr_body') ? factInput.prBody : '',
      issueRef: keptNames.has('issue') ? issueRef : null,
      specPaths: keptNames.has('specs') ? specPaths : [],
      blastSummary: blast.summary,
      blastCallerLines: keptNames.has('blast_callers') ? blastCallerLines : [],
      smartDiffLines: keptNames.has('smart_diff') ? smartDiffLines : [],
      fileStats: keptNames.has('diff_stats') ? fileStats : [],
    });

    // ---- the one model call (AC-1, AC-2) ----
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
    const llm = await this.container.llm(provider);

    let result;
    try {
      result = await llm.completeStructured({
        model,
        schema: BriefResponse,
        schemaName: BRIEF_SCHEMA_NAME,
        messages,
        temperature: 0,
        timeoutMs: BRIEF_TIMEOUT_MS,
      });
    } catch (err) {
      // AC-14 — every throw from the model call becomes a 502, never a bare
      // 500: `app.ts` re-throws an AppError with its own status.
      const message = err instanceof Error ? err.message : 'PR brief generation failed';
      throw new ExternalServiceError(message);
    }

    // ---- grounding, before anything is persisted (AC-10) ----
    const paths = groundingPaths(files, blast);
    const { risks, review_focus, dropped_risks, dropped_focus } = groundBrief(result.data, paths);

    const envelope: PrBriefEnvelope = {
      intent,
      blast,
      risks: { risks },
      history: { history: [] },
      summary: result.data.summary,
      review_focus,
      head_sha: pull.headSha,
      generated_at: new Date().toISOString(),
      model,
      missing_inputs: missingInputs,
    };

    await this.repo.upsertBrief(prId, envelope);

    const inputTokens = messages.reduce((n, m) => n + tokenizer.count(m.content), 0);
    log.info(
      {
        model,
        input_tokens: inputTokens,
        dropped_risks,
        dropped_focus,
        missing_inputs: missingInputs.map((m) => m.input),
      },
      'PR brief generated',
    );

    return envelope;
  }
}
