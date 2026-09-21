import type { LogLine } from "@/components/ui-client";
import type { RunTrace, SkillUsed } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

/** Keys of `RunTrace.prompt_tokens` (one per prompt_assembly slot). */
export type PromptSlot = "system" | "skills" | "memory" | "specs" | "callers" | "repo_map" | "pr_description" | "user";

/** Token estimate of one prompt slot, or null — traces before spec 0006 have no `prompt_tokens`. */
export function slotTokens(trace: RunTrace, slot: PromptSlot): number | null {
  return trace.prompt_tokens?.[slot] ?? null;
}

/** One skill's slice of the `## Skills` block, matched to its `skills_used` entry. */
export interface SkillPromptPart {
  name: string;
  version: number;
  tokens: number;
  text: string;
}

const SKILL_HEADING = "### Skill: ";

/**
 * Split the `## Skills` system-message block on its `### Skill: <name>`
 * headings and pair each slice with `skills_used` (same order — the engine
 * writes both from one list). Returns null — render the block whole — when
 * the trace predates `skills_used` or the two disagree in count or name.
 */
export function splitSkillsBlock(
  text: string,
  used: readonly SkillUsed[] | null | undefined,
): SkillPromptPart[] | null {
  if (!used || used.length === 0) return null;
  const chunks = text
    .split(/^(?=### Skill: )/m)
    .filter((c) => c.startsWith(SKILL_HEADING))
    .map((c) => c.trimEnd());
  if (chunks.length !== used.length) return null;
  const parts = used.map((u, i) => ({ name: u.name, version: u.version, tokens: u.tokens, text: chunks[i] ?? "" }));
  const namesMatch = parts.every((p) => (p.text.slice(SKILL_HEADING.length).split("\n", 1)[0] ?? "").trim() === p.name);
  return namesMatch ? parts : null;
}
