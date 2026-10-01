---
title: Project Context
status: draft
packages: [server, client, reviewer-core]
---

## Problem & why

A reviewer can only enforce rules it was told. DevDigest's agents today carry a system prompt and
skills — text a user typed into the studio — but nothing connects them to the standards the team
already wrote down in the repository: the specs, the ADRs, the insight logs. So a PR that breaks a
rule written in `specs/0008-intent-layer.md` is reviewed by a model that has never seen that file,
and the one artifact that could have made the finding citable and arguable is absent.

**Most of the plumbing for this already exists and is wired to nothing.** This feature is wiring,
not invention, and the spec says so explicitly so an implementer does not rebuild what is there:

| Already exists | Where | State |
|---|---|---|
| A prompt input for project-context chunks | `reviewer-core/src/review/run.ts:86` — `ReviewInput.specs?: string[]`, commented *"Project-context spec chunks (untrusted; delimiter-wrapped downstream)"*, flowing into `promptParts.specs` at `:199` | never populated by this server |
| A prompt slot and its untrusted wrapper | `reviewer-core/src/prompt.ts:161-171` (`PromptSectionName` includes `specs`), `:236-239` (`wrapUntrusted('spec-N', …)`) | renders only when `parts.specs` is non-empty, which is never |
| Per-section prompt metadata, persisted per run | `reviewer-core/src/prompt.ts:191-210` (`PromptSectionInfo` / `AssembledPrompt.sections`) | live, used by the trace |
| The server's own admission that the slot is dead | `server/src/platform/prompt-log.ts:36-38` — `SECTION_SOURCE.specs = 'unwired'`, `.memory = 'unwired'`, with the comment *"The engine supports these slots; this server has never populated them"*; also recorded in `specs/0009-prompt-assembly-logging.md:120-121` | a known fact, not a bug |
| A safe clone reader with all four guards | `server/src/platform/safe-read.ts:53-73` — `readTextFileInClone(clonePath, relPath, maxBytes)`: string vetting, `resolve` + `startsWith(root + sep)`, `lstat` (not `stat`), `realpath` + second containment check, `.git/` exclusion, and a size cap that returns `null` rather than truncating | live, used by the intent layer and the conventions extractor |
| The run-trace **Prompt assembly** accordion, including a `specs` block | `client/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx:87-137`, with the slot rendered at `:115-122`; copy already at `client/messages/en/runs.json:51` (`"specs": "Project context (dynamic)"`) | renders an empty slot |
| Per-segment copy and fullscreen-expand controls — the mockup's buttons | `client/.../PromptBlock.tsx:73-101` | built |
| A declared-but-unshipped **Context** tab on the skill editor | `client/src/app/skills/_components/SkillDetail/constants.ts:4-21` — `{ key: "context", … shipped: false }`, excluded from `VALID_TABS`, comment citing *"spec 0006 decision 5"* | the tab mechanism exists; the flag is off |
| An ordered, per-agent attachment list with a full-replace route | `server/src/db/schema/agents.ts:51-65` (`agent_skills` with `order` + `enabled`), `server/src/modules/agents/routes.ts:154-161` (`PUT /agents/:id/skills`, one transaction) | the exact shape this feature needs for documents |
| An attachment UI with checkboxes, drag ordering and a token footer | `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:1-157` + `SkillRow.tsx` | the mockups draw this interaction verbatim |
| A tokenizer behind DI | `server/src/adapters/tokenizer/index.ts:25-40` (`TiktokenTokenizer.count`, `cl100k_base`, with an `approxTokens = ceil(chars/4)` fallback), reachable as `container.tokenizer.count` (`server/src/platform/container.ts:153-156`) | live |

What is genuinely missing is: a reader that discovers Markdown in a clone, two persisted attachment
lists, a merge rule, a token budget, a browser page, two editor tabs, and a trace field that records
**per document** what was attached and how big it was.

**The trap this spec must not fall into.** `RunTrace.specs_read`
(`server/src/vendor/shared/contracts/trace.ts:118`) and the "Specs read" trace row already exist and
look like the right home for this. They are not. `specs_read` is fed by the PR-intent layer (spec
0008), which regex-extracts spec links from the **PR body**
(`server/src/modules/reviews/intent-helpers.ts:60`) and feeds them to a separate cheap-model intent
classifier — **not** to the review prompt. It is a bare `string[]`: no per-document size, no read
status, no click-through. Project Context is a different input with a different provenance and gets
its own field and its own prompt slot (see `## Decisions`, row 7).

**And the security fact that shapes half the criteria.** `server/INSIGHTS.md:218-224` records that a
clone's `.git/config` holds a live `x-access-token` (`withGitHubToken`,
`server/src/modules/repos/helpers.ts:29`), so "inside the clone root" is not a safety boundary and
`.git/` must be refused outright. `server/INSIGHTS.md:268-274` records that **vetting a path string
is not a filesystem boundary**: a repo that commits `specs/public-api.md` as a symlink to
`../../.env` or `~/.ssh/id_rsa` passes a naive check and the target is read, put in a prompt and
shipped to a model provider. That entry ends *"repo-intel's walker already refused symlinks; a new
reader in another module does not inherit that."* **This feature is exactly such a new reader.**

## Goals / Non-goals

### Goals

- Discover Markdown documents in a repository's clone under configurable roots, and report each
  one's path, byte size and token count.
- Let a user attach an ordered list of those documents to an **agent** and to a **skill**.
- At run time, read the attached documents from the clone and inject their full text into the review
  prompt as an untrusted, delimiter-wrapped `## Project context` block — with no extra LLM call.
- Record in the run trace which documents were attached, their token size and their full text, so a
  user can open a finished run and read exactly what the model was given.
- Refuse a run whose attached documents exceed the context budget, naming the documents and the
  overage, rather than truncating silently.
- Surface an attached document that could not be read as a warning **on the run**, not only in the
  trace, so a review that lost a rule says so where the user is already looking.
- Reuse `readTextFileInClone` for every byte read out of a clone, so the four guards and the `.git/`
  exclusion are inherited rather than reimplemented.
- Seed a committed fixture clone, so every state the mockups draw is reachable on a dev stack
  instead of only the degraded one.

### Non-goals

- **Any git write path.** The Project Context page is a read-only browser in v1: list, filter,
  preview, refresh. The mockup's `+` / new-folder / upload icons and its `Preview | Edit` toggle are
  cut — shipping them would mean a commit path and a new GitHub auth scope, neither of which this
  feature needs.
