/**
 * The `path -> role` table IS the specification of Smart Diff's classifier.
 *
 * Rule ORDER is the decision, not the patterns, so the three cases the order is
 * visible on are pinned first and labelled. Change a rule and this table tells you
 * which other path you just moved. See specs/0010-smart-diff.md (decision 3).
 */
import { describe, it, expect } from 'vitest';
import { SmartDiffRole } from '@devdigest/shared';
import { classifyFile, normalizePath } from '../src/modules/smart-diff/classify.js';
import { CLASSIFY_RULES, ROLE_ORDER, COLLAPSED_ROLES } from '../src/modules/smart-diff/constants.js';

describe('classifyFile', () => {
  describe('the three cases rule order is visible on', () => {
    it('puts a snapshot inside __tests__ in boilerplate, not tests', () => {
      // The snapshot rule sits ABOVE the test-directory rule.
      expect(classifyFile('client/src/__tests__/__snapshots__/x.snap')).toBe('boilerplate');
    });

    it('puts a .claude markdown file in wiring, not docs', () => {
      // Markdown that configures an agent is wiring; the .claude rule sits above docs.
      expect(classifyFile('.claude/skills/security/SKILL.md')).toBe('wiring');
    });

    it('puts e2e/README.md in tests, not docs', () => {
      // `e2e/` is a package here, and its rule sits above every docs rule.
      expect(classifyFile('e2e/README.md')).toBe('tests');
    });
  });

  const TABLE: [path: string, role: string][] = [
    // boilerplate
    ['pnpm-lock.yaml', 'boilerplate'],
    ['client/pnpm-lock.yaml', 'boilerplate'],
    ['package-lock.json', 'boilerplate'],
    ['yarn.lock', 'boilerplate'],
    ['Cargo.lock', 'boilerplate'],
    ['server/dist/index.js', 'boilerplate'], // the dist rule outranks the barrel rule
    ['client/.next/build/manifest.json', 'boilerplate'],
    ['client/src/ui/Button.generated.ts', 'boilerplate'],
    ['public/vendor/chart.min.js', 'boilerplate'],

    // tests
    ['server/test/pulls-status.test.ts', 'tests'],
    ['server/test/smart-diff.it.test.ts', 'tests'], // .it.test.ts must not fall through
    ['server/test/helpers/pg.ts', 'tests'], // directory rule, non-test filename
    ['client/src/lib/api.spec.ts', 'tests'],
    ['client/src/components/Button/Button.test.tsx', 'tests'],
    ['e2e/flows/01-app-boot.flow.json', 'tests'], // non-TS file under e2e/

    // wiring
    ['client/src/components/diff-viewer/index.ts', 'wiring'],
    ['server/vitest.config.ts', 'wiring'],
    ['server/tsconfig.json', 'wiring'],
    ['client/.eslintrc.json', 'wiring'],
    ['client/.env.local', 'wiring'],
    ['docker-compose.override.yml', 'wiring'],
    ['.github/workflows/server-ci.yml', 'wiring'],

    // docs
    ['docs/skills.md', 'docs'],
    ['README.md', 'docs'],
    ['server/docs/adr/0001-onion.md', 'docs'],
    ['CHANGELOG', 'docs'],
    ['LICENSE', 'docs'],

    // core — the fallback
    ['server/src/modules/pulls/service.ts', 'core'],
    ['server/src/db/schema/pulls.ts', 'core'],
    ['client/src/app/repos/[repoId]/pulls/[number]/page.tsx', 'core'], // brackets must not break a rule
    ['client/src/styles/theme.css', 'core'],
    ['scripts/dev.sh', 'core'],
  ];

  it.each(TABLE)('classifies %s as %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('is insensitive to a leading ./ or / and to backslashes', () => {
    expect(classifyFile('./pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('/docs/skills.md')).toBe('docs');
    expect(classifyFile('server\\test\\x.test.ts')).toBe('tests');
  });

  it('does NOT strip a diff-header prefix, so a real top-level a/ survives', () => {
    // Stripping `a/` would misfile a repo that really has one; callers holding
    // diff headers normalise before calling.
    expect(normalizePath('a/src/thing.ts')).toBe('a/src/thing.ts');
  });

  it('falls back to core for an empty path', () => {
    expect(classifyFile('')).toBe('core');
  });
});

describe('the role tables stay in sync with the contract', () => {
  // This pair is what fails loudly if SmartDiffRole is widened in one copy only.
  it('ROLE_ORDER covers exactly the contract enum', () => {
    expect([...ROLE_ORDER].sort()).toEqual([...SmartDiffRole.options].sort());
  });

  it('displays core first and boilerplate last', () => {
    expect(ROLE_ORDER[0]).toBe('core');
    expect(ROLE_ORDER[ROLE_ORDER.length - 1]).toBe('boilerplate');
  });

  it('every rule names a role the contract knows', () => {
    for (const rule of CLASSIFY_RULES) {
      expect(SmartDiffRole.options).toContain(rule.role);
    }
  });

  it('collapses only docs and boilerplate', () => {
    expect([...COLLAPSED_ROLES].sort()).toEqual(['boilerplate', 'docs']);
  });
});
