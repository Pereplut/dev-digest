# 0002. Ship the whole runner bundle into the target repo

Status: accepted. Shipped with [spec 0022](../../specs/0022-export-to-ci.md); see [export-to-ci.md](../export-to-ci.md).

## Context
The workflow must run the same reviewer-core pipeline as the studio inside a repo that has no DevDigest
dependencies, and the job holds the `OPENROUTER_API_KEY` secret.

## Decision
`agent-runner/` is bundled with `ncc` into `dist/` (`agent-runner/package.json` `build`). The export commits every
file of `dist/` to `.devdigest/runner/`, and the workflow runs `node .devdigest/runner/index.js` directly, with no
marketplace action (`server/src/modules/ci/constants.ts:19-21`, `service.ts:58-76`). The job checks out the PR base
commit, so the code that sees the secrets is the one already merged (`workflow.ts:108-110`).

## Consequences
- Self-contained: no registry, no version drift between studio and CI, nothing fetched at run time.
- ncc splits dynamic imports into extra chunk files that `index.js` loads relative to itself, so all files are
  shipped, not only `index.js` (`service.ts:50-57`).
- The repo carries a minified bundle that changes with each studio build; "Update CI config" re-commits it.
- The studio host must have built it (`runner_bundle_missing`, HTTP 500, otherwise).
- The bundle and workflow show up in the install PR's own diff; the runner strips `.devdigest/` and
  `.github/workflows/` before review (`agent-runner/src/diff.ts:21`).
- Until the install PR merges, base has no runner, so the guard step skips (`workflow.ts:112-116`).
