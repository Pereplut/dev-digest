import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { AgentManifest, CiResultArtifact } from '@devdigest/shared';
import type { CiFile } from '@devdigest/shared';
import { AppError } from '../src/platform/errors.js';
import { readRunnerBundle } from '../src/modules/ci/service.js';
import {
  buildCiFileSet,
  buildAgentManifestYaml,
  SLUG_PATTERN,
  type AgentManifestSource,
} from '../src/modules/ci/helpers.js';
import { buildGhaWorkflowYaml } from '../src/modules/ci/workflow.js';
import { GHA_WORKFLOW_PATH, MEMORY_FILE_PATH } from '../src/modules/ci/constants.js';

/**
 * Manifest / file-set serialization tests (spec 0022: AC-14, AC-23..AC-29 and
 * the AC-79 contract). The runner `dist/` is faked on a temp dir so the export
 * is exercised end to end through `readRunnerBundle` + `buildCiFileSet`, with
 * no network and no database.
 */

const SHA = 'a'.repeat(40);

const AGENT: AgentManifestSource = {
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  // Hostile-looking text on purpose: quotes, colon, backslash, newline, unicode, a YAML-ish line.
  systemPrompt: 'Review for "secrets": C:\\temp\nsecond line: # not a comment\n- not a list item \u2713',
  strategy: 'single-pass',
  ciFailOn: 'critical',
};

const SKILLS = [
  { name: 'Lint Rules', body: '# Lint rules\nUse strict equality.\n' },
  { name: 'Security Basics', body: '# Security\nNever log secrets.\n' },
];