- **The COVERAGE donut** in `project-context-page.png`. It is a metric nobody has defined. The
  "Used by N" badge stays, because counting the agents and skills that attach a document is
  well-defined.
- **Reading from the PR head.** Documents come from the synced default branch only (`## Decisions`,
  row 2).
- **Pinning to a commit sha.** `GitClient` (`server/src/vendor/shared/adapters.ts:222-245`) has no
  `readFileAtRef`; adding one is new capability. The staleness window of reading the synced tip is
  an accepted edge case, not a defect.
- **Indexing Markdown into `code_chunks`.** Repo-intel is code-only (ast-grep).
  `server/src/db/schema/context.ts:31-47` declares `source: enum('code','docs','spec')` but nothing
  in `server/src` ever inserts into it — dead aspirational schema. This feature does not revive it.
- **Repurposing `skills.evidence_files`** (`server/src/db/schema/skills.ts:27-60`). That jsonb
  `string[]` is provenance only, written once when a convention is extracted and never read at run
  time (`server/src/modules/conventions/service.ts:241-252`). Project Context documents are a
  different thing with a different lifecycle and get their own storage.
- **Merging into the existing `specs` prompt slot or the `specs_read` trace field.** Both stay as
  they are, owned by the intent layer.
- **The agent editor's Evals / Stats / CI tabs**, drawn in `agent-context-tab.png`. Only **Context**
  ships; the rest stay unrendered, as `SkillDetail/constants.ts:11-14` already handles for skills.
- **A UI for editing a repository's document roots.** The roots live in a nullable `doc_roots jsonb`
  column on `repos` (AC-44); v1 reads it and falls back to the default glob when it is NULL. There
  is **no editing surface in v1** — a root list is changed by seed or migration, not by a user.
- **An e2e flow.** Now *possible* once the seed fixture of AC-45 lands, but still out of v1 scope:
  the flows assert seeded values, and adding a flow over a brand-new fixture in the same change
  doubles the surface under review. Deferred by scope, not by impossibility.

## Decisions

Settled with the user before drafting; recorded so an implementer does not reopen them.

| Question | Decision | Consequence |
|---|---|---|
| Can the user create or edit documents from the Project Context page? | No. v1 is a read-only browser: list, filter, preview, refresh. | The mockup's add / new-folder / upload icons and `Preview \| Edit` toggle are cut. No git write path, no new auth scope. |
| Which revision are documents read from? | The repo's **synced default branch** clone, never the PR head. | A PR that edits a spec to permit its own violation cannot change the rules it is reviewed under. Cost: a document edited on the PR branch is reviewed at its old text, and the clone's sync lag is visible to the user. |
| What happens when attached documents exceed the budget? | The run **refuses to start**, naming each document and the overage. | Never a silent truncation. `server/INSIGHTS.md:15-21` records that repo-intel already "degrades silently" and calls it a debugging trap; this feature does not repeat it. |
| How do an agent's and its skills' documents combine? | Union, deduped by path, **skills first**, keeping the first position. | A skill's documents are the shared baseline; the agent's own are its specialisation. A path attached in both appears exactly once, at its skill-order position. |
| Where do documents come from in the repo? | The repo's own `specs/`, `docs/`, `insights/`, configurable per repo. Default glob `**/{specs,docs,insights}/**/*.md`. | The mockup's `.devdigest/specs/` header is the breadcrumb of the active root, not a new convention — `.devdigest/` exists nowhere in this codebase and is not introduced. |
| Where does the nav entry go? | The **WORKSPACE** group, beside Pull Requests, as `project-context-page.png` draws it. | Diverges from specs 0006 / 0007, which created and extended a dedicated SKILLS LAB section. Reason: SKILLS LAB configures the reviewer; this page browses the repository's own content, which is workspace data. |
| Does Project Context reuse the existing `specs` prompt slot? | No — its own slot. | `reviewer-core` gains a `project_context` section name beside `specs`; `specs` and `RunTrace.specs_read` stay owned by the intent layer (spec 0008), whose documents are chosen by a regex over the PR body, not by a user. |
| Does the COVERAGE donut ship? | No. The "Used by N" badge does. | A donut with no defined metric would be a number nobody could check; an attachment count is deterministic. |
| An attached document cannot be read at run time — refuse the run, or run without it? | **Run without it**, with the non-`ok` status in the trace (AC-22) **and** a run-level warning on the run itself (AC-40, AC-41). | A renamed or deleted document must not block every review on every PR for every agent attaching it. **This is deliberately the opposite of the over-budget rule (AC-21), which refuses.** The two differ because the causes differ: an over-budget run is a *configuration* error the agent's owner made and can fix in one edit, and the only alternative to refusing is truncating text the user believes was sent. An unreadable document is a *repository* state change outside that owner's control. The price of proceeding is exactly the degradation `server/INSIGHTS.md:15-21` calls a debugging trap, so the mitigation is that the warning is run-level and visible without opening the trace — trace-only would re-create the trap. |
| What is the project-context token budget, and where does the number live? | A fixed **20,000 tokens per run**, declared beside `INTENT_MAX_SPEC_CHARS` in `server/src/modules/reviews/constants.ts` (AC-42). | One constant, cheap to move. It is wrong at both ends of the model range by construction — see `## Non-functional`. |
| What does the page footer show? | A document count and scan recency from the Project Context scan; **no chunk count** (AC-43). | `project-context-page.png`'s `1,240 chunks` has nothing behind it: `code_chunks` (`server/src/db/schema/context.ts:31-47`) declares `source: 'docs' \| 'spec'` but nothing in `server/src` ever inserts into it, and repo-intel is ast-grep/code-only. Dead schema, recorded here so nobody rediscovers it as an opportunity. |
| Where do document roots live? | A nullable `doc_roots jsonb` column on `repos`, NULL meaning the default glob (AC-44). | `settings` (`server/src/db/schema/core.ts:39-67`) is keyed `(workspace_id, user_id, key)` with no `repo_id`, so a repo id could only be smuggled into the key string — a schema that lies about its own grain. The column is added in `server/src/db/schema/repos.ts` and the migration is **generated** with `pnpm db:generate`; migrations are never hand-written (root `AGENTS.md`, "Do not touch"). |
| The dev and demo stacks have no clone at all — what does the page show? | Seed a committed fixture clone and point `acme/payments-api`'s `clonePath` at it (AC-45, AC-46). | `scripts/e2e.sh` clones nothing and the only seeded repo has `clonePath: null` (`server/src/db/seed.ts:93`; `server/src/db/seed-conventions.ts:5` calls it FICTIONAL — `updateClonePath`, `server/src/modules/repos/repository.ts:73`, only fires on a real sync). Without a fixture the page renders the AC-3 degraded state on every dev and demo stack, while the mockups are drawn against that same repo showing six documents it cannot have. AC-3 stays regardless: a real connected repo can still be unsynced. |
| Where does the `project_context` block sit in the prompt? | Immediately before `repo_map`, i.e. after system / skills / task / PR description / intent / memory and before the repo-intel blocks (AC-47). | Matches `run-trace-prompt-assembly.png`, which draws it above Repo skeleton. This is **earlier** than the legacy `specs` slot, which `reviewer-core/src/prompt.ts:300-303` renders between `repo_map` and `callers`. Order is user-visible: `PromptSectionInfo[]` is persisted in render order and the trace accordion renders that array. |
| The skill mockup's **SERIALIZES AS** panel contradicts the requirements. | The requirements win. | `skill-context-tab.png` draws `## Project specifications` over a bare path list; `requirements.txt` line 3 says the block is `## Project context` carrying the documents' **text**. A path-only block would make the whole feature a no-op, so the mockup's panel is wrong, not the implementation. Recorded here so a later reader does not read the mockup as evidence of drift. |
| Does the agent's Context tab show documents inherited from its skills? | Yes — marked with their source skill, non-toggleable there, and counted in the footer total (AC-48, AC-49, AC-50). | With the skills-first merge rule, an agent's effective list is not the list its own attachments describe, so a footer summing only its own documents is simply **wrong** for any agent whose skills attach anything. The user's stated purpose is *"so we understand how many tokens will be added to each prompt"*; a wrong total defeats it. |

