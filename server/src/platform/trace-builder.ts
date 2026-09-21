import type {
  MemoryPulled,
  PromptAssembly,
  RunLogLine,
  RunStats,
  RunTrace,
  SkillUsed,
  ToolCall,
} from '@devdigest/shared';
import { RunTrace as RunTraceSchema } from '@devdigest/shared';

/**
 * A5 — shared run-trace builder. A2's single-agent reviewer and A5's
 * multi-agent / built-in-detector runs all assemble the SAME single-document
 * RunTrace through this helper, so the enriched shape (full stats +
 * prompt_assembly + tool_calls + memory_pulled + specs_read + raw_output +
 * full log) is consistent and Zod-validated before it is persisted as ONE
 * document in `run_traces`.
 */
export interface BuildTraceInput {
  config: {
    agent: string;
    version?: string | null;
    provider?: string | null;
    model: string;
    pr?: number | null;
    source?: 'local' | 'ci';
  };
  stats: RunStats;
  promptAssembly: PromptAssembly;
  toolCalls: ToolCall[];
  rawOutput: string;
  memoryPulled: MemoryPulled[];
  specsRead: string[];
  log: RunLogLine[];
  /** Skills appended to the system message, in prompt order (spec 0006). */
  skillsUsed?: SkillUsed[];
  /** Token estimate per non-empty prompt_assembly slot (see countPromptTokens). */
  promptTokens?: Record<string, number>;
}

export function buildRunTrace(input: BuildTraceInput): RunTrace {
  const trace: RunTrace = {
    config: {
      agent: input.config.agent,
      version: input.config.version ?? null,
      provider: input.config.provider ?? null,
      model: input.config.model,
      pr: input.config.pr ?? null,
      source: input.config.source ?? 'local',
    },
    stats: input.stats,
    prompt_assembly: input.promptAssembly,
    tool_calls: input.toolCalls,
    raw_output: input.rawOutput,
    memory_pulled: input.memoryPulled,
    specs_read: input.specsRead,
    log: input.log,
    ...(input.skillsUsed ? { skills_used: input.skillsUsed } : {}),
    ...(input.promptTokens ? { prompt_tokens: input.promptTokens } : {}),
  };
  // Validate so a malformed trace fails loudly at write-time, not read-time.
  return RunTraceSchema.parse(trace);
}

/** An empty prompt-assembly for detectors that don't call an LLM. */
export function emptyPromptAssembly(system: string, user: string): PromptAssembly {
  return { system, skills: null, memory: null, specs: null, user };
}

/** The prompt_assembly slots that are counted, in display order. */
export const PROMPT_TOKEN_SLOTS = [
  'system',
  'skills',
  'memory',
  'specs',
  'callers',
  'repo_map',
  'pr_description',
  'user',
] as const;

/**
 * Token estimate per prompt_assembly slot, skipping slots that are null or
 * empty. `count` is injected (container.tokenizer.count) so this stays pure.
 * `system` excludes the skills block, so no token is counted twice.
 */
export function countPromptTokens(
  assembly: PromptAssembly,
  count: (text: string) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of PROMPT_TOKEN_SLOTS) {
    const text = assembly[slot];
    if (typeof text === 'string' && text.length > 0) out[slot] = count(text);
  }
  return out;
}
