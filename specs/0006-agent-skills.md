---
title: Skills for review agents
status: in-progress  # draft | approved | in-progress | done
packages: [server, client, reviewer-core, e2e, .claude]
---

## Problem
Review agents today are one monolithic system prompt. The slides (Part 2 plus designs tab_1…tab_5) ask for **skills**:
- reusable markdown instruction blocks the user can edit, stored in the DB, which is the source of truth;
- shared between agents; each agent attaches them with its own enabled flag and order;
- importable from a `.md` file or an archive: preview first, confirm to save, executable parts never processed;
- versioned, with history, diff and restore;
- visible in the run trace as their own block, with the tokens they add;
- with usage stats.

One new agent, **Test Quality Reviewer**, ships with skills. The control experiment (without vs. with skills) runs on Test Quality and on the API-contract case, which uses General Reviewer with the contract skills.
Skills are **text only**: no tools, no scripts, nothing executed. They are configuration appended to the prompt.

Much of the scaffolding already exists and is reused:
- **DB:** `skills`, `skill_versions`, `agent_skills(agent_id, skill_id, order)` in `server/src/db/schema/skills.ts` and `agents.ts:51-63`; findings have a `category` column (`schema/reviews.ts:69`).
- **Contracts:** `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` in `server/src/vendor/shared/contracts/knowledge.ts:115-199`.
- **Agent link routes and repo:** `modules/agents/routes.ts:145-165`, `repository.ts:206-255`.
- **Engine:** `ReviewInput.skills?: string[]` (`reviewer-core/src/review/run.ts:55`), `assemblePrompt` (`reviewer-core/src/prompt.ts:85`), and `PromptAssembly.skills` in the trace.
- **UI patterns:** the agents page layout (list column + detail pane with `?tab=`, `app/agents/[id]/page.tsx`), `AgentCard`, `ConfigTab`, the kit `Tabs`/`Toggle`/`Checkbox`/`Markdown`/`Dropdown`, and recharts.
- **Trace UI:** `PromptBlock` already renders a skills block (`TraceBody.tsx:85-103`).
- **i18n:** Skills-tab copy already exists in `agents.json:48-54,92-97`; `app-shell/helpers.ts:33` maps `/skills`.

## Decisions (agreed with the user 2026-09-19)
1. **Prompt slot:** enabled skills go into the **system message**, after the agent prompt and before `INJECTION_GUARD`, one block per skill in link order.
2. **New agent:** only **Test Quality Reviewer**. The API-contract experiment runs on **General Reviewer** with the contract skills attached.
3. **Sidebar:** a narrow edit of `client/src/vendor/ui/nav.ts` is allowed. It adds a "SKILLS LAB" section (Skills, Agents) and a `g s` shortcut, with a documented exception in AGENTS.md and `review_scope.py`. Conventions and Eval Dashboard stay out of scope.
4. **Experiment PRs:** 2 PRs in a real GitHub demo repo, run in the dev app. The seed and e2e fixtures stay single-PR.
5. **Skill page layout follows tab_3–5**, mirroring the Agents page: a card list on the left and the selected skill's detail pane on the right. The pane has a header with name, type badge and `vN` pill, and tabs **Config · Preview · Stats · Versions**. **Context, Evals and "Run on evals" are hidden until built** (defined in constants and i18n, not rendered), like the agent editor.
6. **Full stats:** a new `run_skills` table records which skills (and which versions) went into every run. It feeds card metrics ("N agents · X% pull · Y% accept") and the Stats tab.
7. **Versions:** an optional change note on save; snapshots store name, description, type and body. Diff uses the `diff` (jsdiff) package in the client. Restore saves the old snapshot as a new version.

Defaults I chose (tell me if you disagree):
- **Per-agent enable = a new `agent_skills.enabled` column.** The agent Skills tab (tab_1) lists *all* workspace skills: linked ones first in their order, then unlinked ones.
  - Checking an unlinked skill links it (enabled, appended at the end).
  - Unchecking keeps the link with `enabled=false`, so it keeps its position.
  - A skill reaches the prompt only if `link.enabled && skill.enabled`. The card toggle is a global kill-switch.
