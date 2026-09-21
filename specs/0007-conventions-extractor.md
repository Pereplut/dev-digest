---
title: Conventions Extractor
status: in-progress  # draft | approved | in-progress | done
packages: [server, client, e2e]
---

## Problem
The slides ask for a **Conventions** tab in SKILLS LAB: analyse a repository, propose house coding
conventions with code evidence, let the user accept / reject / edit each one, and merge the accepted
set into a single editable skill. Homework criteria 38–41 grade four parts of this literally:

- **#38** `POST /repos/:id/conventions/extract` really runs an analysis; the result is persistent.
- **#39** Sample picking is **pure code, no LLM** — eslint/tsconfig/prettier configs + top-12 files
  via `repoIntel.getConventionSamples()`.
- **#40** The model returns `{category, rule, evidence: file+line, confidence}`.
- **#41** The create-skill modal edits the future skill **body and metadata**, not just the name.

The requirement notes add one more, ungraded but load-bearing: **validate each candidate's evidence
against the real project files in code — does the file exist, does the cited line contain that code?
Candidates without proof are rejected.**

Much of the scaffolding already exists, unwired, and is reused rather than rebuilt:
- **DB:** `conventions` table with **zero readers/writers** (`server/src/db/schema/knowledge.ts:31`,
  created in `0000_init.sql:96`); listed as roadmap scaffolding at `server/src/db/schema.ts:16-31`.
- **Contracts:** `ConventionCandidate` (`server/src/vendor/shared/contracts/knowledge.ts:197`) — no
  `category`, no line numbers.
- **Sampling:** `getConventionSamples(repoId, n)` (`server/src/modules/repo-intel/service.ts:633`),
  zero callers in `src/`, documented as reserved for convention extraction.
- **Model selection:** a `conventions` entry already in `FEATURE_MODELS`
  (`server/src/vendor/shared/contracts/platform.ts:72`) with `resolveFeatureModel`
  (`server/src/modules/settings/feature-models.ts:51`).
- **Skills:** `skills.type='convention'`, `skills.source='extracted'` and `skills.evidence_files`
  already exist (`server/src/db/schema/skills.ts:17,42,49`); `no-then-chains` is a seeded
  `source:'extracted'` convention skill (`server/src/db/seed-skills.ts:468-475`).
- **Test seam:** `MockLLMProvider.structuredBySchema` was added for this feature
  (`server/src/adapters/mocks.ts:56-60`) and is currently unused.
- **Client:** `activeKeyFor` already maps `/conventions` (`client/src/components/app-shell/helpers.ts:31`)
  and `nav.conventions` already exists (`client/messages/en/shell.json:23`).
- **Job pattern:** `POST /repos/:id/resync` (`server/src/modules/repo-intel/routes.ts:43-65`) is the
  202-with-jobId template, including handler registration at plugin load.

## Scope / non-goals
In scope: a `conventions` server module, the schema extension, contracts in both vendored copies, the
`/conventions` page, the create-skill modal, seed, tests, one e2e flow, docs.

Not in scope: re-extracting automatically on poll/sync; enforcing conventions during a review
(accepted conventions reach agents only through the skill the user creates); cross-repo views; a
Stats tab for conventions.

## Decisions (agreed with the user 2026-09-20)
1. **Re-scan merges.** Candidates upsert on a stable fingerprint; an existing `accepted`/`rejected`
   decision survives a re-scan. New rules arrive as `pending`.
2. **Cheap model.** The `conventions` registry default drops from `openai/gpt-5.4` to
   `openrouter/deepseek-v4-flash` (what Onboarding already uses). Settings still overrides it.
3. **Background job + live progress.** `POST …/extract` returns 202 and the page polls, reusing
   `JobRunner` as `resync` does.
4. **Seeded candidates only.** The seeded repo `acme/payments-api` has `clone_path: null`
   (`server/src/db/seed.ts:91`) and the hermetic e2e stack has no clones at all, so the three
   screenshot candidates are seeded pre-validated. A *real* extraction is demonstrated by hand
   against the imported clone `server/clones/Pereplut/dev-digest`. Automated coverage of the real
   pipeline comes from an integration test writing a throwaway checkout to a temp dir — no fixture
   repo is committed.
5. **Unindexed repos get a deterministic directory-walk fallback.** `getConventionSamples()` runs
   first (the graded path); when it returns `[]` the job walks the clone with a fixed heuristic. The
   scan row records which picker ran.
6. **Route `/conventions`**, repo taken from `useActiveRepo()`; breadcrumb "Skills Lab › Conventions".

## Design

### DB (`server/src/db/schema/knowledge.ts`), then `pnpm db:generate` → `0016_*.sql` and `pnpm db:migrate`
Extend the existing `conventions` table (nothing reads it, so this is safe):
- `category text not null`; `evidence_start_line` / `evidence_end_line` integer null.
- **drop** `accepted boolean` and add `status text not null default 'pending'`
  (`pending|accepted|rejected`) — a boolean cannot distinguish "rejected" from "not yet decided",
  which the merge-upsert needs.