## User stories

- As a **tech lead**, I want to attach our written standards to a review agent, so that the
  reviewer enforces the rules we already agreed on instead of its own generic priors.
- As a **tech lead**, I want to attach documents to a skill, so that every agent using that skill
  inherits the same baseline without my re-attaching them one agent at a time.
- As a **developer reading a review**, I want to open a finished run and read the exact document
  text that was sent, so that I can tell whether a finding came from our standard or from the model.
- As a **developer configuring an agent**, I want to see the token cost of each document and the
  running total before I save, so that I learn what each attachment costs every run.
- As a **developer browsing the repo**, I want one page that lists every project document DevDigest
  can see and renders it, so that I can tell what is attachable without switching to GitHub.
- As a **security-minded operator**, I want document text to reach the model as data and never as
  instruction, and no file outside the repository to be readable through this path, so that a
  malicious repository cannot steal a token or rewrite the review.

## Acceptance criteria (EARS)

### Discovery and reading (server)

**AC-1** — WHEN a client requests `GET /repos/:repoId/context-docs` for a repository in its
workspace, the Project Context API shall respond `200` with a `documents` array holding one entry
per discovered Markdown file, each carrying `path` (clone-relative, POSIX separators), `root` (the
configured root it matched), `bytes`, `tokens`, `tokens_approx` (boolean), `status`, and
`used_by_agents` / `used_by_skills` counts.

**AC-2** — WHERE a repository has no configured document roots, the Project Context service shall
discover documents with the default glob `**/{specs,docs,insights}/**/*.md`, and shall use the
repository's stored roots when they are present.

**AC-3** — IF `repos.clone_path` is null or the directory it names does not exist, THEN
`GET /repos/:repoId/context-docs` shall respond `200` with `documents: []`, `degraded: true` and
`reason: "not_cloned"` — never a 4xx or 5xx.

**AC-4** — The Project Context document walker shall exclude any entry whose first path segment is
`.git`, any entry whose `lstat` reports a symbolic link, and any entry whose `realpath` does not
remain inside the resolved clone root.

**AC-5** — The Project Context server module shall read file contents only through
`readTextFileInClone` (`server/src/platform/safe-read.ts:53`) and shall contain no direct import of
`node:fs` or `node:fs/promises` for reading a clone file.

**AC-6** — WHEN a client requests `GET /repos/:repoId/context-docs/content?path=<p>`, the Project
Context API shall respond `400` if `p` fails `isSafeRelativePath` or does not end in `.md`, `404` if
`readTextFileInClone` returns `null`, and `200` with the file's text otherwise.

**AC-7** — The Project Context service shall compute each document's `tokens` with
`container.tokenizer.count`, and shall set `tokens_approx: true` exactly when the tokenizer is
serving the `approxTokens` fallback rather than the `cl100k_base` encoder.

**AC-8** — IF a discovered document is larger than `MAX_CONTEXT_DOC_BYTES`, THEN the Project Context
API shall return it with `status: "too_large"`, `tokens: null` and its real `bytes`, and shall not
return any part of its text.

**AC-44** — The `repos` table shall carry a nullable `doc_roots jsonb` column declared in
`server/src/db/schema/repos.ts`, whose NULL value selects the default glob of AC-2, and the
accompanying migration shall be the one `pnpm db:generate` produces — never a hand-written `.sql`
file.

### Attachment (server)

**AC-9** — WHEN a client sends `PUT /agents/:id/context-docs` with an ordered list of paths, the
Agents API shall replace that agent's entire document list in one transaction, preserving the
submitted order as the stored `order`.

**AC-10** — WHEN a client sends `PUT /skills/:id/context-docs` with an ordered list of paths, the
Skills API shall replace that skill's entire document list in one transaction, preserving the
submitted order as the stored `order`.

**AC-11** — IF a submitted path fails `isSafeRelativePath` or does not end in `.md`, THEN the
receiving route shall respond `400` and persist nothing from that request.

**AC-12** — WHEN a well-formed path is submitted for a document that does not currently exist in the
clone, the receiving route shall respond `200` and store it, because a document may be added or
removed after it is attached.

**AC-13** — WHEN an agent's document list changes, the Agents service shall include the new ordered
path list in the `agent_versions.config_json` snapshot it already writes for that edit.

**AC-14** — WHEN a review run resolves its documents, the run executor shall produce the union of
the enabled skills' documents followed by the agent's own, deduplicated by path, keeping each
duplicate's first occurrence and its position.

