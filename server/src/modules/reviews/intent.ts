/**
 * The intent step (spec 0008): why was this PR opened?
 *
 * Runs once per review request, beside `loadDiff` and before any agent starts,
 * so one classification serves every agent in the run.
 *
 * FAIL-OPEN, deliberately (decision D2). Every failure path returns `undefined`
 * and the review proceeds with a prompt byte-identical to one built without the
 * feature — the same policy `buildCallersDigest` follows in `run-executor.ts`.
 * A classifier is an enrichment; it must never be able to stop a review.
 *
 * Ring 3: orchestration. No SQL (that is the repository), no vendor SDK (that is
 * the container's LLM port), no prompt text (that is `intent-prompt.ts`).
 */
import type { PromptIntent } from '@devdigest/reviewer-core';
import type { IntentEvidence, IntentSource } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import { readTextFileInClone } from '../../platform/safe-read.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import * as schema from '../../db/schema.js';
import type { ReviewRepository, PullRow } from './repository.js';
import {
  INTENT_MAX_BODY_CHARS,
  INTENT_MAX_COMMITS,
  INTENT_MAX_PATHS,
  INTENT_MAX_SPEC_CHARS,
  INTENT_MAX_SPEC_FILE_BYTES,
  INTENT_MAX_TITLE_CHARS,
  INTENT_TIMEOUT_MS,
} from './constants.js';
import {
  bandConfidence,
  budget,
  extractSpecLinks,
  intentInputHash,
  labelSources,
  sourceLabels,
  stripHtmlComments,
  verifyEvidence,
} from './intent-helpers.js';
import {
  INTENT_CLASSIFICATION_SCHEMA_NAME,
  IntentClassification,
  buildIntentMessages,
} from './intent-prompt.js';

/** What the executor needs back. `undefined` from `deriveIntent` means "carry on without". */
export interface DerivedIntent {
  promptIntent: PromptIntent;
  /** Spec paths actually read, for the trace's `specs_read`. */
  specPaths: string[];
  call: {
    provider: string;
    model: string;
    reused: boolean;
    duration_ms: number;
    tokens_in: number | null;
    tokens_out: number | null;
    cost_usd: number | null;
    confidence: 'high' | 'medium' | 'low';
  };
}

/**
 * A source as gathered, named by its REAL ref — a spec path, `#123`, or the
 * kind. Deliberately not an `IntentPromptSource`: that one is named by a label
 * we generate, and the two must not be assignable to each other, or a spec path
 * slips back into the prompt's trusted region.
 */
interface GatheredSource {
  kind: IntentSource['kind'];
  ref: string;
  text: string;
  meta: IntentSource;
}

/**
 * Collect what the classifier may see. Pure-ish: the only I/O is reading the
 * linked spec files, and each read is bounded and guarded.
 *
 * A spec is preferred FROM THE DIFF when the PR changes it: that is the version
 * this PR proposes, and it needs no filesystem access at all.
 */
