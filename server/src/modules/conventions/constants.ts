/** Literals and thresholds for the convention extractor (spec 0007). */

/** JobRunner kind for a background extraction run. */
export const EXTRACT_JOB_KIND = 'conventions-extract';

/**
 * How many top-ranked source files join the sample. Fixed by homework
 * criterion 39 ("top-12 files via repoIntel.getConventionSamples()").
 */
export const TOP_FILE_COUNT = 12;

/** Per-file line cap in the prompt sample, so one huge file cannot crowd out the rest. */
export const MAX_SAMPLE_LINES = 200;

/** Hard cap on how many candidates one model response may contain. */
export const MAX_CANDIDATES = 20;

/**
 * Character budget for the whole sample block. The JobRunner kills a handler at
 * 120s (platform/jobs.ts), so the prompt has to stay small enough to come back
 * well inside that. ~4 chars/token ⇒ roughly 30k tokens of samples.
 */
export const SAMPLE_CHAR_BUDGET = 120_000;

/**
 * Largest file the extractor will read into memory. Matches repo-intel's own
 * walker cap (`MAX_FILE_SIZE`, 400 KB) — kept as a separate constant rather
 * than imported, because a module may not reach into another module's internals.
 * No real config or source file comes close; a bigger one is a memory attack.
 */
export const MAX_SAMPLE_FILE_BYTES = 400 * 1024;

/** How far off the cited line range a snippet may still be found. */
export const PROOF_LINE_SLACK = 2;

/**
 * Shortest line that counts as real evidence. A snippet made only of `}`,
 * `const` or similar matches almost any window, so proof requires at least one
 * line this long that is not pure punctuation (see proof.ts).
 */
export const MIN_INFORMATIVE_CHARS = 12;

/** Source extensions the fallback walker will consider. */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/**
 * Config files probed directly at the clone root.
 *
 * These CANNOT come from `repoIntel.getConventionSamples()`: its junk filter
 * (modules/repo-intel/service.ts) excludes any path containing `eslint`,
 * `prettier` or `.config.`, and `tsconfig.json` is not even a walked extension.
 * Criterion 39 asks for configs, so they are probed here instead.
 */
export const CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.cjs',
  'package.json',
] as const;

/** Directory names the fallback walker never descends into. */
export const WALK_EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.git',
  '.turbo',
  'out',
] as const;

/** Substrings that disqualify a path from the fallback sample (mirrors repo-intel's filter). */
export const WALK_JUNK_PATTERNS = [
  '.test.',
  '.spec.',
  '.d.ts',
  '__tests__/',
  '__mocks__/',
  '/test/',
  '/tests/',
  '/migrations/',
  '/__fixtures__/',
] as const;

/** Cap on how many files the fallback walker will visit before giving up. */
export const WALK_MAX_ENTRIES = 5_000;
