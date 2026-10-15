/**
 * @devdigest/agent-runner — CI runner CLI (T8).
 *
 * Invoked by the generated GitHub Actions workflow as
 * `node .devdigest/runner/index.js` (`server/src/modules/ci/constants.ts` /
 * `workflow.ts`) — bundled by `ncc` into a single self-contained
 * `dist/index.js` (T7) with no runtime dependency on `node_modules/@devdigest/*`.
 *
 * Reads CI-injected env vars directly (OPENROUTER_API_KEY, GITHUB_TOKEN,
 * GITHUB_REPOSITORY, PR_NUMBER, DEVDIGEST_COMMIT_SHA, DEVDIGEST_REPOSITORY_ID). This is intentional, not a `SecretsProvider`
 * bypass: the runner executes OUTSIDE the server DI graph (in the target
 * repo's own CI), so the `SecretsProvider`/`process.env` chokepoint — which is
 * scoped to `server/` — does not apply here (see `agent-runner/AGENTS.md`).
 *
 * All actual logic lives in `run.ts` (`runCi`), which takes every dependency
 * (fs, fetch, LLM provider, clock) as an injectable parameter so it can be
 * unit-tested hermetically. This file only wires those dependencies to the
 * real world and maps the result onto `process.exitCode`.
 */
import path from 'node:path';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { runCi, type PostAs } from './run.js';
import { redactSecrets } from './artifact.js';

/** Default artifact file name; the generated workflow uploads exactly this path. */
const RESULT_FILE = 'devdigest-result.json';

function resolvePostAs(value: string | undefined): PostAs {
  if (value === 'github_review' || value === 'pr_comment' || value === 'none') return value;
  return 'github_review';
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const devdigestDir = env.DEVDIGEST_DIR ?? path.join(process.cwd(), '.devdigest');
  const resultPath = env.DEVDIGEST_RESULT_PATH ?? path.join(process.cwd(), RESULT_FILE);
  const postAs = resolvePostAs(env.DEVDIGEST_POST_AS);

  // No global LLM client — always injected (reviewer-core invariant). An empty
  // key still constructs the provider; the first `completeStructured` call
  // will fail (and be caught by `runCi`'s hard-fail path) rather than the
  // runner crashing before it can report a clear error.
  const llm = new OpenRouterProvider(env.OPENROUTER_API_KEY ?? '');

  const result = await runCi({
    devdigestDir,
    env,
    llm,
    postAs,
    resultPath,
    readFile: readFileSync,
    readDir: readdirSync,
    writeFile: writeFileSync,
  });

  if (result.results === null) {
    console.error(`[agent-runner] FAILED: ${redactSecrets(result.error, env)}`);
  } else {
    console.log(`[agent-runner] ran ${result.results.length} reviewer(s), posted as ${postAs}:`);
    for (const r of result.results) {
      console.log(
        `[agent-runner]   ${r.agent}: findings=${r.artifact.findings_count} ` +
          `blockers=${r.blockers} gateTriggered=${r.gateTriggered}`,
      );
    }
  }
  return result.exitCode;
}

// Only run when executed directly (CI), never on import (tests import `main`
// / `runCi` directly and drive them with injected fixtures).
// Compare URLs, not a hand-built string: `import.meta.url` is percent-encoded,
// so a checkout path with a space, `#` or non-ASCII never matched and the job
// exited 0 without reviewing anything.
const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      // Message only, redacted: never the raw error object (could carry request config) or env.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[agent-runner] fatal error: ${redactSecrets(message, process.env)}`);
      process.exitCode = 1;
    },
  );
}
