# agent-runner — `@devdigest/agent-runner`

Bundled CI runner. A standalone package (not part of any workspace) that `ncc` compiles into
`dist/`, which an Export-to-CI PR embeds as `.devdigest/runner/` in the target repo, where the
**target repo's own GitHub Actions** run it — outside this repo's server, its DI graph and its
Postgres. Overview, env vars and exit codes: [README.md](README.md)

## Commands (npm)
- `npm ci` · `npm run typecheck` · `npm test` (hermetic, LLM stubbed) · `npm run build` (ncc → `dist/`)
- **Install prerequisites, in this order** (the path aliases resolve `zod`/`openai` from *those*
  packages' `node_modules`, never from `agent-runner/node_modules`):
  1. `cd reviewer-core && npm ci`
  2. `cd server && pnpm install`
  3. `cd agent-runner && npm ci && npm run build`
- `dist/` is never committed (git-ignored, no exception). Export to CI reads the built directory.
- No ESLint config yet.

## Layout
- `src/index.ts`: CLI entry. Reads env, wires real fs/fetch/`OpenRouterProvider` into `runCi`.
- `src/run.ts`: `runCi`, the single orchestrator. It loads every `.devdigest/agents/*.y{a,}ml`
  manifest, fetches the PR diff once, reviews all agents in parallel, posts per agent, and writes the
  `devdigest-result.json` array. It exits 1 if any agent's gate triggered.
- `manifest.ts` / `skills.ts` / `context.ts` / `diff.ts` / `github.ts` / `artifact.ts` / `errors.ts`:
  helpers. `diff.ts` and `github.ts` are self-authored on purpose: importing the server's parser or
  octokit would break bundle self-containment.

## What it does
1. Reads the checked-in `.devdigest/agents/*.yaml` manifests and `.devdigest/skills/*.md` from the
   target repo's working tree (validated against `AgentManifest` before use).
2. Runs the PR diff and title/body through the same `reviewer-core` pipeline a local studio run uses
   (`reviewPullRequest` → `assemblePrompt` / `wrapUntrusted` / `groundFindings`).
3. Posts per `DEVDIGEST_POST_AS` (`github_review` | `pr_comment` | `none`) with the CI-injected
   GitHub token, writes `devdigest-result.json` (`CiResultArtifact[]`), and exits non-zero if
   the deterministic gate triggered.

## Boundaries
- **Secrets come from `process.env`, on purpose.** The server's rule that only `LocalSecretsProvider`
  reads `process.env` is scoped to `server/`. In someone else's CI there is no container to inject a
  `SecretsProvider` from, so `OPENROUTER_API_KEY` / `GITHUB_TOKEN` come from the workflow's `env:`.
  Never log them, and never let them reach `devdigest-result.json` or a posted comment.
- `reviewer-core` and `@devdigest/shared` are consumed as **raw TypeScript source** through
  `tsconfig.json` path aliases (mirrored in `vitest.config.ts`), exactly like the server. Never point
  them at a built artifact.
- Every reviewer-core invariant holds unchanged, because this code leaves the repo:
  - `groundFindings()` is mandatory. An all-dropped result is a valid zero-finding APPROVE.
  - The diff and PR body go through `assemblePrompt` (which applies `wrapUntrusted` + `INJECTION_GUARD`);
    never hand-roll the prompt.
  - The posted verdict and the exit code come from the deterministic gate
    (`countBlockers` / `gateTriggered` against the manifest's `ci_fail_on`), never the model's verdict.
  If a reviewer-core change would require bypassing one of these, take it to a spec, not a workaround.

## Do not touch without reading
- `src/index.ts`: changes reach every target repo that already installed a bundle.
- `tsconfig.json` paths: must keep resolving to raw source.
- The `dist/` shape: an export must ship **every** file in `dist/` (see INSIGHTS.md).
- Workflow generation and what gets embedded in the exported PR belong to the server `ci` module, not here.

## Know before you edit
- Gotchas: [INSIGHTS.md](INSIGHTS.md) · Review pipeline: [reviewer-core/docs/](../reviewer-core/docs/)
