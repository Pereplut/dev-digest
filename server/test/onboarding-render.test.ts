/**
 * `renderSections` — the grounding engine (AC-22 to AC-31, AC-69, AC-82 to
 * AC-85). Pure, no DB, no IO.
 */
import { describe, it, expect } from 'vitest';
import { Draft } from '../src/modules/onboarding/draft.js';
import type { Facts } from '../src/modules/onboarding/facts.js';
import {
  SECTION_FALLBACK_BODIES,
  deriveOnboardingStatus,
  renderSections,
} from '../src/modules/onboarding/render.js';
import { SECTION_KINDS } from '../src/modules/onboarding/constants.js';

function baseFacts(over: Partial<Facts> = {}): Facts {
  return {
    repoFullName: 'acme/widgets',
    readme: 'Widgets.',
    packageManager: 'pnpm',
    scripts: [
      { name: 'dev', command: 'tsx watch src/server.ts' },
      { name: 'build', command: 'tsc' },
    ],
    scriptsTruncated: false,
    envKeys: ['DATABASE_URL'],
    envKeysTruncated: false,
    dockerComposePresent: true,
    runLocallyCommands: ['pnpm dev', 'pnpm build'],
    readingPath: ['src/app.ts', 'src/server.ts'],
    readingPathTruncated: false,
    criticalPaths: [['src/app.ts', 'src/server.ts']],
    criticalPathsTruncated: false,
    firstTasks: { items: [{ text: 'Open finding in src/app.ts:10.', anchor: 'src/app.ts:10' }], truncated: false },
    firstTasksContext: { findings: [], candidates: [] },
    preDegradedReason: null,
    ...over,
  };
}

const FACT_PATHS = new Set(['README.md', 'src/app.ts', 'src/server.ts', 'package.json']);

function draftWith(kind: string, body: string, over: Record<string, unknown> = {}): Draft {
  return {
    sections: SECTION_KINDS.map((k) => ({
      kind: k,
      body: k === kind ? body : 'Steady state body text with no claims.',
      diagram: null,
      links: [],
      ...(k === kind ? over : {}),
    })),
  };
}

