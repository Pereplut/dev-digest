---
title: Export to CI — run a tuned agent on every pull request in GitHub Actions
status: approved
packages: [agent-runner, server, client]
---

## Problem & why

A review agent tuned in the studio runs only on one machine, on demand. It becomes useful to a team
when it runs on every pull request in the team's own CI and posts where code review already
happens. Today none of that path exists. The repo has the contract skeleton and nothing else:

- `ci_installations` and `ci_runs` exist and are read or written by nothing
  (`server/src/db/schema/ci.ts:1-13`, a "ROADMAP SCAFFOLDING" note). `ci_installations` carries
  only `agent_id`, `repo`, `target_type` and `installed_at` (`ci.ts:17-25`). It has no status,
  no workflow version, no repository id, and no saved triggers or post-as. So "Update CI config"
  has nothing to re-export from.
- `agent_runs.source` is already the enum `local | ci` (`server/src/db/schema/runs.ts:39`). But
  the table has no column for the repository, the external PR number, the commit SHA, the Actions
  run id or the job URL (`runs.ts:10-46`). A CI run therefore cannot be written to it as it
  stands. `cost_usd` is `numeric` and so a **string** in Drizzle (`runs.ts:25-35`).
- `AgentManifest`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRun` and `CiResultArtifact`
  are defined at `server/src/vendor/shared/contracts/eval-ci.ts:266-376` and consumed by nothing.
  The client copy `client/src/vendor/shared/contracts/eval-ci.ts` has drifted and lacks
  `AgentManifest`.
- `CiResultArtifact` (`eval-ci.ts:365-375`) carries no commit SHA and no repository id. So nothing
  could tie an artifact to the run and repository it claims to come from.
- `GitHubClient` can `commitFiles`, `openPullRequest` and `findOpenPr`
  (`server/src/vendor/shared/adapters.ts:169-177`). It cannot list workflow runs, download an
  artifact, or read a repository's numeric id and default branch.
- The agent editor's tabs are `config`, `skills` and `evals`
  (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11-17`). `?tab=` resolves
  through `VALID_TABS`, which derives from `TABS` (`constants.ts:22`). The label `editor.tabs.ci`
  already exists (`client/messages/en/agents.json:53`) and renders nowhere.
- `client/src/vendor/ui/nav.ts` has no CI Runs entry (`nav.ts:25-40`).
- The API has **no authentication** and binds to `127.0.0.1` (`server/src/platform/config.ts:36-42`).
  So the CI side of this feature cannot push results to it. It also must not be made able to.

The cost of the gap: every agent tuned in the studio stays a demo.

## Goals / Non-goals

**Goals**

- **Add to CI** on the agent's CI tab opens a four-step wizard: Target → Preview → Configure →
  Install. It serializes the agent to a manifest, shows every file that will ship, and lets the
  user edit the workflow and pick triggers and post-as. It then either opens a PR on
  `devdigest/ci` or hands the user the files as a client-built zip.
- A generated GitHub Actions workflow that runs the **bundled** `agent-runner` shipped in the
  same PR, and holds the workflow security invariants in `## Acceptance criteria`.
- A new **`agent-runner/`** package, ported from upstream commit `0574487` (multi-manifest). It
  fetches the diff once, runs every manifest through `reviewer-core`, posts per post-as, exits 1
  when any gate triggers, and uploads an array artifact carrying `commit_sha` and `repository_id`.
- **Pull-based ingest.** `POST /ci/refresh` lists the workflow runs and downloads the
  `devdigest-result` artifact with the studio's GitHub token. It rejects any artifact whose SHA
  or repository id does not match, and writes `agent_runs` rows with `source='ci'`.
- An agent **CI tab**: installations, history, "Fail CI on", "Add to CI" and
  "Update CI config".
- A global **CI Runs** page at `/ci` with one new nav entry.

**Non-goals.** These are named because a reader would reasonably assume them:

- **CircleCI, Jenkins and Generic CLI.** The Target step shows only GitHub Actions. **This is a
  deliberate deviation from `design/export-to-ci/ci_1.PNG`**, which draws four cards: no generator
  exists for the other three, and the requirements allow them only "if the generators are really
  implemented". `CiTarget` keeps its four enum values, so the contract is not narrowed. The server
  refuses every target except `gha` (AC-29).
- **The `uses: devdigest/review-action@v1` step and `OPENAI_API_KEY`** shown in
  `ci_3.PNG`. That action is an unpublished placeholder. The workflow runs
  `node .devdigest/runner/index.js` with `OPENROUTER_API_KEY`.
- **Any inbound push endpoint.** The API has no auth and binds to loopback. Results arrive only
  through `POST /ci/refresh`, which pulls them.
- **`ci_runs`.** It stays unused and untouched. The `CiRun` DTO is backed by `agent_runs`.
- **Verifying repo secrets.** The wizard never reads or reports whether `OPENROUTER_API_KEY` is set
  in the target repo. GitHub does not expose secret values, and the studio-local key says nothing
  about the repo.
- **Agent memory.** Nothing produces any, so `.devdigest/memory.jsonl` ships empty.
- **Fork PRs.** The job is skipped for them. No fork review is posted and no fork run is ingested.
- **Auto-merge, enabling branch protection, or a GitHub App.** Making "Fail CI on" block a merge
  needs a required status check that the user adds by hand. The Configure step says so.
- **Per-finding content in the studio.** The artifact carries counts, not findings. A CI run in
  the studio has no finding list, no trace and no Accept/Dismiss.
- **The multi-agent-review feature** (spec 0021, worktree A): the multi-run service,
  `POST /pulls/:id/review`, the PR page and `multi_agent_runs`. See `## Ownership and merge order`.
- **Changing any `reviewer-core` invariant.** `groundFindings()` stays mandatory. `wrapUntrusted()`
  stays paired with `INJECTION_GUARD`.
- **A separate "Add repository" flow.** The "Add repository" row in `ci_2.PNG` opens the same
  wizard (AC-84). It is not a second flow.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| How much ships in v1? | **The simplest implementation that meets the criteria.** Iterate later. | Robustness criteria describe behaviour, not mechanism. A natural unique key gives idempotency, skip-on-error gives a degraded refresh, and committing onto the existing branch gives re-export. |
