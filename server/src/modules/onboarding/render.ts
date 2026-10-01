/**
 * The single renderer (AC-22 to AC-31, AC-69, AC-82 to AC-85). Turns a
 * (possibly null) model draft plus the deterministic facts into the five
 * `OnboardingSection`s, applying every grounding rule in the order decision 12
 * fixes — the order IS the requirement: AC-82's raw-body scan must run before
 * AC-25's link-syntax strip, or `[src/nope.ts](http://evil)` is laundered into
 * unbackticked prose the backtick-only AC-26 check cannot see.
 *
 * Pure: no DB, no IO, no container. `SECTION_FALLBACK_BODIES` is exported from
 * HERE and nowhere else (AC-31's second closure) — a second "quick skeleton"
 * table inlined elsewhere would be the loophole AC-31 exists to close.
 */
import type { OnboardingLink, OnboardingSection, OnboardingSectionKind } from '@devdigest/shared';
import { MANAGER_BUILTINS, SECTION_KINDS, SECTION_TITLES } from './constants.js';
import type { Draft, DraftSection } from './draft.js';
import type { Facts } from './facts.js';
import { NO_SIGNALS_STATEMENT } from './first-tasks.js';
import { NO_SOURCE_FILES_DEGRADED_KINDS } from './helpers.js';

/**
 * The deterministic body used whenever a section ends up `generated: false` —
 * no draft at all, or the model's body dropped to nothing. Every path-like
 * token in these five strings must be in the fact path set (there are none
 * here, which trivially satisfies it — the render step would otherwise reject
 * its own output).
 */
export const SECTION_FALLBACK_BODIES: Record<OnboardingSectionKind, string> = {
  architecture: 'An architecture overview is not available yet for this repository.',
  critical_paths: 'No critical dependency chains are available yet for this repository.',
  run_locally: 'No run instructions are available yet for this repository.',
  reading_path: 'No reading order is available yet for this repository.',
  first_tasks: NO_SIGNALS_STATEMENT,
};

const MANAGER_CMD_RE = /^(pnpm|npm run|yarn|npx)\s+(\S+)/;

function isPathLike(token: string): boolean {
  return token.includes('/') || /\.[A-Za-z0-9]{1,5}$/.test(token);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/** A paragraph (blank-line separated) or, inside a list, one item per line. */
function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  for (const paragraph of body.split(/\n\s*\n/)) {
    const lines = paragraph.split('\n').filter((l) => l.trim().length > 0);
    const isList = lines.length > 0 && lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
    if (isList) blocks.push(...lines);
    else if (paragraph.trim().length > 0) blocks.push(paragraph);
  }
  return blocks;
}

interface BlockCandidates {
  /** Backticked spans, plus every markdown link's text AND target, plus every
   * autolink — all candidates for the AC-82 raw-body path-like-token scan. */
  pathLikeCandidates: string[];
  /** Backticked spans only (AC-27, AC-83 both key on backticks specifically). */
  backtickedSpans: string[];
}