describe('readRunnerBundle + buildCiFileSet (faked dist/)', () => {
  let distDir: string;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'devdigest-ci-dist-'));
    writeFileSync(join(distDir, 'index.js'), '// runner entry\n');
    mkdirSync(join(distDir, 'chunks'));
    writeFileSync(join(distDir, 'chunks', '123.index.js'), '// runner chunk\n');
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  function exportFiles(
    agent: AgentManifestSource = AGENT,
    skills: { name: string; body: string }[] = SKILLS,
    extra: { workflowOverride?: string } = {},
  ): CiFile[] {
    return buildCiFileSet(agent, skills, readRunnerBundle(distDir), {
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
      ...extra,
    });
  }

  it('AC-23/AC-24/AC-25: the file set equals the expected path list for an agent with two skills, including every faked dist file under .devdigest/runner/', () => {
    const files = exportFiles();
    expect(files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/lint-rules.md',
      '.devdigest/skills/security-basics.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/chunks/123.index.js',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ]);
    const byPath = new Map(files.map((f) => [f.path, f]));
    expect(byPath.get('.devdigest/runner/index.js')!.contents).toBe('// runner entry\n');
    expect(byPath.get('.devdigest/runner/chunks/123.index.js')!.contents).toBe('// runner chunk\n');
    expect(byPath.get('.devdigest/skills/lint-rules.md')!.contents).toBe(SKILLS[0]!.body);
    // Only the workflow is editable.
    expect(files.filter((f) => f.editable).map((f) => f.path)).toEqual([GHA_WORKFLOW_PATH]);
    // No duplicate paths.
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
  });

  it('AC-26: the manifest YAML round-trips through AgentManifest.safeParse with fields equal to the fixture agent', () => {
    const files = exportFiles();
    const manifestFile = files.find((f) => f.path === '.devdigest/agents/security-reviewer.yaml')!;
    const parsed = AgentManifest.safeParse(parse(manifestFile.contents));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      name: AGENT.name,
      provider: AGENT.provider,
      model: AGENT.model,
      system_prompt: AGENT.systemPrompt, // survives quotes, backslash, newline, unicode byte-for-byte
      skills: ['lint-rules', 'security-basics'],
      strategy: AGENT.strategy,
      ci_fail_on: AGENT.ciFailOn,
    });
  });

  it('AC-26: every skill slug named in the manifest has a matching skill file, and each ci_fail_on value round-trips', () => {
    const files = exportFiles();
    const manifest = AgentManifest.parse(parse(files.find((f) => f.path.startsWith('.devdigest/agents/'))!.contents));
    for (const slug of manifest.skills) {
      expect(files.map((f) => f.path)).toContain(`.devdigest/skills/${slug}.md`);
    }
    for (const ciFailOn of ['critical', 'warning', 'any', 'never'] as const) {
      const yaml = buildAgentManifestYaml({ ...AGENT, ciFailOn }, []);
      expect(AgentManifest.parse(parse(yaml)).ci_fail_on).toBe(ciFailOn);
    }
  });

  it('AC-27: slugs match the pattern and are identical across two calls, and a skill named like the agent is disambiguated', () => {
    const a = exportFiles().map((f) => f.path);
    const b = exportFiles().map((f) => f.path);
    expect(a).toEqual(b);
    const manifestPath = a[0]!;
    expect(manifestPath.replace('.devdigest/agents/', '').replace('.yaml', '')).toMatch(SLUG_PATTERN);

    const clash = exportFiles(AGENT, [{ name: 'Security Reviewer', body: 'x' }, { name: 'security reviewer!', body: 'y' }]);
    const paths = clash.map((f) => f.path);
    expect(paths).toContain('.devdigest/agents/security-reviewer.yaml');
    expect(paths).toContain('.devdigest/skills/security-reviewer-2.md');
    expect(paths).toContain('.devdigest/skills/security-reviewer-3.md');
    for (const p of paths.filter((p) => p.startsWith('.devdigest/skills/'))) {
      expect(p.replace('.devdigest/skills/', '').replace('.md', '')).toMatch(SLUG_PATTERN);
    }
  });

  it('AC-28: memory.jsonl is exported empty', () => {
    const memory = exportFiles().find((f) => f.path === MEMORY_FILE_PATH)!;
    expect(memory).toBeDefined();
    expect(memory.contents).toBe('');
    expect(memory.editable).toBe(false);
  });

  it('AC-24 (negative): an agent with zero skills emits no skill file and skills: []', () => {
    const files = exportFiles(AGENT, []);
    expect(files.filter((f) => f.path.startsWith('.devdigest/skills/'))).toEqual([]);
    const manifest = files.find((f) => f.path === '.devdigest/agents/security-reviewer.yaml')!;
    expect(manifest.contents).toContain('skills: []');
    expect(AgentManifest.parse(parse(manifest.contents)).skills).toEqual([]);
  });

  it('AC-29 (negative): a name with no usable characters still yields a valid slug', () => {
    const files = exportFiles({ ...AGENT, name: '!!! \u2713 !!!' }, []);
    const manifestPath = files[0]!.path;
    expect(manifestPath).toMatch(/^\.devdigest\/agents\/[a-z0-9][a-z0-9-]*\.yaml$/);
  });

  it('the workflow override replaces the generated workflow byte-for-byte; an empty override is ignored', () => {
    const override = 'name: edited\non: pull_request\n';
    const edited = exportFiles(AGENT, SKILLS, { workflowOverride: override }).find((f) => f.path === GHA_WORKFLOW_PATH)!;
    expect(edited.contents).toBe(override);
    expect(edited.editable).toBe(true);

    const generated = buildGhaWorkflowYaml({ triggers: ['opened', 'synchronize'], postAs: 'github_review' });
    const empty = exportFiles(AGENT, SKILLS, { workflowOverride: '' }).find((f) => f.path === GHA_WORKFLOW_PATH)!;
    expect(empty.contents).toBe(generated);
  });

  describe('runner_bundle_missing', () => {
    function expectMissing(fn: () => unknown): void {
      let caught: unknown;
      try {
        fn();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe('runner_bundle_missing');
      expect((caught as AppError).statusCode).toBe(500);
    }

    it('a dist/ without index.js throws runner_bundle_missing, even when other files exist', () => {
      rmSync(join(distDir, 'index.js'));
      expectMissing(() => readRunnerBundle(distDir));
    });

    it('an index.js that exists only in a subdirectory does not satisfy the entry requirement', () => {
      rmSync(join(distDir, 'index.js'));
      writeFileSync(join(distDir, 'chunks', 'index.js'), '// nested');
      expectMissing(() => readRunnerBundle(distDir));
    });

    it('a dist/ directory that does not exist throws runner_bundle_missing', () => {
      expectMissing(() => readRunnerBundle(join(distDir, 'does-not-exist')));
    });

    it('an empty dist/ throws runner_bundle_missing', () => {
      const empty = mkdtempSync(join(tmpdir(), 'devdigest-ci-empty-'));
      try {
        expectMissing(() => readRunnerBundle(empty));
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });

    it('positive control: with index.js present the bundle reads, sorted, with / separators', () => {
      const bundle = readRunnerBundle(distDir);
      expect(bundle.map((f) => f.path)).toEqual(['.devdigest/runner/chunks/123.index.js', '.devdigest/runner/index.js']);
      expect(bundle.every((f) => f.editable === false)).toBe(true);
    });
  });
});