- **Import is parsed on the server** (`@fastify/multipart` + `fflate`, pure JS). It accepts `.md`, `.zip` and `.skill`.
  - The core is `SKILL.md` (or the single `.md`), with frontmatter `name`, `description` and optional `type`.
  - Every other archive entry is listed as ignored; scripts and binaries are flagged "executable, not processed".
  - Nothing is written until the user confirms.
- **Source labels on cards:** Manual / Extracted / Community / Imported. `SkillSource` gains `imported_file`. The column is `text` with an enum, so no DB enum migration is needed.
- **Drag-to-reorder** uses `@dnd-kit/core` + `@dnd-kit/sortable` (keyboard sensor for accessibility), added with `pnpm add`.
- **Metric definitions:**
  - Pull % = runs that included the skill ÷ completed runs of the agents currently linked to it.
  - Accept % = accepted ÷ decided findings in runs that included the skill.
  - Findings by category (30d) = counts per `findings.category` over those runs.
  - Findings are attributed to the run, not to a single skill. The UI says so in a hint.
  - Empty → "—".

## Design

### DB (`server/src/db/schema`), then `pnpm db:generate` (creates `0015_*.sql`) and `pnpm db:migrate`
- `agent_skills.enabled boolean not null default true`.
- `skills`: unique `(workspace_id, name)`, `updated_at`.
- `skill_versions` gains `name`, `description`, `type`, `message text null`.
- New `run_skills(run_id → agent_runs cascade, skill_id → skills set null, skill_name, version, tokens, order)`, PK `(run_id, skill_id)`, index `skill_id`.
- Row types go in `db/rows.ts` to avoid the helpers ⇄ repository import cycle (server INSIGHTS :77).

### Contracts (`server/src/vendor/shared`, hand-mirrored to `client/src/vendor/shared`, see root INSIGHTS)
- `SkillSource` += `imported_file`.
- `Skill` += `token_count`, `stats: { agent_count, pull_rate|null, accept_rate|null }`.
- `SkillDraft` (create/update body): name 1..80, description 1..500, type, body 1..20k chars, and an optional `message`.
- `SkillVersion { version, name, description, type, body, message, created_at }`.
- `SkillStats { agent_count, pull_rate, accept_rate, findings_30d, agents: {id,name}[], findings_by_category: {category,count}[] }`.
- `SkillImportPreview { draft, source_filename, ignored_files: {path, reason}[], name_conflict }`.
- `AgentSkillLink` += `enabled`; `AgentSkill = AgentSkillLink & { skill: Skill }`; `Agent` += optional `skill_count`.
- Trace: `RunTrace` += optional `prompt_tokens` (per slot) and `skills_used: {id,name,version,tokens}[]`. `PromptAssembly.system` = the agent prompt + guard **without** the skills block, so nothing is counted twice. Old traces lack these fields, so read them defensively (client INSIGHTS :9-13).

### reviewer-core (`src/prompt.ts`)
- System message = `parts.system` + `\n\n## Skills\n` + the joined skills + `INJECTION_GUARD`. Remove `## Skills / rules` from the user message. `ReviewInput.skills` stays `string[]`; the server formats each one as `### Skill: <name>\n<body>`.
- Update `reviewer-core/test/prompt.test.ts`, `server/test/prompt-callers.test.ts` and `docs/agent-prompts/README.md:36-45`.

### Server: new module `src/modules/skills/` (onion layers: routes → service → repository; the archive reader sits behind a port)
- **`repository/skill.repo.ts`:**
  - `list(workspace, q)` with stats aggregates.
  - `get`, `insert` (writes v1 into `skill_versions`), `update` (bumps the version and writes a snapshot, in a transaction), `restore(id, version)`, `delete`.
  - `versions(id)`, `stats(id)`.
  - `enabledForAgent(workspaceId, agentId)` returns an ordered list of `{id,name,version,body}` where both flags are true.
- **`service.ts`:** CRUD, `previewImport(file)`, the name-conflict check, and token counts via `container.tokenizer`.
- **Import:**
  - `import/parse-skill-md.ts`: frontmatter + body. Reuse a YAML dependency if one exists; otherwise write a minimal scalar/folded parser.
  - `adapters/archive/`: an `ArchiveReader` port with an fflate implementation.
  - Limits: upload ≤ 1 MB, ≤ 200 entries, ≤ 2 MB uncompressed in total (zip-bomb guard).
  - Only `.md` entries are read as text. Nothing is written to disk and nothing is executed.