async function gather(
  repo: ReviewRepository,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
  diffText: string,
): Promise<{ sources: GatheredSource[]; specs: { path: string; content: string }[]; title: string; body: string }> {
  const sources: GatheredSource[] = [];
  const specs: { path: string; content: string }[] = [];

  const push = (
    kind: IntentSource['kind'],
    ref: string,
    text: string,
    status: IntentSource['status'],
    truncated = false,
  ): void => {
    const meta: IntentSource = { kind, ref, chars: text.length, truncated, status };
    if (status === 'used' && text.length > 0) sources.push({ kind, ref, text, meta });
    else sources.push({ kind, ref, text: '', meta });
  };

  const title = budget(pull.title ?? '', INTENT_MAX_TITLE_CHARS);
  push('title', 'title', title.text, title.text ? 'used' : 'empty', title.truncated);

  const cleaned = stripHtmlComments(pull.body);
  const body = budget(cleaned, INTENT_MAX_BODY_CHARS);
  push('body', 'body', body.text, body.text ? 'used' : 'empty', body.truncated);

  if (pull.branch) push('branch', 'branch', pull.branch, 'used');

  // The linked ticket contributes its REFERENCE only (decision D4): no extra
  // GitHub call, so "take the ticket into account" means its identifier.
  //
  // Read from `cleaned`, like the spec links below: see the note there.
  const issue = cleaned.match(/#(\d+)\b/)?.[0];
  if (issue) push('issue', issue, issue, 'used');

  const paths = diffText
    .split('\n')
    .filter((l) => l.startsWith('+++ b/'))
    .map((l) => l.slice(6))
    .slice(0, INTENT_MAX_PATHS);
  if (paths.length > 0) push('paths', 'paths', paths.join('\n'), 'used');

  // The system prompt tells the model it is shown commit subjects, so it has to
  // actually get them: a source named but never supplied invites a quote that
  // then fails verification and silently costs confidence.
  const commits = await repo.listCommitSubjects(pull.id, INTENT_MAX_COMMITS);
  if (commits.length > 0) push('commits', 'commits', commits.join('\n'), 'used');

  // `cleaned`, not `pull.body`: an HTML comment is invisible in GitHub's
  // rendered view, so a link hidden in one would pull a file off disk and into
  // the classifier while no human reviewer of the PR could see that it was
  // asked for. Stripping comments only for the text we SHOW the model left that
  // channel open for the text we ACT on. Not budgeted — the cap belongs to the
  // body as a source, and a link past it is still a link the author wrote.
  for (const rel of extractSpecLinks(cleaned, repoRow.fullName)) {
    const fromDiff = specFromDiff(diffText, rel);
    let content = fromDiff;
    if (content === null && repoRow.clonePath) {
      content = await readTextFileInClone(repoRow.clonePath, rel, INTENT_MAX_SPEC_FILE_BYTES);
    }
    if (content === null || content.trim().length === 0) {
      // Recorded, never dropped: an unreadable spec caps the band, because we
      // know documentation was meant to be here and we did not see it.
      push('spec', rel, '', 'unreadable');
      continue;
    }
    const cut = budget(content, INTENT_MAX_SPEC_CHARS);
    push('spec', rel, cut.text, 'used', cut.truncated);
    specs.push({ path: rel, content: cut.text });
  }

  return { sources, specs, title: title.text, body: body.text };
}

/** The post-image of a file in the diff, when this PR changes it. */
function specFromDiff(diffText: string, path: string): string | null {
  const marker = `+++ b/${path}`;
  const start = diffText.indexOf(marker);
  if (start === -1) return null;
  const rest = diffText.slice(start + marker.length);
  const end = rest.indexOf('\ndiff --git ');
  const body = end === -1 ? rest : rest.slice(0, end);
  const added = body
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
  return added.length > 0 ? added.join('\n') : null;
}

export async function deriveIntent(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
  diffText: string,
  runLog: Pick<RunLogger, 'step' | 'info'>,
): Promise<DerivedIntent | undefined> {
  const t0 = Date.now();
  try {
    const { sources, specs, title, body } = await gather(repo, pull, repoRow, diffText);
    const hash = intentInputHash({ headSha: pull.headSha, title, body, specs });

    const stored = await repo.getIntent(pull.id);
    const storedHash = await repo.getIntentInputHash(pull.id);
    if (stored && storedHash === hash) {
      runLog.info(
        `Intent: ${stored.category} · confidence ${stored.confidence} · ` +
          `sources ${sourceLabels(stored.sources).join(', ') || 'none'} · reused`,
      );
      return {
        promptIntent: toPromptIntent(stored.category, stored.confidence, stored, stored.sources),
        specPaths: stored.sources.filter((s) => s.kind === 'spec' && s.status === 'used').map((s) => s.ref),
        call: {
          provider: 'reused',
          model: stored.model ?? 'reused',
          reused: true,
          duration_ms: Date.now() - t0,
          tokens_in: null,
          tokens_out: null,
          cost_usd: null,
          confidence: stored.confidence,
        },
      };
    }

    const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');
    const llm = await container.llm(provider);
    // The model names sources by OUR label, never by the author's spec path.
    const labelled = labelSources(sources.filter((s) => s.text.length > 0));

    const result = await runLog.step(
      `Deriving PR intent (${provider}/${model})`,
      () =>
        llm.completeStructured({
          model,
          schema: IntentClassification,
          schemaName: INTENT_CLASSIFICATION_SCHEMA_NAME,
          messages: buildIntentMessages(
            repoRow.fullName,
            labelled.map((l) => ({ kind: l.source.kind, label: l.label, text: l.source.text })),
          ),
          temperature: 0,
          timeoutMs: INTENT_TIMEOUT_MS,
        }),
      { kind: 'tool' },
    );

    // The model's quotes are claims, not grounding, until checked against the
    // exact text that was sent. Citations cannot be combined with structured
    // outputs in one request, so this is ours to do.
    // Keyed by label, because that is what the model was given. The real path
    // goes back on afterwards, so what is stored and shown is still the path.
    const textByLabel = new Map(labelled.map((l) => [l.label, l.source.text]));
    const refByLabel = new Map(labelled.map((l) => [l.label, l.source.ref]));
    const evidence: IntentEvidence[] = verifyEvidence(result.data.evidence, textByLabel).map(
      (e) => ({ ...e, ref: refByLabel.get(e.ref) ?? e.ref }),
    );
    const metas = sources.map((s) => s.meta);
    const confidence = bandConfidence(metas, evidence);

    await repo.upsertIntent(pull.id, {
      intent: {
        intent: result.data.intent,
        in_scope: result.data.in_scope,
        out_of_scope: result.data.out_of_scope,
      },
      category: result.data.category,
      confidence,
      rationale: result.data.rationale || null,
      sources: metas.map((m) => ({
        kind: m.kind,
        ref: m.ref,
        chars: m.chars,
        truncated: m.truncated,
        status: m.status,
      })),
      evidence: evidence.map((e) => ({
        sourceKind: e.source_kind,
        ref: e.ref,
        quote: e.quote,
        valid: e.valid,
      })),
      inputHash: hash,
      headSha: pull.headSha,
      provider,
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    });

    runLog.info(
      `Intent: ${result.data.category} · confidence ${confidence} · ` +
        `sources ${sourceLabels(metas).join(', ') || 'none'}`,
    );

    return {
      promptIntent: toPromptIntent(result.data.category, confidence, result.data, metas),
      specPaths: specs.map((s) => s.path),
      call: {
        provider,
        model,
        reused: false,
        duration_ms: Date.now() - t0,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
        confidence,
      },
    };
  } catch (err) {
    // Redacted: a provider error can echo the prompt back, and the prompt holds
    // the PR body. The Live Log is shown in the UI and persisted in the trace.
    runLog.info(`Intent skipped: ${redact(err)}`);
    return undefined;
  }
}

function toPromptIntent(
  category: string,
  confidence: 'high' | 'medium' | 'low',
  data: { intent: string; in_scope: string[]; out_of_scope: string[] },
  sources: IntentSource[],
): PromptIntent {
  return {
    category,
    confidence,
    intent: data.intent,
    in_scope: data.in_scope,
    out_of_scope: data.out_of_scope,
    sources: sourceLabels(sources),
  };
}

/** First line of the error class + message, capped. Never the provider's echo of the prompt. */
function redact(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error';
  return raw.split('\n')[0]!.slice(0, 200);
}
