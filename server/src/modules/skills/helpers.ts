import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import {
  DERIVED_DESCRIPTION_MAX,
  DERIVED_NAME_MAX,
  FALLBACK_SKILL_NAME,
} from './constants.js';

/**
 * Pure helpers for the skills module (spec 0006): the ONE prompt formatter for
 * a skill, row → DTO mapping, stats math, and import-draft derivation. No I/O.
 */

/**
 * The block a skill contributes to an agent's system message. The SINGLE
 * definition: `Skill.token_count`, the Preview tab and the run executor all
 * render through this, so the tokens shown are the tokens sent.
 */
export function renderSkillBlock(name: string, body: string): string {
  return `### Skill: ${name}\n${body}`;
}

/** Card metrics carried on `Skill.stats`. */
export interface SkillCardStats {
  agent_count: number;
  pull_rate: number | null;
  accept_rate: number | null;
}

/** Raw aggregate counts behind one skill's metrics (see SkillsRepository.aggregates). */
export interface SkillAggregateCounts {
  agentCount: number;
  /** Done runs of the agents currently linked to the skill. */
  runsTotal: number;
  /** Of those, runs whose prompt included the skill. */
  runsWithSkill: number;
  accepted: number;
  dismissed: number;
}

/** A ratio in 0..1, or null when there is nothing to divide by (UI shows "—"). */
export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.min(1, Math.max(0, numerator / denominator));
}

/** Aggregate counts → the card metrics. */
export function toCardStats(c: SkillAggregateCounts | undefined): SkillCardStats {
  if (!c) return { agent_count: 0, pull_rate: null, accept_rate: null };
  return {
    agent_count: c.agentCount,
    pull_rate: rate(c.runsWithSkill, c.runsTotal),
    accept_rate: rate(c.accepted, c.accepted + c.dismissed),
  };
}

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(
  row: SkillRow,
  tokenCount: number | null,
  stats: SkillCardStats | null = null,
): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    token_count: tokenCount,
    stats,
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    version: row.version,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    body: row.body,
    message: row.message ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/** Editable content fields; a change to any of them creates a new version. */
export interface SkillContent {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

/** True when `patch` changes any versioned field of `existing` (`enabled` never does). */
export function isSkillContentChange(existing: SkillContent, patch: Partial<SkillContent>): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.type !== undefined && patch.type !== existing.type) ||
    (patch.body !== undefined && patch.body !== existing.body)
  );
}

/** A skill resolved for one run: what the executor sends and records. */
export interface LoadedSkill {
  id: string;
  name: string;
  version: number;
  block: string;
  tokens: number;
}

/** The Live Log line for the skills a run loaded. */
export function skillsLogLine(skills: Pick<LoadedSkill, 'name' | 'version'>[]): string {
  if (skills.length === 0) return 'Skills: none';
  return `Skills: ${skills.length} loaded (${skills.map((s) => `${s.name} v${s.version}`).join(', ')})`;
}

// ---- import-draft derivation ----------------------------------------------

/** `Flaky Test_Patterns.md` → `flaky-test-patterns`. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, DERIVED_NAME_MAX)
    .replace(/-+$/g, '');
}

/** Name from a file path: the file's base name, or its folder for a `SKILL.md`. */
export function nameFromPath(path: string, fallback?: string): string {
  const segments = path.split('/').filter(Boolean);
  const file = segments[segments.length - 1] ?? '';
  const base = file.replace(/\.[^.]+$/, '');
  const candidates =
    base.toLowerCase() === 'skill'
      ? [segments[segments.length - 2], fallback]
      : [base, fallback];
  for (const c of candidates) {
    const slug = c ? slugify(c.replace(/\.[^.]+$/, '')) : '';
    if (slug) return slug;
  }
  return FALLBACK_SKILL_NAME;
}

/** First prose paragraph of a markdown body (headings skipped), truncated. */
export function firstParagraph(body: string, max = DERIVED_DESCRIPTION_MAX): string {
  const paragraphs = body.split(/\n\s*\n/);
  for (const p of paragraphs) {
    const lines = p
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('```'));
    if (lines.length === 0) continue;
    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trimEnd()}…`;
  }
  return '';
}
