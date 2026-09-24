import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5432/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  // Verbose prompt-assembly logging (spec 0008). The `prompt assembled` record
  // is emitted at DEBUG either way; this adds per-section hashes, the per-skill
  // breakdown and the section order — never section text, in either mode.
  // Default OFF, and IGNORED unless NODE_ENV=development: a deployed
  // environment cannot switch it on with an env var alone (loadConfig below).
  PROMPT_LOG_VERBOSE: z.string().optional(),
  API_PORT: z.coerce.number().int().default(3001),
  // Bind address. Defaults to loopback: DevDigest is a local-first tool with no
  // authentication (LocalNoAuthProvider resolves every request to the same
  // workspace and there is no auth hook), so binding all interfaces would let
  // anyone on the same network segment read run traces, overwrite stored API
  // keys and trigger paid LLM runs. Set API_HOST=0.0.0.0 deliberately, and only
  // once real authentication exists.
  API_HOST: z.string().default('127.0.0.1'),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  /** Bind address — loopback unless API_HOST says otherwise. See EnvSchema. */
  apiHost: string;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /**
   * Verbose prompt-assembly logging. Default false, and forced false outside
   * `nodeEnv === 'development'` — so this is safe to read without re-checking
   * the environment at the call site.
   */
  promptLogVerbose: boolean;
  /**
   * PROMPT_LOG_VERBOSE was set but deliberately ignored (not a dev environment).
   * Exists so boot can say so out loud instead of leaving the operator to think
   * verbose logging is on when it silently is not.
   */
  promptLogVerboseIgnored: boolean;
  /**
   * Whether the `prompt assembled` records can be emitted at all — true only
   * when the log level actually admits `debug`. The executor uses this to skip
   * building the records AND to skip tokenizing every section of every chunk,
   * so the feature costs nothing at the default `info` level.
   */
  promptLogEnabled: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  const logLevel = parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info');
  const verboseRequested = parsed.PROMPT_LOG_VERBOSE === 'true';
  const isDev = parsed.NODE_ENV === 'development';
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    apiHost: parsed.API_HOST,
    webPort: parsed.WEB_PORT,
    cloneDir,
    secretsPath: join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel,
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    // The `&& isDev` is the whole point: the env var alone cannot enable this.
    promptLogVerbose: verboseRequested && isDev,
    promptLogVerboseIgnored: verboseRequested && !isDev,
    // `trace` is below `debug` in pino, so it admits debug records too.
    promptLogEnabled: logLevel === 'debug' || logLevel === 'trace',
  };
}
