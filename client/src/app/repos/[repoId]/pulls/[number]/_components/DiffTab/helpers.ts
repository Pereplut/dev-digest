import type { PrFile, SmartDiff, SmartDiffRole } from "@/lib/types";
import { findingsForFile, type DiffFindingLike } from "@/components/diff-viewer";

/** One rendered role section: the server's group, resolved to real PrFiles. */
export interface RenderGroup {
  role: SmartDiffRole;
  files: PrFile[];
}

/**
 * Join the server's grouping onto the files the page actually holds.
 *
 * These two lists come from different places and can genuinely differ: `pr.files`
 * is fetched live from GitHub, while the smart-diff route reads the persisted
 * `pr_files` copy. So:
 *  - a grouped path with no PrFile is skipped (there is no patch to render), and
 *  - a PrFile no group claimed comes back as `leftovers`, to be rendered in its
 *    own section — never silently dropped.
 *
 * Group order and within-group order are the server's; nothing is re-sorted here.
 */
export function orderedGroups(
  files: PrFile[],
  smart: SmartDiff | undefined,
): { groups: RenderGroup[]; leftovers: PrFile[] } {
  if (!smart || smart.groups.length === 0) return { groups: [], leftovers: [] };

  const byPath = new Map(files.map((f) => [f.path, f]));
  const claimed = new Set<string>();
  const groups: RenderGroup[] = [];

  for (const group of smart.groups) {
    const resolved: PrFile[] = [];
    for (const gf of group.files) {
      const file = byPath.get(gf.path);
      if (!file) continue;
      resolved.push(file);
      claimed.add(gf.path);
    }
    if (resolved.length > 0) groups.push({ role: group.role, files: resolved });
  }

  return { groups, leftovers: files.filter((f) => !claimed.has(f.path)) };
}

/**
 * Which i18n key and count the one visibility button shows.
 *
 * Four branches over two independent conditions, so it lives here rather than as
 * a nested ternary in JSX — and it is unit-testable with no renderer. The wording
 * stays "comments" alone until a review exists, so a PR that never ran one reads
 * exactly as it did before Smart Diff.
 */
export function annotationToggle(
  commentCount: number,
  findingCount: number,
  shown: boolean,
): { key: string; count: number } {
  const verb = shown ? "hide" : "show";
  return findingCount > 0
    ? { key: `diff.${verb}Annotations`, count: commentCount + findingCount }
    : { key: `diff.${verb}Comments`, count: commentCount };
}

/**
 * How many FILES in this set carry at least one finding — not how many findings
 * there are. Two files holding five findings count 2 (spec 0010, AC 3).
 */
export function filesWithFindings(files: PrFile[], findings: DiffFindingLike[]): number {
  if (findings.length === 0) return 0;
  return files.reduce((n, f) => (findingsForFile(findings, f.path).length > 0 ? n + 1 : n), 0);
}