- `fingerprint text not null`, `evidence_valid boolean not null default false`,
  `rejected_reason text`, `scan_id uuid → convention_scans set null`, `created_at`/`updated_at`.
- Index `conventions_repo_idx` on `repo_id`; **unique `(repo_id, fingerprint)`** — the upsert target.

New `convention_scans` — the pollable status surface, because the `jobs` table is write-only
(`server/src/platform/jobs.ts:97-110`): `id, workspace_id, repo_id, status(running|done|failed),
sampler(repo-intel|walk), sample_file_count, candidate_count, rejected_count, model,
cost_usd numeric(12,6) null, error, started_at, finished_at`.

`cost_usd` is a **string** in Drizzle 0.38 — convert at the row↔DTO boundary in the repository
(server INSIGHTS :144). Row types go in `db/rows.ts`, never imported from another module's
repository (server INSIGHTS :77).

**Fingerprint:** a pure function of `(evidence_path, normalised rule)` — lowercase, collapse
whitespace, strip trailing punctuation, sha256, first 16 hex. It excludes line numbers and
confidence, so a rule found again at a shifted line updates its row instead of duplicating it.

### Contracts (`server/src/vendor/shared/contracts/knowledge.ts`, hand-mirrored to the client copy)
`ConventionCandidate` grows in place under the existing `// ---- Conventions ----` heading — it is
unused, so this is not a breaking edit, and splitting one small contract across two files would be
worse. Added: `ConventionStatus`, `ConventionCategory` (8 values), `ConventionScan`,
`ConventionsPage`, `ConventionPatch`, `ConventionSkillDraft`. All snake_case, each schema followed by
`export type X = z.infer<typeof X>`.

Mirroring into `client/src/vendor/shared` is by hand (root INSIGHTS :19), and client code imports
these as **types only** (client INSIGHTS :83).

### Server: new module `src/modules/conventions/`
Pure free functions first, so they unit-test with no DB and no clone:
- **`sampling.ts`** — `CONFIG_CANDIDATES` (eslint/tsconfig/prettier/package.json probed at the clone
  root), `pickSamplePaths()` (configs present, then the top 12 ranked), `walkFallbackPaths()`
  (decision 5), `buildSampleBlock()` (per-file truncation + 1-based line numbers, so the model's
  line citations mean something).
  ⚠ `getConventionSamples()` **cannot** return configs — its junk filter
  (`repo-intel/service.ts:717-731`) excludes `eslint`, `prettier`, `.config.`. Configs come only from
  the direct probe.
- **`proof.ts`** — `validateEvidence(fileContent, candidate)`: missing file → `file_not_found`;
  range outside the file → `line_out_of_range`; normalised snippet not inside a **±2-line window**
  around the cited range → `snippet_not_found`; otherwise pass, and the snippet is **re-derived from
  the real file** so the UI never shows model-authored code. Failures are persisted as
  `status='rejected'` with a reason, not dropped — that keeps the rejection auditable and stops the
  next scan re-proposing them.
- **`skill-body.ts`** — `renderConventionsSkill(repoName, candidates)`, the markdown in the design.
- **`prompt.ts`** — `buildExtractionMessages()`. The sample block is untrusted and goes inside the
  `<untrusted>` wrapper with the task line outside it (server INSIGHTS :102).
- **`repository/convention.repo.ts`** — the only file importing `drizzle-orm`; the merge-upsert and
  the scan lifecycle.
- **`service.ts`** — orchestration through `container.git`, `container.repoIntel`,
  `container.llm(...)`, `container.skillsRepo`. No SDK imports, no SQL.
- **`routes.ts`** — transport only, plus job-handler registration at plugin load:
  `GET /repos/:id/conventions`, `POST /repos/:id/conventions/extract` (202),
  `PATCH /conventions/:id`, `POST /repos/:id/conventions/skill`. Registered in `modules/index.ts`.

`clone_path` null → **409** with an explicit message, not a silent empty result: repo-intel's silent
degradation is recorded as a defect (server INSIGHTS :15). `enqueue`'s promise gets a `catch` sink
(server INSIGHTS :96).

The skill is created through a dedicated route rather than `POST /skills`, because `CreateSkillBody`
(`modules/skills/routes.ts:27`) accepts neither `enabled` nor `evidence_files`. The conventions
service writes it via `container.skillsRepo` with `source:'extracted'` — cross-module reuse goes
through the container, never by importing another module's service.

