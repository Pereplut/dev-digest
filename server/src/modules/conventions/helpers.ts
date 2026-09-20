/**
 * Pure helpers for the conventions module: the merge fingerprint, the row → DTO
 * mapping, and path safety. No DB, no `this`, no I/O.
 */
import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import type { ConventionCandidate, ConventionScan } from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';

/**
 * Stable identity of a convention, used as the merge key on a re-scan.
 *
 * Built from the evidence path plus the NORMALISED rule text only. Line numbers
 * and confidence are deliberately excluded: the same rule found again after the
 * file shifted is the same convention, and re-deriving it must not wipe the
 * user's accept/reject decision.
 */
export function conventionFingerprint(evidencePath: string, rule: string): string {
  const key = `${evidencePath.trim().toLowerCase()}::${normalizeRule(rule)}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Lowercase, collapse whitespace, drop trailing punctuation. */
export function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!;:,]+$/, '');
}

/**
 * Collapse candidates that share a fingerprint, keeping the best one.
 *
 * The fingerprint is the merge key, so two rows carrying the same one in a
 * single `INSERT … ON CONFLICT DO UPDATE` make Postgres abort the whole
 * statement ("cannot affect row a second time", SQLSTATE 21000) and fail the
 * entire scan. A model naming the same rule twice for one file is ordinary
 * output, not an edge case: `conventionFingerprint` deliberately normalises
 * away case, whitespace and trailing punctuation, so near-identical phrasings
 * collapse together.
 *
 * "Best" is proved-over-unproved, then higher confidence — so a duplicate never
 * downgrades a candidate that passed proof.
 */
export function dedupeByFingerprint<
  T extends { fingerprint: string; confidence: number; evidenceValid: boolean },
>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const current = best.get(row.fingerprint);
    if (!current || outranks(row, current)) best.set(row.fingerprint, row);
  }
  return [...best.values()];
}

function outranks(
  a: { confidence: number; evidenceValid: boolean },
  b: { confidence: number; evidenceValid: boolean },
): boolean {
  if (a.evidenceValid !== b.evidenceValid) return a.evidenceValid;
  return a.confidence > b.confidence;
}

/**
 * Reject a path that would escape the clone root. The model supplies these
 * strings, so `../../etc/passwd` is a realistic input, not a hypothetical.
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes('\0')) return false;
  const normalized = normalize(path).replace(/\\/g, '/');
  return !normalized.startsWith('../') && normalized !== '..';
}

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status,
    evidence_valid: row.evidenceValid,
    rejected_reason: row.rejectedReason,
    updated_at: row.updatedAt?.toISOString() ?? null,
  };
}

export function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    status: row.status,
    sampler: row.sampler,
    sample_file_count: row.sampleFileCount,
    candidate_count: row.candidateCount,
    rejected_count: row.rejectedCount,
    model: row.model,
    // `numeric` is a STRING in Drizzle 0.38 — convert here, at the boundary, so
    // no caller ever learns the column's storage type.
    cost_usd: row.costUsd === null ? null : Number(row.costUsd),
    error: row.error,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}
