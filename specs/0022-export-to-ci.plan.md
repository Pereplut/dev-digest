## Task
Build spec 0022 (Export to CI) as two PRs in order. PR 1 is the `agent-runner/` package, a port of upstream `0574487` carrying the spec's departures. PR 2 is the server `ci` module, the schema and migration, the GitHub port additions, the agent CI tab, the export wizard and the `/ci` page. It uses at most 5 implementer runs and one test-writer, implementers write no tests, and the fix loop is capped at 2 subagents.

## Requirements source
| Governing spec | `status:` (`path:line`) | Criteria it defines | Rows in my review |
|---|---|---|---|
| `/home/komp/devdigest-ci/specs/0022-export-to-ci.md` | `status: approved` (`specs/0022-export-to-ci.md:3`) | 92 (AC-1 … AC-92) | 92 spec rows (R1–R92) + 6 user rows (R93–R98) = 98 |

The counts match: 92 spec criteria and 92 spec rows. Six requirements came from the user (relayed in the caller's prompt) and are not in the spec. They are R93–R98, sourced as the user's words.

## Requirements review
Line numbers refer to `specs/0022-export-to-ci.md`.

| ID | Requirement, restated in one sentence | Source | Verdict | Satisfied by |
|---|---|---|---|---|
| R1 | `agent-runner/` ships an npm package with its lockfile, an AGENTS/CLAUDE-shim/INSIGHTS trio, no pnpm lockfile, and passes check-agent-docs | :173 (AC-1) | clear | S3, S9, S10 |
| R2 | `npm run build` produces `dist/index.js` via ncc, and `dist/` is ignored with nothing tracked | :176 (AC-2) | clear. The root `.gitignore:3-6` currently **un-ignores** `agent-runner/dist/`, which contradicts this; S2 removes those lines | S2, S3, S10 |
| R3 | Every manifest YAML is validated before any model call, GitHub write or artifact write, and one failure exits 1 | :178 (AC-3) | ambiguous: against AC-92's "`agent: null` entry when no manifest loaded" | S4, S5 · **Q2** |
| R4 | The diff is fetched once per run, whatever the number of manifests | :181 (AC-4) | clear | S5 |
| R5 | `.devdigest/**` and `.github/workflows/**` are stripped from the diff before review | :183 (AC-5) | clear | S4 |
| R6 | Each manifest is reviewed through `reviewPullRequest`, so the wrapUntrusted and groundFindings gates apply | :185 (AC-6) | clear | S5 |
| R7 | The PR title and branch names reach the model only inside a wrapped block, never in `task` | :188 (AC-7) | clear (they go into `prDescription`; `task` = `Review PR #<n>`) | S5 |
| R8 | Blockers and the gate come from `countBlockers`/`gateTriggered` over grounded findings plus the manifest's `ci_fail_on` | :192 (AC-8) | clear | S5 |
| R9 | Exit 1 if any gate triggers, else 0 | :195 (AC-9) | clear | S5, S7 |
| R10 | A diff or model failure exits 1, posts nothing, and still writes error entries | :196 (AC-10) | clear | S5, S6 |
| R11 | post_as behaves as follows: `github_review` posts one review per manifest, `pr_comment` posts one comment per manifest, and `none` makes zero GitHub writes | :198 (AC-11) | clear | S4, S5 |
| R12 | The artifact is a validated JSON array with one entry per manifest, carrying `commit_sha` and `repository_id` from env | :202 (AC-12) | clear | S1, S5, S6 |
| R13 | Neither secret value ever appears in the artifact, stdout or stderr | :205 (AC-13) | clear | S6, S7 |
| R14 | `CiResultArtifact` requires a 40-hex lowercase `commit_sha` and a positive-int `repository_id`, in both copies | :207 (AC-14) | clear | S1 |
| R15 | The ported upstream runner tests pass under `npm test`, extended to the AC-14 fields | :210 (AC-15) | ambiguous: who ports them, given that implementers write no tests | S8 · **Q1** |
| R16 | `CiInstallation` gains `status`, `workflow_version`, `triggers`, `post_as`, `pr_url` and `last_run`, and loses no field | :215 (AC-16) | clear | S11, S25 |
| R17 | `CiRun` carries the 14 listed fields, populated from `agent_runs` | :219 (AC-17) | clear. It also gains `status` and `error` so AC-92's "failed verdict" is renderable while `verdict` stays two-valued | S11, S20, S25 |
| R18 | `CiExportInput` gets an optional `workflow_override`, and the triggers default becomes `[opened, synchronize]` | :223 (AC-18) | clear | S11, S25 |
| R19 | `CiExport.installation` becomes nullable | :225 (AC-19) | clear | S11, S25 |
| R20 | Export `CiRefreshResult {degraded, message, ingested, skipped}` and `CiUpdateResult` with one entry per installation | :227 (AC-20) | clear. I chose the shape `{ results: [...] }` | S11, S25 |
| R21 | The client copy mirrors the server CI section, `AgentManifest` included | :230 (AC-21) | clear | S25 |
| R22 | The listed `ci_installations` and `agent_runs` columns, the unique key and the unique index arrive in one generated migration | :233 (AC-22) | clear. `repository_id` and `actions_run_id` are `bigint {mode:'number'}`, because run ids exceed int32 | S12, S13 |
| R23 | `action:'files'` returns 200 with null installation and null pr_url, makes no GitHub write and writes no row | :242 (AC-23) | clear | S21, S22 |
| R24 | The emitted file set is exactly manifest + enabled skills + empty memory + every `dist/` file under `.devdigest/runner/` + the workflow | :245 (AC-24) | clear | S19, S21 |
| R25 | The manifest YAML parses, passes `AgentManifest`, and its fields equal the agent's | :252 (AC-25) | clear | S19 |
| R26 | Slugs match `^[a-z0-9][a-z0-9-]*$` and are deterministic | :255 (AC-26) | clear | S19 |
| R27 | `memory.jsonl` is zero bytes | :257 (AC-27) | clear | S19 |
| R28 | A missing `dist/index.js` returns 500 `runner_bundle_missing` naming the build command, with no GitHub call | :258 (AC-28) | clear | S21 |
| R29 | A non-`gha` target returns 422 `validation_error` | :261 (AC-29) | clear | S21 |
| R30 | The workflow's `on:` has exactly `pull_request`, with types filtered to the three allowed values | :266 (AC-30) | clear | S17, S18 |
| R31 | No `pull_request_target`, `issue_comment`, `pull_request_review_comment` or `workflow_run` anywhere | :268 (AC-31) | clear | S18 |
| R32 | Top-level permissions are exactly `contents: read` + `pull-requests: write`, and there are no job permissions | :270 (AC-32) | clear | S17, S18 |
| R33 | The job `if:` is false when the head repo is not the base repo | :272 (AC-33) | clear (`head.repo.full_name == github.repository`, not upstream's `fork == false`) | S17, S18 |
| R34 | Every `uses:` is pinned to a 40-hex SHA, only the three actions are used, and there is no review-action | :274 (AC-34) | clear (the SHAs must be resolved, see `## Not found`) | S17, S18 |
| R35 | Secrets appear only as the two exact expressions and only in the review step's `env:` | :277 (AC-35) | clear | S17, S18 |
| R36 | No `run:` contains `${{`, and the review `run:` is exactly `node .devdigest/runner/index.js` | :280 (AC-36) | clear | S18 |
| R37 | The review env passes the PR number, the repo, `head.sha`, `github.repository_id` and `DEVDIGEST_POST_AS` = post_as | :282 (AC-37) | clear | S17, S18 |
| R38 | The upload step for `devdigest-result.json` uses artifact name `devdigest-result` and has `if: always()` | :285 (AC-38) | clear, restated as `if: always() && steps.guard.outputs.present == 'true'`, which is needed to honour AC-91. The test-writer asserts that `always()` is *contained* in the condition | S18 |
| R39 | `open_pr` makes one commit to `devdigest/ci` and opens a PR into the default branch read from GitHub, with no write to the default branch | :290 (AC-39) | clear | S14, S15, S21 |
| R40 | `workflow_override` is committed byte-for-byte | :293 (AC-40) | clear | S21 |
| R41 | If an open `devdigest/ci` PR exists, the export commits to it and returns its URL without opening a second | :295 (AC-41) | clear | S21 |
| R42 | A successful `open_pr` upserts one row per (agent, repo), storing triggers, post_as, pr_url and repository_id, with version 1 then +1 | :297 (AC-42) | clear | S20, S21 |
| R43 | A GitHub failure returns an envelope with GitHub's message, creates no row, and leaves the existing row's fields unchanged | :301 (AC-43) | clear | S21 |
| R44 | `POST /agents/:id/ci/update` re-exports every `gha` installation with stored settings and returns `CiUpdateResult` | :305 (AC-44) | clear | S21, S22 |
| R45 | One failed re-export does not stop the others; that entry has `ok:false` and a non-empty error | :308 (AC-45) | clear | S21 |
| R46 | `GET /agents/:id/ci/installations` returns the list with `last_run` set to the newest run or null | :311 (AC-46) | clear | S20, S22 |
| R47 | Refresh lists completed runs of `devdigest-review.yml` per installation and downloads `devdigest-result` with the studio token | :316 (AC-47) | clear | S14, S15, S21 |
| R48 | An entry with a SHA mismatch against the run's `head_sha` writes no row and counts as skipped | :319 (AC-48) | clear | S19, S21 |
| R49 | An entry with a repository_id mismatch writes no row and counts as skipped | :321 (AC-49) | clear | S19, S21 |
| R50 | A missing, expired, non-zip, non-JSON or schema-invalid artifact is skipped and processing continues | :324 (AC-50) | clear | S21 |
| R51 | A passing entry whose `agent` matches inserts one `source='ci'` row with the listed fields and `cost_usd` as a string | :327 (AC-51) | clear | S20, S21 |
| R52 | An already-ingested (installation, run id) pair inserts no second row | :332 (AC-52) | clear (`onConflictDoNothing` on the unique index) | S12, S20 |
| R53 | A list failure gives `degraded:true` plus a message, other installations continue, and no row is changed | :334 (AC-53) | clear | S21 |
| R54 | `GET /ci/runs[?agent_id]` returns the workspace's ci runs, ran_at descending | :337 (AC-54) | clear | S20, S22 |
| R55 | `TABS` includes `ci`, so `?tab=ci` opens the tab | :342 (AC-55) | clear | S29 |
| R56 | One row per installation showing repo, target, status, version and last-run verdict/time, with a placeholder when null | :344 (AC-56) | clear | S30 |
| R57 | No installations shows an empty state plus Add to CI | :347 (AC-57) | clear | S30 |
| R58 | A "Fail CI on" select with 4 values persists via the existing agent update | :349 (AC-58) | clear (`agents/service.ts:123` already accepts `ci_fail_on`) | S30 |
| R59 | The tab renders history from `GET /ci/runs?agent_id=` | :351 (AC-59) | clear | S28, S30 |
| R60 | "Update CI config" is disabled with no gha installation; when activated it makes one POST and renders each entry's outcome | :352 (AC-60) | clear | S28, S30 |
| R61 | Add to CI opens a modal with Target, Preview, Configure and Install steps, Target active | :358 (AC-61) | clear | S31 |
| R62 | Target shows only GitHub Actions | :360 (AC-62) | clear | S31 |
| R63 | Preview lists every file path and shows its content; only the workflow is editable | :362 (AC-63) | clear | S21 (`editable` flag), S31 |
| R64 | An edited workflow goes into `workflow_override` and into the zip | :365 (AC-64) | clear | S31 |
| R65 | Configure defaults: opened on, synchronize on, reopened off, post-as `github_review` | :367 (AC-65) | clear | S31 |
| R66 | The secrets panel shows instructions only, with no set/not-set state and no request | :369 (AC-66) | clear | S31 |
| R67 | Configure shows the branch-protection note | :373 (AC-67) | clear | S31 |
| R68 | Install issues exactly one `open_pr` POST and disables confirm while it is in flight | :375 (AC-68) | clear | S28, S31 |
| R69 | On success show `pr_url` as a link; on failure show `error.message` and stay open | :378 (AC-69) | clear | S31 |
| R70 | The zip holds exactly the previewed file set via the AC-90 writer, with no `open_pr` request | :380 (AC-70) | clear | S31 |
| R71 | Escape closes the wizard and returns focus to Add to CI | :383 (AC-71) | clear (the vendored `Modal` has no keydown handler, so the wizard owns it) | S31 |
| R72 | The `/ci` table has repo, PR, agent, verdict, findings, cost and duration columns, plus a job link with `target=_blank` and `rel="noopener noreferrer"` | :388 (AC-72) | clear | S32 |
| R73 | Refresh makes one POST, then refetches, and is disabled while in flight | :391 (AC-73) | clear | S28, S32 |
| R74 | A degraded refresh shows a banner with the message and keeps the rows | :393 (AC-74) | clear | S32 |
| R75 | No runs shows an empty state pointing to Add to CI | :395 (AC-75) | clear | S32 |
| R76 | `nav.ts` gains exactly one entry, `href: '/ci'` | :397 (AC-76) | clear | S33 |
| R77 | All CI strings come from `messages/en/ci.json` | :398 (AC-77) | clear | S26, S30–S32 |
| R78 | The checkout uses `ref: base.sha`, and nothing checks out the head, `head_ref` or the merge ref | :404 (AC-78) | clear | S17, S18 |
| R79 | Artifact entries carry required `blockers` and `gate_triggered` in both copies, set from AC-8 | :409 (AC-79) | clear | S1, S5 |
| R80 | Ingest stores `blockers` and `ci_gate_triggered`, and the verdict derives from them, never from the current `ci_fail_on` | :412 (AC-80) | clear | S19, S20, S21 |
| R81 | An unedited Preview regenerates from the Configure choices; after an edit it stops regenerating and Configure shows a notice | :416 (AC-81) | clear (regenerate = re-issue `action:'files'` with the new triggers/post_as) | S31 |
| R82 | Update regenerates the workflow from stored settings, ignoring overrides, and the tab shows "edits are discarded" text | :420 (AC-82) | clear | S21, S30 |
| R83 | Target has a repo select over the workspace repos' `full_name`, prefilled with the active repo, accepting free text, with Continue disabled unless the value is `owner/name` | :423 (AC-83) | clear | S31 |
| R84 | The "Add repository" row opens the same wizard | :426 (AC-84) | clear | S30 |
| R85 | Export/update success sets `pr_open`; ingest sets `active` | :428 (AC-85) | clear | S20, S21 |
| R86 | Export/update failure on an existing installation sets `error` | :431 (AC-86) | clear | S20, S21 |
| R87 | With no open PR, `devdigest/ci` is force-reset to the default head, the commit goes on top, and a new PR opens | :433 (AC-87) | clear (needs a new `resetToBase` option on `commitFiles`, because `octokit.ts:275-285` parents on the existing branch) | S14, S15, S21 |
| R88 | Refresh examines at most 30 completed runs per installation | :436 (AC-88) | clear | S15, S21 |
| R89 | `GET /ci/runs` returns at most 100 rows with no paging | :438 (AC-89) | clear | S20, S22 |
| R90 | The zip is a dependency-free STORE writer in the wizard folder, and `client/package.json` and the lockfile are unchanged | :440 (AC-90) | clear (upstream `zip.ts` has no imports) | S31 |
| R91 | A guard step skips runner and upload with a notice and exit 0 when `.devdigest/runner/index.js` is absent on base | :443 (AC-91) | clear | S18 |
| R92 | A hard fail writes per-manifest `status:"error"` entries (≤500-char error, no env value, zero counts, gate false, sha and id), and ingest stores `status='failed'` with the error | :447 (AC-92) | ambiguous on the `agent: null` branch (see R3) | S1, S5, S6, S19, S21 · **Q2** |
| R93 | Two PRs, in order: PR 1 `chore/agent-runner` from `main`, then PR 2 rebased on it | user: "**Two PRs, in order.**" | clear | `## Execution mode` (PR column on every step) |
| R94 | At most 5 implementer subagents in total | user: "**At most 5 implementer subagents in total** across both PRs" | clear | `## Execution mode` (I1–I3 + one fix = 4) |
| R95 | Implementers write no tests | user: "**Implementers write NO tests** in this workflow" | ambiguous for the ported upstream tests | **Q1** |
| R96 | Review chain is plan-verifier, then architecture-reviewer, then one test-writer; the fix loop is at most 2 subagents | user: "plan-verifier (first, completeness gate) → architecture-reviewer → one test-writer … Fix loop is capped at **max 2 subagents total**" | clear | `## Execution mode` |
| R97 | The `.it.test` lane, `e2e.sh`, `/pr-self-review` and the demo-fork walk are the user's | user: "Commands reserved for the user" | clear | `## Verification` |
| R98 | Lean v1; expensive ACs are flagged, not dropped | user: "Keep it simple — the user explicitly wants a lean v1." | clear | `## Recommendations` (cost flags) |

**Under-planning check:** 94 of 98 rows are `clear` and each names a step or execution section. Four (R3, R15, R92, R95) are ambiguous and blocked on Q1 and Q2. Each still has a default step.

## Scope
| Package | What changes | Why |
|---|---|---|
| `agent-runner/` (new, **PR 1**) | the whole package, ported from `0574487` | R1–R15, R79, R92 |
| root (**PR 1**) | `.gitignore` (remove lines 3-6), `AGENTS.md` (tech-stack, packages and Verify rows) | R1, R2 |
| `server/src/vendor/shared/` + `client/src/vendor/shared/` | **PR 1:** `CiResultArtifact` only. **PR 2:** the rest of the Export-to-CI section (`eval-ci.ts:266-376`) | R14, R16–R21 |
| `server/` (**PR 2**) | `db/schema/{ci,runs}.ts`, one generated migration `0025_*`, `vendor/shared/adapters.ts`, `adapters/github/octokit.ts`, `adapters/mocks.ts`, `modules/ci/**` (new), `modules/index.ts`, `package.json` (`yaml` devDep, Q4) | R22–R54, R78–R80, R82, R85–R89, R91, R92 |
| `client/` (**PR 2**) | contract mirror, `messages/en/ci.json`, `lib/hooks/ci.ts` + `index.ts`, `AgentEditor/{constants,AgentEditor}.tsx`, `CiTab/**`, `app/ci/**`, `vendor/ui/nav.ts` (1 entry), `components/app-shell/helpers.ts` (Q3), `src/test/evals-static.test.ts` (1 line, Q3) | R21, R55–R77, R81, R83, R84, R90 |
| `reviewer-core/`, `mcp/`, `e2e/` | none | spec :137, :548 |

## Constraints
| Constraint | Source (`path:line`) | How this plan honors it |
|---|---|---|
| C1. Never hand-edit a migration; schema changes go through `db:generate` + `db:migrate` | root `AGENTS.md` Do-not-touch | S13 generates. The latest migration is `0024_sad_morg.sql`, so expect exactly one `0025_*`. Run `pnpm db:generate < /dev/null` (avoids the TTY prompt, `server/INSIGHTS.md:231-238`). This change is add-only, so no prompt is expected; if one appears, stop |
| C2. Lockfiles change only through their own manager | root `AGENTS.md` | `agent-runner/package-lock.json` is created by `npm install`. `server/pnpm-lock.yaml` changes only via `pnpm add -D yaml` (Q4). `client/package.json` and the lockfile stay untouched (AC-90) |
| C3. `client/src/vendor/ui` is frozen except `nav.ts` for a new top-level page | root `AGENTS.md` | S33 adds one item, with no `gKey` and no `SHORTCUTS` row (as in the spec 0017 precedent, `nav.ts:26-29`) |
| C4. drizzle only in `modules/*/repository/**`; services import no SDK; no cross-module service/repo imports, even type-only | `server/.dependency-cruiser.cjs:34-44, :25-31, :88-97`; `server/INSIGHTS.md:473-479` | The ci module reads agents and skills through `container.agentsRepo.getById` and `container.skillsRepo.enabledForAgent` (`skill.repo.ts:249`). Writes go through its own `repository/*.repo.ts`. Octokit stays in `adapters/github/octokit.ts` |
| C5. Arch gates match filenames: orchestration outside `service.ts` escapes them | `server/INSIGHTS.md:547-553` | Upstream's `ingest.ts` is **folded into `service.ts`**. Pure code goes in `helpers.ts` and `workflow.ts` (both I/O-free) |
| C6. Drizzle 0.38 `numeric` is a string | `server/INSIGHTS.md:144-150`; `runs.ts:25-35` | `String(cost_usd)` on write and `Number()` on read, inside `ci-run.repo.ts` only |
| C7. GitHub run ids exceed int32 | external fact (GitHub run ids ≈1e10) | `actions_run_id` and `repository_id` use `bigint(..., { mode: 'number' })`. Upstream used `text` for the run id |
| C8. `text({enum})` adds no CHECK | `server/INSIGHTS.md:515-521` | Status, triggers and post_as are enforced by Zod only. No DB-level enum test |
| C9. New repo/port methods break cast stubs invisibly | `server/INSIGHTS.md:114-120` | S16 implements the new `GitHubClient` methods in `mocks.ts`. `grep -rn "GitHubClient" server/test reviewer-core/test` and widen any stub in the same edit |
| C10. Two contract copies have drifted; the client lacks `AgentManifest` | root `INSIGHTS.md:30-38`; spec :24 | The verbatim contract text below is pasted into both. The session diffs the two sections (wiring checklist item 7) |
| C11. Client code may only `import type` from `@devdigest/shared` | `client/INSIGHTS.md:83-89` | Every new client import is `import type`. `post_as`/trigger literals are mirrored in a local `constants.ts` |
| C12. Vendored `Modal` has `role="dialog"` but no heading and no Escape/focus handling | `client/INSIGHTS.md:120-126`; `vendor/ui/kit/Modal.tsx:26,53` | The wizard owns its Escape `keydown` and its focus restore (R71). The test-writer queries `getByRole("dialog")` |
| C13. Root `.gitignore:3-6` un-ignores `agent-runner/dist/` (upstream committed it) | `.gitignore:3-6` | S2 deletes lines 3-6, so `dist/` (line 2) applies. S10 checks that `git ls-files agent-runner/dist` is empty |
| C14. `check-agent-docs.sh` silently skips untracked packages | root `INSIGHTS.md:249-255` | S10 runs `git add -N agent-runner` before the check |
| C15. Parallel agents share a cwd; `git stash` stashes their work | root `INSIGHTS.md:76-83, :390-398` | Every brief says: use `(cd /abs/pkg && …)` subshells and never use `git stash`. I2 and I3 own disjoint trees (`server/**` vs `client/**`) |
| C16. An existing test asserts `messages/en/` has no new file | `client/src/test/evals-static.test.ts:86-106` | Adding `ci.json` breaks `pnpm test`. S27 adds `"ci.json"` to that list (Q3) |
| C17. The sidebar highlights `/ci-runs`, not `/ci` | `client/src/components/app-shell/helpers.ts:38` | S33 changes that line to `pathname === "/ci" \|\| pathname.startsWith("/ci/")` and gives the nav item key `"ci-runs"` (Q3) |
| C18. The runner build resolves aliases into sibling sources, whose deps must be installed | upstream retro (`0574487:docs/retros/2026-07-08-export-to-ci-run.md:260-262`); `0574487:agent-runner/tsconfig.json` paths | `agent-runner/AGENTS.md` documents the prerequisites: `reviewer-core` `npm ci` and `server` `pnpm install`, before `agent-runner` `npm ci && npm run build` |
| C19. `reviewer-core` untouched; the engine is consumed as source | spec :137, :548; `reviewer-core/AGENTS.md` | The runner calls `reviewPullRequest`, `toReviewPayload`, `countBlockers`, `gateTriggered` and `OpenRouterProvider` (`reviewer-core/src/index.ts:46-68`) unchanged |
| C20. `prompt.ts:268-269` appends `task` unwrapped | `reviewer-core/src/prompt.ts:268-269` | S5: `task = "Review PR #<n>"`. The title and head/base branch names are prepended to `prDescription`, which the engine wraps |
| C21. Diff boundary: no path under the multi-run service, the review route, the PR page, `multi_agent_runs` or `reviewer-core/` | spec :547-549 | Plan-verifier checks `git diff --name-only origin/main` |
| C22. `buildApp` reaps `running` agent_runs | `server/INSIGHTS.md:164-171` | Ingest only writes `done`/`failed`, never `running` |
| C23. `commit_sha` must be the PR head, because the workflow run's `head_sha` is the PR head for `pull_request` events (`github.sha` is the merge commit) | spec :282, :319 | Env `DEVDIGEST_COMMIT_SHA: ${{ github.event.pull_request.head.sha }}`, never `github.sha` |
| C24. `nav.ts` and `contracts/eval-ci.ts` are re-checked after each merge | spec :117-118, :641 | Rebase steps R-B1/R-B2 in `## Execution mode` |

## Cross-track contracts (paste verbatim into every brief)

**Shared names**

| Contract | Value |
|---|---|
| Workflow path | `.github/workflows/devdigest-review.yml` (id for `listWorkflowRuns`: `devdigest-review.yml`) |
| Runner entry | `.devdigest/runner/index.js`; run command exactly `node .devdigest/runner/index.js` |
| Result file / artifact | file `devdigest-result.json` (cwd = `GITHUB_WORKSPACE`); artifact name `devdigest-result` |
| Branch | `devdigest/ci` |
| Manifests / skills / memory | `.devdigest/agents/<slug>.yaml`, `.devdigest/skills/<skill-slug>.md`, `.devdigest/memory.jsonl` (0 bytes) |

**Runner env (workflow → runner)**

| Variable | Value |
|---|---|
| `OPENROUTER_API_KEY` | `${{ secrets.OPENROUTER_API_KEY }}` |
| `GITHUB_TOKEN` | `${{ secrets.GITHUB_TOKEN }}` |
| `GITHUB_REPOSITORY` | `${{ github.repository }}` |
| `PR_NUMBER` | `${{ github.event.pull_request.number }}` |
| `DEVDIGEST_COMMIT_SHA` | `${{ github.event.pull_request.head.sha }}` |
| `DEVDIGEST_REPOSITORY_ID` | `${{ github.repository_id }}` |
| `DEVDIGEST_POST_AS` | literal `github_review` \| `pr_comment` \| `none` |

The PR title, body and branch names are read by the runner from `GITHUB_EVENT_PATH` (the GHA default). They are never passed in `env:` and never put in `run:`.

**HTTP endpoints (client ↔ server)**

| Endpoint | Body | Response |
|---|---|---|
| `POST /agents/:id/export-ci` | `CiExportInput` | `CiExport` |
| `GET /agents/:id/ci/installations` | — | `CiInstallation[]` |
| `POST /agents/:id/ci/update` | — | `CiUpdateResult` |
| `POST /ci/refresh` | — | `CiRefreshResult` |
| `GET /ci/runs?agent_id=` | — | `CiRun[]` |

**PR 1 contract edit (both copies): replace `CiResultArtifact`:**
```ts
export const CiResultArtifact = z.object({
  status: z.enum(['ok', 'error']),
  error: z.string().max(500).nullish(),
  agent: z.string().nullable(),
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  blockers: z.number().int().nonnegative(),
  gate_triggered: z.boolean(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent_version: undefined as never, // (do NOT add — placeholder removed)
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
  commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  repository_id: z.number().int().positive(),
});
```
Delete the `agent_version` line. It is a note to the implementer, not a field.

**PR 2 contract edit (both copies; the rest of the CI section):**
```ts
export const CiTrigger = z.enum(['opened', 'synchronize', 'reopened']);
export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export const CiInstallationStatus = z.enum(['pr_open', 'active', 'error']);
export const CiRunVerdict = z.enum(['approve', 'request_changes']);
// CiTarget, CiFile, AgentManifest unchanged (client copy: ADD AgentManifest + AgentManifestInput verbatim)
export const CiExportInput = z.object({
  repo: z.string().min(1),
  target: CiTarget.default('gha'),
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize']),
  base: z.string().default('main'), // kept (no removals); ignored — default branch comes from GitHub
  workflow_override: z.string().optional(),
});
// CiRunStatus unchanged; CiRun MOVES ABOVE CiInstallation
export const CiRun = z.object({
  id: z.string(), agent_id: z.string().nullable(), agent_name: z.string().nullable(),
  ci_installation_id: z.string().nullable(), repo: z.string(), pr_number: z.number().int().nullable(),
  commit_sha: z.string(), actions_run_id: z.number().int(), job_url: z.string(),
  verdict: CiRunVerdict, status: CiRunStatus /* 'succeeded' | 'failed' for ingested rows */,
  error: z.string().nullable(), findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(), duration_ms: z.number().int().nullable(), ran_at: z.string(),
});
export const CiInstallation = z.object({
  id: z.string(), agent_id: z.string(), repo: z.string(), target_type: CiTarget, installed_at: z.string(),
  status: CiInstallationStatus, workflow_version: z.number().int().min(1),
  triggers: z.array(CiTrigger), post_as: CiPostAs, pr_url: z.string().nullable(), last_run: CiRun.nullable(),
});
export const CiExport = z.object({ installation: CiInstallation.nullable(), files: z.array(CiFile), pr_url: z.string().nullable() });
export const CiRefreshResult = z.object({ degraded: z.boolean(), message: z.string().nullable(), ingested: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });
export const CiUpdateResult = z.object({ results: z.array(z.object({ installation_id: z.string(), ok: z.boolean(), pr_url: z.string().nullable(), error: z.string().nullable() })) });
```
Each export also gets its `z.infer` type with the same name.

**DTO field mapping:**
- `CiRun.verdict = ci_gate_triggered ? 'request_changes' : 'approve'`.
- `CiRun.status = agent_runs.status === 'failed' ? 'failed' : 'succeeded'`. The UI renders a failed status in place of the verdict.

**`GitHubClient` additions** (`adapters.ts`, camelCase like the rest of the port):
- `getRepository(repo): Promise<{ id: number; defaultBranch: string }>`
- `listWorkflowRuns(repo, { workflowFile: string; status: 'completed'; perPage: number }): Promise<{ id: number; headSha: string; htmlUrl: string; updatedAt: string; prNumber: number | null }[]>`
- `downloadArtifact(repo, { runId: number; name: string }): Promise<Uint8Array | null>` returns `null` when the artifact is absent or expired.
- `CommitFilesPayload.resetToBase?: boolean`. When true, the parent is the `base` head even if `branch` exists, followed by a forced `updateRef`.

## Steps
"Port" means read with `git -C /home/komp/devdigest-ci show 0574487:<path>`. Copies are in `/tmp/claude-1000/-home-komp-dev-digest/049db276-d9fa-4505-bce1-80802a4d5548/scratchpad/upstream-ref/`. Implementers write no tests: every step's test is owned by `TW` (test-writer) or is untested per spec `## Test plan`.

**PR 1: implementer I1, worktree `/home/komp/devdigest-agent-runner` (branch `chore/agent-runner`, at `c70c0e4` = origin/main)**
1. **S1** Contract: replace `CiResultArtifact` per the block above in `server/src/vendor/shared/contracts/eval-ci.ts:365-376` and in the same section of `client/src/vendor/shared/contracts/eval-ci.ts`. Ring 2 · skill: `zod`, `typescript-expert` · test: TW-3 (contract rejects) · satisfies R12, R14, R79, R92.
2. **S2** Root `.gitignore`: delete lines 3-6 (the comment plus `!agent-runner/dist/` and `!agent-runner/dist/**`). Add `agent-runner/.gitignore` (port `0574487:agent-runner/.gitignore`: `node_modules/`, `dist/`, `*.log`) · satisfies R2.
3. **S3** Package scaffold. Port `agent-runner/package.json` with changes: npm, plus `openai` added to `dependencies` (reviewer-core's provider is bundled). Port `tsconfig.json` and `vitest.config.ts` as-is. Then `(cd /home/komp/devdigest-agent-runner/agent-runner && npm install)` creates `package-lock.json`. **Do not** port `pnpm-lock.yaml` · satisfies R1, R2.
4. **S4** Port `src/errors.ts`, `manifest.ts`, `skills.ts` and `diff.ts` as-is, and `src/github.ts` as-is (one diff fetch helper, review POST, comment POST). Port `src/context.ts` with changes: also read and validate `DEVDIGEST_COMMIT_SHA` (`/^[0-9a-f]{40}$/`) and `DEVDIGEST_REPOSITORY_ID` (positive int), and expose `headRef`/`baseRef` from the event payload. If either value is invalid, throw *before* the manifest load and write nothing, since no valid artifact is possible · skill: `typescript-expert`, `security` · satisfies R3, R5, R11, R12.
5. **S5** Port `src/run.ts` with these changes:
   - (a) `task: \`Review PR #${n}\``. The PR title and the head/base branch names go into `prDescription` as `Title: …\nBranches: <head> → <base>\n\n<body>`.
   - (b) The catch path calls `buildErrorArtifacts` (S6) and writes them, still exits 1, and posts nothing. This reverses upstream's "no artifact".
   - (c) Every entry carries `blockers` and `gate_triggered` from `countBlockers`/`gateTriggered`.
   - (d) Manifest validation failures (AC-3) still exit before any write (Q2 default).
   - Keep "compute all, then write, then post". Satisfies R4, R6–R12, R79, R92.
6. **S6** Port `src/artifact.ts` with changes. `buildResultArtifact` adds `status:'ok'`, `error:null`, `blockers`, `gate_triggered`, `commit_sha` and `repository_id`. A new `buildErrorArtifacts(agents: string[] | null, message, env)` yields one entry per manifest name, or one `agent:null` entry (Q2). It sets zero counts, `blockers:0`, `gate_triggered:false`, `cost_usd:null`, and `error` = message with every non-empty value of `OPENROUTER_API_KEY` and `GITHUB_TOKEN` replaced by `***`, then truncated to 500 characters. Every entry passes through `CiResultArtifact.parse` · satisfies R12, R13, R92.
7. **S7** Port `src/index.ts` with changes: log only the error message after the same redaction, never `env`. `DEVDIGEST_RESULT_PATH` defaults to `devdigest-result.json` in the cwd · satisfies R9, R13.
8. **S8** (Q1 default) Port `src/diff.test.ts`, `src/manifest.test.ts` and `src/run.test.ts` as-is, adapting only fixture env/fields and the four assertions the spec changed: the Q5 test now expects the error artifact; the artifact field set; the `task` line; and the env fixture gaining `DEVDIGEST_COMMIT_SHA`/`DEVDIGEST_REPOSITORY_ID`. **No new test cases.** · satisfies R15.
9. **S9** Docs:
   - `agent-runner/AGENTS.md`: port upstream `agent-runner/CLAUDE.md` content (not the shim), restructured as commands, boundaries, the install prerequisites from C18, and "dist/ is never committed".
   - `agent-runner/CLAUDE.md`: copy `reviewer-core/CLAUDE.md`'s 3-line shim.
   - `agent-runner/INSIGHTS.md`: port `0574487:agent-runner/insights/INSIGHTS.md`, moved to the package root.
   - `agent-runner/README.md`: port.
   - Root `AGENTS.md`: add a Tech-stack row, a Packages row (`agent-runner/`, npm, no port) and a Verify row (`npm run typecheck` · lint: none in v1 · `npm test` · build: `npm run build`).
   - Satisfies R1.
10. **S10** Run the build and checks: `npm run build`; then `git -C /home/komp/devdigest-agent-runner add -N agent-runner && bash scripts/check-agent-docs.sh`; then confirm `git ls-files agent-runner/dist` prints nothing · satisfies R1, R2.

**Session, between waves (not an agent).**
- **R-B1.** Commit PR 1 on `chore/agent-runner`.
- In `/home/komp/devdigest-ci`, commit `specs/0022-export-to-ci.md`, `specs/0022-export-to-ci.plan.md` and the `specs/README.md` row. The branch has 0 commits of its own: HEAD `14d0486`, whose tree `ec3af73` is identical to `c70c0e4`'s.
- Then run `git -C /home/komp/devdigest-ci rebase --onto chore/agent-runner 14d0486 feat/export-to-ci`. That replays only the spec commit, and the untracked `design/export-to-ci/` is left alone.

**PR 2 server: implementer I2, worktree `/home/komp/devdigest-ci`, owns `server/**` only**

11. **S11** Server contract: the PR 2 block above, in `server/src/vendor/shared/contracts/eval-ci.ts:266-376`. Ring 2 · `zod`, `typescript-expert` · satisfies R16–R20.
12. **S12** Schema, port with changes from `0574487:server/src/db/schema/{ci,runs}.ts`.
    - `ciInstallations` gains:
      - `status` text enum, NOT NULL, default `'pr_open'`;
      - `workflowVersion` integer, NOT NULL, default 1;
      - `triggers` jsonb `string[]`, NOT NULL;
      - `postAs` text enum, NOT NULL, default `'github_review'`;
      - `repositoryId` bigint `{mode:'number'}`, NOT NULL;
      - `prUrl` text;
      - `updatedAt` timestamptz, NOT NULL, defaultNow;
      - a `unique('ci_installations_agent_repo_uq').on(agentId, repo)`.
    - `agentRuns` gains nullable columns:
      - `ciInstallationId` uuid, FK to `ciInstallations`, set null;
      - `repo` text;
      - `externalPrNumber` int;
      - `commitSha` text;
      - `actionsRunId` bigint `{mode:'number'}`;
      - `jobUrl` text;
      - `ciGateTriggered` boolean;
      - `uniqueIndex('agent_runs_ci_installation_actions_run_uq').on(ciInstallationId, actionsRunId)`.
    - Update the header comment of `ci.ts:1-13`: `ci_installations` is now wired, and `ci_runs` stays unused.
    - Ring 4 · `drizzle-orm-patterns`, `postgresql-table-design` · satisfies R22.
13. **S13** `(cd /home/komp/devdigest-ci/server && pnpm db:generate < /dev/null)`. Read the new `0025_*.sql`: it must be add-only and must touch only those two tables. Then run `pnpm db:migrate` · satisfies R22, R52.
14. **S14** Port: add the four `GitHubClient` items from the contract to `server/src/vendor/shared/adapters.ts:146-181`. This is port-shape only; upstream's `ListWorkflowRunsOptions`/`ArtifactRef` are a reference, not copied. Ring 2 · satisfies R39, R47, R87, R88.
15. **S15** `server/src/adapters/github/octokit.ts`:
    - `getRepository` uses `repos.get`.
    - `listWorkflowRuns` uses `actions.listWorkflowRuns({workflow_id, status:'completed', per_page})` and maps `pull_requests[0]?.number`.
    - `downloadArtifact` uses `actions.listWorkflowRunArtifacts({run_id, name})`, picks the first non-`expired`, then `actions.downloadArtifact({archive_format:'zip'})` to a `Uint8Array`. A 404/410 or absence returns `null`.
    - `commitFiles` honours `resetToBase`.
    - All wrapped in the existing `withRetry`/`withTimeout`. Port reference: the `0574487` octokit diff.
    - Ring 4 · `onion-architecture`, `security` · satisfies R39, R47, R87, R88.
16. **S16** `server/src/adapters/mocks.ts`: implement the three methods (deterministic fakes) and honour `resetToBase`. Grep `server/test` and `reviewer-core/test` for `GitHubClient` stubs and widen them (C9) · satisfies R47.
17. **S17** `server/src/modules/ci/constants.ts`, port with changes:
    - Drop the non-GHA paths.
    - `FORK_GATE_CONDITION = "github.event.pull_request.head.repo.full_name == github.repository"`.
    - `PR_BASE_SHA_EXPR = '${{ github.event.pull_request.base.sha }}'`.
    - Add `REPOSITORY_ID_EXPR`, `PIN = { checkout: 'actions/checkout@<40hex>', setupNode: 'actions/setup-node@<40hex>', uploadArtifact: 'actions/upload-artifact@<40hex>' }` with the v4 tag in a comment.
    - Env-name constants exactly per the contract table.
    - `DEFAULT_PULL_REQUEST_EVENTS = ['opened','synchronize']`.
    - `FORBIDDEN_TRIGGER_EVENTS` adds `pull_request_target` and `workflow_run`.
    - `MAX_RUNS_PER_REFRESH = 30`, `MAX_CI_RUNS_LISTED = 100`, `CI_BRANCH = 'devdigest/ci'`, `DEFAULT_RUNNER_DIST_DIR` via `new URL('../../../../agent-runner/dist/', import.meta.url)`.
    - Resolve the SHAs with `gh api repos/actions/checkout/commits/v4 --jq .sha`, and the same for the other two (see `## Not found`).
    - Satisfies R30–R37, R88, R89.
18. **S18** `server/src/modules/ci/workflow.ts`, port GHA only with changes. It stays pure, with no I/O.
    - Checkout step: `uses: <PIN.checkout>` with `with: { ref: <base sha expr> }`.
    - Guard step:

      ```yaml
      id: guard
      shell: bash
      run: |
        if [ -f .devdigest/runner/index.js ]; then echo "present=true" >> "$GITHUB_OUTPUT"; else echo "::notice::DevDigest is not installed on the base branch yet; skipping review"; echo "present=false" >> "$GITHUB_OUTPUT"; fi
      ```

    - Setup-node and the review step get `if: steps.guard.outputs.present == 'true'`.
    - Review `env` per the contract.
    - Upload step: `if: always() && steps.guard.outputs.present == 'true'`.
    - Export `buildGhaWorkflowYaml({triggers, postAs})`.
    - Ring 1 (pure) · satisfies R30–R38, R78, R91.
19. **S19** `server/src/modules/ci/helpers.ts`, pure, porting `slug.ts` + `manifest.ts` as-is (they are dependency-free) plus new code:
    - `buildCiFileSet(agent, skills, runnerFiles, opts)`: workflow `editable:true`, everything else `false`.
    - `classifyArtifactEntry(entry, run, installation)`, returning `'sha_mismatch' | 'repo_mismatch' | 'other_agent' | 'ok'`.
    - `toAgentRunInsert(entry, run, installation, workspaceId)`, with `status: entry.status==='ok'?'done':'failed'`.
    - `toCiRunDto` and `toCiInstallationDto`.
    - Ring 1 · satisfies R24–R27, R48, R49, R51, R80, R92.
20. **S20** Two new repositories; upstream `repository.ts` is reference only.
    - `server/src/modules/ci/repository/ci-installation.repo.ts`:
      - `listByAgent` and `listGhaByWorkspace` (joined to `agents.workspaceId`);
      - `getByAgentRepo`;
      - `upsertOnExport`, a single `insert … onConflictDoUpdate` on (agent_id, repo) with `workflowVersion = ci_installations.workflow_version + 1` and `status='pr_open'`;
      - `setStatus`.
    - `.../repository/ci-run.repo.ts`:
      - `insertIfAbsent` (`onConflictDoNothing` on the unique index, returning whether a row was inserted; `String(cost)`);
      - `listCiRuns(workspaceId, agentId?)` (`source='ci'`, `ran_at desc`, `limit 100`, left join agents for the name; `Number(cost)`);
      - `newestByInstallation(ids)`.
    - Ring 4 · `drizzle-orm-patterns` · satisfies R42, R46, R51, R52, R54, R85, R86, R89.
21. **S21** `server/src/modules/ci/service.ts`, new, using upstream `service.ts` and `ingest.ts` as reference. Contents:
    - exported `readRunnerBundle(distDir)`: recursive read of every file as utf-8; a missing `index.js` throws `new AppError('runner_bundle_missing', 'Runner bundle not built — run: cd agent-runner && npm run build', 500)`.
    - `CiService(container, opts?: { runnerDistDir?; installations?; runs? })` (injectable for TW-4).
    - `exportCi`:
      - target ≠ `gha` gives `ValidationError`; repo not `^[\w.-]+/[\w.-]+$` gives `ValidationError`;
      - read the agent and skills, then read the bundle **before any GitHub call**;
      - `files` returns `{installation:null, …}`;
      - `open_pr` runs `getRepository`, then `findOpenPr`, then `commitFiles({branch:'devdigest/ci', base: defaultBranch, resetToBase: !open})`, then `openPullRequest` if not open, then `upsertOnExport`;
      - on a GitHub error: `setStatus(existing,'error')` if the row exists, then throw `ExternalServiceError(err.message)`.
    - `updateAll`: sequential, per-installation try/catch, regenerated with no override.
    - `listInstallations`: with `last_run`.
    - `refresh`:
      - per installation, `listWorkflowRuns` (30); a throw gives `degraded` plus a message and moves on;
      - per run: `downloadArtifact`, then `container.archiveReader.read(bytes,'devdigest-result.json', 1_000_000)`, then `JSON.parse`, then `CiResultArtifact.array().safeParse`; any failure counts as skipped;
      - per entry: `classifyArtifactEntry` (`other_agent` is ignored, not counted), then `insertIfAbsent`, then `setStatus('active')`.
    - `listRuns`.
    - `node:fs` in a service is precedented (`modules/conventions/service.ts`).
    - Ring 3 · `onion-architecture` · satisfies R23, R28, R29, R39–R45, R47–R53, R82, R85–R88.
22. **S22** `server/src/modules/ci/routes.ts`, transport only, ported from upstream `routes.ts` with the new endpoint list. Register `ci` in `server/src/modules/index.ts`. Use `getContext` for `workspaceId` and `IdParams` for `:id` · `fastify-best-practices` · satisfies R23, R29, R44, R46, R47, R54.
23. **S23** (Q4) `(cd /home/komp/devdigest-ci/server && pnpm add -D yaml)`, so the test-writer can parse YAML. No runtime use · satisfies TW-2/TW-3 enablement.

**PR 2 client: implementer I3, same worktree, owns `client/**` only (runs no server command)**

24. **S25** Client contract: paste the PR 2 block into `client/src/vendor/shared/contracts/eval-ci.ts`, adding `AgentManifest`/`AgentManifestInput` verbatim. If `Provider`/`CiFailOn` are not in scope there, import them as the server copy does · `zod` · satisfies R16–R21.
25. **S26** New `client/messages/en/ci.json` (namespace `ci`, camelCase keys). Port `0574487:client/messages/en/ci.json` with changes: drop the CircleCI/Jenkins/CLI copy and the "not set/ready" badges; add the AC-67 note, the AC-81 notice, the AC-82 discard text and the empty states · satisfies R77.
26. **S27** (Q3) `client/src/test/evals-static.test.ts:90-103`: add `"ci.json"` to the expected list. This is the only edit to a test file, and it is forced by C16 · satisfies R77.
27. **S28** `client/src/lib/hooks/ci.ts`, new, merging upstream `ci.ts` and `ci-runs.ts`: `useCiInstallations(agentId)`, `useCiRuns(agentId?)`, `useExportCi(agentId)`, `useUpdateCi(agentId)`, `useRefreshCi()` (which invalidates `ci-runs` on success). Use the exact contract paths and `import type` only. Add `export * from "./ci"` to `hooks/index.ts` · satisfies R59, R60, R68, R73.
28. **S29** `AgentEditor/constants.ts`: add `{ key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" }` to `TABS`. If `Workflow` is not an `IconName`, use one that is. Render `<CiTab agent={agent} />` for `tab === "ci"` in `AgentEditor.tsx`. `VALID_TABS` derives automatically (`constants.ts:22`) · satisfies R55.
29. **S30** `AgentEditor/_components/CiTab/{CiTab.tsx,helpers.ts,styles.ts,constants.ts,index.ts}`, port with changes from upstream `CiTab.tsx`:
    - installation rows (R56) and empty state (R57);
    - the "Fail CI on" select via `useUpdateAgent` (R58);
    - the run-history table (R59);
    - "Update CI config", disabled without a gha installation, rendering per-entry outcomes and the discard text (R60, R82);
    - "Add repository" row and "Add to CI" both open the same `ExportWizard`, with focus returning to the opener (R84, R71).
    - Satisfies R56–R60, R82, R84.
30. **S31** `CiTab/_components/ExportWizard/{ExportWizard.tsx,helpers.ts,constants.ts,types.ts,styles.ts,index.ts,zip.ts}` and `ExportWizard/_components/{TargetStep,PreviewStep,ConfigureStep,InstallStep}/<Name>.tsx`. Port with changes from upstream `CiTab/ExportWizard/**`; it is moved under `_components/` per the naming rule. `zip.ts` is ported **as-is** (it has no imports).
    - Target: only GitHub Actions, plus a repo `<input list>` + `<datalist>` from `useRepos()`, prefilled from `useActiveRepo()`; Continue is disabled unless `/^[\w.-]+\/[\w.-]+$/` matches.
    - Preview: `action:'files'` request; only the workflow file is an editable textarea, tracked by an `edited` flag.
    - Configure: toggles default to opened and synchronize on; post-as defaults to `github_review`. When `!edited`, a change re-issues `files`; otherwise the notice is shown. Includes the secrets instructions panel and the branch-protection note.
    - Install: one `open_pr` request carrying `workflow_override` when edited; confirm is disabled while pending; the `pr_url` link or `error.message` is shown; the zip download uses the current file set with the edited workflow.
    - The wizard owns its Escape handler and focus restore.
    - Satisfies R61–R71, R81, R83, R90.
31. **S32** `client/src/app/ci/page.tsx` + `app/ci/_components/CiRunsView/{CiRunsView.tsx,helpers.ts,styles.ts,index.ts}`, port with changes from upstream `app/ci/**`:
    - columns per R72, with `target="_blank" rel="noopener noreferrer"`;
    - cost via `Number` (null renders the placeholder, never 0);
    - status `failed` renders "Failed" in place of the verdict;
    - Refresh is disabled while pending, then refetches;
    - a degraded banner;
    - an empty state.
    - Satisfies R72–R75.
32. **S33** `client/src/vendor/ui/nav.ts`: one item `{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci" }` in a new `AUTOMATION` section, with no `gKey`. (Q3) In `components/app-shell/helpers.ts:38`, change the match to `/ci` · satisfies R76.

**Validation and the single test-writer (TW): see `## Execution mode`.**

| Test | File | Covers |
|---|---|---|
| TW-1 | added in `/home/komp/devdigest-agent-runner/agent-runner/src/run.test.ts` (PR 1) | AC-5 three-path fixture, AC-7, AC-11 counts, AC-12 two-element array, AC-13 (success and failure), AC-79, AC-92 runner half |
| TW-2 | `server/test/ci-workflow.test.ts` | AC-30–38, AC-78, AC-91, with the negative-fixture checker |
| TW-3 | `server/test/ci-manifest.test.ts` | AC-14, AC-23–29 (temp `dist/` via `readRunnerBundle`), AC-79 contract |
| TW-4 | `server/test/ci-ingest.test.ts` | unit, fake `GitHubClient` plus repo stubs via `CiService` opts: AC-48–51, AC-80, AC-92 ingest half |
| TW-5 | `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/ExportWizard.test.tsx` | AC-61–66, AC-81, AC-83 |

## Skills for the implementer
| Path (glob) | Skills | What they will require here |
|---|---|---|
| `agent-runner/src/**` | security, typescript-expert (`**/*.{ts,tsx}` route) | no secret in logs; strict types; Zod at the artifact boundary |
| `{server,client}/src/vendor/shared/**` | zod, typescript-expert | schema and `z.infer` type share one name; `.nullish()` vs `.nullable()` exactly as in the block |
| `server/src/modules/ci/**`, `adapters/**` | onion-architecture (+ typescript-expert) | rings per C4/C5; no SDK in service |
| `server/src/modules/ci/routes.ts` | fastify-best-practices | Zod type-provider schemas; transport only |
| `server/src/db/**`, `modules/ci/repository/**` | drizzle-orm-patterns | upserts and conflict handling in one statement |
| `server/src/db/schema/**` | postgresql-table-design | bigint ids, unique key, FK `on delete set null` |
| `client/src/**/*.{ts,tsx}` | react-best-practices, react-code-organization, next-best-practices | `_components/<Pascal>` layout; `"use client"`; no value import from shared |
| `client/**/*.test.tsx` (TW only) | react-testing-library | `getByRole("dialog")`, not heading |
| `server/test/**`, `agent-runner/**/*.test.ts` (TW only) | typescript-expert | — |

Source: `.claude/skills/pr-self-review/skill-map.json`.

## Verification
| Package | Command | What counts as pass |
|---|---|---|
| agent-runner (I1, session) | `(cd /home/komp/devdigest-agent-runner/reviewer-core && npm ci) && (cd /home/komp/devdigest-agent-runner/server && pnpm install --frozen-lockfile) && (cd /home/komp/devdigest-agent-runner/agent-runner && npm ci && npm run typecheck && npm test && npm run build)` | exit 0; `dist/index.js` exists; `git -C /home/komp/devdigest-agent-runner ls-files agent-runner/dist` is empty |
| PR 1 docs | `git -C /home/komp/devdigest-agent-runner add -N agent-runner && (cd /home/komp/devdigest-agent-runner && bash scripts/check-agent-docs.sh)` | `agent-runner` listed `ok` (not merely "All paired") |
| server, both PRs (shared contract touched in PR 1) | `(cd <worktree>/server && pnpm typecheck && pnpm lint && pnpm exec vitest run --exclude '**/*.it.test.ts')` | exit 0; lint includes `pnpm arch`, 0 errors |
| client, both PRs | `(cd <worktree>/client && pnpm typecheck && pnpm lint && pnpm test)` | exit 0 |
| specs | `(cd /home/komp/devdigest-ci && bash scripts/check-specs.sh)` | exit 0 |
| PR 2 runner bundle, for the manual walk | `(cd /home/komp/devdigest-ci/agent-runner && npm ci && npm run build)` | `dist/index.js` exists |
| **User:** integration lane | `cd server && pnpm exec vitest run .it.test` | 0 failed **and 0 skipped**; any FAIL in an untouched file is not a pass (`server/INSIGHTS.md` green-run rule). The migration is unverified until it runs |
| **User:** e2e | `./scripts/e2e.sh` | required: nav, a new page and the agent tabs changed |
| **User:** gate | `/pr-self-review`, per PR, before each push | no CRITICAL |
| **User:** manual | spec :622 walk, steps 1–9, on a demo fork (name to be supplied) | the studio GitHub token needs the `workflow` scope or the Workflows permission, plus Actions read |

## Recommendations
| ID | Proposal | Why (`path:line`) | Cost if adopted | If declined |
|---|---|---|---|---|
| P1 | Add `with: persist-credentials: false` to the generated checkout | the job never pushes; this narrows token exposure (spec Non-functional :508) | one line in S18; TW-2 unchanged | the token remains in `.git/config` for the job's lifetime |
| P2 | `.github/workflows/agent-runner.yml` (npm ci, typecheck, test, build), path-filtered on `agent-runner/**`, `reviewer-core/**`, `server/src/vendor/shared/**` | the spec does not ask for it (:120-123); runner breakage from engine changes would otherwise be silent | 1 file in PR 1; the push needs the `workflow` token scope (root `INSIGHTS.md:63-68`) | the runner is only tested locally |
| P3 | A re-export PR on a repo that already has the runner fetches a diff containing the new multi-MB bundle *before* stripping, so GitHub may return 422 and the re-export PR's check goes red | upstream comment at `run.ts:112-116` assumes stripping prevents the 422, but stripping happens after the fetch | runner `github.ts` would switch to `pulls/{n}/files`, plus tests: v2 | re-export PRs may show a red check; merging still works |

**Cost flags (no AC dropped):**
- **AC-81:** each Configure toggle re-POSTs `files`, which carries the full bundle.
- **AC-83:** a combobox with free text; cheapest as `<input list>`.
- **AC-92:** both halves are needed, plus a contract change in PR 1.
- **AC-71:** custom Escape handling and focus restore, because the vendored `Modal` has neither.
- **AC-87:** a new adapter option.
- **AC-44, AC-45, AC-60, AC-82:** the whole Update CI config path is untested and costs about 15% of the server and client work.

## Clarification needed
**Blocked:** R3, R15, R92, R95

1. Should I1 port upstream's three runner test files (adapting only the fields and the four assertions the spec changed, with no new cases) and leave only the new cases to TW-1? Spec :113 says "Implementers write none" and the test-writer "covers … the ported runner tests". (R15, R95) — *default:* yes, I1 ports them as package files · *cost of the other choice:* PR 1 has no test signal until the final test-writer pass, and port bugs surface only then.
2. AC-3 says an invalid manifest exits before *any* artifact write. AC-92 asks for an `agent: null` entry "when no manifest loaded". Which wins? (R3, R92) — *default:* AC-3 wins for invalid manifests (no artifact). The `agent:null` error entry is written only when `.devdigest/agents/` holds zero manifests, which exits 1. Ingest never matches a null agent, so such a run is not listed · *cost of the other choice:* AC-3's "no write" test inverts, and a broken manifest becomes visible on `/ci`.
3. Two one-line edits fall outside the spec's "may change" list (:128-134) but are forced. (a) `client/src/test/evals-static.test.ts:90-103` must list `ci.json`, or `pnpm test` fails. (b) `components/app-shell/helpers.ts:38` maps `/ci-runs`, not `/ci`, so the nav entry never highlights. (R77, R76) — *default:* I3 makes both · *cost of the other choice:* (a) a red client suite, or (b) a nav item that never shows as active.
4. Should `yaml` be added as a **server devDependency** so TW can parse the workflow (the test plan :605 forbids regex), changing `server/pnpm-lock.yaml` via pnpm? (R30–R38) — *default:* yes, `pnpm add -D yaml` in S23 · *cost of the other choice:* TW must hand-write a YAML parser or fall back to text checks, contrary to the test plan.

**If you just say "go with the defaults":** I re-issue this plan unchanged, with R3, R15, R92 and R95 marked `clear`.

## Out of scope
| Not in this plan | Why | Who owns it |
|---|---|---|
| CI workflow for `agent-runner/` | not required by spec :120-123 | P2, if accepted |
| `ci_runs` table, non-GHA generators, push endpoint | Non-goals :63-74 | — |
| multi-run service, `POST /pulls/:id/review`, PR page, `multi_agent_runs`, `reviewer-core/` | spec :136-137 | spec 0021 / worktree A |
| `/code-review`, security review, `/pr-self-review` | separate tools; the last is manual-only | user |
| `docs/` write-up | Completion phase | `doc-writer`, after the reviewers are clean |

## Not found
| Looked for | How (verbatim command) | Conclusion | What would settle it |
|---|---|---|---|
| Pinned 40-hex SHAs for checkout, setup-node and upload-artifact v4 | `grep -rhn 'uses:' .github/workflows/` | the repo pins none (all `@v4`) | I2 runs `gh api repos/actions/<name>/commits/v4 --jq .sha`; if offline, the user supplies them |
| Whether the client `eval-ci.ts` has `Provider`/`CiFailOn` in scope | not opened | unknown | I3 reads the file in S25 |
| ncc output file list (only `index.js`, or chunks too) | not built | unknown; S21 ships the whole directory either way | S10 build output |
| Whether GHA ignores a `GITHUB_REPOSITORY` override in `env:` | external | GitHub documents default `GITHUB_*` assignments as ignored; the value is identical, so it is harmless | GitHub docs / manual walk |
| CI rows leaking into other `agent_runs` aggregates | `grep -rn "from(agentRuns)…" server/src` | read sites filter by `prId` or join via `run_skills`/`reviews` (`run.repo.ts:36`, `skill.repo.ts:293-364`); I did not open `pull.repo.ts:260` in full | plan-verifier reads `pull.repo.ts:255-275` |
| Error code for a non-enum `target` (e.g. `"foo"`) at Zod body validation | not opened (app error handler) | assumed 422 `validation_error` | I2 reads `server/src/app.ts` error handler |
| `IconName` includes `Workflow` | not opened | upstream used it in `nav.ts` | I3's typecheck |

## Execution mode
**Recommendation:** multi-agent. Three packages are involved. PR 1 must exist before PR 2 starts (contract plus rebase), so the work splits into one sequential runner wave followed by two disjoint tracks, server and client, run in parallel.

**Multi-agent decomposition** (base ref for every reviewer: `origin/main`, never `HEAD`)

| Wave | Agent | Steps | Runs in parallel with | Handoff artifact |
|---|---|---|---|---|
| W1 | I1 implementer (runner) in `/home/komp/devdigest-agent-runner` | S1–S10 | nothing | uncommitted PR 1 tree. **Session:** commit, then R-B1 rebase of PR 2 |
| W2a | I2 implementer (server) in `/home/komp/devdigest-ci` | S11–S16, S17–S23 | W2b | `server/**` changes |
| W2b | I3 implementer (client) in `/home/komp/devdigest-ci` | S24–S32 | W2a: disjoint trees `server/**` vs `client/**`, and each runs only its own package suite | `client/**` changes |
| — | **Session: integration-wiring checklist** (grep plus Read, no agent) | items 1–12 below | — | pass, or a list fed to the fix pass |
| W3 | plan-verifier | all of S1–S32 against `origin/main` in `/home/komp/devdigest-ci` (the PR 2 branch contains PR 1) | — | Met/Missing/Contradicted |
| W4 | architecture-reviewer | same diff | — | layering report |
| F1 | **one** implementer fix pass (if W3/W4 found anything) | only the listed items | — | — |
| F2 | plan-verifier delta (only if F1 ran) | F1's items | — | — |
| W5 | **one** test-writer | TW-1 into the PR 1 worktree; TW-2–TW-5 into the PR 2 worktree | — | test files. **Session:** commit TW-1 on `chore/agent-runner`, then rebase PR 2 again (`rebase --onto chore/agent-runner <old PR1 tip>`) |

**Order and the cap.** W5 follows W4 as the user ordered, so tests are written against code that F1 has already fixed. F1 + F2 are the 2-subagent fix cap.

**Escalation.** If F2 still reports Missing or Contradicted items, or if W5's tests expose a product bug, nothing else runs. The session stops and hands the user a list of each remaining item with its AC.

**Implementer count.** I1, I2, I3 and F1 make 4, within the limit of 5. The 5th is held in reserve and is used only with the user's say-so.

**Integration-wiring checklist** (the session runs it after W2; every item names both ends):
1. All seven env names appear in both `server/src/modules/ci/{constants,workflow}.ts` and `agent-runner/src/{context,index}.ts`.
2. `devdigest-result` appears in the workflow upload **and** the service's `downloadArtifact`. `devdigest-result.json` appears in the upload `path`, in the runner's default `DEVDIGEST_RESULT_PATH`, **and** in the service's `archiveReader.read` path.
3. `.devdigest/runner/index.js` appears in the guard, in `run:`, and in the service's `dist/` → `.devdigest/runner/` mapping. The mapping covers **every** file in `dist/`, not only `index.js` (an upstream fix-loop item).
4. `post_as` flows wizard body → route → `CiService` → `buildGhaWorkflowYaml` → `DEVDIGEST_POST_AS` (an upstream fix-loop item).
5. `workflow_override` reaches **both** the `open_pr` body and the zip (an upstream fix-loop item).
6. `ci` is in `TABS`, `AgentEditor` renders `CiTab`, and `/agents/:id?tab=ci` does not snap back (an upstream fix-loop item).
7. The client hook URLs equal the five route paths. The CI sections of the two contract copies are identical apart from the client-side additions (`AgentManifest`).
8. `GitHubClient` additions are implemented in `octokit.ts` **and** `mocks.ts`, and no test stub is left short.
9. `nav.ts` key `"ci-runs"` matches the return value of `activeKeyFor("/ci")`.
10. `ci.json` is in the `evals-static` list.
11. Exactly one new migration `0025_*`, and `git diff --name-only origin/main -- server/src/db/migrations` lists only it, `meta/_journal.json` and its snapshot.
12. `git diff --name-only origin/main -- client/package.json client/pnpm-lock.yaml reviewer-core` prints nothing.

**Brief contents per implementer** (the session composes these; each brief carries the whole `## Cross-track contracts` section verbatim):
- the worktree path;
- the owned paths (exclusive) and the forbidden paths (the other track's tree, `reviewer-core/`, migrations except the generated one, lockfiles except via the manager);
- its steps;
- the upstream file for each port;
- the routed INSIGHTS lines from `## Constraints`;
- "write no tests, never `git stash`, use `(cd /abs && …)` subshells, do not run `.it.test`";
- its package's Verification rows as the definition of done.

**Merge sequence:**
1. PR 1 merges first.
2. Then `feat/multi-agent-review`.
3. Then rebase PR 2 with `git -C /home/komp/devdigest-ci fetch origin && git -C /home/komp/devdigest-ci rebase --onto origin/main chore/agent-runner feat/export-to-ci`. The `--onto` form drops the PR 1 commits if PR 1 was squash-merged; a plain rebase would replay them and conflict.
4. Re-check `client/src/vendor/ui/nav.ts` and `contracts/eval-ci.ts` after each merge, and report them even when clean (spec :641).

**Single-agent decomposition**
1. S1–S10 in the PR 1 worktree, with skills security and typescript-expert loaded.
2. Commit and run R-B1.
3. S11–S23, loading onion-architecture, drizzle-orm-patterns, postgresql-table-design, fastify-best-practices and zod before S11, S12, S20 and S22 respectively.
4. S24–S32, loading the react/next skills.
5. The wiring checklist.
6. TW-1–TW-5 from a fresh context.

This is one context holding three packages and about nine skills, roughly 76k of mandatory reading before any code (root `INSIGHTS.md:291-298`).

**Cost of the mode I recommend:**
- About 8 subagent runs: I1, I2, I3, plan-verifier, architecture-reviewer, F1, F2 and the test-writer.
- About 1.1–1.4M tokens:

  | Run | Estimate |
  |---|---|
  | I1 | ~120k |
  | I2 | ~250–300k |
  | I3 | ~250–300k |
  | plan-verifier | ~120k |
  | architecture-reviewer | ~100k |
  | F1 | ~80–120k |
  | F2 | ~50k |
  | test-writer | ~180–220k |

- Each implementer reloads 40–52k of mandatory reading.
- W1 serialises before W2, which costs wall-clock but avoids a contract conflict across worktrees.

**This is a recommendation, not a choice.** The main session must put it to the user with `AskUserQuestion` before implementation starts.

## User decisions on this plan (2026-10-15)
- Clarifications 1–4: **defaults accepted**. R3, R15, R92, R95 are `clear`: I1 ports the three upstream runner test files (adapting only spec-changed fields/assertions, no new cases); AC-3 wins for invalid manifests, the `agent:null` error entry only when zero manifests exist; I3 makes the two forced one-line edits (`evals-static.test.ts` list, `app-shell/helpers.ts` `/ci` match); I2 runs `pnpm add -D yaml` (S23).
- Proposals: **P2 accepted** — PR 1 adds `.github/workflows/agent-runner.yml` (npm ci, typecheck, test, build; path filter `agent-runner/**`, `reviewer-core/**`, `server/src/vendor/shared/**`; actions pinned to full SHAs). **P1 declined. P3 declined** (v2).
- Execution mode: **multi-agent chain** as in `## Execution mode`.
- **W1 takeover (2026-10-15):** `/home/komp/devdigest-agent-runner` (branch `chore/agent-runner`, base `origin/main` c70c0e4) was pre-staged by the spec-0021 session with the upstream `0574487` runner, the doc-layout conversion, the root `.gitignore`/`AGENTS.md` rows and `.github/workflows/agent-runner.yml` — all on pnpm. That session handed it over (its user agreed). I1 therefore does: npm switch (S3), S1, S4–S8, and the npm flip of root `AGENTS.md` rows and the P2 workflow; S2/S9 are mostly done and only need checking.
- **Migration numbering:** spec 0021 adds `agent_runs.multi_run_id` as `0025`. This feature's migration is generated **after rebasing onto feat/multi-agent-review**, so expect `0026_*` (wiring check 11 reads "exactly one new migration after 0021's").
- **nav.ts:** 0021 adds a "Multi-Agent Review" item in a new GLOBAL section and merges first; S33 rebases onto it.
