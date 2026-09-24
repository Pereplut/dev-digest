import { createHash } from 'node:crypto';
import type { PromptAssembledInfo, PromptSectionName } from '@devdigest/reviewer-core';
import { redactCredentials } from './redact.js';
import type { PinoLike } from './run-logger.js';

/**
 * Structured logging of prompt assembly (spec 0008).
 *
 * Answers "what actually went into this prompt?" from the logs alone, WITHOUT
 * putting anyone's code in them. Two properties make that safe:
 *
 *  1. The record is metadata by construction. `PromptSectionInfo` holds a
 *     fixed-enum name and numbers; there is no field a diff, a spec chunk or a
 *     PR body could occupy. This is stronger than filtering a free-text message,
 *     and it holds in verbose mode too — verbose adds a HASH, never content.
 *  2. The two strings that do vary (the chunk label, which is a repo file path,
 *     and the model id) are redacted here, at the sink. `platform/redact.ts`
 *     documents the rule; server/INSIGHTS.md records the regression that
 *     followed from a persist path trusting a distant chokepoint instead.
 *
 * Emitted at `debug`, one record per LLM call — see `onPromptAssembled` in
 * reviewer-core for why per call and not per run.
 */

/** Where each prompt section comes from IN THE STUDIO SERVER. */
const SECTION_SOURCE: Record<PromptSectionName, string> = {
  system: 'db:agents.system_prompt',
  skills: 'db:skills',
  task: 'server:taskLine',
  pr_description: 'github:pull.body',
  // Derived by the cheap-model classifier before the review (spec 0008), not
  // read from a store — so the label names the producer, not a table.
  intent: 'llm:intent-classifier',
  // The engine supports these slots; this server has never populated them (the
  // run trace records memoryPulled/specsRead as []). If one gets wired up, give
  // it a real label here — 'unwired' showing up in a log means exactly that.
  memory: 'unwired',
  specs: 'unwired',
  repo_map: 'repo-intel:getRepoMap',
  callers: 'repo-intel:getCallerSignatures',
  diff: 'git:diff-loader',
};

/** Run identity attached to every record. `runId` is the correlation id. */
export type PromptLogContext = {
  runId: string;
  prId: string;
  agent: string;
  provider: string;
  model: string;
};

/** Truncated sha256 — enough to compare two runs, useless for recovering text. */
export function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * Wrap a token counter so repeated sections are tokenized once per run.
 *
 * On a map-reduce run `assemblePrompt` runs per file, so the system prompt,
 * skills, repo map and callers are re-measured for every chunk although they
 * are byte-identical each time. Only the diff slice actually differs.
 */
export function memoizeCount(count: (text: string) => number): (text: string) => number {
  const cache = new Map<string, number>();
  return (text) => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const n = count(text);
    cache.set(text, n);
    return n;
  };
}

/** Emit one `prompt assembled` record. Metadata only — never section text. */
export function logPromptAssembled(
  log: PinoLike,
  ctx: PromptLogContext,
  info: PromptAssembledInfo,
  opts: { verbose: boolean; skills?: { name: string; chars: number; tokens?: number }[] } = {
    verbose: false,
  },
): void {
  const sections = info.sections.map((s) => ({
    name: s.name,
    source: SECTION_SOURCE[s.name],
    chars: s.chars,
    ...(s.tokens !== undefined ? { tokens: s.tokens } : {}),
    ...(s.count !== undefined ? { count: s.count } : {}),
    ...(s.truncated ? { truncated: true } : {}),
    // Present only in verbose — the engine only computes it when asked.
    ...(s.digest !== undefined ? { digest: s.digest } : {}),
  }));

  log.debug(
    {
      ...ctx,
      model: redactCredentials(ctx.model),
      mode: info.mode,
      chunk: { ...info.chunk, label: redactCredentials(info.chunk.label) },
      totals: info.totals,
      sections,
      ...(opts.verbose
        ? {
            order: sections.map((s) => s.name),
            ...(opts.skills && opts.skills.length > 0
              ? { skillBreakdown: opts.skills.map((s) => ({ ...s, name: redactCredentials(s.name) })) }
              : {}),
          }
        : {}),
    },
    'prompt assembled',
  );
}