describe('renderSections', () => {
  it('AC-82/AC-25: a link whose TEXT is an invented path is dropped, body carries neither path nor target', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', '[src/nope.ts](http://evil)'),
    );
    expect(arch!.body).not.toContain('src/nope.ts');
    expect(arch!.body).not.toContain('evil');
    expect(arch!.dropped_refs).toBe(1);
  });

  it('AC-82: a link whose TARGET is invented is also dropped (innocuous text, bad target)', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', '[the entry point](src/nope.ts)'),
    );
    expect(arch!.body).not.toContain('src/nope.ts');
    expect(arch!.dropped_refs).toBe(1);
  });

  it('AC-82 paired: a link to a real fact path survives as bare text, dropped_refs unchanged', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', '[the readme](README.md)'),
    );
    expect(arch!.body).toBe('the readme');
    expect(arch!.dropped_refs).toBe(0);
  });

  it('AC-83: run_locally drops every invented command', () => {
    const body = [
      '`docker compose up -d`',
      '',
      '`make build`',
      '',
      '`./scripts/dev.sh`',
      '',
      '`go run ./...`',
    ].join('\n\n');
    const [, , runLocally] = renderSections(baseFacts(), FACT_PATHS, draftWith('run_locally', body));
    expect(runLocally!.dropped_refs).toBe(4);
    expect(runLocally!.generated).toBe(false);
  });

  it('AC-83 paired: `pnpm dev` (a parsed script AND a facts-builder command) survives in run_locally', () => {
    const [, , runLocally] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('run_locally', '`pnpm dev`'),
    );
    expect(runLocally!.body).toContain('pnpm dev');
    expect(runLocally!.dropped_refs).toBe(0);
  });

  it('AC-83 scope: the same docker-compose block survives OUTSIDE run_locally (architecture)', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', '`docker compose up -d`'),
    );
    expect(arch!.body).toContain('docker compose up -d');
    expect(arch!.dropped_refs).toBe(0);
  });

  it('AC-27: an unknown pnpm/npm run/yarn/npx command is dropped in any section', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', '`pnpm db:reset`'),
    );
    expect(arch!.dropped_refs).toBe(1);
  });

  it('AC-27 paired: a manager built-in (`pnpm install`, no such script) survives', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', '`pnpm install`'),
    );
    expect(arch!.body).toContain('pnpm install');
    expect(arch!.dropped_refs).toBe(0);
  });

  it('AC-26: a block citing a path outside the fact path set is dropped', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', 'See `src/nope.ts` for the entry point.'),
    );
    expect(arch!.dropped_refs).toBe(1);
    expect(arch!.generated).toBe(false);
  });

  it('AC-26 paired: a block citing a real fact path survives', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', 'See `src/app.ts` for the entry point.'),
    );
    expect(arch!.dropped_refs).toBe(0);
    expect(arch!.body).toContain('src/app.ts');
  });

  it('AC-84: a model-written link label is replaced by the path basename', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', 'Entry point below.', {
        links: [{ label: 'src/nope.ts', path: 'package.json' }],
      }),
    );
    expect(arch!.links).toEqual([{ label: 'package.json', path: 'package.json' }]);
    expect(JSON.stringify(arch!.links)).not.toContain('src/nope.ts');
  });

  it('AC-84 paired: a plausible but model-written label is still replaced', () => {
    const [arch] = renderSections(
      baseFacts(),
      FACT_PATHS,
      draftWith('architecture', 'Entry point below.', {
        links: [{ label: 'Server entry', path: 'src/app.ts' }],
      }),
    );
    expect(arch!.links).toEqual([{ label: 'app.ts', path: 'src/app.ts' }]);
  });

  it('AC-28: three unquoted mermaid forms each null the diagram and count one drop', () => {
    for (const diagram of [
      'flowchart TD\nA[src/nope.ts]',
      'flowchart TD\nA-->|src/nope.ts|B',
      'flowchart TD\nsubgraph src/nope.ts',
    ]) {
      const [arch] = renderSections(
        baseFacts(),
        FACT_PATHS,
        draftWith('architecture', 'Body text.', { diagram }),
      );
      expect(arch!.diagram).toBeNull();
      expect(arch!.dropped_refs).toBe(1);
    }
  });

  it('AC-28 paired: the same three forms naming a fact path keep the diagram', () => {
    for (const diagram of [
      'flowchart TD\nA[src/app.ts]',
      'flowchart TD\nA-->|src/app.ts|B',
      'flowchart TD\nsubgraph src/app.ts',
    ]) {
      const [arch] = renderSections(
        baseFacts(),
        FACT_PATHS,
        draftWith('architecture', 'Body text.', { diagram }),
      );
      expect(arch!.diagram).toBe(diagram);
      expect(arch!.dropped_refs).toBe(0);
    }
  });

  it('AC-69: critical_paths diagram is nulled; architecture keeps it', () => {
    const draft: Draft = {
      sections: SECTION_KINDS.map((k) => ({
        kind: k,
        body: 'Body text.',
        diagram: 'flowchart TD\nA[src/app.ts]',
        links: [],
      })),
    };
    const sections = renderSections(baseFacts(), FACT_PATHS, draft);
    const arch = sections.find((s) => s.kind === 'architecture')!;
    const critical = sections.find((s) => s.kind === 'critical_paths')!;
    expect(arch.diagram).not.toBeNull();
    expect(critical.diagram).toBeNull();
  });

  it('AC-29: the draft schema carries no title key', () => {
    const shape = Draft.shape.sections.element.shape;
    expect(Object.keys(shape)).not.toContain('title');
  });

  it('AC-30: two empty bodies fall back to their deterministic text, status partial', () => {
    const draft: Draft = {
      sections: SECTION_KINDS.map((k) => ({
        kind: k,
        body: k === 'architecture' || k === 'critical_paths' ? '' : 'Grounded body text.',
        diagram: null,
        links: [],
      })),
    };
    const sections = renderSections(baseFacts(), FACT_PATHS, draft);
    const arch = sections.find((s) => s.kind === 'architecture')!;
    const critical = sections.find((s) => s.kind === 'critical_paths')!;
    expect(arch.generated).toBe(false);
    expect(arch.body).toBe(SECTION_FALLBACK_BODIES.architecture);
    expect(critical.generated).toBe(false);
    expect(deriveOnboardingStatus(sections)).toBe('partial');
  });

  it('all five bodies dropped (every block cites src/nope.ts) → partial, never done', () => {
    const draft: Draft = {
      sections: SECTION_KINDS.map((k) => ({
        kind: k,
        body: 'See `src/nope.ts`.',
        diagram: null,
        links: [],
      })),
    };
    const sections = renderSections(baseFacts(), FACT_PATHS, draft);
    expect(sections.every((s) => !s.generated)).toBe(true);
    expect(deriveOnboardingStatus(sections)).toBe('partial');
  });

  it('a full valid draft → done', () => {
    const draft: Draft = {
      sections: SECTION_KINDS.map((k) => ({
        kind: k,
        body: 'Grounded body text with no claims to check.',
        diagram: null,
        links: [],
      })),
    };
    const sections = renderSections(baseFacts(), FACT_PATHS, draft);
    expect(sections.every((s) => s.generated)).toBe(true);
    expect(deriveOnboardingStatus(sections)).toBe('done');
  });

  it('AC-85 paired: a chain member / finding file / evidence_path citation survives (not just ranked paths)', () => {
    const facts = baseFacts();
    const extendedPaths = new Set([...FACT_PATHS, 'docs/CHAIN.md', 'src/finding.ts', 'src/evidence.ts']);
    const [arch] = renderSections(
      facts,
      extendedPaths,
      draftWith('architecture', 'See `docs/CHAIN.md`, `src/finding.ts` and `src/evidence.ts`.'),
    );
    expect(arch!.dropped_refs).toBe(0);
    expect(arch!.body).toContain('docs/CHAIN.md');
  });

  it('null draft → every section generated:false with its deterministic fallback (AC-4, AC-31)', () => {
    const sections = renderSections(baseFacts(), FACT_PATHS, null);
    expect(sections).toHaveLength(5);
    for (const s of sections) {
      expect(s.generated).toBe(false);
      expect(s.body).toBe(SECTION_FALLBACK_BODIES[s.kind]);
    }
  });

  it('first_tasks: zero items discards model prose entirely (AC-40)', () => {
    const facts = baseFacts({ firstTasks: { items: [], truncated: false } });
    const [, , , , firstTasks] = renderSections(
      facts,
      FACT_PATHS,
      draftWith('first_tasks', 'There are many great tasks to pick up right now!'),
    );
    expect(firstTasks!.generated).toBe(false);
    expect(firstTasks!.body).toBe(SECTION_FALLBACK_BODIES.first_tasks);
    expect(firstTasks!.items).toEqual([]);
  });

  it('every deterministic fallback body is self-consistent: no path-like token outside the (empty) fact set', () => {
    for (const body of Object.values(SECTION_FALLBACK_BODIES)) {
      const tokens = body.split(/\s+/).filter((t) => t.includes('/') || /\.[A-Za-z0-9]{1,5}$/.test(t));
      expect(tokens).toEqual([]);
    }
  });

  it('no_source_files pre-degradation forces critical_paths and reading_path, ignoring the draft', () => {
    const facts = baseFacts({ preDegradedReason: 'no_source_files' });
    const draft: Draft = {
      sections: SECTION_KINDS.map((k) => ({ kind: k, body: 'Grounded body text.', diagram: null, links: [] })),
    };
    const sections = renderSections(facts, FACT_PATHS, draft);
    const critical = sections.find((s) => s.kind === 'critical_paths')!;
    const reading = sections.find((s) => s.kind === 'reading_path')!;
    const arch = sections.find((s) => s.kind === 'architecture')!;
    expect(critical.generated).toBe(false);
    expect(critical.degraded_reason).toBe('no_source_files');
    expect(reading.generated).toBe(false);
    expect(reading.degraded_reason).toBe('no_source_files');
    expect(arch.generated).toBe(true);
    expect(arch.degraded_reason).toBeNull();
  });
});