**AC-15** — WHILE a skill is disabled (`skills.enabled` false) or its `agent_skills.enabled` link is
false, the run executor shall contribute none of that skill's documents to the merged list.

**AC-50** — WHEN a client requests `GET /agents/:id/context-docs`, the Agents API shall respond with
the agent's **effective** merged list in run order, each entry carrying `inherited_from` — the name
of the skill it came from, or null for the agent's own attachments — so the editor never has to
recompute the merge rule client-side.

### Run time (server + reviewer-core)

**AC-16** — WHEN a review run assembles its prompt, the run executor shall read each attached
document from the repository clone synced to the repository's default branch, and shall not read any
file from the pull request's head revision on this path.

**AC-17** — The prompt assembler shall render attached documents into a `project_context` section
that is distinct from the `specs` section, and the run executor shall leave `PromptParts.specs`
unpopulated so the intent layer keeps sole ownership of that slot.

**AC-18** — WHEN the `project_context` section is rendered, the prompt assembler shall wrap each
document individually with `wrapUntrusted()`, using the document's repository path as the block
label, with the path appearing inside the wrapped block and nowhere outside it.

**AC-19** — IF an attached document's text contains the literal `</untrusted>`, THEN the prompt
assembler shall neutralise it via `wrapUntrusted()` and the run shall proceed, so that no document
can close its own delimiter.

**AC-20** — WHEN a run attaches project-context documents, the run executor shall make zero
additional LLM calls beyond those the same run would make with no documents attached.

**AC-21** — IF the merged documents' total token count exceeds `MAX_PROJECT_CONTEXT_TOKENS`, THEN
the run executor shall fail the run before issuing any model call, with an error naming every
attached document, each one's token count, the budget and the overage, and shall truncate no
document.

**AC-22** — IF an attached document cannot be read (absent, refused by a guard, or over
`MAX_CONTEXT_DOC_BYTES`), THEN the run executor shall record that path in the run trace with a
`status` other than `ok` and shall not substitute empty text for it silently.

**AC-23** — WHEN a run completes, the run executor shall write a `context_docs` array into the run
trace holding `path`, `bytes`, `tokens` and `status` for each attached document, and `RunTrace` shall
accept the field as nullish so traces written before this feature still parse.

**AC-24** — WHEN a run with one attached document completes, the assembled prompt recorded for that
run shall contain that document's full text, byte-for-byte, inside the `## Project context` block.

**AC-25** — WHEN a review runs against a pull request that violates an invariant stated only in an
attached document (the fixture: *"module `api/` must not import `db/` directly"*), the reviewer shall
produce at least one finding whose text names that document's path.

**AC-40** — WHEN a run completes with at least one attached document whose status is not `ok`, the
run executor shall record a run-level warning on the run itself — outside `run_traces.trace` and
reachable from the run summary — naming every affected document path and its status.

**AC-42** — The run executor shall take its budget from a `MAX_PROJECT_CONTEXT_TOKENS` constant
whose value is `20_000`, declared in `server/src/modules/reviews/constants.ts` beside
`INTENT_MAX_SPEC_CHARS`.

**AC-47** — The prompt assembler shall render the `project_context` section immediately before
`repo_map`, so that `AssembledPrompt.sections` reads `system`, `skills`, `task`, `pr_description`,
`intent`, `memory`, `project_context`, `repo_map`, `specs`, `callers`, `diff` — each present only
when it has content.

### Client

**AC-26** — The client navigation registry shall list a `Project Context` entry in the `WORKSPACE`
group, and shall register its keyboard shortcut in `SHORTCUTS` as a separate entry, because
`client/src/vendor/ui/nav.ts` keeps the two arrays parallel.

**AC-27** — The Project Context page shall render exactly one of five states — loading skeleton,
populated list, empty (`documents: []` with `degraded` absent), not-cloned (`degraded: true` with
`reason: "not_cloned"`), request error — and shall name the reason in the not-cloned and error
states rather than showing a blank pane.

**AC-28** — WHEN a user selects a document, the Project Context preview pane shall render its
Markdown through a pipeline that does not render embedded raw HTML, configured explicitly rather
than relying on the current absence of `rehype-raw` from
`client/src/vendor/ui/primitives/Markdown.tsx:1-42`.

**AC-29** — WHILE the refresh control's request is in flight, the Project Context page shall disable
that control and expose a busy state to assistive technology.

**AC-30** — The Project Context list shall show, per document, a badge whose counts are the number
of distinct agents and the number of distinct skills that directly attach that path.

**AC-31** — The skill editor shall render its `context` tab (`shipped: true`, included in
`VALID_TABS`), the agent editor shall render a `context` tab beside `config` and `skills`, and the
agent editor shall render no tab for Evals, Stats or CI.

**AC-32** — The Context tab shall render, per document row, an attach checkbox, the document path,
its root badge and a preview control, and shall render a footer holding the summed token count of
the attached documents and an `N of M attached` badge.

**AC-33** — WHILE the Context tab's document filter is non-empty, the Context tab shall disable drag
reordering, matching `SkillsTab`'s existing rule.

**AC-34** — WHEN a user toggles or reorders a document, the Context tab shall send the full ordered
list to the server, apply the change optimistically, and on failure restore the previous list and
raise a toast naming the failure.

**AC-35** — WHEN a user opens a run trace, the Prompt assembly accordion shall render a
`Project context` block listing each attached document with its token count, expandable to the full
text that was sent.

**AC-36** — WHERE a document's `tokens_approx` is true, the client shall mark that token count as an
estimate wherever it is rendered, so an approximate number is never shown as exact.

**AC-37** — The Project Context page, both Context tabs and the trace block shall take every
user-facing string from `client/messages/en/projectContext.json` (plus the existing `runs` namespace
for the trace slot label) and shall contain no hardcoded user-facing copy.

**AC-38** — WHILE the viewport is 640 px wide or narrower, the Project Context page shall render one
pane at a time with a control to move between the list and the preview, and shall not require
horizontal scrolling to reach either.

**AC-39** — Each attach control in a Context tab shall have an accessible name that includes the
document's path, so two documents with the same file name are distinguishable by assistive
technology.

**AC-41** — WHEN a run carries the warning of AC-40, the PR page shall display it on that run
without the user opening the run trace, in an element with `role="status"` that names each affected
document.

**AC-43** — The Project Context page footer shall render the number of documents returned by the
scan and when that scan ran, and shall render no chunk count.