describe('CiResultArtifact contract (AC-14, AC-79)', () => {
  const valid = {
    status: 'ok',
    error: null,
    agent: 'Security Reviewer',
    findings_count: 1,
    critical: 1,
    warning: 0,
    suggestion: 0,
    blockers: 1,
    gate_triggered: true,
    cost_usd: 0.001,
    duration_ms: 1200,
    version: '1',
    pr_number: 42,
    commit_sha: SHA,
    repository_id: 123456789,
  };

  it('AC-14: accepts a valid entry (positive control)', () => {
    expect(CiResultArtifact.safeParse(valid).success).toBe(true);
    expect(CiResultArtifact.array().safeParse([valid, valid]).success).toBe(true);
  });

  it('AC-14: rejects an entry missing commit_sha', () => {
    const { commit_sha: _omitted, ...rest } = valid;
    void _omitted;
    expect(CiResultArtifact.safeParse(rest).success).toBe(false);
  });

  it('AC-14: rejects a 39-character, 41-character, uppercase or non-hex SHA', () => {
    for (const bad of ['a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'g'.repeat(40), '']) {
      expect(CiResultArtifact.safeParse({ ...valid, commit_sha: bad }).success).toBe(false);
    }
  });

  it('AC-14: rejects a missing, zero, negative, fractional or string repository_id', () => {
    const { repository_id: _omitted, ...rest } = valid;
    void _omitted;
    expect(CiResultArtifact.safeParse(rest).success).toBe(false);
    for (const bad of [0, -1, 1.5, '123']) {
      expect(CiResultArtifact.safeParse({ ...valid, repository_id: bad }).success).toBe(false);
    }
  });

  it('AC-79: rejects an entry missing blockers, and an entry missing gate_triggered', () => {
    const { blockers: _b, ...noBlockers } = valid;
    const { gate_triggered: _g, ...noGate } = valid;
    void _b;
    void _g;
    expect(CiResultArtifact.safeParse(noBlockers).success).toBe(false);
    expect(CiResultArtifact.safeParse(noGate).success).toBe(false);
    expect(CiResultArtifact.safeParse({ ...valid, blockers: -1 }).success).toBe(false);
    expect(CiResultArtifact.safeParse({ ...valid, gate_triggered: 'true' }).success).toBe(false);
  });

  it('AC-92 shape: an error entry with agent null and an over-long error is rejected only for the length', () => {
    const errorEntry = { ...valid, status: 'error', agent: null, findings_count: 0, blockers: 0, gate_triggered: false, error: 'boom' };
    expect(CiResultArtifact.safeParse(errorEntry).success).toBe(true);
    expect(CiResultArtifact.safeParse({ ...errorEntry, error: 'x'.repeat(501) }).success).toBe(false);
  });
});