| How do CI results reach the studio? | **Pull.** The workflow uploads `devdigest-result.json` as the artifact `devdigest-result`. `POST /ci/refresh` lists the workflow runs and downloads the artifact through the Actions API with the studio's GitHub token. There is no push endpoint. | A run is visible only after someone presses Refresh. Every artifact also carries `commit_sha` and `repository_id`, and ingest rejects any artifact that does not match the run's `head_sha` and the installation's stored repository id (AC-48, AC-49). |
| Where does an ingested run live? | **`agent_runs` with `source='ci'`.** It gains the repository, PR number, commit SHA, Actions run id and job URL. `ci_runs` stays unused. | One run model. CI rows have `pr_id` null, because a repo outside the studio has no `pull_requests` row. |
| Which targets? | **GitHub Actions only.** | The other three mockup cards are not rendered (Non-goals). |
| Where does the runner come from? | **A port of upstream `0574487`** (multi-manifest, array artifact). It uses npm with a fresh `package-lock.json` and the repo's `AGENTS.md` / `CLAUDE.md` / `INSIGHTS.md` layout. `dist/` is built with ncc and **not committed**. The whole `dist/` directory ships under `.devdigest/runner/`. | Export fails loudly when `dist/` is missing (AC-28). The runner lands as its **own PR, merged first**. |
| How is the workflow constrained? | It triggers on `pull_request` `opened` and `synchronize` by default, with `reopened` optional. It never uses `pull_request_target` or a comment trigger. Its permissions are exactly `contents: read` and `pull-requests: write`. The job is skipped for forks. External actions are pinned to full commit SHAs. Secrets appear only as `${{ secrets.OPENROUTER_API_KEY }}` / `${{ secrets.GITHUB_TOKEN }}`. Untrusted data reaches the runner only through `env:`. | AC-30 to AC-38. |
| What does post-as offer? | `github_review` (the default), `pr_comment` or `none`, which reports through the exit code only. "Fail CI on" is read from the manifest, and the runner exits 1 when the gate triggers. | Changing "Fail CI on" in the studio changes CI only after a re-export (`## Edge cases`). |
| How does Install work? | **Open a PR:** the branch `devdigest/ci` into the repo's default branch. It never writes to the default branch, and a re-export updates the open PR. **Copy files as a zip:** built in the browser. | Installations persist `triggers` and `post_as`, so "Update CI config" can re-export with one click and bump `workflow_version`. |
| What does the "Secrets expected" panel show? | **Instructions, not state.** `OPENROUTER_API_KEY` reads "add in repo Settings → Secrets and variables → Actions". `GITHUB_TOKEN` reads "auto-provided by GitHub Actions". Neither row shows set/not set. | **This deviates from `ci_4.PNG`**, which shows "not set" and "ready" badges. The repo's secret state is unverifiable, and the studio-local key would make a false claim about the repo (AC-66). |
| Which commit does the workflow check out? | **The base SHA** (`github.event.pull_request.base.sha`), never the PR head. The runner, manifests and skills therefore come from the trusted default branch, and PR code never executes. The diff still comes from the GitHub API. | AC-78. A change to a manifest or the runner takes effect only once it is merged. The export PR's own run finds no runner on its base (`## Edge cases`). |
| What is a CI run's verdict? | **The runner's own gate result.** The runner adds `blockers` and `gate_triggered` to every artifact entry. Ingest uses them, never the agent's current `ci_fail_on`. | AC-79, AC-80. The verdict reflects what CI actually enforced, even after `ci_fail_on` changes in the studio. |
| What happens to edited workflow YAML? | **The edit wins, with a notice.** Configure no longer regenerates an edited YAML. The server does not re-validate the override, because the human PR review is the gate. "Update CI config" regenerates from the saved settings and says that it discards past edits. | AC-40, AC-81, AC-82. A user can commit a workflow that breaks AC-30 to AC-38; the PR reviewer is the only check (`## Non-functional`). |
| Where is the repository chosen? | **An `owner/name` select on the Target step**, prefilled with the active workspace repo. Free text is allowed. The CI tab's "Add repository" row opens the same wizard. | AC-83, AC-84. |
| Installation status, and re-export with no open PR | **`pr_open | active | error`.** If no open PR from `devdigest/ci` exists, the branch is recreated from the current default branch (force) and a new PR opens. If one is open, the export commits on top of it. | AC-85, AC-86, AC-87. The force reset discards whatever was on the stale `devdigest/ci` branch. |
| How much does refresh scan? | **The 30 most recent completed runs per installation per refresh. `/ci` shows the 100 most recent rows, with no paging.** | AC-88, AC-89. Older runs are not visible in the studio. |
| How is the zip built? | **With no new dependency.** It ports upstream's dependency-free STORE-method zip writer (`ExportWizard/zip.ts`, commit `0574487`). | AC-90. `client/package.json` and `client/pnpm-lock.yaml` stay unchanged. |
| What does the export PR's own run do? | **Skip with a notice.** A guard step exits 0 when the base has no runner yet. | AC-91. |
| Does a hard-failed CI run reach CI Runs? | **Yes.** The runner writes an error artifact (no secrets) and still exits 1; ingest stores it as a failed run. | AC-10, AC-92. Changes upstream's "no artifact" behaviour. |
| What does a missing runner bundle return? | **500 with code `runner_bundle_missing`.** | AC-28. |
| Who writes tests? | **One `test-writer` after implementation.** It covers the workflow-YAML security invariants, manifest serialization, ingest rejection, one wizard client test, and the ported runner tests. Implementers write none. | Many criteria are covered by the manual walk or by `plan-verifier` reading the diff, not by a unit test. `## Test plan` says which. |

## Ownership and merge order

**Three PRs, merged in this order**, with `client/src/vendor/ui/nav.ts` re-checked after each merge,
because both features add an entry to it:

1. **`chore/agent-runner`**, branched from `main`. It is a technical PR: the `agent-runner/` package,
   its `package-lock.json`, `AGENTS.md`, `CLAUDE.md` shim and `INSIGHTS.md`, its row in the root
   `AGENTS.md` package and Verify tables, and the shared-contract additions the runner itself
   validates against (AC-14). It contains no `server/src/modules/ci/` code and no UI.
2. **`feat/multi-agent-review`** (worktree A, spec 0021). It adds the finding attribution that the
   requirements say ingest may read.
3. **`feat/export-to-ci`** (this spec, worktree B), rebased on 1 and 2.

**This feature may change:** `server/src/modules/ci/**` and its registration in the route/container
wiring; additions to `GitHubClient` in `server/src/vendor/shared/adapters.ts` and their octokit
adapter; `server/src/db/schema/ci.ts`, the `agent_runs` columns in `server/src/db/schema/runs.ts`,
and the one generated migration; the CI section of `contracts/eval-ci.ts` in **both** vendored
copies; the agent CI tab under `client/src/app/agents/[id]/`; the `/ci` page; the CI hooks in
`client/src/lib/hooks/`; `client/messages/en/ci.json`; one entry in `nav.ts`; and `agent-runner/`
(PR 1 only).

**This feature must not touch:** the multi-run review service, `POST /pulls/:id/review` and the
run executor, the PR page, `multi_agent_runs`, or `reviewer-core/` (consumed as source, unchanged).

**Shared contracts.** This spec owns these, and they change only here:

- in `contracts/eval-ci.ts` lines 266-376: `CiTarget`, `CiFile`, `AgentManifest`, `CiExportInput`,
  `CiInstallation`, `CiExport`, `CiRunStatus`, `CiRun`, `CiResultArtifact`;
- the new `CiRefreshResult` and `CiUpdateResult`;
- the new `GitHubClient` methods.

These are **read-only** here: `Agent` and `CiFailOn` (`ci_fail_on` changes through the existing
agent update route), `Finding`, `GitHubReviewPayload`, `LLMProvider`, the trace contracts, and every
contract worktree A adds or changes for finding attribution and `multi_agent_runs`.
`contracts/eval-ci.ts` also holds the eval contracts of specs 0019 and 0020. This spec edits only
the Export-to-CI section of that file.

## User stories

- As an **agent author**, I want to export my tuned agent to a repository's GitHub Actions from
  its CI tab, so that it reviews every pull request without me running it.
