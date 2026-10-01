/**
 * Facts builder (AC-32 to AC-40, AC-65, AC-66, AC-67, AC-85). Assembles every
 * deterministic input the prompt and the render step need, and exposes the
 * exact set of repo-relative paths that reach the prompt (`factPaths`) —
 * the AC-85 fact path set, "every path that reaches the prompt", not just
 * ranked paths plus root files.
 *
 * `factPaths` is produced by construction, not recomputed: every path written
 * into `Facts` goes through `rec()`. No repo-relative path may reach the
 * returned object any other way (plan decision 13) — that single invariant is
 * what makes the fact path set trustworthy.
 *
 * IO here is `readTextFileInClone` (platform, the one clone-read chokepoint —
 * AC-35) and `container.repoIntel` (a port, not a vendor SDK or drizzle).
 */
import type { Container } from '../../platform/container.js';
import type { OnboardingReason } from '@devdigest/shared';
import { readTextFileInClone } from '../../platform/safe-read.js';
import {
  CRITICAL_PATHS_LIMIT,
  ENV_KEYS_LIMIT,
  README_EXCERPT_CHARS,
  READING_PATH_LIMIT,
  ROOT_FILE_ALLOWLIST,
  ROOT_FILE_MAX_BYTES,
  SCRIPTS_LIMIT,
} from './constants.js';
import {
  buildFirstTasks,
  siblingTestCandidates,
  type FirstTasksCandidate,
  type FirstTasksFinding,
  type FirstTasksResult,
} from './first-tasks.js';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | null;

export interface ScriptEntry {
  name: string;
  command: string;
}

export interface Facts {
  repoFullName: string;
  readme: string | null;
  packageManager: PackageManager;
  scripts: ScriptEntry[];
  scriptsTruncated: boolean;
  envKeys: string[];
  envKeysTruncated: boolean;
  dockerComposePresent: boolean;
  /** Deterministic, ordered run commands (AC-65, AC-76). */
  runLocallyCommands: string[];
  readingPath: string[];
  readingPathTruncated: boolean;
  criticalPaths: string[][];
  criticalPathsTruncated: boolean;
  firstTasks: FirstTasksResult;
  /** Set only under `no_source_files` (ANSWERED 1) — render pre-degrades two sections. */
  preDegradedReason: OnboardingReason | null;
}

export interface BuildFactsInput {
  repoFullName: string;
  repoId: string;
  /** `null` when the repo has no readable clone — root files are skipped entirely. */
  clonePath: string | null;
  /** From the service's single `getTopFilesByRank(repoId, READING_PATH_LIMIT + 1)` call (decision 14). */
  rankedPaths: string[];
  findings: FirstTasksFinding[];
  candidates: FirstTasksCandidate[];
  preDegradedReason: OnboardingReason | null;
  container: Pick<Container, 'repoIntel'>;
}

export interface BuildFactsResult {
  facts: Facts;
  factPaths: ReadonlySet<string>;
}

