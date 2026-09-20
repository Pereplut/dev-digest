/**
 * Deterministic sample selection — homework criterion 39.
 *
 * NO model is involved in choosing what the extractor looks at. The sample is
 * (a) whichever of `CONFIG_CANDIDATES` exist at the clone root, then (b) the top
 * `TOP_FILE_COUNT` ranked source files from `repoIntel.getConventionSamples()`.
 * When the repo has never been indexed that call returns `[]`, and
 * `walkFallbackPaths` picks the same number of files by a fixed heuristic.
 *
 * Everything here is a free function over plain data, so it unit-tests with no
 * DB, no clone and no model.
 */
import {
  MAX_SAMPLE_LINES,
  SAMPLE_CHAR_BUDGET,
  SOURCE_EXTENSIONS,
  TOP_FILE_COUNT,
  WALK_JUNK_PATTERNS,
} from './constants.js';

export interface SampleFile {
  path: string;
  content: string;
}

/**
 * The final ordered sample list: configs first (they state the rules the code
 * is supposed to follow), then the ranked source files.
 *
 * `rankedPaths` is whatever the sampler produced; it is truncated to
 * `TOP_FILE_COUNT` here rather than at the call site so the cap is testable.
 */
export function pickSamplePaths(configPathsPresent: string[], rankedPaths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...configPathsPresent, ...rankedPaths.slice(0, TOP_FILE_COUNT)]) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Fallback picker for a repo repo-intel has never indexed.
 *
 * Deterministic by construction: filter to source extensions, drop test/generated
 * paths, then sort by (directory depth, path length, path) and take the top N.
 * Shallow, short paths are a decent proxy for "central to the project" without
 * needing a rank table, and the tie-break on the path itself makes the order
 * total — two runs over the same tree always produce the same sample.
 */
export function walkFallbackPaths(paths: string[], limit = TOP_FILE_COUNT): string[] {
  return paths
    .filter((p) => SOURCE_EXTENSIONS.some((ext) => p.endsWith(ext)))
    .filter((p) => !isWalkJunk(p))
    .sort((a, b) => depth(a) - depth(b) || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, limit);
}

/** Mirrors repo-intel's junk filter, minus the config patterns we deliberately want. */
export function isWalkJunk(path: string): boolean {
  const lower = path.toLowerCase();
  return WALK_JUNK_PATTERNS.some((p) => lower.includes(p));
}

function depth(path: string): number {
  return path.split('/').length;
}

/**
 * Render the sample as one prompt block.
 *
 * Lines are numbered from 1 and the numbering reflects the ORIGINAL file, so a
 * model citing `evidence_start_line` names a line the proof step can look up.
 * Truncated files say so, otherwise the model would cite a line past the cut.
 */
export function buildSampleBlock(
  files: SampleFile[],
  charBudget = SAMPLE_CHAR_BUDGET,
  maxLines = MAX_SAMPLE_LINES,
): string {
  const chunks: string[] = [];
  let used = 0;
  for (const f of files) {
    const chunk = renderSampleFile(f, maxLines);
    if (used + chunk.length > charBudget) break;
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks.join('\n');
}

function renderSampleFile(file: SampleFile, maxLines: number): string {
  const all = file.content.replace(/\r\n/g, '\n').split('\n');
  const kept = all.slice(0, maxLines);
  const numbered = kept.map((line, i) => `${i + 1}\t${line}`).join('\n');
  const truncated =
    all.length > maxLines ? `\n… truncated, ${all.length - maxLines} more lines\n` : '\n';
  return `--- ${file.path} ---\n${numbered}${truncated}`;
}