- As a **repository maintainer**, I want the export to arrive as a PR on `devdigest/ci` whose
  workflow I can read for least privilege, secret handling and how PR code is executed, so that
  installing the reviewer does not open an attack path.
- As a **developer**, I want a same-repo PR to receive the agent's review automatically, so that
  the findings appear where review already happens.
- As a **team lead**, I want a CRITICAL finding to turn a required check red, so that "Fail CI on"
  can block a merge.
- As an **agent author**, I want CI runs to appear in the studio with repo, PR, verdict, findings,
  cost, duration and a link to the Actions run, so that I can see what the agent did in CI without
  opening GitHub.
- As an **agent author**, I want to re-export every installation with one click after I tune the
  agent, so that CI does not keep running a stale prompt.

## Acceptance criteria (EARS)

**agent-runner package (PR 1)**

- **AC-1** — The repository shall contain `agent-runner/` with `package.json`, an npm
  `package-lock.json`, `AGENTS.md`, a `CLAUDE.md` of three lines importing `AGENTS.md`, and
  `INSIGHTS.md`. It shall have no pnpm lockfile, and `bash scripts/check-agent-docs.sh` shall pass.
- **AC-2** — `npm run build` in `agent-runner/` shall produce `agent-runner/dist/index.js` with ncc.
  `agent-runner/dist/` shall be listed in a `.gitignore` and contain no tracked file.
- **AC-3** — WHEN the runner starts, it shall validate every `*.yaml` under `.devdigest/agents/`
  against `AgentManifest`. IF any manifest fails, THEN it shall exit 1 before any model call,
  GitHub write or artifact write.
- **AC-4** — The runner shall fetch the PR diff exactly once per invocation, whatever the number of
  manifests.
- **AC-5** — The runner shall remove every file under `.devdigest/` and `.github/workflows/` from
  the diff before any manifest reviews it.
- **AC-6** — The runner shall review each manifest through `reviewer-core`'s `reviewPullRequest`,
  so the diff and PR body pass through `wrapUntrusted()` and the findings pass through
  `groundFindings()` before they are counted or posted.
- **AC-7** — The runner shall pass the PR title, branch names and any comment text to the model
  only inside a `wrapUntrusted()` block, and never in the raw `task` line.
  (`reviewer-core/src/prompt.ts:268-269` appends `task` unwrapped. Upstream's runner puts the PR
  title there: `agent-runner/src/run.ts:135` in the reference.)
- **AC-8** — The runner shall compute each manifest's blocker count and gate with `countBlockers` /
  `gateTriggered` from the grounded findings and that manifest's `ci_fail_on`, never from the
  model's self-reported verdict.
- **AC-9** — The runner shall exit `1` when any manifest's gate triggers, and `0` when none does.
- **AC-10** — IF the diff fetch or any manifest's model call fails, THEN the runner shall exit 1,
  post nothing, and still write `devdigest-result.json` holding error entries as AC-92 defines.
- **AC-11** — WHERE `DEVDIGEST_POST_AS` is `github_review`, the runner shall post one GitHub review
  per manifest, with the event derived from that manifest's gate. WHERE it is `pr_comment`, the
  runner shall post one PR comment per manifest. WHERE it is `none`, the runner shall make no
  GitHub write call.
- **AC-12** — WHEN every manifest has been reviewed, the runner shall write `devdigest-result.json`
  as a JSON array with one `CiResultArtifact` per manifest. Each entry shall be validated before the
  write and carry `commit_sha` and `repository_id`, taken from the runner's environment.
- **AC-13** — The runner shall write neither the value of `OPENROUTER_API_KEY` nor that of
  `GITHUB_TOKEN` to the artifact, to stdout or to stderr.
- **AC-14** — `CiResultArtifact` shall carry `commit_sha` (a 40-character lowercase hex string) and
  `repository_id` (a positive integer), both required, in both vendored copies of
  `contracts/eval-ci.ts`.
- **AC-15** — The ported upstream runner tests shall pass under `npm test` in `agent-runner/`,
  extended to the AC-14 fields.

**Contracts and schema**

- **AC-16** — `CiInstallation` shall carry `status` (`pr_open | active | error`), `workflow_version` (an integer ≥ 1),
  `triggers` (an array of `opened | synchronize | reopened`), `post_as`
  (`github_review | pr_comment | none`), `pr_url` (string or null) and `last_run` (`CiRun` or
  null). These shall be added without removing an existing field.
- **AC-17** — `CiRun` shall carry `id`, `agent_id`, `agent_name`, `ci_installation_id`, `repo`,
  `pr_number`, `commit_sha`, `actions_run_id`, `job_url`, `verdict` (`approve | request_changes`),
  `findings_count`, `cost_usd`
  (a number or null), `duration_ms` and `ran_at`. Each shall be populated from `agent_runs`.
- **AC-18** — `CiExportInput` shall carry an optional `workflow_override` string. Its `triggers`
  default shall be `['opened', 'synchronize']`.
- **AC-19** — `CiExport.installation` shall be nullable, so that a response with no side effect
  (AC-23) is representable.
- **AC-20** — `@devdigest/shared` shall export `CiRefreshResult`, carrying `degraded` (boolean),
  `message` (string or null), `ingested` and `skipped` (non-negative integers). It shall also export
  `CiUpdateResult`, carrying one `{ installation_id, ok, pr_url, error }` entry per installation.
- **AC-21** — `client/src/vendor/shared/contracts/eval-ci.ts` shall mirror the Export-to-CI section
  of the server copy, `AgentManifest` included. Field names and types shall match AC-14 and
  AC-16 to AC-20.
- **AC-22** — The server schema shall give `ci_installations` the columns `status`,
  `workflow_version` (NOT NULL, default 1), `triggers`, `post_as`, `repository_id` (NOT NULL),
  `pr_url` and `updated_at`, plus a unique key on (`agent_id`, `repo`). It shall give `agent_runs`
  the nullable columns `ci_installation_id`, `repo`, `external_pr_number`, `commit_sha`,
  `actions_run_id`, `job_url` and `ci_gate_triggered` (boolean), plus a unique index on (`ci_installation_id`, `actions_run_id`).
  All of these shall come from one `pnpm db:generate` migration, with no existing migration edited.

**Export (server)**

- **AC-23** — WHEN `POST /agents/:id/export-ci` is called with `action: 'files'`, the API shall
  respond 200 with a `CiExport` whose `installation` is null and whose `pr_url` is null. It shall
  make no GitHub write call and write no `ci_installations` row.
- **AC-24** — The CI service shall emit exactly this file set:
  - `.devdigest/agents/<slug>.yaml`;
  - one `.devdigest/skills/<skill-slug>.md` per enabled linked skill;
  - an empty `.devdigest/memory.jsonl`;
  - one `.devdigest/runner/<path>` for every file under `agent-runner/dist/`, at its path relative
    to `dist/`;
  - `.github/workflows/devdigest-review.yml`.
- **AC-25** — The emitted manifest shall parse as YAML and pass `AgentManifest.safeParse`. Its
  `name`, `model`, `system_prompt`, `strategy` and `ci_fail_on` shall equal the agent's, and its
  `skills` shall equal the emitted skill slugs.