- **`routes.ts`:** `GET /skills?q`, `GET /skills/:id`, `POST /skills`, `PUT /skills/:id`, `DELETE /skills/:id`, `GET /skills/:id/versions`, `POST /skills/:id/versions/:version/restore`, `GET /skills/:id/stats`, `POST /skills/import/preview` (multipart; it only returns a preview).
  - Register the module in `modules/index.ts`.
  - Add a `container.skillsRepo` getter next to `agentsRepo` (`platform/container.ts:~101`).
  - Register `@fastify/multipart` scoped to the skills plugin.
- **Agents module:**
  - `GET /agents/:id/skills` returns `AgentSkill[]`.
  - Replace `SetSkillsBody` with `{ skills: [{skill_id, enabled}] }`, a full ordered replace. It runs in a transaction and checks that every skill belongs to the workspace, which is a gap today.
  - Add `skill_count` to the agent list DTO.
- **Run executor** (`modules/reviews/run-executor.ts:193-215`):
  - Load `enabledForAgent`, format the skills, and pass `skills` to `reviewPullRequest`.
  - Emit a live-log event: "Skills: n loaded (name vN, …)".
  - Inside the persistence transaction, insert the `run_skills` rows and pass `skills_used` plus per-slot tokens into `buildRunTrace`.
  - Update every `as unknown as` stub under `server/test/` that the executor now touches (server INSIGHTS :114, :150).

### Seed (`server/src/db/seed.ts`, prompts in `seed-prompts.ts`): idempotent by name; PR #482 data stays untouched
- **Skills** (with their v1 version rows):
  - rubric: `pr-quality-rubric`, `untested-branches`, `missing-corner-cases`, `over-mocking`
  - security: `secret-leakage-gate`, `lethal-trifecta`, `phantom-api-gate` (globally off, as in the design)
  - convention: `no-then-chains`, `n-plus-one-queries`, `breaking-route-change`, `contract-schema-drift`, `status-code-semantics`
- **Agent:** new **Test Quality Reviewer**. Its prompt is deliberately generic, so the experiment shows what the skills add.
- **Links:**
  - General Reviewer → rubric + the 3 contract skills
  - Security Reviewer → the 3 security skills
  - Performance Reviewer → n+1
  - Test Quality Reviewer → the 3 test skills
- **Import fixtures** (not seeded; imported through the UI to walk the whole path):
  - `server/fixtures/skills/flaky-test-patterns.zip`: `SKILL.md` + `scripts/detect.sh`, which shows the "executable, not processed" row;
  - `api-versioning.md`, a single-file sample.

### Client
- **Nav:** in `vendor/ui/nav.ts`, add a "SKILLS LAB" section with Skills (`/skills`, gKey `s`, icon Sparkles) and Agents, and add `g s` to `SHORTCUTS`. Document the exception in AGENTS.md "Do not touch" and in `.claude/skills/pr-self-review/scripts/review_scope.py:250` (exempt `nav.ts` only), plus its test.
- **Routes:**
  - `app/skills/page.tsx`: the list; it auto-selects the first skill or shows an empty state.
  - `app/skills/[id]/page.tsx`: the list column + detail pane, `?tab=config|preview|stats|versions` with `VALID_TABS`, the same pattern as `agents/[id]/page.tsx`.
  - Crumbs: "Skills Lab › Skills".
- **`_components/SkillCard`** (the `AgentCard` pattern):
  - a `role=button` div with an icon tinted by type;
  - the name in mono, a `Toggle` with stopPropagation that sets the global `enabled`, and a 1-line description;
  - a type Badge, a source label with icon (Manual/Extracted/Community/Imported), and a footer "N agents · X% pull · Y% accept";
  - disabled skills are dimmed.
