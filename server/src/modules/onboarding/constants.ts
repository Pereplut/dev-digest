/** Literals and thresholds for the onboarding tour generator (spec 0017). */
import type { OnboardingSectionKind } from '@devdigest/shared';

/** JobRunner kind for a background generation run. */
export const ONBOARDING_JOB_KIND = 'onboarding-generate';

/**
 * Races the WHOLE handler body (AC-16) — facts, every clone read, the model
 * call, the render step and every write — not just `completeStructured`.
 * Strictly less than `JobRunner`'s own 120 000 ms (`platform/jobs.ts:41`), so
 * the failed-row write still lands before `JobRunner` kills the job.
 */
export const GENERATION_TIMEOUT_MS = 90_000;

/**
 * A `running` generation older than this is presumed abandoned and is taken
 * over by the next POST (AC-20). Strictly greater than `GENERATION_TIMEOUT_MS`
 * so a generation that is merely close to its own timeout is never raced by a
 * concurrent takeover.
 */
export const GENERATION_STALE_MS = 600_000;

/** `reading_path` link cap (AC-32). */
export const READING_PATH_LIMIT = 12;

/** `critical_paths` chain cap (AC-33, AC-85 via decision 6). */
export const CRITICAL_PATHS_LIMIT = 5;

/** `first_tasks` merged-list cap (ANSWERED 3 — per-source cap + 1, merged cap here). */
export const FIRST_TASKS_LIMIT = 8;

/** `package.json` scripts cap (AC-33's parsed-list case). */
export const SCRIPTS_LIMIT = 12;

/** `.env.example` key-name cap (AC-33's parsed-list case). */
export const ENV_KEYS_LIMIT = 20;

/** `README.md` excerpt cap, in characters (AC-34 — never affects `truncated`). */
export const README_EXCERPT_CHARS = 4_000;

/** The only root files the facts builder ever reads (AC-35). */
export const ROOT_FILE_ALLOWLIST = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'docker-compose.yml',
  '.env.example',
  'README.md',
] as const;

/** Largest root file the facts builder will read into memory. */
export const ROOT_FILE_MAX_BYTES = 256 * 1024;

/** The five section kinds, in fixed display order (AC-1, AC-3). */
export const SECTION_KINDS: readonly OnboardingSectionKind[] = [
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
] as const;

/** Fixed per-kind titles — the draft schema carries none (AC-29). */
export const SECTION_TITLES: Record<OnboardingSectionKind, string> = {
  architecture: 'Architecture',
  critical_paths: 'Critical Paths',
  run_locally: 'Run Locally',
  reading_path: 'Reading Path',
  first_tasks: 'First Tasks',
};

/**
 * Package-manager built-ins that are not a `package.json` script (AC-27):
 * `pnpm install`, `npm i`, `yarn add …`, `npx create-…` etc. are legitimate
 * even though no script of that name exists.
 */
export const MANAGER_BUILTINS = ['install', 'i', 'add', 'exec', 'dlx', 'create'] as const;