Also: lower the `conventions` `FEATURE_MODELS` default, and fix the stale two-step comment at
`server/src/adapters/mocks.ts:56-59` (criterion #39 forbids an LLM file-selection step).

### Seed (`server/src/db/seed.ts`)
One `done` scan plus the three screenshot candidates for `acme/payments-api`, all `pending` and
`evidence_valid: true`, with a comment explaining that they are seeded as already-proved because the
fictional repo has no checkout.

### Client
- `client/src/vendor/ui/nav.ts`: add Conventions to SKILLS LAB (`ListChecks`, `/conventions`,
  `gKey: "c"`) and `g c` to `SHORTCUTS` — the spec-0006 vendored-code exception, already exempted in
  `review_scope.py`.
- `src/app/conventions/` — `page.tsx` + `_components/{ConventionsView,ConventionCard,EvidenceBlock,CreateSkillModal}/`
  + `_lib/test-utils.tsx`, following the `app/skills/_components/SkillForm/` file split.
- `src/lib/hooks/conventions.ts` — `useConventions(repoId, poll)` (poll at 1500ms while the scan is
  running, modelled on `hooks/repo-intel.ts:31-48`), `useExtractConventions`, `usePatchConvention`
  (optimistic + rollback), `useCreateConventionSkill`.
- Confidence bar: the kit `ProgressBar` with `ConfidenceNum`'s thresholds (≥85 `--ok`, ≥65 `--warn`).
- Modal token count is an approximation (`ceil(len/4)`, the server tokenizer's own fallback), shown
  with a `≈` — there is no client-side tokenizer.
- New `client/messages/en/conventions.json`, shipped with the page (client INSIGHTS :52).

### e2e
New read-only `09-conventions.flow.json`; the mutating `09-pr-finding-actions` moves to `10-`
(read-only flows must sort first). Update the coverage table in `e2e/README.md`.

The suite ends at **9/10**: the new conventions flow passes, and the only red one is the
pre-existing mutating flow, whose closing re-navigation is flaky. That was verified by removing
`09-conventions` and re-running — it still fails, at a *different* step (see `e2e/INSIGHTS.md`,
2026-09-20). Not a regression from this spec, and left unfixed as out of scope.

## Acceptance criteria
1. `POST /repos/:id/conventions/extract` runs a real analysis and its candidates survive a restart (#38).
2. Sample selection makes **no** LLM call and uses configs + `getConventionSamples()` (#39).
3. Each candidate carries category, rule, evidence file **and line**, and confidence (#40).
4. A candidate whose evidence does not exist in the repo is rejected with a reason.
5. The Conventions page lists candidates with evidence and confidence, and accepts / rejects / edits
   each one, persistently.
6. "Create skill" opens a modal whose body **and** metadata are editable before saving (#41), and
   saving creates a `convention` skill with `source: 'extracted'` visible in Skills Lab.
7. A re-scan preserves earlier accept/reject decisions.

## Test plan
- **Server unit (hermetic):** `sampling`, `proof` (all four outcomes + the ±2-line window),
  `fingerprint` normalisation, `skill-body` rendering, `prompt` guard placement.
- **Server integration (`conventions.it.test.ts`):** the whole extract path against a temp-dir
  checkout with `MockLLMProvider`; the merge-upsert preserving a decision; 409 on a null clone path;
  skill creation with `evidence_files`. Read the skipped count (server INSIGHTS :108).
- **Client:** `ConventionCard` (accept payload, inline edit, bar colour), `ConventionsView` (counter,
  empty / no-clone states, polling stops), `CreateSkillModal` (nothing saved before Create, edited
  body reaches the payload).
- **e2e:** the read-only conventions flow.
- **Manual:** the dev app on the seeded repo, then a real re-scan against the imported clone.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-20 | slides + hw_2 read; specs + INSIGHTS checked; existing scaffolding inventoried |
| Planning | 2026-09-20 | decisions agreed with the user (see Decisions) |
| Implementation | 2026-09-20 | migrations 0016/0017 (split in two: drizzle-kit prompts interactively when one pass both adds and drops columns); contracts mirrored into both vendored copies; `modules/conventions/` (sampling → proof → skill-body → prompt → repo → service → routes); seed; `/conventions` page + modal; nav `g c`; docs/conventions.md |
| Validation | 2026-09-20 | server 200 unit (44 new) + 62 integration, **0 skipped** (`conventions.it.test.ts` 6/6) · reviewer-core 43 · client 176 (31 new) · 0 lint errors, 0 new `pnpm arch` violations · live dev-API check of all five routes incl. the 409 no-clone path and the generated skill body · e2e: the new `09-conventions` flow passes |
| Completion | 2026-09-20 | `docs/conventions.md` written and indexed; INSIGHTS entries in `server/` (the `getConventionSamples` config gap, the drizzle-kit interactive-prompt trap) and `e2e/` (the `10-` flake, the hermetic stack's memory floor). Pending: `/pr-self-review` by the user, then PR |