export async function buildFacts(input: BuildFactsInput): Promise<BuildFactsResult> {
  const recorded = new Set<string>();
  const rec = (path: string): string => {
    recorded.add(path);
    return path;
  };

  // ---- reading path (AC-32, AC-33) ----
  const readingPathTruncated = input.rankedPaths.length > READING_PATH_LIMIT;
  const readingPath = input.rankedPaths.slice(0, READING_PATH_LIMIT).map(rec);

  // ---- critical paths (AC-33, decision 6) ----
  const chainsRaw = await input.container.repoIntel.getCriticalPaths(
    input.repoId,
    CRITICAL_PATHS_LIMIT + 1,
  );
  const criticalPathsTruncated = chainsRaw.length > CRITICAL_PATHS_LIMIT;
  const criticalPaths = chainsRaw.slice(0, CRITICAL_PATHS_LIMIT).map((chain) => chain.map(rec));

  // ---- root files, read only through the allowlist chokepoint (AC-35) ----
  const rootFiles = new Map<string, string>();
  if (input.clonePath !== null) {
    for (const path of ROOT_FILE_ALLOWLIST) {
      const content = await readTextFileInClone(input.clonePath, path, ROOT_FILE_MAX_BYTES);
      if (content !== null) rootFiles.set(path, content);
    }
  }
  const dockerComposePresent = rootFiles.has('docker-compose.yml');

  // ---- package manager (AC-37, AC-65) ----
  const packageManager: PackageManager = rootFiles.has('pnpm-lock.yaml')
    ? 'pnpm'
    : rootFiles.has('package-lock.json')
      ? 'npm'
      : rootFiles.has('yarn.lock')
        ? 'yarn'
        : null;

  // ---- package.json scripts — parsed wholesale, never thrown on malformed input ----
  const parsedScripts = parsePackageJsonScripts(rootFiles.get('package.json'));
  const scriptsTruncated = parsedScripts.length > SCRIPTS_LIMIT;
  const scripts = parsedScripts.slice(0, SCRIPTS_LIMIT);

  // ---- .env.example key names only — nothing right of '=' is ever kept (AC-36) ----
  const parsedEnvKeys = parseEnvExampleKeys(rootFiles.get('.env.example'));
  const envKeysTruncated = parsedEnvKeys.length > ENV_KEYS_LIMIT;
  const envKeys = parsedEnvKeys.slice(0, ENV_KEYS_LIMIT);

  // ---- README excerpt (AC-34 — never moves any `truncated` flag) ----
  const readmeRaw = rootFiles.get('README.md') ?? null;
  const readme = readmeRaw === null ? null : readmeRaw.slice(0, README_EXCERPT_CHARS);

  // Record every root file actually present — the paths, never their content.
  for (const path of ROOT_FILE_ALLOWLIST) {
    if (rootFiles.has(path)) rec(path);
  }

  // ---- run_locally commands — deterministic-only (AC-65, AC-76, AC-83) ----
  const runLocallyCommands = buildRunLocallyCommands(scripts, packageManager);

  // ---- first_tasks (AC-38 to AC-40, AC-66, AC-67) ----
  const siblingCandidatePaths = new Set<string>();
  for (const path of input.rankedPaths) {
    for (const c of siblingTestCandidates(path)) siblingCandidatePaths.add(c);
  }
  const existingSiblingPaths =
    siblingCandidatePaths.size === 0
      ? new Set<string>()
      : new Set(
          (await input.container.repoIntel.getFileRank(input.repoId, [...siblingCandidatePaths])).map(
            (r) => r.path,
          ),
        );
  const firstTasks = buildFirstTasks({
    findings: input.findings,
    candidates: input.candidates,
    rankedPaths: input.rankedPaths,
    existingSiblingPaths,
  });
  for (const item of firstTasks.items) {
    if (item.anchor) rec(item.anchor.split(':')[0]!);
  }

  const facts: Facts = {
    repoFullName: input.repoFullName,
    readme,
    packageManager,
    scripts,
    scriptsTruncated,
    envKeys,
    envKeysTruncated,
    dockerComposePresent,
    runLocallyCommands,
    readingPath,
    readingPathTruncated,
    criticalPaths,
    criticalPathsTruncated,
    firstTasks,
    preDegradedReason: input.preDegradedReason,
  };

  return { facts, factPaths: recorded };
}

/** Never throws — a malformed `package.json` yields no scripts, not an error. */
function parsePackageJsonScripts(raw: string | undefined): ScriptEntry[] {
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== 'object') return [];
    return Object.entries(scripts as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([name, command]) => ({ name, command }));
  } catch {
    return [];
  }
}

/** Key names only — the value right of `=` never leaves this function (AC-36). */
function parseEnvExampleKeys(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const keys: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
    if (match) keys.push(match[1]!);
  }
  return keys;
}

/**
 * `npm` needs `run`; `pnpm` and `yarn` both support running a script bare
 * (`pnpm dev`, `yarn dev`) — which is also the exact vocabulary AC-27's
 * matcher recognizes (`pnpm`, `npm run`, `yarn`, `npx`), so a model-written
 * `` `pnpm dev` `` is checked against this same bare form.
 */
function buildRunLocallyCommands(scripts: ScriptEntry[], manager: PackageManager): string[] {
  if (manager === null) return scripts.map((s) => s.name);
  if (manager === 'npm') return scripts.map((s) => `npm run ${s.name}`);
  return scripts.map((s) => `${manager} ${s.name}`);
}