- **List column:** a search box and an `Add Skill` Dropdown with *Create skill* and *Import skill*.
- **`_components/SkillDetail`:** the header (icon, name, type badge, `vN` pill) and `Tabs` from `constants.ts`. Hidden tabs are kept but not rendered.
  - **`ConfigTab`:** `SkillForm` with name, description, type (`SelectInput`), body (`Textarea mono`) and an optional change note. The description hint reads: "Directive: say when this skill applies and what the agent must check. It is the skill's interface." It also has save/cancel and delete (the confirm shows "used by N agents").
  - **`PreviewTab`:** "Rendered as the reviewing agent receives it." It renders the `### Skill: <name>` block through the kit `Markdown` and shows the token count.
  - **`StatsTab`:** 4 stat tiles (Used by, Pull frequency, Accept rate with a ring, Findings 30d), an "Agents using this skill" list with Open links to `/agents/:id?tab=skills`, and a "Findings by category" recharts donut with a legend of counts.
  - **`VersionsTab`:** "Version history · N versions" and the snapshot hint, with rows for `vN`, the message (or "Edited"), the date, and a Current badge on the latest. Older rows have **Diff**, which opens a Modal with the jsdiff line diff against the current version, and **Restore**.
  - **Create** opens the detail pane in a "new" state (`/skills/new`) with an empty `SkillForm`.
- **`_components/ImportSkillModal`:**
  - a file input (`.md,.zip,.skill`) → `usePreviewSkillImport`;
  - it shows the parsed draft (rendered markdown), the ignored-files list, a trust warning ("An imported skill is someone else's instructions inside your agent's system prompt. Read it before saving.") and a rename field when the name conflicts;
  - **Confirm** saves via `POST /skills` with `source: imported_file` and navigates to the new skill's Preview tab.
- **Agent editor Skills tab (tab_1):**
  - add `skills` to `VALID_TABS` in `agents/[id]/page.tsx:16` and to `TABS` in `AgentEditor/constants.ts`; `AgentEditor.tsx` renders the tab by key;
  - new `_components/SkillsTab` with a "Skills · N of M enabled" header, a filter, the order hint, and sortable rows (handle, `Checkbox`, mono name, type badge, a muted state for "globally off", and a total "+~X tokens");
  - it saves the full ordered list via `useSetAgentSkills` (optimistic update);
  - pass `skillCount` to `AgentCard`.
- **Hooks:**
  - `src/lib/hooks/skills.ts`: `useSkills`, `useSkill`, `useCreateSkill`, `useUpdateSkill`, `useDeleteSkill`, `useSkillVersions`, `useRestoreSkillVersion`, `useSkillStats`, `usePreviewSkillImport`.
  - Add `useAgentSkills`/`useSetAgentSkills` to `agents.ts` and export everything from `hooks/index.ts`.
  - In `lib/api.ts`, don't set the JSON content-type when the body is `FormData`.
- **Trace:** `TraceBody` shows the token count on each prompt block and splits the skills block into one sub-block per `skills_used` entry.
- **i18n and dependencies:**
  - a new `messages/en/skills.json`, shipped together with the page;
  - add any new kit names to the explicit exports in `components/ui-client.ts`;
  - `pnpm add diff @dnd-kit/core @dnd-kit/sortable`.

### Also required by the final-check slide
- In `.claude/skills/pr-self-review/SKILL.md`, add `disable-model-invocation: true`.
- Update the gate's denial text, AGENTS.md step 5 and `scripts/check-claude-skills.sh` so they tell the user to run `/pr-self-review` by hand.
- Run it by hand at the end and confirm it routed both client and server skills.

## Implementation order
0. Do the two steps plan mode blocked:
   - the engineering-insights wrap-up over `.claude/.insights-state/57d3b9c9-….transcript.md`;
   - write `specs/0006-agent-skills.md` from this plan (`status: approved`) and add its row to the specs index.
1. Prompt placement in reviewer-core, plus tests.
2. Schema + migration 0015; contracts in both copies.
3. Skills module (CRUD, versions, stats, import), the archive adapter, agent-link changes, and the executor + `run_skills` + trace wiring, plus tests.
4. Seed skills, agent and links; import fixtures.
5. Client: nav, hooks, Skills pages (list, detail tabs, import), agent SkillsTab, trace tokens, i18n, tests.
6. pr-self-review `disable-model-invocation`; e2e flows; `docs/skills.md`; INSIGHTS entries as findings are confirmed.

## Execution (multi-agent, as requested)
- **Phase A (me, sequential, the foundation everyone else builds on):**
  - step 0;
  - schema + migration 0015;
  - contracts in both copies;
  - reviewer-core prompt;
  - every dependency install (`pnpm add` in server and client), so no two agents race on a lockfile.