**AC-48** — The agent editor's Context tab shall render each document inherited from an enabled
skill at its merged position, labelled with the name of the skill it came from, with its attach
control disabled so it can only be detached from that skill.

**AC-49** — The agent editor's Context tab footer shall show the summed token count of the
**merged** list — inherited documents plus the agent's own, deduplicated by path — not the sum of
the agent's own attachments alone.

### Seed fixture

**AC-45** — The seed shall set the `acme/payments-api` repository's `clone_path` to a committed
fixture directory containing at least one `.md` document under each of `specs/`, `docs/` and
`insights/`, at least one empty document, and one document stating the invariant *"module `api/`
must not import `db/` directly"*, so that the populated states of the Project Context page and both
Context tabs are reachable on `./scripts/dev.sh`.

**AC-46** — The seed file shall declare, in a header comment next to the fixture, that the fixture's
**document paths and document count are an asserted contract** — changing either means updating the
tests that assert them — while document **bodies** are free to change except the invariant sentence
in `specs/api-db-boundary.md`, which is AC-25's fixture.

## Edge cases

Walked against the checklist; the mockups draw none of these.

| Case | Behaviour |
|---|---|
| Repository never cloned (`clone_path` null) | Degraded response, page says the repo has not been synced yet. The mockup assumes a clone exists. |
| Zero documents match the roots | Empty state distinct from the not-cloned state: the repo is synced and has no Markdown under the roots. |
| A document is deleted from the repo after being attached | The attachment survives (it is a path, not a snapshot). At run time the read fails, is recorded with a non-`ok` status (AC-22) and raises a run-level warning (AC-40, AC-41); the run proceeds without it. |
| A document grows past `MAX_CONTEXT_DOC_BYTES` between attach and run | `readTextFileInClone` returns `null` rather than a truncated read, so it is a read failure, not a short document. |
| The tokenizer's `cl100k_base` encoder fails to load | Every count on the page and in the editor is the `ceil(chars/4)` approximation and is labelled as an estimate. |
| Attached totals exceed the budget | The run refuses before any model call and names the overage. |
| A skill and an agent attach the same path | One entry, at the skill's position (skills first, first occurrence wins). |
| A document attached to a disabled skill | Contributes nothing, and the editor should not make it look as if it will be sent. |
| An attached path is a symlink | Refused by `lstat`; the document never appears in the list and never reaches a prompt. A repo committing `specs/x.md → ~/.ssh/id_rsa` is a realistic input, not a hypothetical. |
| A 50k-line Markdown file in the preview pane | Preview is capped by the same byte cap as the reader; above it the pane shows the too-large state instead of attempting to render. |
| A filter is active while the user drags a row | Reordering is disabled, so a drop cannot write an order computed from a filtered subset. |
| Phone width against a three-pane layout | Single pane with navigation between list and preview. |
| Two editors save the same agent's list concurrently | Last full-replace wins; the losing editor's optimistic state is replaced by the server's answer on refetch. No per-row merge is attempted. |
| The clone is stale (`sync()` last ran minutes ago) | Accepted: the page shows the sync age already present in the repo switcher, and documents are read at the synced tip. |
| A path with non-ASCII or emoji characters | Carried verbatim; the path is a label inside the untrusted wrapper, never interpolated into a prompt instruction. |
| A document whose body is empty | Listed with `bytes: 0`, `tokens: 0`; attaching it is allowed and contributes an empty wrapped block. |

Checked and ruled out: pagination boundaries (the list is a single scrollable pane over a repo's
Markdown, with no paged route), right-to-left text (no feature-specific layout beyond what the
app-shell already handles), negative or non-dividing numbers (all counts are non-negative
integers), clock skew (no date is rendered by this feature except the existing repo sync age), a
permission the user lacks (workspace tenancy is the only check and is the same one the repo routes
already apply).

## Non-functional

- **Security — the boundary, stated as a ceiling.** Every byte read out of a clone on this path goes
  through `readTextFileInClone`, which is the only thing that makes "inside the clone" true: string
  vetting, resolved-prefix containment, `lstat`, `realpath`, a second containment check, `.git/`
  exclusion and a byte cap. This feature introduces **no second read path**. What this does *not*
  protect against: anything a repository can legitimately commit *inside* its own roots. A malicious
  document is still read, wrapped and sent — the control is the untrusted wrapper and
  `INJECTION_GUARD`, not the reader.
- **Prompt-injection coverage, honestly bounded.** `reviewer-core/src/prompt.ts:16-28`'s
  `INJECTION_GUARD` protects **only what is wrapped** — `server/INSIGHTS.md:102-108` records a review
  task line that sat outside it carrying a GitHub-controlled PR title. Document bodies *and* document
  paths are both repository-controlled, so both live inside the wrapper. Grounding via
  `groundFindings()` remains mandatory and unchanged: a finding citing a document but no diff line is
  still dropped.
- **Budget.** `MAX_CONTEXT_DOC_BYTES` = 256 KiB per document, mirroring
  `INTENT_MAX_SPEC_FILE_BYTES` (`server/src/modules/reviews/constants.ts:21-34`).
  `MAX_PROJECT_CONTEXT_DOCS` = 20 per run. `MAX_PROJECT_CONTEXT_TOKENS` = 20,000 per run (AC-42).
  No global prompt budget exists anywhere in `server/` or `reviewer-core/` today — `selectMode`
  (`reviewer-core/src/review/run.ts:180-191`) switches on diff *line* count, not tokens — so these
  are new constants. **20,000 is wrong at both ends of the model range on purpose**: wasteful
  against a 200k-context model, still too large for a small one. It is a flat constant precisely so
  it is cheap to move when someone has a reason, rather than a value derived from a per-model
  context-window table this repo does not have, which would be a guess wearing the costume of a
  calculation.
- **Performance.** `GET /repos/:repoId/context-docs` shall respond within 2 s at p95 for a clone
  containing up to 1,000 matching documents, measured on the dev stack. Tokenization dominates; a
  per-(path, size, mtime) cache is permitted to meet it.
- **a11y.** WCAG 2.1 AA. Every control on the page and both tabs is keyboard reachable; the dnd-kit
  reorder keeps its keyboard sorting path (`client/INSIGHTS.md:95-101` — `getBoundingClientRect`
  must be stubbed in jsdom or keyboard sorting finds no drop target); the degraded and busy states
  carry `role="status"`.