- **AC-26** — The CI service shall derive each slug to match `^[a-z0-9][a-z0-9-]*$`. The same
  agent shall yield the same slug on every export.
- **AC-27** — The `.devdigest/memory.jsonl` the CI service emits shall have zero bytes.
- **AC-28** — IF `agent-runner/dist/index.js` does not exist when an export is requested, THEN the
  API shall respond 500 with code `runner_bundle_missing` and a message naming
  `cd agent-runner && npm run build`. It shall make no GitHub call.
- **AC-29** — IF `CiExportInput.target` is not `gha`, THEN `POST /agents/:id/export-ci` shall
  respond 422 with code `validation_error`.

**Generated workflow — security invariants**

- **AC-30** — The generated workflow's `on:` shall have exactly one key, `pull_request`. Its
  `types` shall be the requested triggers filtered to `opened`, `synchronize` and `reopened`.
- **AC-31** — The generated workflow shall contain none of `pull_request_target`, `issue_comment`,
  `pull_request_review_comment` or `workflow_run`.
- **AC-32** — The generated workflow's top-level `permissions:` shall equal exactly
  `{ contents: read, pull-requests: write }`, and no job shall declare its own `permissions:`.
- **AC-33** — The generated workflow's review job shall carry a job-level `if:` that evaluates false
  when `github.event.pull_request.head.repo` is not the base repository.
- **AC-34** — Every `uses:` in the generated workflow shall match `^[^@\s]+@[0-9a-f]{40}$`. The
  workflow shall use exactly `actions/checkout`, `actions/setup-node` and
  `actions/upload-artifact`, and shall not contain `devdigest/review-action`.
- **AC-35** — The generated workflow shall reference secrets only as
  `${{ secrets.OPENROUTER_API_KEY }}` and `${{ secrets.GITHUB_TOKEN }}`, and only under the review
  step's `env:`.
- **AC-36** — No `run:` value in the generated workflow shall contain a `${{` expression. The review
  step's `run:` shall be exactly `node .devdigest/runner/index.js`.
- **AC-37** — The generated workflow's review step `env:` shall pass the PR number, the repository,
  `github.event.pull_request.head.sha`, `github.repository_id` and `DEVDIGEST_POST_AS`. That last
  value shall equal the export's `post_as`.
- **AC-38** — The generated workflow shall upload `devdigest-result.json` as the artifact
  `devdigest-result`, in a step carrying `if: always()`, so that a gate-failed run still uploads.

**Install, re-export and Update CI config (server)**

- **AC-39** — WHEN `POST /agents/:id/export-ci` is called with `action: 'open_pr'`, the CI service
  shall commit the full file set as one commit to the branch `devdigest/ci` and open a PR into the
  repository's default branch read from GitHub. It shall make no write to the default branch.
- **AC-40** — WHERE `CiExportInput.workflow_override` is present, the committed
  `.github/workflows/devdigest-review.yml` shall equal it byte for byte.
- **AC-41** — IF an open PR whose head is `devdigest/ci` already exists in the repository, THEN the
  CI service shall commit to that branch and return that PR's URL, without opening a second PR.
- **AC-42** — WHEN an `open_pr` export succeeds, the CI service shall upsert exactly one
  `ci_installations` row for (agent, repo). The row shall store `triggers`, `post_as`, `pr_url` and
  the `repository_id` that GitHub reported, and set `workflow_version` to 1 on first export or to
  the previous value + 1 after that.
- **AC-43** — IF the GitHub commit, PR or repository call fails during an export, THEN the API shall
  respond with an error envelope carrying GitHub's message. It shall create no `ci_installations`
  row, and leave an existing row's `workflow_version`, `triggers`, `post_as` and `pr_url`
  unchanged.
- **AC-44** — WHEN `POST /agents/:id/ci/update` is called, the CI service shall re-export every
  `gha` installation of that agent with its stored `triggers` and `post_as`, as AC-39 to AC-42 do.
  It shall respond 200 with a `CiUpdateResult` holding one entry per installation.
- **AC-45** — IF one installation's re-export fails during `POST /agents/:id/ci/update`, THEN the CI
  service shall still re-export the others, and that entry shall carry `ok: false` and a non-empty
  `error`.
- **AC-46** — `GET /agents/:id/ci/installations` shall respond 200 with that agent's
  `CiInstallation[]`, each with `last_run` set to its newest ingested run or null.

**Ingest**

- **AC-47** — WHEN `POST /ci/refresh` is called, the CI service shall list the completed runs of
  `devdigest-review.yml` for every `gha` installation in the workspace, and download each run's
  `devdigest-result` artifact with the studio's GitHub token.
- **AC-48** — IF an artifact entry's `commit_sha` differs from the workflow run's `head_sha`, THEN
  the CI service shall write no `agent_runs` row for it and count it in `skipped`.
- **AC-49** — IF an artifact entry's `repository_id` differs from the installation's stored
  `repository_id`, THEN the CI service shall write no `agent_runs` row for it and count it in
  `skipped`.
- **AC-50** — IF an artifact is missing, expired, not a zip, not JSON, or fails
  `CiResultArtifact.array()` validation, THEN the CI service shall write no row for it, count it in
  `skipped`, and continue with the next run.