- **Phase B: parallel subagents in the same tree, each owning disjoint files:**
  1. **server-skills:** `modules/skills/**`, `adapters/archive/**`, the agents link changes, executor/trace/`run_skills`, `container.ts`, `modules/index.ts`, and server tests.
  2. **seed:** `db/seed.ts`, `seed-prompts.ts`, `server/fixtures/skills/**`.
  3. **client-skills-page:** `app/skills/**`, `lib/hooks/skills.ts`, `messages/en/skills.json`, `vendor/ui/nav.ts`, and client tests for those files.
  4. **client-agent-tab-trace:** `agents/[id]/**` SkillsTab, `lib/hooks/agents.ts`, `AgentCard` skillCount, `TraceBody`/`PromptBlock` tokens, `lib/api.ts` FormData, and their tests.

  Shared touch points (`hooks/index.ts`, `ui-client.ts`, `agents.json`) are pre-edited by me in Phase A.
- **Phase C (me):**
  - integrate the Phase B work;
  - pr-self-review `disable-model-invocation`, the AGENTS.md exception, the `review_scope.py` change;
  - e2e;
  - the full Verify matrix;
  - the manual check, docs, INSIGHTS;
  - `/pr-self-review` run by hand.

## Verification
- **reviewer-core:** `npm run typecheck && npm run lint && npm test`. Check that skills sit in the system message before the guard, that they are absent from the user message, and that an empty list produces no `## Skills` section.
- **server:** `pnpm typecheck` and `pnpm lint`.
  - Unit tests:
    - parse-skill-md;
    - zip import: `scripts/*` is ignored; a zip bomb, an oversize upload or an archive with no `.md` gets a 422; a preview persists nothing;
    - stats math (pull and accept rates with zero denominators).
  - `pnpm exec vitest run .it.test` with a new `skills.it.test.ts`:
    - CRUD, version bump, and restore creating vN+1;
    - workspace isolation on linking, and the transactional replace;
    - the executor with a `MockLLMProvider` capturing messages: an enabled skill lands in the system message and in `run_skills` and `skills_used`; a skill disabled on the link or globally is absent;
    - the stats endpoint.
  - Check the skipped count, since these suites skip themselves without Docker.
- **client:** `pnpm typecheck`, `pnpm lint`, `pnpm test`:
  - SkillCard: the toggle doesn't select the card;
  - SkillDetail: tab routing, hidden tabs not rendered;
  - VersionsTab: Current badge, Restore calls the mutation, Diff modal;
  - StatsTab: renders "—" when a rate is null;
  - SkillsTab: the count, the check/uncheck payload, keyboard reorder;
  - ImportSkillModal: nothing is saved before Confirm, and ignored files are shown.
- **e2e:** a read-only flow over the Skills list, the Preview tab, and the Security agent's Skills tab ("2 of 3 enabled"), sorted before the mutating `08` flow (rename 08 → 09 with `git mv` and update the README table). Run `./scripts/e2e.sh`.
- **Manual (dev app, `./scripts/dev.sh`):**
  1. Create and edit a skill in the UI; check the Versions diff and Restore.
  2. Import `flaky-test-patterns.zip` through the preview (`scripts/detect.sh` should be listed as not processed) and attach it to Test Quality Reviewer.
  3. On the GitHub demo repo, run Test Quality Reviewer (happy-path-only test PR) and General Reviewer (route-signature PR), each without and then with skills. Only the runs with skills should flag the uncovered branch or edge case, and the breaking change.
  4. Open the run trace → Prompt assembly: it should show one block per skill with tokens; the disabled skill should be absent. The skill's Stats tab should update.
  5. Run `/pr-self-review` by hand: it should pass, with both frontend and backend skills routed.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-19 | slides spec_1/2 + tab_1..5 read; specs + INSIGHTS checked |
| Planning | 2026-09-19 | decisions agreed with the user (see Decisions) |
| Implementation | 2026-09-19 | Phase A by hand; 4 parallel agents (server, seed, Skills pages, agent tab + trace); integration fixes: client runtime import from `@devdigest/shared` broke the Next build (now lint-enforced), `.dd-md` block styles |
| Validation | 2026-09-19 | reviewer-core 43/43 · server 156 unit + 56 it (0 skipped) · client 145 · e2e 9/9 (incl. mutating) · manual: Skills list/preview/stats/versions, agent Skills tab, import preview (cancelled, nothing saved). Pending: control experiment on real GitHub PRs, `/pr-self-review` by the user |
| Completion | | status done, docs, insights wrap-up |