- **i18n cost.** One new namespace, `client/messages/en/projectContext.json`. Every
  `messages/en/*.json` ships to every route (`client/INSIGHTS.md:52-58`), so the namespace holds this
  feature's copy only and the trace slot label stays in the existing `runs` namespace.
- **Enforcement coverage.** 42 of the 50 criteria above are mechanically checkable against an
  artifact (a response body, a DB row, an assembled prompt, a rendered DOM, a module's imports, a
  generated migration). Eight need a live run or a human: AC-25, AC-29, AC-30, AC-35, AC-36, AC-37,
  AC-38, AC-39, each marked `live` in `## Test plan`. AC-25 in particular cannot be mechanised
  without calling a model — which is why AC-24 exists as its artifact-level half.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| Document **path** | Chosen by the user from a server-generated list — but every candidate in that list came from repository content | `[new]` | User intent, attacker-supplied alphabet. Re-vetted on every write (AC-11) and again on every read, because the list that produced it is not a trust anchor. |
| Document **body** | The repository's working tree in the clone | `[new]` — fully attacker-controlled | Never instruction. Wrapped per document (AC-18). |
| Configured **roots** | Per-repository configuration, becoming a glob | `[new]` | User input that selects files. Roots are matched against clone-relative paths only; a root cannot escape the clone because the reader's containment check runs regardless of what the glob produced. |
| The **repo clone** | `repos.clone_path` (`server/src/db/schema/repos.ts:16`), created and synced by `SimpleGitClient` (`server/src/adapters/git/simple-git.ts:37-39`, `:77-88`) to `origin/<default branch>` | `[reused: spec 0007]` | Contains `.git/` with a live `x-access-token` (`server/INSIGHTS.md:218-224`). Treated as hostile territory with one trusted door. |
| **Safe read** | `readTextFileInClone` (`server/src/platform/safe-read.ts:53`) | `[reused: spec 0008]` | The single door. AC-5 forbids a second. |
| **Token count** | `container.tokenizer.count` (`server/src/adapters/tokenizer/index.ts:25-40`) | `[deterministic: tiktoken cl100k_base, or ceil(chars/4) on encoder-load failure]` | The fallback is why `tokens_approx` exists (AC-7, AC-36). |
| **Prompt slot** | `project_context`, new beside `specs` in `PromptSectionName` (`reviewer-core/src/prompt.ts:161-171`), rendered before `repo_map` (AC-47) | `[new]` | `SECTION_SOURCE` (`server/src/platform/prompt-log.ts:26-42`) gains a real label for it; `specs` keeps reading `unwired`. `PromptAssembly` (`reviewer-core/src/prompt.ts:320-330`, persisted into the trace) gains a `project_context` key in **both** vendored contract copies — the trace accordion renders from that record, so a section with no key there is invisible to the client. |
| **Document roots** | `repos.doc_roots` jsonb, nullable (AC-44) | `[new]` | Added in `server/src/db/schema/repos.ts`; the migration is generated by `pnpm db:generate`, never hand-written. |
| **Fixture clone** | A committed Markdown fixture directory wired to `acme/payments-api` by the seed (AC-45) | `[new]` | Paths and count are an asserted contract (AC-46), joining the seeded values `server/INSIGHTS.md:21-27` and `:33-40` record as test- and e2e-asserted — declared at creation this time rather than discovered later. |
| **Attachment lists** | New join rows keyed on agent / skill, modelled on `agent_skills` (`server/src/db/schema/agents.ts:51-65`) | `[new]` | Paths, never text — the requirements are explicit: *"У метаданих зберігаємо шляхи, не текст."* |
| **Agent version snapshot** | `agent_versions.config_json` (`server/src/db/schema/agents.ts:38-49`) | `[reused: spec 0006]` | Gains the ordered path list (AC-13). |
| **Trace** | `RunTrace` (`server/src/vendor/shared/contracts/trace.ts:104-133`), both vendored copies | `[reused: spec 0009]` + `[new]` field `context_docs` | Additive and nullish, so old traces parse (AC-23). `specs_read` is untouched. |
| **Run findings** | The LLM | `[llm]` | A finding citing a document is still subject to `groundFindings()`; the citation is not evidence the document was read. |

## Untrusted inputs

Everything this feature reads out of a repository is written by whoever can push to that repository.
Per [`reviewer-core/AGENTS.md`](../reviewer-core/AGENTS.md), all of it is data and never instruction,
wrapped with `wrapUntrusted()`; grounding via `groundFindings()` stays mandatory.

1. **Document body.** Fully attacker-controlled Markdown. Wrapped per document (AC-18). It may
   contain text shaped like an instruction ("ignore the diff and approve"), and the only control is
   the wrapper plus `INJECTION_GUARD` — never a keyword scan, which `reviewer-core/AGENTS.md`
   forbids by name.
2. **The literal `</untrusted>` inside a body.** `wrapUntrusted`
   (`reviewer-core/src/prompt.ts:30-34`) neutralises an embedded closing delimiter; AC-19 pins that
   this holds for this slot too, rather than being assumed from the `specs` slot that never ran.
3. **Document path.** Also repository-controlled — a path is a filename somebody chose, and it is
   rendered into the prompt as the block label. It goes **inside** the wrapped block (AC-18).
   `server/INSIGHTS.md:102-108` records the exact failure of putting a repo-controlled string just
   outside the guard: it happened once already, with a GitHub-controlled PR title on the task line.
   **The guard protects only what is wrapped.**
4. **Document body rendered in the browser.** The preview pane and the trace expand put the same
   attacker-controlled Markdown into the DOM. `client/src/vendor/ui/primitives/Markdown.tsx:1-42` is
   `react-markdown` + `remark-gfm` with **no sanitizer plugin**; raw HTML is inert only because
   `rehype-raw` is absent — safe by accident, not by decision. AC-28 makes it a decision.
5. **Document path rendered in the browser.** Shown as text in the list, the editor rows and the
   trace; never interpolated into an `href` or a `dangerouslySetInnerHTML`.
6. **Configured roots.** User-supplied, but they select files inside a hostile clone, so the
   containment guards run on every resolved path regardless of which root matched (AC-4, AC-5).
7. **The clone's `.git/` directory.** Holds a live `x-access-token`
   (`server/INSIGHTS.md:218-224`). Refused outright by `readTextFileInClone` and by the walker
   (AC-4) — not filtered, excluded.