- **AC-51** — WHEN an artifact entry passes AC-48 to AC-50 and its `agent` equals the installation's
  agent name, the CI service shall insert one `agent_runs` row with `source='ci'`. The row shall
  carry `pr_id` null, the installation id, `repo`, `external_pr_number`, `commit_sha`,
  `actions_run_id`, `job_url` (the workflow run's `html_url`), `findings_count`, `duration_ms` and
  `cost_usd`. `cost_usd` shall be written as a decimal string.
- **AC-52** — WHEN `POST /ci/refresh` meets an (installation, Actions run id) pair that already has
  an `agent_runs` row, the CI service shall insert no second row.
- **AC-53** — IF listing workflow runs fails for an installation, THEN `POST /ci/refresh` shall
  respond 200 with `degraded: true` and a non-empty `message`. It shall still process the remaining
  installations and delete or modify no existing row.
- **AC-54** — `GET /ci/runs` shall respond 200 with the workspace's `source='ci'` runs as `CiRun[]`,
  ordered by `ran_at` descending, filtered to one agent when `?agent_id=` is given.

**Client — agent CI tab**

- **AC-55** — The agent editor's `TABS` shall include `ci`, labelled by `editor.tabs.ci`, so that
  `/agents/:id?tab=ci` opens the CI tab.
- **AC-56** — The CI tab shall render one row per installation, showing the repository, the target,
  the status, the `workflow_version` and the last run's verdict and time. A null `last_run` shall
  render the `ci` namespace's placeholder.
- **AC-57** — IF the agent has no installation, THEN the CI tab shall render an empty-state message
  and the Add to CI control.
- **AC-58** — The CI tab shall render a "Fail CI on" selector with the four `CiFailOn` values.
  Changing it shall persist through the existing agent update route.
- **AC-59** — The CI tab shall render the agent's CI run history from `GET /ci/runs?agent_id=`.
- **AC-60** — The CI tab shall render "Update CI config" disabled while the agent has no `gha`
  installation. WHEN it is activated, the tab shall issue one `POST /agents/:id/ci/update` and
  render each entry's outcome.

**Client — export wizard**

- **AC-61** — WHEN Add to CI is activated, the CI tab shall open a modal wizard whose steps are, in
  order, Target, Preview, Configure and Install, with Target active.
- **AC-62** — The Target step shall render exactly one target, GitHub Actions, and no CircleCI,
  Jenkins or Generic CLI option.
- **AC-63** — The Preview step shall list every `CiFile.path` returned by an `action: 'files'`
  request and render the selected file's contents. Only `.github/workflows/devdigest-review.yml`
  shall be editable.
- **AC-64** — WHEN the user has edited the workflow in Preview, the wizard shall send the edited
  text as `workflow_override` in the `open_pr` request, and put the edited text in the zip.
- **AC-65** — The Configure step shall render trigger toggles defaulting to `opened` on,
  `synchronize` on and `reopened` off, and post-as options defaulting to `github_review`.
- **AC-66** — The Configure step's "Secrets expected" panel shall render `OPENROUTER_API_KEY` with
  an instruction to add it in the repository's Actions secrets, and `GITHUB_TOKEN` as provided by
  GitHub Actions. It shall render no set/not-set state for either, and issue no request to read
  either.
- **AC-67** — The Configure step shall render a note saying that blocking a merge needs "Fail CI on"
  plus a required status check in the repository's branch protection.
- **AC-68** — WHEN "Open a PR" is confirmed on Install, the wizard shall issue exactly one
  `POST /agents/:id/export-ci` with `action: 'open_pr'` and the chosen `triggers` and `post_as`.
  While it is in flight, the confirm control shall be disabled.
- **AC-69** — WHEN that request succeeds, the wizard shall render the returned `pr_url` as a link.
  IF it fails, THEN the wizard shall render the error envelope's `error.message` and stay open.
- **AC-70** — WHEN "Copy files as a zip" is chosen, the wizard shall build a zip in the browser
  holding exactly the previewed file set at their paths, using the AC-90 writer. It shall issue no
  `open_pr` request.
- **AC-71** — WHEN the wizard is open, pressing `Escape` shall close it and return focus to the
  Add to CI control.

**Client — CI Runs page**

- **AC-72** — The `/ci` page shall render one table row per `GET /ci/runs` entry. The columns shall
  be repository, PR, agent, verdict, findings, cost, duration, and a link to `job_url` that opens in
  a new tab with `rel="noopener noreferrer"`.
- **AC-73** — WHEN Refresh is activated, the `/ci` page shall issue one `POST /ci/refresh` and then
  refetch `GET /ci/runs`. While the request is in flight, Refresh shall be disabled.
- **AC-74** — WHILE the last refresh returned `degraded: true`, the `/ci` page shall render a
  banner with the returned `message` and keep the existing rows.
- **AC-75** — IF `GET /ci/runs` returns no entries, THEN the `/ci` page shall render an empty-state
  message pointing to Add to CI.
- **AC-76** — `client/src/vendor/ui/nav.ts` shall gain exactly one entry, whose `href` is `/ci`.
- **AC-77** — Every user-facing string on the CI tab, the wizard and the `/ci` page shall resolve
  through `next-intl` from `client/messages/en/ci.json`, apart from the existing tab label in
  `agents.json`.

**Decisions folded in after the first draft**

- **AC-78** — The generated workflow's checkout step shall carry
  `ref: ${{ github.event.pull_request.base.sha }}`. No step shall check out
  `github.event.pull_request.head.sha`, `github.head_ref` or the PR merge ref. So the runner,
  manifests and skills that execute come from the base commit, and no file from the PR head
  executes.
- **AC-79** — Each `CiResultArtifact` entry shall carry `blockers` (a non-negative integer) and
  `gate_triggered` (boolean), both required, in both vendored copies. The runner shall set them to
  that manifest's AC-8 results.
- **AC-80** — WHEN ingest writes an `agent_runs` row, the CI service shall store the entry's
  `blockers` in `agent_runs.blockers` and its `gate_triggered` in `ci_gate_triggered`. `CiRun.verdict`
  shall be `request_changes` when `ci_gate_triggered` is true and `approve` otherwise, never
  computed from the agent's current `ci_fail_on`.
- **AC-81** — WHILE the workflow in Preview is unedited, the wizard shall regenerate it from the
  Configure step's triggers and post-as. Once it is edited, the wizard shall stop regenerating it
  and the Configure step shall render a notice that the edited workflow will be committed as
  written.
- **AC-82** — WHEN "Update CI config" runs, the CI service shall regenerate the workflow from each
  installation's stored `triggers` and `post_as`, ignoring any earlier `workflow_override`. The CI
  tab shall render, beside the control, text stating that manual workflow edits are discarded.
- **AC-83** — The Target step shall render a repository select listing the workspace's repositories
  by `full_name`, prefilled with the active repo and accepting free text. WHILE the value does not
  match `owner/name`, Continue shall be disabled.
- **AC-84** — WHEN the CI tab's "Add repository" row is activated, the CI tab shall open the same
  wizard that Add to CI opens.
- **AC-85** — WHEN an `open_pr` export or an update succeeds, the CI service shall set the
  installation's `status` to `pr_open`. WHEN ingest writes a row for an installation, it shall set
  that installation's `status` to `active`.
- **AC-86** — IF an export or update fails for an installation that already exists, THEN the CI
  service shall set its `status` to `error`.
- **AC-87** — IF no open PR has `devdigest/ci` as its head, THEN the CI service shall point
  `devdigest/ci` at the current default-branch head (force, creating the branch if missing), commit
  the file set onto it, and open a new PR.
- **AC-88** — WHEN `POST /ci/refresh` runs, the CI service shall examine at most the 30 most recent
  completed workflow runs per installation.
- **AC-89** — `GET /ci/runs` shall return at most 100 entries, the newest by `ran_at`, and shall
  accept no paging parameter.
- **AC-90** — The wizard's zip shall be written by a dependency-free module in the wizard's folder
  that stores entries uncompressed (ZIP method 0, STORE), ported from upstream `0574487`. The
  feature diff shall not change `client/package.json` or `client/pnpm-lock.yaml`.
- **AC-91** — The generated workflow shall, before the runner step, test whether
  `.devdigest/runner/index.js` exists in the checked-out base commit. IF it does not, THEN the job
  shall print a notice that DevDigest is not installed on the base branch yet, skip the runner and
  upload steps, and finish successfully (exit 0). So the export PR's own run is green, not red.
- **AC-92** — IF the runner hard-fails (AC-10), THEN it shall write one `CiResultArtifact` entry per
  manifest (or one entry with `agent: null` when no manifest loaded) with `status: "error"`,
  `error` (a message of at most 500 characters that contains no environment-variable value), zero
  counts, `blockers: 0`, `gate_triggered: false`, `commit_sha` and `repository_id`. Successful
  entries carry `status: "ok"`. WHEN ingest reads an `error` entry that passes the AC-48/AC-49
  checks, the CI service shall write an `agent_runs` row with `status = 'failed'` and the error text,
  and `/ci` shall show it with a failed verdict.

**Enforcement split.** 92 criteria in all:

- **AC-1, AC-2, AC-22 and AC-90** are artifact claims that `plan-verifier` and the checkers can read.
- **AC-3 to AC-15, AC-79 and AC-92 (runner half)** are covered by the ported runner tests and the test-writer's
  additions.
- **AC-23 to AC-38, AC-78 and AC-91** are covered by the test-writer's manifest and workflow-YAML tests.
  The security invariants AC-30 to AC-38 and AC-78 are the half that must have a test.
- **AC-48 to AC-50, AC-80 and AC-92 (ingest half)** are covered by the ingest-rejection test.
- **AC-61 to AC-66, AC-81 and AC-83** are covered by the single wizard test.
- **Everything else is not exercised by any automated test in this workflow.** That means the
  routes, the rest of the wizard, the CI tab and the `/ci` page. It is checked by the manual walk
  or by `plan-verifier` reading the diff, and `## Test plan` says which.

## Edge cases

| Case | Handling |
|---|---|
| **Fork PR** | The job is skipped (AC-33): no secret, no review, no artifact, nothing to ingest. |
| **PR comment, `/review` text in a comment** | No comment trigger exists (AC-31). Comment text never reaches the runner. |
| **Gate triggers (CRITICAL with `ci_fail_on: critical`)** | The runner exits 1 (AC-9) and the upload still runs (AC-38). The check goes red. It blocks a merge only if the user made it required (AC-67). |
| **Model or diff failure in CI** | Hard fail: exit 1, nothing posted, but an error artifact is written (AC-10, AC-92), so the run appears on CI Runs as failed with its error text. A failure before the runner starts (e.g. checkout) still leaves the Actions page as the only record. |
| **`OPENROUTER_API_KEY` not added to the repo** | The model call fails, which lands in the row above. The wizard cannot pre-check this (AC-66). |
| **Studio GitHub token lacks permission to write `.github/workflows/`** | GitHub rejects workflow-file writes without the `workflow` scope (classic token) or the Workflows permission (fine-grained). The commit fails and AC-43 surfaces GitHub's message with no installation written. Ingest's artifact download likewise needs Actions read access. |
| **Re-export while the `devdigest/ci` PR is open** | A new commit on the same branch, the same PR URL (AC-41), and `workflow_version` + 1 (AC-42). |
| **Re-export after the PR was merged or closed** | `findOpenPr` returns null, so `devdigest/ci` is force-reset to the current default branch and a new PR opens (AC-87). Anything left on the stale branch is discarded. |
| **Studio changes `ci_fail_on` after export** | CI keeps enforcing the exported value until the next re-export. Ingested verdicts follow what CI enforced (AC-80), not the new studio value. |
| **A PR that edits a manifest, a skill or the runner** | That PR is reviewed by the **base** versions (AC-78). The edit takes effect only for PRs opened after it merges. |
| **Two agents installed in the same repository** | Both share `devdigest/ci` and one `devdigest-review.yml`, and the runner reviews every manifest in `.devdigest/agents/` (AC-3). Each installation picks its own entry from the shared array artifact (AC-51). The shared workflow carries one `post_as` and one trigger set, so the last export wins. |
| **`synchronize` pushes in quick succession** | Each Actions run has its own id and `head_sha`, so ingest keys on (installation, run id) (AC-52). |
| **Artifact from a different commit or repository** | Rejected (AC-48, AC-49). It is counted as skipped, not raised as an error. |
| **Artifact expired (past GitHub's retention)** | Skipped (AC-50). A run not refreshed before expiry is lost to the studio. |
| **Agent renamed after export** | The artifact's `agent` is the manifest `name` at export time. Until "Update CI config" runs, AC-51's name match fails and the entries are not ingested. Known gap. |
| **Agent deleted** | `ci_installations` cascades from `agents` (`ci.ts:19-21`). The agent's `agent_runs` rows keep `agent_id` null (`runs.ts:17`) and still list on CI Runs, with the agent placeholder. |
| **Agent with zero enabled skills** | The manifest has `skills: []` and no skill file is emitted. It is still a valid export (AC-24, AC-25). |
| **Two skills slugify to the same slug** | The `-2`, `-3` suffix rule is upstream's. Its determinism is required by AC-26. |
| **`agent-runner/dist/` not built** | AC-28: a loud 500 with a named fix. Never a workflow pointing at a missing runner. |
| **Very large runner bundle in the export PR's own diff** | When the export PR itself triggers the workflow, the runner strips `.devdigest/**` and `.github/workflows/**` (AC-5). The upstream fix loop found that the minified bundle otherwise produced a GitHub 422 "diff too large". |
| **Export PR runs the workflow on itself** | `pull_request` reads the workflow file from the PR's merge ref, so the export PR does trigger it. The job checks out the **base** SHA (AC-78), which has no `.devdigest/runner/` yet, so the guard step (AC-91) prints a notice and the job succeeds without reviewing. Reviews start with the first PR opened after the export PR merges. |
| **`cost_usd` null in the artifact** | Stored null and rendered as the placeholder. Never `0`. |
| **Refresh while GitHub is down** | `degraded: true`, existing rows kept (AC-53, AC-74). |
| **Two refreshes at once** | The unique index (AC-22) makes the second insert of a pair fail. That must be handled as "already ingested", not as a 500. |
| **Time zones** | `ran_at` is the Actions run's completion instant, stored `timestamptz` and rendered in the viewer's locale. |

**Checked and ruled out:**

- *pagination of CI Runs*: capped at 100 rows with no pager (AC-89), and at 30 scanned runs per
  installation per refresh (AC-88);
- *permission denied*: one workspace, no roles;
- *RTL or long repo names*: truncated by the table like every other list;
- *negative numbers*: counts and costs are non-negative by contract.

## Non-functional

- **Security: what the workflow invariants do, and their ceiling.** They stop:
  - forks receiving the secret (AC-33);
  - comment-triggered runs (AC-31);
  - privilege beyond `contents: read` / `pull-requests: write` (AC-32);
  - shell injection from PR text (AC-36);
  - PR code executing at all (AC-78).

  The runner, manifests and skills come from the base commit. The PR reaches the job only as API
  diff text, which is data.

  **The ceiling is the workflow file itself.** GitHub reads a `pull_request` workflow definition
  from the PR's merge ref, so a same-repository PR that edits `.github/workflows/devdigest-review.yml`
  changes what runs for that PR. That is a property of GitHub Actions that no generated content can
  prevent. It is bounded by who can push branches to the repo.

  **AC-40 lets the user's own edit override every generated invariant**, and nothing re-validates
  it. The human review of the export PR (manual step 2) is the gate for that.
- **Security: what the ingest check cannot do.** `commit_sha` and `repository_id` are written by
  the runner, which runs in the target repo. The check proves that an artifact belongs to the run
  and repository it was pulled from. It does not prove that the runner was unmodified. Its value is
  a channel the studio itself authenticated to (the studio's own GitHub token, against a repository
  id fixed at export) plus a consistency check. It does not make the artifact trustworthy content.
  Ingest treats every field as data (`## Untrusted inputs`).
- **Secrets.** No secret value appears in any emitted file (AC-35), the artifact or the logs
  (AC-13). The studio's GitHub token is used server-side and never reaches the client or an
  emitted file.
- **Money.** `cost_usd` crosses the repository boundary as a string and converts with
  `Number()` / `String()` (`runs.ts:25-35`).
- **Accessibility (WCAG 2.2 AA).** The wizard uses the vendored `Modal` (`role="dialog"`), traps
  focus and restores it on close (AC-71). The step indicator conveys the current and completed
  steps in text, not only by colour. Verdict and status badges carry text.
- **Client imports.** Every `@devdigest/shared` import in new client code is `import type`. A value
  import passes typecheck and vitest and still breaks `next build` (`client/INSIGHTS.md`, cited by
  spec 0020).
- **i18n.** `ci.json` is a new namespace. Every catalogue ships to every route, so this is payload
  on unrelated pages. The cost is accepted because the ownership decision names "ci i18n".
- **No new dependency.** The client has no zip library (no `jszip` / `fflate`). The zip is written
  by a ported dependency-free STORE writer (AC-90), so `client/package.json` and the lockfile do not
  change. The cost is no compression. The runner bundle is shipped as uncompressed bytes in the zip.
- **Diff boundary.** The feature PR's `git diff --name-only main` shall list no path under the
  multi-run service, the `POST /pulls/:id/review` route, the PR page or `multi_agent_runs`, and no
  path under `reviewer-core/`. This is a review check, not an `AC-N`, because it constrains the diff
  rather than the product.
- **Latency.** None is gated. A review should post within a few minutes of the trigger, but model
  and runner latency are outside the studio's control.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| Agent name, model, provider, system prompt, strategy, `ci_fail_on` | `agents` row | `[reused: spec 0006]` | Serialized into the manifest (AC-25). |
| Linked skills and their bodies | `agent_skills` + `skills` | `[reused: spec 0006]` | Enabled links only (AC-24). |
| Manifest YAML, slugs, workflow YAML | CI service generators | `[deterministic: pure functions over the agent row and CiExportInput]` | No model on the export path. |
| Runner bundle | `agent-runner/dist/**` | `[new]` | Built by ncc in PR 1. Read from disk at export time (AC-24, AC-28). |
| Repository id and default branch | GitHub repos API through a new `GitHubClient` method | `[new]` | Fixed at export time (AC-42). |
| Workflow run list, `head_sha`, `html_url` | GitHub Actions API through a new `GitHubClient` method | `[new]` | |
| `devdigest-result.json` | Actions artifact, written by the runner in the target repo | `[new]`; counts are `[llm]`-derived | Finding counts come from model output after grounding. They are a measurement, never a source of truth. |
| Verdict | the artifact entry's `gate_triggered`, from the runner's `gateTriggered` over grounded findings and the manifest's `ci_fail_on` | `[deterministic]` | AC-79, AC-80. |
| Workflow override | user edit in Preview | `[new]` | Committed verbatim (AC-40). |

## Untrusted inputs

- **PR diff, PR body, PR title, branch names (runner side).** These are written by whoever opens the
  PR. They are data, never instruction. The diff and body reach the model only through
  `reviewPullRequest`, which applies `wrapUntrusted()` with `INJECTION_GUARD`, and findings pass the
  mandatory `groundFindings()` gate (AC-6). The PR title and branch names must not enter the
  unwrapped `task` line (AC-7). The upstream runner violated this.
- **The same values (workflow side).** They reach the runner through `env:` only, never
  interpolated into a `run:` script (AC-36). `${{ github.event.pull_request.title }}` inside a
  `run:` is the classic Actions script injection.
- **PR and issue comments.** They are never a trigger and never read (AC-31).
- **`devdigest-result.json` (studio side).** It is produced by code running in a repository the
  studio does not control. Ingest validates it against `CiResultArtifact` and the SHA/repository-id
  checks (AC-48 to AC-50), and uses its fields only as numbers and identifiers. The `agent` string
  is matched against a name, never rendered as markup. `job_url` comes from the GitHub API response
  (`html_url`), not from the artifact.
- **Manifest and skill files in the target repo.** They are read from the **base** commit (AC-78),
  so a PR's own edits to them are never executed or prompted for that PR. The runner validates
  manifests (AC-3). Skill bodies enter the system prompt as the agent's own instructions.
- **Repository names typed into the wizard.** They are validated as `owner/name` before any GitHub
  call.

## Test plan

Implementers write no tests. One `test-writer` covers the five areas below after implementation.
Every other criterion is listed against the check that actually covers it. **Untested** means that
no automated test in this workflow exercises it.

| Criteria | How |
|---|---|
| AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-10, AC-11, AC-12, AC-15 | **Ported runner tests** (`agent-runner/`, `npm test`), with an injected LLM stub, fetch and fs. They check that: an invalid manifest exits 1 with zero LLM, fetch-POST and write calls; two manifests produce one diff fetch; a diff touching `.devdigest/runner/index.js`, `.github/workflows/x.yml` and `src/a.ts` reaches the stub with only `src/a.ts`; a stubbed CRITICAL finding with `ci_fail_on: critical` exits 1, and the same with `never` exits 0 (the negative); a stub that throws gives exit 1 and an error artifact (AC-92); each `post_as` value produces one review POST per manifest, one comment POST per manifest, and zero GitHub writes respectively; the artifact is a two-element array and each element parses. |
| AC-79 | Runner test: with `ci_fail_on: critical`, a stubbed CRITICAL finding yields an entry with `blockers: 1, gate_triggered: true`, and a stubbed SUGGESTION yields `blockers: 0, gate_triggered: false` (the negative). Manifest-serialization test: `CiResultArtifact` rejects an entry missing either field. |
| AC-7 | Runner test: a PR title of `IGNORE PREVIOUS INSTRUCTIONS` appears in the assembled prompt only between `<untrusted` fences and never in the `task` section. Negative: the PR number does appear in `task`. |
| AC-13 | Runner test: with `OPENROUTER_API_KEY=sk-or-TESTSECRET` and `GITHUB_TOKEN=ghs_TESTTOKEN` set, neither string appears in the artifact bytes or in captured stdout/stderr, on a success run and on a failure run. Plus manual walk step 8. |
| AC-14, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21 | **Manifest-serialization test** (server unit): `CiResultArtifact` rejects an entry missing `commit_sha` and rejects a 39-character SHA, and accepts a valid one. The other contract shapes are untested beyond typecheck. `plan-verifier` compares both vendored copies field by field. |
| AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29 | **Manifest-serialization test** (server unit, with the runner `dist/` faked on a temp dir): the file set equals the expected path list for an agent with two skills, including every faked `dist/` file under `.devdigest/runner/`; the manifest YAML round-trips through `AgentManifest.safeParse` with fields equal to the fixture agent's; the slug matches the pattern and is identical across two calls; `memory.jsonl` is empty; a missing `dist/index.js` throws `runner_bundle_missing`. Negative: an agent with zero skills emits no skill file and `skills: []`. AC-23 and AC-29 at the route level are **untested** (`plan-verifier` reads the route). |
| AC-78 | **Workflow-YAML security test**: the checkout step's `with.ref` equals `${{ github.event.pull_request.base.sha }}`, and the strings `pull_request.head.sha` and `github.head_ref` occur in no `ref:` anywhere in the document. (`head.sha` may still occur under the review step's `env:` for AC-37.) Negative: a fixture checking out `head.sha` fails the checker. |
| AC-30, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-38 | **Workflow-YAML security test** (server unit, which parses the YAML, not regex on text). It checks: `on` keys equal `['pull_request']`; types for input `['opened','issue_comment','reopened']` equal `['opened','reopened']`; no forbidden event name anywhere in the document; `permissions` deep-equals the two entries and no job has `permissions`; the job `if` references `head.repo`; every `uses` matches the 40-hex pattern and the set of action names equals the three; every `secrets.` occurrence is one of the two and sits under the review step's `env`; no `run` contains `${{`; `DEVDIGEST_POST_AS` equals the input for each of the three values; the upload step has `if: always()` and the artifact name. Negative: a fixture workflow with `issue_comment`, a `@v4` tag and `${{ github.event.pull_request.title }}` in `run:` fails the test's own invariant checker, which shows the checker can fail. |
| AC-48, AC-49, AC-50 | **Ingest-rejection test** (server unit over a fake `GitHubClient` and an in-memory repo stub): an entry whose `commit_sha` differs from `head_sha` writes no row and `skipped` is 1; an entry whose `repository_id` differs writes no row; a non-zip, a zip without the entry, invalid JSON and a schema-failing entry are each skipped while a valid run in the same refresh is still ingested. Positive control: a matching entry writes exactly one row with `source='ci'`. |
| AC-80 | **Ingest-rejection test**: an entry with `gate_triggered: true` ingested for an agent whose current `ci_fail_on` is `never` yields a row whose `CiRun.verdict` is `request_changes`. An entry with `gate_triggered: false` for an agent at `any` yields `approve`. Together these show that the current setting is not consulted. |
| AC-81, AC-83 | **Wizard client test** (the same file): changing a trigger on Configure changes the Preview YAML while it is unedited; after an edit, the same change leaves the YAML byte-identical and renders the notice. The repository select is prefilled with the active repo's `full_name`; typing `not-a-repo` disables Continue, and typing `acme/x` enables it. |
| AC-82, AC-84, AC-85, AC-86, AC-87, AC-88, AC-89 | **Untested**. Manual walk: "Update CI config" after a manual YAML edit produces a commit whose workflow equals the regenerated one, and the CI tab shows the discard text; "Add repository" opens the wizard; status reads `pr_open` after export and `active` after the first ingested run; a re-export after merging the first PR opens a new PR whose diff against the default branch holds only the changed files. `plan-verifier` reads the limits 30 and 100 in the diff. |
| AC-91 | **Workflow-YAML security test**: a step before the runner step tests for `.devdigest/runner/index.js` and the runner and upload steps are conditioned on its output. Negative: a fixture without the guard fails the checker. Manual walk step 2: the export PR's check is green with the notice in its log. |
| AC-92 | **Runner test**: a stub LLM that throws yields exit 1, zero GitHub writes, and an artifact whose entries have `status: "error"`, a non-empty `error` that does not contain the fake `OPENROUTER_API_KEY` value, and valid `commit_sha`/`repository_id`. **Ingest-rejection test**: an error entry with matching SHA and repo id writes one row with `status = 'failed'`; the same entry with a wrong SHA writes none. |
| AC-90 | `plan-verifier`: `git diff --name-only main -- client/package.json client/pnpm-lock.yaml` prints nothing, and the zip module imports nothing outside the repo. Manual: the downloaded zip extracts with `unzip -t` reporting no errors. |
| AC-61, AC-62, AC-63, AC-64, AC-65, AC-66 | **Wizard client test** (one file): opening shows four steps with Target active; exactly one target option, with no "CircleCI", "Jenkins" or "Generic CLI" text; Preview lists the fixture paths and only the workflow is editable; after an edit, the `open_pr` request body's `workflow_override` equals the edited text; Configure defaults match; the secrets panel has no "not set"/"ready" text and the test's fetch mock records no secrets request. |
| AC-67, AC-68, AC-69, AC-70, AC-71 | **Untested** (the single wizard test stops at AC-66). Checked in the manual walk, steps 1 and 2. |
| AC-1, AC-2 | `bash scripts/check-agent-docs.sh`; `git ls-files agent-runner/dist` prints nothing; `npm run build` produces `dist/index.js`. Run by the session at Validation. |
| AC-22 | `plan-verifier` reads the generated migration and schema. **Untested**: the integration lane is the user's. |
| AC-39, AC-40, AC-41, AC-42, AC-43 | **Untested**. Manual walk steps 1 and 2 (the PR exists on `devdigest/ci`, the edited YAML is in it, and a second export reuses the PR URL). |
| AC-44, AC-45, AC-46 | **Untested**. Manual: "Update CI config" after changing the prompt bumps `workflow_version` and pushes a commit to the open PR. |
| AC-47, AC-51, AC-52, AC-53, AC-54 | AC-51's positive control is in the ingest-rejection test. The others are **untested**. Manual walk step 9 (a run appears with the correct repo, PR and SHA; a second Refresh adds no row). |
| AC-55, AC-56, AC-57, AC-58, AC-59, AC-60 | **Untested**. Manual walk on the CI tab. |
| AC-72, AC-73, AC-74, AC-75, AC-76, AC-77 | **Untested**. Manual walk step 9. `nav.ts` diff read by `plan-verifier` and re-checked after each merge. |
| — | **Manual verification flow**, on a demo fork to be named later: (1) export the agent to it; (2) review the export PR by hand for permissions, triggers, secret references and the `node .devdigest/runner/index.js` step; (3) add `OPENROUTER_API_KEY` under Settings → Secrets and variables → Actions; (4) merge; (5) open a **same-repo** test PR (not a fork); (6) confirm the review is posted per post-as; (7) with "Fail CI on: critical", re-exported, and the check required in branch protection, confirm that a PR with a CRITICAL finding turns the required check red; (8) download the artifact and read the job log, and confirm that no secret value appears in either; (9) Refresh CI Runs and confirm the run is listed with the job link and the correct repo, PR number and commit SHA. |

**Verification commands** (Validation phase):

- `cd agent-runner && npm run typecheck && npm test && npm run build`;
- `cd server && pnpm typecheck && pnpm lint && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
- `cd client && pnpm typecheck && pnpm lint && pnpm test`;
- `bash scripts/check-specs.sh` and `bash scripts/check-agent-docs.sh`.

The integration lane and `./scripts/e2e.sh` are the user's.

## Summary to report

At Completion, the implementing session reports, per PR (runner, feature):

- tokens used, by agent;
- wall-clock time from start to merge-ready;
- review time (the `plan-verifier`, `architecture-reviewer` and fix-loop share of that);
- merge conflicts met when rebasing onto the runner PR and onto worktree A, with how each was
  resolved. Report `nav.ts` and `contracts/eval-ci.ts` explicitly, even when clean.

## Phases

| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-10-15 | 3 researcher runs (upstream agent-runner, upstream 0574487 reference, local scaffold); INSIGHTS routed |
| Planning | 2026-10-15 | spec-creator draft + 3 rounds of user decisions; approved by the user 2026-10-15 |
| Implementation | | |
| Validation | | typecheck · lint · tests · e2e · manual |
| Completion | | status done, docs, insights wrap-up |