function extractBlockCandidates(block: string): BlockCandidates {
  const backtickedSpans: string[] = [];
  const pathLikeCandidates: string[] = [];
  for (const m of block.matchAll(/`([^`]+)`/g)) {
    backtickedSpans.push(m[1]!);
    pathLikeCandidates.push(m[1]!);
  }
  for (const m of block.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    pathLikeCandidates.push(m[1]!, m[2]!);
  }
  for (const m of block.matchAll(/<([^<>\s]+)>/g)) {
    pathLikeCandidates.push(m[1]!);
  }
  return { pathLikeCandidates, backtickedSpans };
}

function shouldDropBlock(
  block: string,
  kind: OnboardingSectionKind,
  factPaths: ReadonlySet<string>,
  scriptNames: ReadonlySet<string>,
  commands: ReadonlySet<string>,
): boolean {
  const { pathLikeCandidates, backtickedSpans } = extractBlockCandidates(block);

  // AC-26 (scanned per AC-82, BEFORE the link strip): any path-like candidate
  // outside the fact path set drops the whole block.
  if (pathLikeCandidates.some((t) => isPathLike(t) && !factPaths.has(t))) return true;

  // AC-27, every section: a pnpm/npm run/yarn/npx command whose script/binary
  // is neither a parsed script nor a manager built-in.
  for (const span of backtickedSpans) {
    const m = MANAGER_CMD_RE.exec(span.trim());
    if (!m) continue;
    const name = m[2]!;
    if (!scriptNames.has(name) && !(MANAGER_BUILTINS as readonly string[]).includes(name)) {
      return true;
    }
  }

  // AC-83, run_locally only: EVERY backticked span must equal a facts-builder
  // command or a parsed script name, character for character.
  if (kind === 'run_locally') {
    for (const span of backtickedSpans) {
      if (!commands.has(span) && !scriptNames.has(span)) return true;
    }
  }

  return false;
}

/** Runs AFTER the AC-82 scan — `[t](u)` → `t`, `<u>` → `u` (AC-25). */
function stripLinkSyntax(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/<([^<>\s]+)>/g, '$1');
}

function diagramTokens(diagram: string): string[] {
  return diagram.split(/[\s"'[\]{}|()]+/).filter((t) => t.length > 0);
}

function truncatedFor(kind: OnboardingSectionKind, facts: Facts): boolean {
  switch (kind) {
    case 'reading_path':
      return facts.readingPathTruncated;
    case 'critical_paths':
      return facts.criticalPathsTruncated;
    case 'run_locally':
      return facts.scriptsTruncated || facts.envKeysTruncated;
    case 'first_tasks':
      return facts.firstTasks.truncated;
    case 'architecture':
      return false;
  }
}

function renderOneSection(
  kind: OnboardingSectionKind,
  facts: Facts,
  factPaths: ReadonlySet<string>,
  scriptNames: ReadonlySet<string>,
  commands: ReadonlySet<string>,
  draftSection: DraftSection | null,
): OnboardingSection {
  // The two sections pre-degraded under `no_source_files` (ANSWERED 1) are
  // set BEFORE anything else and ignore the draft entirely — never offered to
  // the model in any way this render step honours.
  if (facts.preDegradedReason === 'no_source_files' && NO_SOURCE_FILES_DEGRADED_KINDS.includes(kind)) {
    return {
      kind,
      title: SECTION_TITLES[kind],
      body: SECTION_FALLBACK_BODIES[kind],
      diagram: null,
      links: [],
      generated: false,
      degraded_reason: 'no_source_files',
      dropped_refs: 0,
      truncated: false,
      items: [],
      commands: [],
    };
  }

  let droppedRefs = 0;
  const blocks = splitBlocks(draftSection?.body ?? '');
  const survivors: string[] = [];
  for (const block of blocks) {
    if (shouldDropBlock(block, kind, factPaths, scriptNames, commands)) {
      droppedRefs += 1;
    } else {
      survivors.push(stripLinkSyntax(block));
    }
  }
  let body = survivors.join('\n\n').trim();

  // Links — independent of body prose (AC-24, AC-84).
  const links: OnboardingLink[] = [];
  for (const link of draftSection?.links ?? []) {
    if (!factPaths.has(link.path)) {
      droppedRefs += 1;
      continue;
    }
    links.push({ label: basename(link.path), path: link.path });
  }

  // Diagram — architecture only (AC-69); whole-string token scan (AC-28).
  let diagram: string | null = null;
  if (kind === 'architecture' && draftSection?.diagram) {
    const tokens = diagramTokens(draftSection.diagram);
    if (tokens.some((t) => isPathLike(t) && !factPaths.has(t))) {
      droppedRefs += 1;
    } else {
      diagram = draftSection.diagram;
    }
  }

  // first_tasks: no items ⇒ the model's prose is discarded entirely (AC-40),
  // which then takes the generic empty-body fallback below.
  if (kind === 'first_tasks' && facts.firstTasks.items.length === 0) {
    body = '';
  }

  const generated = body.length > 0;
  if (!generated) body = SECTION_FALLBACK_BODIES[kind];

  return {
    kind,
    title: SECTION_TITLES[kind],
    body,
    diagram,
    links,
    generated,
    degraded_reason: null,
    dropped_refs: droppedRefs,
    truncated: truncatedFor(kind, facts),
    items: kind === 'first_tasks' ? facts.firstTasks.items : [],
    commands: kind === 'run_locally' ? facts.runLocallyCommands : [],
  };
}

/**
 * The ONLY function that produces `OnboardingSection[]`. Called with
 * `draft = null` for the deterministic skeleton (AC-4, AC-31) and with the
 * model's draft on a successful generation.
 */
export function renderSections(
  facts: Facts,
  factPaths: ReadonlySet<string>,
  draft: Draft | null,
): OnboardingSection[] {
  const scriptNames = new Set(facts.scripts.map((s) => s.name));
  const commands = new Set(facts.runLocallyCommands);
  const draftByKind = new Map<OnboardingSectionKind, DraftSection>();
  if (draft) for (const s of draft.sections) draftByKind.set(s.kind, s);

  return SECTION_KINDS.map((kind) =>
    renderOneSection(kind, facts, factPaths, scriptNames, commands, draftByKind.get(kind) ?? null),
  );
}

/** `done` iff all five generated; every other finished generation is `partial` (AC-22, AC-23). */
export function deriveOnboardingStatus(sections: OnboardingSection[]): 'done' | 'partial' {
  return sections.every((s) => s.generated) ? 'done' : 'partial';
}