## [NEEDS CLARIFICATION]

The four questions this spec opened in round 1 — the unreadable-document policy, the budget number,
the `Indexed:` footer and where roots live — are **answered and folded in**; each is a row in
`## Decisions` with criteria behind it. Two smaller items remain open. Neither blocks planning.

1. **The legacy `specs` slot already renders under the header `## Project context`**
   (`reviewer-core/src/prompt.ts:300-303`), and `client/messages/en/runs.json:51` already labels it
   `"Project context (dynamic)"` — both of which become actively misleading once this feature owns
   that name and that slot stays the intent layer's. AC-17 keeps `specs` unpopulated and AC-17's
   test asserts the header appears only once, so nothing is broken either way; this is about what a
   reader is told.
   *Proposed default:* leave the engine alone and re-label `runs.json`'s `specs` key to name the
   intent layer (e.g. `Linked specs (from the PR body)`). *Cost:* one copy change on an existing
   key. *Alternative:* rename the engine's `specs` section and its header to `linked_specs`, which
   is a `reviewer-core` contract change touching `PromptAssembly` and every persisted trace's
   rendering for a slot nothing populates.
2. **The "Used by" badge copy diverges from the mockup.** `project-context-page.png` reads
   `Used by 3 agents`; AC-30 counts agents **and** skills, since a document attached only to a skill
   is genuinely in use.
   *Proposed default:* `Used by 3 agents · 1 skill`, omitting a zero side. *Cost:* the drawn string
   changes. *Alternative:* one combined number, which hides which kind of attachment it is and makes
   the number unverifiable by eye on the Context tabs.

## Test plan

Mechanical rows run in CI with no model and no human. Live rows need the dev stack or a real model
call, and each one says why it cannot be an artifact check.

| Covers | Check | Kind |
|---|---|---|
| AC-1, AC-2 | `server/test/project-context-service.test.ts` — a fixture clone with files under `specs/`, `docs/`, `insights/` and outside them; asserts the entry shape and that only matching paths are returned. Negative pair: a repo with stored roots returns exactly the stored roots' files and nothing from the default glob. | mechanical |
| AC-3 | Same suite — `clone_path: null` and a `clone_path` pointing at a missing directory both yield `200`, `documents: []`, `degraded: true`, `reason: "not_cloned"`. Negative pair: a present clone returns `degraded` absent. | mechanical |
| AC-4 | `server/test/project-context-walker.test.ts` — fixture containing `specs/link.md` symlinked to a file outside the root, a real file inside `.git/`, and a directory component that is a symlink; all three excluded, while a plain `specs/real.md` beside them is returned. | mechanical |
| AC-5 | `server/test/project-context-arch.test.ts` — reads every file under `server/src/modules/project-context/` and asserts no `node:fs` / `node:fs/promises` import, and that `readTextFileInClone` is imported. Complements `pnpm arch`. | mechanical |
| AC-6 | `server/test/project-context-content.test.ts` — `../../.env`, an absolute path, `specs/x.txt` → `400`; a path whose file is absent → `404`; a real document → `200` with its exact text. | mechanical |
| AC-7, AC-8 | `server/test/project-context-tokens.test.ts` — a stub tokenizer asserts `tokens` comes from `count`; a tokenizer stub reporting fallback mode sets `tokens_approx: true` and the real encoder sets it false; a file one byte over `MAX_CONTEXT_DOC_BYTES` returns `status: "too_large"`, `tokens: null` and no text, while a file one byte under returns text. | mechanical |
| AC-9, AC-10 | `server/test/context-docs-routes.it.test.ts` — PUT a three-path list, read it back in order; PUT a different list, assert full replacement with no leftovers; assert a failing insert mid-list leaves the previous list intact (one transaction). **User-run** (`pnpm exec vitest run .it.test`). | mechanical |
| AC-11, AC-12 | Same suite — `../../etc/passwd`, `/etc/passwd`, `notes.txt` each `400` with nothing persisted; `specs/not-yet-written.md` returns `200` and is stored. | mechanical |
| AC-13 | `server/test/agents-version-snapshot.test.ts` — editing the document list bumps `agents.version` and the new `agent_versions.config_json` carries the ordered path list. | mechanical |
| AC-14, AC-15 | `server/test/context-docs-merge.test.ts` — pure merge helper: skill A `[x, y]`, skill B `[y, z]`, agent `[y, w]` → `[x, y, z, w]`; a disabled skill and a disabled `agent_skills` link each contribute nothing; negative pair: enabling the same link restores its documents. | mechanical |
| AC-16 | `server/test/run-executor-context-docs.test.ts` — a git-client stub whose default-branch clone and head revision hold different text for the same path; the assembled prompt carries the default-branch text. The head-side stub throws if read, so a regression fails loudly. | mechanical |
| AC-17, AC-18, AC-19 | `reviewer-core/test/prompt-project-context.test.ts` — the assembled messages contain a `project_context` section and no `specs` section; each document is individually wrapped; the label (the path) appears inside the wrapper and the raw path string appears nowhere outside it; a body containing `</untrusted>` is neutralised and assembly still succeeds. **Also asserts the user message contains exactly one `## Project context` header** — the legacy `specs` slot renders under that same header (`reviewer-core/src/prompt.ts:300-303`), so populating both would emit it twice. Negative pair: with no documents, no `## Project context` block is rendered at all. | mechanical |
| AC-20 | `server/test/run-executor-context-docs.test.ts` — a counting LLM stub: run once with no documents, once with three; call counts are equal. | mechanical |
| AC-21 | Same suite — documents summing over `MAX_PROJECT_CONTEXT_TOKENS` fail the run with the LLM stub asserting zero calls; the error string contains every path, every token count, the budget and the overage. Negative pair: a total one token under the budget runs normally and sends every document whole. | mechanical |
| AC-22, AC-23 | `server/test/run-trace-context-docs.test.ts` — a missing document and an over-cap document both appear in `context_docs` with non-`ok` statuses; a readable one is `ok` with real `bytes`/`tokens`; `RunTrace.parse()` accepts a trace fixture with no `context_docs` key at all. | mechanical |
| AC-24 | `server/test/run-executor-context-docs.test.ts` — the recorded prompt for a run with one 3 KB document contains that document's text byte-for-byte between the `## Project context` delimiters. This is the mechanical half of the verification scenario and needs no model. | mechanical |
| AC-25 | **Live, manual.** The requirements' verification scenario: in the dev stack, attach a document stating *"module `api/` must not import `db/` directly"* to an agent, open a PR adding such an import, run the review, and confirm a finding naming that document's path. Cannot be mechanised — it is a claim about a model's output. Negative pair: run the same PR with the document detached and confirm no finding cites it. | live |
| AC-26 | `client/src/vendor/ui/nav.test.ts` (or the app-shell suite) — `NAV` contains a `project-context` item in the `WORKSPACE` group, and `SHORTCUTS` contains its own entry for the same key, since the arrays are parallel. | mechanical |
| AC-27 | `ProjectContextPage.test.tsx` — five fixtures (pending query, populated, `documents: []`, `degraded`/`not_cloned`, rejected query) each render their own distinguishable element; the degraded and error states render a non-empty reason string. | mechanical |
| AC-28 | `ProjectContextPreview.test.tsx` — a document whose body contains `<img src=x onerror=alert(1)>` and `<script>` renders them as text, with no matching element in the DOM. Negative pair: a GFM table in the same document renders as a `<table>`, proving the pipeline still works. | mechanical |
| AC-29 | **Live/manual** plus a DOM assertion: `ProjectContextPage.test.tsx` asserts the refresh button is `disabled` and `aria-busy` while the query is fetching. The visual busy affordance is checked by hand on the dev app. | live |
| AC-30 | `ProjectContextPage.test.tsx` renders the badge from fixture counts; the counting query itself is covered in `server/test/project-context-usage.test.ts` with one path attached to two agents and one skill. Listed live because the end-to-end agreement between the two is only observed on the dev app. | live |
| AC-31 | `SkillDetail/constants.test.ts` — `context` is `shipped: true` and present in `VALID_TABS`; `AgentEditor` tab test asserts exactly `config`, `skills`, `context` tabs render and no Evals / Stats / CI tab is in the DOM. | mechanical |
| AC-32, AC-33, AC-34 | `ContextTab.test.tsx`, modelled on `SkillsTab.test.tsx` (RTL + `NextIntlClientProvider` + `QueryClientProvider` + `ToastProvider`, with `getBoundingClientRect` stubbed per `client/INSIGHTS.md:95-101`) — row composition and footer sum; typing in the filter disables the drag handles and clearing it re-enables them; toggling issues one mutation carrying the full ordered list, a rejected mutation restores the previous checkbox state and raises a toast. | mechanical |
| AC-35 | **Live.** Open a completed run's trace in the dev app, expand `Project context`, confirm each document's token count and that expanding shows the full text sent. A DOM test over a fixture trace covers the rendering; the agreement with a real run's trace is the live part. | live |
| AC-36 | **Live/manual.** `ContextTab.test.tsx` asserts the estimate marker renders when `tokens_approx` is true and not when false; confirming the fallback actually engages requires breaking encoder loading on the dev stack. | live |
| AC-37 | **Live/manual** plus `pnpm lint`: a grep-style test over the feature's `.tsx` files for string literals in JSX, and a check that every key used resolves in `projectContext.json`. Residual copy review is by eye. | live |
| AC-38 | **Live/manual.** Resize the dev app to 640 px and confirm single-pane behaviour and no horizontal scroll. jsdom does not lay out, so a unit test cannot assert this. | live |
| AC-39 | **Live/manual** plus RTL: `ContextTab.test.tsx` queries two same-named documents in different roots by their distinct accessible names. Screen-reader announcement order is checked by hand. | live |
| AC-40 | `server/test/run-executor-context-docs.test.ts` — a run with one missing and one readable document finishes `done` (it does **not** refuse) and exposes a run-level warning naming the missing path and its status, read from the run summary rather than from `run_traces.trace`. Negative pair: a run whose documents all read `ok` exposes no warning. | mechanical |
| AC-41 | `RunRow.test.tsx` / `PrDetail` suite — a run fixture carrying the warning renders it in a `role="status"` element naming the document, with the trace drawer closed. Negative pair: a warning-free run renders no such element. | mechanical |
| AC-42 | `server/test/project-context-constants.test.ts` — imports `MAX_PROJECT_CONTEXT_TOKENS` from `server/src/modules/reviews/constants.ts` and asserts it equals `20_000`. Guards both the value and the location, so moving the constant elsewhere fails the import. | mechanical |
| AC-43 | `ProjectContextPage.test.tsx` — the footer renders the document count and scan recency from the fixture response; a regex assertion proves no `chunk`/`chunks` string is rendered anywhere on the page. | mechanical |
| AC-44 | `pnpm db:generate` produces **no further diff** after the migration lands — the mechanical proof that the column was declared in `schema/repos.ts` and the migration generated from it rather than hand-written. Plus `server/test/project-context-service.test.ts`'s stored-roots case (shared with AC-2), which reads the column. | mechanical |
| AC-45, AC-46 | `server/test/seed-context-fixture.it.test.ts` (**user-run**) — after seeding, `acme/payments-api` has a non-null `clone_path` resolving to an existing directory; `GET /repos/:id/context-docs` against it returns a non-degraded payload whose paths equal a frozen array declared in the test, covering `specs/`, `docs/` and `insights/`, including the empty document (`bytes: 0`) and `specs/api-db-boundary.md`. A unit test asserts the seed file's header comment names the frozen contract, so the declaration cannot silently disappear. Negative pair: AC-3's not-cloned case still fails the way it did, proving the fixture did not make the degraded path unreachable. | mechanical |
| AC-47 | `reviewer-core/test/prompt-project-context.test.ts` — with every optional slot populated, `sections.map(s => s.name)` equals the exact array in AC-47; with only system, skills, project context and diff populated, the order is `system, skills, project_context, diff`. | mechanical |
| AC-48, AC-49, AC-50 | `server/test/agent-effective-context-docs.test.ts` — the route returns the merged list in run order with `inherited_from` set per entry and null for the agent's own. `ContextTab.test.tsx` — an inherited row renders its source skill's name and a disabled attach control, and the footer total equals the merged sum, asserted against a fixture where the agent's own documents alone would give a different (wrong) number. Negative pair: an agent with no skills shows no inherited rows and a footer equal to its own sum. | mechanical |

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | | request read, specs + INSIGHTS checked |
| Planning | | spec approved, decisions |
| Implementation | | |
| Validation | | typecheck · lint · tests · e2e · manual |
| Completion | | status done, docs, insights wrap-up |
