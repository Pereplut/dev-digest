---
title: Onboarding Generator
status: approved
packages: [server, client, e2e]
---

## Problem & why

A developer who opens an unfamiliar repository in DevDigest gets PR reviews but no orientation:
where the code starts, which files carry the most weight, how to run it, and what to pick up
first. Most of the parts to answer that already exist but nothing connects them:

- The `onboarding` table (`server/src/db/schema/context.ts:120-126`: `repo_id` PK, `json` jsonb,
  `generated_at`) shipped in migration `0000`. Nothing reads or writes it.
- `Onboarding` / `OnboardingSection` / `OnboardingLink` are in
  `server/src/vendor/shared/contracts/knowledge.ts:28-47`, with `kind: z.string()` (`:36`).
- `server/src/prompts/onboarding.system.md` exists. Its loader `server/src/platform/prompts.ts` has
  no call site, and `pnpm build` (`tsc -p tsconfig.json`, `server/package.json:8`) never copies
  `src/prompts` to `dist/`, even though `prompts.ts:12-14` requires that copy. A built server
  would throw `ENOENT` the first time it generated anything.
- `repoIntel.getTopFilesByRank` (`server/src/modules/repo-intel/service.ts:643`) and
  `getCriticalPaths` (`:667`, docstring "onboarding reading-path") have no consumer.
- `FEATURE_MODELS` already lists `'onboarding'` (`contracts/platform.ts:15,45-47`).
- `client/src/components/mermaid-diagram/MermaidDiagram.tsx` is unused, and
  `client/messages/en/shell.json` already carries `nav["onboarding-tour"]`.
- `/onboarding` is the add-repo wizard (`client/src/app/onboarding/page.tsx`), and
  `activeKeyFor` maps any path containing `/onboarding` to the `"onboarding-tour"` nav key
  (`client/src/components/app-shell/helpers.ts:29`). So the tour cannot use that path, and the wizard
  currently claims the tour's nav key.

The cost today: a newcomer has to read the code cold. The pieces built for this feature are dead
code that nothing tests end to end.

## Goals / Non-goals

**Goals**

- A per-repository tour page with exactly five sections: `architecture`, `critical_paths`,
  `run_locally`, `reading_path`, `first_tasks`.
- Facts are gathered deterministically: stack and scripts from a fixed root-file allowlist, and the
  reading path and critical paths from the existing import-graph rank.
- One structured LLM call turns those facts into prose, and code-side checks enforce its grounding.
- A deterministic skeleton with an honest status, worded as a sentence, whenever the index is
  missing or degraded, the clone is missing, or the model call fails with nothing better to show.
  The page is never empty.
- A failed regeneration costs the reader nothing: the last good tour keeps rendering, with its age
  and the failure stated above it.
- An in-page table of contents and collapsible sections.
- `MermaidDiagram` gains an optional `fallback` prop, so a diagram that does not render leaves a
  stated line in its place instead of silently nothing (AC-75).
- One read-only e2e flow.

**Non-goals**

- **MCP tool.** No `get_onboarding` tool in `mcp/`. The `mcp/` package is not touched.
- **Share link.** The mockup's "Share link" button is out of scope and is not rendered.
- **Per-row `Open` control on `critical_paths`.** The mockup puts an `Open` button on each
  critical-path row; there is no file-viewer route for it to open (`nav.ts` lists `pulls`, `skills`,
  `agents`, `conventions` only, and nothing under `src/app` renders a file). The row ships as path +
  description. Same reasoning as the Share link: the mockup shows design intent ahead of the product.
- **Populating `hotness`.** `computeFileRank` hardcodes `hotness: 0`
  (`repo-intel/pipeline/rank.ts:51`), and the clone is shallow (`CLONE_DEPTH = 1`), so the
  `× (1 + hotness)` term has no effect. This feature does not change it.
- **Any indexer change.** `repo-intel/pipeline/**`, `SUPPORTED_EXT`, `MAX_INDEXED_FILES` and
  `CLONE_DEPTH` stay as they are.
- **Size-threshold refusal.** A large repository is not refused; lists are capped and the cap is
  disclosed.
- **Invented beginner tasks.** `first_tasks` lists only DevDigest's own signals.
- **Cancelling an in-flight provider request.** No LLM port in this repo accepts an abort signal
  today (no `signal` field in `server/src/adapters/llm/*`, `reviewer-core/src/llm/*` or
  `server/src/platform/*`). This feature bounds the *generation state*, not the provider's spend.
- **Multi-language tours.** The prompt's `{{language}}` slot is outside this feature's decisions.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| Section identity | The five kinds are a fixed enum (`architecture`, `critical_paths`, `run_locally`, `reading_path`, `first_tasks`), narrowing `OnboardingSection.kind` from `z.string()`. The server owns the five slots, and each section can degrade on its own. | Both contract copies change. `server/test/contracts.test.ts` parses an `Onboarding` fixture and must be updated with the contract. |
| No clone / no index | Render a deterministic skeleton with an honest `role="status"` reason in words. Never an empty page, never an ungrounded model call. | `POST` is refused in those states. `GET` always returns five sections. |
| Reading path order | Ordered by the existing `file_rank.rank` (PageRank). `hotness` stays `0`, and that is documented, not fixed. | The ordering reflects import centrality only, never commit activity. |
| Large repos | Fixed named caps that disclose real truncation. No size-threshold refusal. | Truncation must be observable (fetch cap + 1), not inferred. |
| First tasks | Only open findings (`accepted_at IS NULL AND dismissed_at IS NULL`), pending convention candidates whose evidence proof succeeded, and high-rank files with no sibling test. A finding carries `file:line`, a candidate carries its id, an untested file carries the path alone. Zero signals is stated as zero. | Model prose cannot add tasks. An untested-file item has no line number, so AC-38 and the renderer must not promise one. |
| Stack & scripts | Parsed in code from a fixed root-file allowlist (`package.json`, lockfiles, `docker-compose.yml`, `.env.example`, `README.md`), read through `readTextFileInClone`. The model never names a file to read. `.env.example` contributes key names only. | No model-chosen path reaches the filesystem, so the clone's `.git/config` token is not reachable (`server/INSIGHTS.md` 2026-09-20). |
| Scope | The in-page TOC and one e2e flow are in. The MCP tool and the Share link are out. | See Non-goals. |
| Tour route (Q1) | `/repos/[repoId]/tour`, beside `/repos/[repoId]/pulls`. The nav href template is `/repos/:repoId/tour`, which `resolveHref` already substitutes. | The URL names the repository. `activeKeyFor` stops keying on `/onboarding` (AC-45, AC-46), and the e2e flow opens a repo-scoped URL (AC-55). |
| POST while a generation runs (Q2) | 202 with the **existing** `job_id`. | No sixth `OnboardingReason`, no client error branch: the client treats the response as "already started" and keeps polling (AC-19). |
| "last refreshed" (Q3) | The tour's `generated_at`, and no second timestamp. | The subline already says "Generated from index of N files", so index freshness is implied there; "last refreshed" can then only mean when the prose was written (AC-57). |
| "No sibling test" (Q4) | Same directory only: `dir/base.ext` is covered by `dir/base.test.<e>`, `dir/base.spec.<e>` or `dir/__tests__/base.test.<e>`. No mirrored-tree rule. | Accepted cost: this repo's own `server/src/**` files read as untested, because their tests live in `server/test/`. This is deliberate — a mirrored-tree or basename match over-matches common basenames, and must not be added later as a "fix". |
| A failed regeneration (raised by this spec's edge cases) | A failed generation never discards the last good tour: the stored `done` sections keep rendering, under a `generation_failed` status that says the refresh failed and how old the shown version is. | The `onboarding` row is no longer a single current state: it carries the last good sections and their `generated_at` alongside the current generation's status (AC-15, AC-58, AC-59, AC-60). |
| Adopted UX | A per-section fallback chip wherever `generated: false`; a line in `reading_path` saying the order is import-graph centrality and not recent activity; a "Re-index" control beside the `not_indexed` status and **never** beside `no_source_files`. | AC-61, AC-62, AC-63, AC-64. Declined: model and cost in the header — out of scope, no criterion, two more columns. |
| Interaction defaults | All five sections open on first load, collapse state not remembered. A TOC click on a collapsed section expands it, then scrolls. The TOC is hidden below `md`. Regenerate asks for no confirmation. The first GET shows a loading skeleton. A diagram that fails to parse renders the prose plus a "diagram unavailable" line. | AC-70 to AC-75. None of these needs persistence, a dialog or a second route. |
| Prompt section kinds | The system prompt is rewritten for the five kinds. It no longer names `routes_and_apis`, which is not one of them, and it allows a diagram only in `architecture`. | AC-68, AC-69. A draft diagram on any other kind is dropped by the render step, not merely discouraged by wording. |
| The `Open` button on `critical_paths` (Q5) | Omitted in v1. The row is path + description, with no control. | Moved to Non-goals beside the Share link. No new route, no new contract field, no criterion either way. |
| Glob tokens in model prose (Q6) | AC-26 stays strict: a path-like token must equal a fact path. | Accepted cost: the mockup's own sentence "route to `src/api/*`" would not survive grounding, so shipped prose names exact files and reads flatter than the design. This is deliberate — a prefix rule would also admit `src/*`, which matches every indexed path and makes the check meaningless. AC-80 and AC-81 push the obligation into the prompt: cite exact indexed paths, never directory globs. |
| `MermaidDiagram` gives the parent no failure signal | Add an optional `fallback?: React.ReactNode` prop, rendered in place of the `null` on the invalid branch. AC-75's trigger becomes "the diagram is not rendered", not "rendering throws". | Verified in the component: a source failing the keyword regex sets `"invalid"` without throwing (`MermaidDiagram.tsx:12-14`, `:29-31`); `mermaid.parse(src, { suppressErrors: true })` returns `false` rather than throwing, deliberately, because mermaid otherwise injects a "Syntax error" graphic into the DOM (`:16-21`, `:39`); the `catch` sets the same state (`:49-51`). All three converge on `return null` (`:59`). The component is first-party under `client/src/components/`, not `client/src/vendor/ui/`, so the vendored-file rule is untouched. |
| A refresh running over a good tour | The page keeps rendering the last good tour's sections while a regeneration runs. | AC-79. AC-3 guaranteed it only by implication; this makes it explicit, one state before AC-58/AC-59 — a refresh never costs the reader what they already had. |

## User stories

- As a **developer new to a repository**, I want a five-part tour of it on one page, so that I know
  what to read first and how to run it without reading the code cold.
- As a **maintainer**, I want to regenerate the tour after the index changes, so that it reflects
  the current code.
- As a **user of a repository with no clone or no index**, I want the page to say plainly why the
  tour is incomplete, so that I know what to do instead of staring at an empty page.

## Acceptance criteria (EARS)

Terms used below:
- **Fact path set**: the repo-relative paths the facts builder collected, meaning the ranked paths
  it read plus the allowlisted root files present in the clone.
- **Path-like token**: a backticked span that contains `/`, or ends in `.` followed by 1–5
  alphanumerics.
- **Block**: a paragraph or a list item of a section `body`.
- **Tour route**: `/repos/[repoId]/tour` — the Next.js route segment, whose nav href template is
  `/repos/:repoId/tour` and is resolved by `resolveHref` (`client/src/vendor/ui/nav.ts:73-76`).
- **Last good tour**: the sections and `generated_at` of the most recent generation that reached
  `status: 'done'` for that repository, as stored on the `onboarding` row.

### Contract

- **AC-1** — `OnboardingSection.kind` shall be
  `z.enum(['architecture','critical_paths','run_locally','reading_path','first_tasks'])` in both
  `server/src/vendor/shared/contracts/knowledge.ts` and `client/src/vendor/shared/contracts/knowledge.ts`.
- **AC-2** — Both contract copies shall export
  `OnboardingReason = z.enum(['flag_off','no_clone','not_indexed','no_source_files','generation_failed'])`.
- **AC-3** — `GET /repos/:id/onboarding` shall respond 200 with a body that parses against the tour
  contract and holds exactly five sections in the order `architecture`, `critical_paths`,
  `run_locally`, `reading_path`, `first_tasks`. This holds in every repository state, including no
  generation, no clone and no index.
- **AC-4** — WHEN no generation has ever completed for a repository, `GET /repos/:id/onboarding`
  shall return `status: 'not_generated'` with every section `generated: false` and a body built
  only from deterministic facts.

### Preconditions

- **AC-5** — IF the repository's `clone_path` is null, or `lstat(clone_path)` fails, THEN
  `GET /repos/:id/onboarding` shall return `reason: 'no_clone'`.
- **AC-6** — IF `config.repoIntelEnabled` is false, THEN `GET /repos/:id/onboarding` shall return
  `reason: 'flag_off'`, whether or not a `repo_index_state` row exists.
- **AC-7** — IF the repository has no `repo_index_state` row, or its status is `degraded` or
  `failed`, THEN `GET /repos/:id/onboarding` shall return `reason: 'not_indexed'`.
- **AC-8** — IF the repository's index row reports zero indexed files with reason `no_files`, THEN
  `GET /repos/:id/onboarding` shall return `reason: 'no_source_files'`, not `'not_indexed'`.
- **AC-9** — WHEN more than one precondition reason applies, the onboarding service shall report
  the first in the order `flag_off`, `no_clone`, `not_indexed`, `no_source_files`.
- **AC-10** — IF the precondition reason is `flag_off`, `no_clone` or `not_indexed`, THEN
  `POST /repos/:id/onboarding` shall respond 409 with that reason in the error body, enqueue no job,
  and make zero `completeStructured` calls.
- **AC-11** — WHILE the precondition reason is `no_source_files`, `POST /repos/:id/onboarding` shall
  accept the request, and the resulting tour shall carry `generated: false` with
  `degraded_reason: 'no_source_files'` on `critical_paths` and `reading_path`.

### Generation lifecycle

- **AC-12** — WHEN `POST /repos/:id/onboarding` is accepted, the API shall respond 202 with a
  `job_id`, and a following `GET` shall return `status: 'running'` with a non-null `started_at`.
- **AC-13** — WHEN an onboarding generation job runs, the onboarding service shall make exactly one
  `completeStructured` call. This holds when the provider throws an error carrying `status: 429` or
  `status: 503`: the handler rethrows a plain `Error`, so `JobRunner`'s `withRetry`
  (`platform/jobs.ts:58`, `platform/resilience.ts:40`) does not retry it.
- **AC-14** — The onboarding service shall resolve the model through `resolveFeatureModel(…, 'onboarding')`.
- **AC-15** — IF the `completeStructured` call throws, or returns output that fails the draft schema,
  THEN the onboarding service shall persist *generation* `status: 'failed'` with
  `reason: 'generation_failed'`, writing no section content (the last good tour is kept by AC-58).
- **AC-16** — IF the model call has not settled within `GENERATION_TIMEOUT_MS`, a named constant
  strictly less than `JobRunner`'s `timeoutMs` (120 000, `platform/jobs.ts:41`), THEN the onboarding
  service shall persist `status: 'failed'` with `reason: 'generation_failed'` before `JobRunner`'s
  timeout fires.
- **AC-17** — IF the model call settles after its generation was marked `failed` (by timeout, by
  the boot reap, or by stale takeover), THEN the onboarding service shall leave that generation
  `failed` and write none of its sections.
- **AC-18** — WHEN `buildApp` boots with `config.nodeEnv !== 'test'`, the API shall mark every
  onboarding generation in `status: 'running'` as `failed` with `reason: 'generation_failed'`.
- **AC-19** — WHILE a generation for a repository is `running` and its `started_at` is newer than
  `GENERATION_STALE_MS`, `POST /repos/:id/onboarding` shall respond 202 with the **existing**
  generation's `job_id` and enqueue no second job.
- **AC-20** — IF a `running` generation's `started_at` is older than `GENERATION_STALE_MS` (a named
  constant greater than `GENERATION_TIMEOUT_MS`), THEN `POST /repos/:id/onboarding` shall mark it
  `failed` and start a new generation.
- **AC-21** — WHEN two `POST /repos/:id/onboarding` requests for the same repository arrive
  concurrently and no generation is running, the API shall enqueue exactly one job.
- **AC-22** — WHEN a generation finishes with at least one section `generated: true` and at least
  one `generated: false`, the onboarding service shall persist `status: 'partial'`.
- **AC-23** — WHEN a generation finishes with all five sections `generated: true`, the onboarding
  service shall persist `status: 'done'` and set `generated_at`.
- **AC-58** — IF a generation fails for a repository that has a last good tour, THEN the onboarding
  service shall leave that tour's stored sections and its `generated_at` byte-identical.
- **AC-59** — WHILE the most recent generation for a repository is `failed` and a last good tour
  exists, `GET /repos/:id/onboarding` shall return that tour's five sections, its original
  `generated_at`, and `reason: 'generation_failed'`.

### Grounding (render step)

- **AC-24** — The onboarding render step shall drop every link whose `path` is not in the fact path
  set, and add one to that section's `dropped_refs` per dropped link.
- **AC-25** — The onboarding render step shall output every section `body` with no markdown link or
  autolink syntax left in it (`[text](url)` becomes `text`, and `<url>` becomes plain text).
- **AC-26** — The onboarding render step shall remove each block of a model-written `body` that
  contains a path-like token not in the fact path set, and add one to `dropped_refs` per removed
  block.
- **AC-27** — The onboarding render step shall remove each block of a model-written `body` that
  contains a backticked `pnpm`, `npm run`, `yarn` or `npx` command whose script or binary name is
  neither among the parsed root `package.json` scripts nor in the fixed manager built-in set
  (`install`, `i`, `add`, `exec`, `dlx`, `create`), and add one to `dropped_refs` per removed block.
- **AC-28** — IF a model-written `diagram` contains a quoted mermaid node label that is path-like and
  not in the fact path set, THEN the onboarding render step shall set that section's `diagram` to
  `null` and add one to `dropped_refs`.
- **AC-69** — IF a model draft returns a non-null `diagram` on any section other than
  `architecture`, THEN the onboarding render step shall set that section's `diagram` to `null`.
- **AC-29** — The onboarding draft schema passed to `completeStructured` shall contain no `title`
  field. The server shall fill each section's `title` from a fixed per-kind table.
- **AC-30** — IF a section's model-written `body` is empty after the render step, THEN the
  onboarding render step shall set that section's `generated: false` and use that kind's
  deterministic body.
- **AC-31** — WHEN the model call fails and no last good tour exists, the onboarding service shall
  build the five sections by calling the same render function it uses on success, with no draft. A
  test that spies on the imported renderer observes this call.

### Facts

- **AC-32** — The `reading_path` section's links shall be the paths returned by
  `repoIntel.getTopFilesByRank`, in that order, truncated to `READING_PATH_LIMIT`. No model output
  can reorder or add to them.
- **AC-33** — The onboarding facts builder shall request each capped list (reading path, critical
  paths, first tasks, scripts, env keys) at its named cap + 1, and shall set that section's
  `truncated: true` only when the source returned more than the cap.
- **AC-34** — IF a non-list input is shortened to fit the prompt (for example the `README.md`
  excerpt), THEN the onboarding facts builder shall leave every section's `truncated` unchanged.
- **AC-35** — The onboarding facts builder shall read clone files only through
  `readTextFileInClone`, and only these root paths: `package.json`, `pnpm-lock.yaml`,
  `package-lock.json`, `yarn.lock`, `docker-compose.yml`, `.env.example`, `README.md`.
- **AC-36** — The onboarding facts builder shall extract key names from `.env.example`, and no
  substring right of a `=` in that file shall appear in the assembled prompt or in any section
  `body`.
- **AC-37** — The onboarding facts builder shall derive the package manager from which lockfile is
  present: `pnpm-lock.yaml` → `pnpm`, `package-lock.json` → `npm`, `yarn.lock` → `yarn`.
- **AC-38** — The `first_tasks` section shall list items only from three sources, each item carrying
  the strongest anchor that source has: open findings (`file:start_line`), pending convention
  candidates (candidate id with `evidence_path:evidence_start_line`), and high-rank files with no
  sibling test (the repo-relative path alone — this source has no line number, and none is
  fabricated).
- **AC-39** — The onboarding facts builder shall select a finding for `first_tasks` only when it
  belongs to the repository and has `accepted_at IS NULL AND dismissed_at IS NULL`.
- **AC-40** — IF all three `first_tasks` sources are empty, THEN the `first_tasks` section shall
  contain no items and a deterministic statement that no signals were found, and shall discard any
  model-written `first_tasks` prose.
- **AC-65** — IF none of `pnpm-lock.yaml`, `package-lock.json` and `yarn.lock` is present in the
  clone root, THEN the onboarding facts builder shall emit each run command as the bare
  `package.json` script name, with no package-manager prefix.
- **AC-66** — The onboarding facts builder shall select a pending convention candidate for
  `first_tasks` only when its stored evidence proof succeeded; a candidate with
  `evidence_valid = false` is excluded.
- **AC-67** — A `first_tasks` item built from an untested high-rank file shall carry the path with
  no line number and no trailing `:` separator, in both the section body and the item's anchor
  field.

### Prompt and untrusted input

- **AC-41** — The onboarding service shall place every repository-derived string in the prompt
  inside `wrapUntrusted()`: file excerpts, paths, script names, env key names, the repository full
  name, finding titles and convention rules.
- **AC-42** — The onboarding service shall load its system prompt through
  `renderPrompt('onboarding.system.md', …)`.
- **AC-43** — WHEN `pnpm build` completes in `server/`, the build shall have produced
  `server/dist/prompts/onboarding.system.md`.
- **AC-68** — `server/src/prompts/onboarding.system.md` shall name exactly the five section kinds
  (`architecture`, `critical_paths`, `run_locally`, `reading_path`, `first_tasks`) and shall contain
  no other kind name, `routes_and_apis` included.
- **AC-80** — `server/src/prompts/onboarding.system.md` shall instruct the model to cite only exact
  indexed file paths, naming the directory-glob form (for example `src/api/*`) as not accepted.
- **AC-81** — `server/src/prompts/onboarding.system.md` shall contain exactly one backticked token
  ending in `/*`, the counter-example inside the AC-80 sentence, so the prompt never models elsewhere
  the form AC-26 drops.

### Client

- **AC-44** — The sidebar shall render an "Onboarding Tour" item whose href template is
  `/repos/:repoId/tour`, resolved against the active repository id by `resolveHref`. This adds the
  item to `NAV`'s `WORKSPACE` group in `client/src/vendor/ui/nav.ts`, the one vendored file the root
  `AGENTS.md` allows a new top-level page to touch (precedent: specs 0006 and 0007).
- **AC-45** — `activeKeyFor('/onboarding')` shall return a value other than `'onboarding-tour'`.
- **AC-46** — `activeKeyFor('/repos/<id>/tour')` shall return `'onboarding-tour'`.
- **AC-47** — The tour page shall render a table of contents with five links, in contract order,
  where link *k* has `href="#<kind>"` and the matching section element has `id="<kind>"`.
- **AC-48** — The tour page shall render each section heading and TOC label from an i18n key
  selected by `kind`, and never from the API's `title` field.
- **AC-49** — The tour page shall render each section header as a `button` whose `aria-expanded`
  value reflects, and toggles, the visibility of that section's body.
- **AC-50** — WHILE the tour's `status` is anything other than `done`, the tour page shall render a
  `role="status"` element whose text is the i18n sentence for that status and reason, not the raw
  enum value.
- **AC-51** — WHERE a `repo_index_state` row exists, the tour page header subline shall show that
  row's `files_indexed` count ("Generated from index of N files", per the mockup).
- **AC-52** — WHILE the tour's `status` is `running`, the tour page shall disable the Regenerate
  button and re-fetch `GET /repos/:id/onboarding` until `status` is no longer `running`.
- **AC-53** — WHILE the precondition reason is `flag_off`, `no_clone` or `not_indexed`, the tour
  page shall disable the Regenerate button.
- **AC-54** — IF the sum of `dropped_refs` across sections is greater than zero, THEN the tour page
  shall show that number in its status text.
- **AC-57** — WHERE the tour's `generated_at` is non-null, the tour page header shall render its
  "last refreshed" value from that timestamp, and shall render no second timestamp in that line.
- **AC-60** — WHILE the tour's `reason` is `generation_failed` and a last good tour is shown, the
  tour page's `role="status"` element shall state both that the refresh failed and the age of the
  version on screen.
- **AC-61** — WHERE a section has `generated: false`, the tour page shall render a fallback chip in
  that section's header, labelled from i18n.
- **AC-62** — The tour page shall render, inside the `reading_path` section, an i18n line stating
  that the order comes from import-graph centrality and not from recent activity.
- **AC-63** — WHILE the precondition reason is `not_indexed`, the tour page shall render a
  "Re-index" control beside the status that issues `POST /repos/:id/resync`.
- **AC-64** — IF the precondition reason is `no_source_files`, THEN the tour page shall render no
  "Re-index" control.
- **AC-70** — WHEN the tour page mounts, the tour page shall render all five section bodies
  expanded, whatever was collapsed before the mount.
- **AC-71** — WHEN a table-of-contents link whose target section is collapsed is activated, the tour
  page shall expand that section.
- **AC-72** — WHILE the viewport is narrower than the Tailwind `md` breakpoint (768 px), the tour
  page shall not display the table of contents.
- **AC-73** — WHEN the Regenerate button is activated, the tour page shall issue
  `POST /repos/:id/onboarding` without first rendering a confirmation dialog.
- **AC-74** — WHILE the first `GET /repos/:id/onboarding` of a page visit is in flight, the tour
  page shall render a loading skeleton and no section body.
- **AC-75** — IF a section's `diagram` is not rendered by `MermaidDiagram` — it fails the
  `MERMAID_RE` keyword test, `mermaid.parse` returns `false`, or the lazy import throws, all three of
  which land on the same `"invalid"` state — THEN the tour page shall render that section's body
  prose together with an i18n "diagram unavailable" line and no `svg`, by passing that line to
  `MermaidDiagram`'s new `fallback` prop.
- **AC-76** — The tour page shall render the `run_locally` commands as an ordered list, numbered
  from 1 in the order the facts builder returned them.
- **AC-77** — The tour page shall render, for each `run_locally` command, a control with an
  accessible name that copies that command's exact text to the clipboard.
- **AC-78** — The tour page heading shall render the repository name segment (the part of
  `full_name` after `/`), not the full name.
- **AC-79** — WHILE a generation for a repository is `running` and a last good tour exists, the tour
  page shall render that tour's five section bodies.

### e2e and scope guard

- **AC-55** — WHEN the e2e onboarding flow opens the tour route for the seeded `acme/payments-api`
  (`clonePath: null`, `server/src/db/seed.ts:93`), the tour page shall show all five section
  headings and the `no_clone` status sentence, and the flow shall click no mutating control.
- **AC-56** — The change shall leave `server/src/modules/repo-intel/pipeline/**`, `CLONE_DEPTH`,
  `SUPPORTED_EXT` and `MAX_INDEXED_FILES` unmodified.

## Edge cases

- **Orphaned `running` row after an API restart.** `app.ts:100-112` reaps `agent_runs` and `jobs`
  only. Without AC-18 and AC-20, the guard in AC-19 would block every future generation for good.
- **Hung provider call.** `withTimeout` rejects the job while the handler keeps running
  (`platform/resilience.ts:13-24`). On the default OpenRouter path nothing enforces a timeout
  (`server/INSIGHTS.md` 2026-09-27). AC-16 bounds the row and AC-17 guards against the late write;
  the provider's spend is not stopped (Non-goals).
- **429/5xx retried three times by the job runner.** Covered by AC-13.
- **Prose or diagram naming a nonexistent file, or inventing a command.** Covered by AC-25, AC-26,
  AC-27 and AC-28. A prompt instruction is not an invariant.
- **Model-supplied titles.** Removed by AC-29 and AC-48, so the heading, the TOC and the anchor
  cannot disagree.
- **Truncation the facade hides.** `getTopFilesByRank(repoId, n)` returns at most `n`, and
  `getCriticalPaths` caps its roots internally at `CRITICAL_PATH_ROOTS = 5`
  (`repo-intel/service.ts:710`). Without cap + 1 (AC-33), `truncated: false` would be a guess.
- **Clone deleted after indexing.** `readTextFileInClone` returns `null` on a missing root, so
  without AC-5 the tour would be silently empty with no reason.
- **Indexed repo with zero supported-extension files** (Python or Go). `runFullIndex` persists
  status `partial` with `stats.reason: 'no_files'` and `filesIndexed: 0`
  (`repo-intel/pipeline/full.ts:101-105`), and `repository.ts:212-225` reads `stats.reason` back
  into `IndexState.reason` — so AC-8 can read it off the persisted row, and because the status is
  `partial` rather than `degraded`/`failed`, AC-7 does not shadow it and AC-9's precedence holds.
  Without AC-8 and AC-11 the page would say "re-index", and re-indexing yields zero files again: a
  loop with no exit. AC-64 keeps the "Re-index" control out of this state for the same reason.
- **Flag off but an index row present.** `getTopFilesByRank` returns `[]` when the flag is off
  (`service.ts:648`), which looks the same as "no index". AC-6 reads the flag directly.
- **Half-successful generation.** Covered by AC-22 and AC-30.
- **First run, no history.** Covered by AC-4.
- **Repository deleted while generating.** `onboarding.repo_id` cascades on delete
  (`context.ts:123`). The job's final write then targets no row and must not throw an unhandled
  error. Same shape as `runFullIndex`'s `repo_not_found` (`full.ts:80-81`).
- **Two writers.** Concurrent POSTs are covered by AC-21. Stale running rows are covered by AC-20.
- **Symlinked allowlist file** (for example `package.json` pointing at `../../.env`). This is
  `readTextFileInClone`'s `lstat` + `realpath` guard (`platform/safe-read.ts:64-70`). AC-35 keeps
  every read on that path.
- **Malformed `package.json`.** The facts builder must yield no scripts rather than throw. The
  `run_locally` skeleton still renders.
- **`MAX_INDEXED_FILES` (5000) bound hit.** The mockup's example "12,450 files" is above the
  indexer bound, so `files_indexed` can never show it. The header shows the indexed count (AC-51),
  not a repository file count.
- **The existing `contracts.test.ts` fixture** (`server/test/contracts.test.ts:193-196`) parses an
  `Onboarding` payload. Narrowing `kind` (AC-1) breaks it unless it is updated in the same change.
- **A regeneration that fails over a good tour.** One transient 429 on Regenerate would otherwise
  send a repository that already had a `done` tour back to the deterministic skeleton, destroying
  orientation nobody asked to lose. AC-58 keeps the stored sections, AC-59 serves them with their
  original `generated_at`, and AC-60 says on screen that the refresh failed and how old the shown
  version is.
- **No lockfile in the clone** (a repository vendored without one, or a non-Node stack with a
  `package.json`). AC-37 maps a lockfile to a manager; AC-65 covers its absence by printing bare
  script names rather than guessing `npm`.
- **A pending convention candidate whose evidence proof failed.** `evidence_valid = false` means the
  cited span no longer matches, so the task would send a newcomer to a line that proves nothing.
  AC-66 excludes it.
- **An untested-file task has no line number.** Findings and candidates carry a line; this third
  source carries only a path. AC-38 and AC-67 keep it a path rather than inventing `:1`.
- **The prompt names a sixth kind.** `onboarding.system.md` as written names `routes_and_apis`,
  which is not one of the five and would make `OnboardingSection.kind` (AC-1) reject the draft.
  AC-68 rewrites the prompt; AC-69 drops a diagram the draft puts on any kind but `architecture`.
- **A diagram the browser cannot parse.** `MermaidDiagram` does **not** throw. A source failing the
  keyword regex sets `"invalid"` (`MermaidDiagram.tsx:12-14`, `:29-31`);
  `mermaid.parse(src, { suppressErrors: true })` returns `false` rather than throwing, deliberately,
  because mermaid otherwise injects a "Syntax error" graphic into the DOM (`:16-21`, `:39`); and the
  `catch` sets the same state (`:49-51`). All three converge on `if (state === "invalid") return null`
  (`:59`), so the parent receives no signal at all today. AC-75 therefore triggers on "the diagram is
  not rendered", and the new `fallback` prop puts the stated line where that `null` was.
- **Clock skew on the header's age.** `generated_at` can be newer than the browser's clock (a server
  ahead of the client, or a machine whose clock jumps), which would otherwise render a negative
  interval or "in 2 hours" in the AC-57 line and the AC-60 sentence. A negative interval is clamped
  to the "just now" string. No separate criterion: the clamp is one branch of the age formatter, and
  the AC-57 and AC-60 assertions cover the line it feeds.
- **The e2e flow must sort before `10-pr-finding-actions`.** `e2e/AGENTS.md` requires the one
  mutating flow to sort last, so the next free number, `11-`, cannot be used as-is.

## Non-functional

- **Security.** Every read inside the clone goes through `readTextFileInClone` (AC-35). Every
  repository-derived string in the prompt is wrapped (AC-41). `.env.example` values never leave the
  parser (AC-36). Prose has its link syntax stripped (AC-25).
  **What this cannot do:** the render step checks backticked tokens, link targets and quoted
  mermaid labels. Plain unbackticked prose that makes a false claim *without* naming a path or
  command (for example "this repo uses Redis") passes. Grounding narrows the model's surface; it
  does not prove the prose true.
- **Accessibility.** WCAG 2.2 AA for the tour page. Status is announced through `role="status"`
  (AC-50), the collapsibles expose `aria-expanded` on a native `button` (AC-49), and each icon-only
  copy control carries an accessible name (AC-77). The fallback chip (AC-61) carries text, so
  "this section is a skeleton" is never signalled by colour alone.
- **Cost.** One model call per accepted POST (AC-13), zero on refused POSTs (AC-10) and zero on
  `GET`.
- **Ordering honesty.** `reading_path` order is pure import-graph PageRank, because `hotness` is
  always `0`. Any description of the ordering, in UI or docs, must not claim it reflects recent
  activity. AC-62 puts that statement on the page itself, so the obligation is visible to the
  reader and not only to this spec.
- **Grounding over fluency (accepted cost).** AC-26 admits a path-like token only when it equals a
  fact path, so shipped prose names exact files: the mockup's own sentence "route to `src/api/*`"
  would be dropped by this feature's own rule, and the prose reads flatter than the design. That is
  deliberate — a prefix rule would also admit `src/*`, which matches every indexed path and makes the
  check meaningless. AC-80 and AC-81 move the obligation into the prompt, so an exact citation is
  what the model is asked for and a drop is the exception rather than the norm.
- **Freshness honesty.** The header carries exactly one timestamp, the tour's `generated_at`
  (AC-57). WHILE a last good tour is shown after a failed refresh, its age is stated rather than
  implied (AC-60) — a stale tour that looks current is the failure mode this pair exists to
  prevent.
- **Enforcement split.** 79 of the 81 criteria have a named automated test below. Eight of those
  (AC-18 to AC-21, AC-38 to AC-40 and AC-66, in four `.it.test` files) run only in the user's
  Docker lane, so no agent run proves them. AC-43 is a build-output check outside vitest. AC-56 is
  checked against the diff by `plan-verifier`, not by a test. AC-72 is asserted through the
  rendered `hidden md:*` class rather than a real viewport, so it proves the class and not the
  pixels.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| Ranked file paths | `repoIntel.getTopFilesByRank` | [reused: spec 0007 / repo-intel] | `file_rank.rank` = PageRank; `hotness` is always 0 |
| Critical paths | `repoIntel.getCriticalPaths` | [reused: repo-intel] | Facade caps roots at 5 internally |
| Index state | `repoIntel.getIndexState` + `config.repoIntelEnabled` | [reused: repo-intel] | Drives AC-5 to AC-9 |
| Root files (allowlist) | `readTextFileInClone` | [deterministic: fixed allowlist, parsed in code] | AC-35 |
| Stack / package manager / scripts | parsed `package.json` + lockfile presence | [deterministic: JSON parse + filename map] | AC-37 |
| Env key names | `.env.example` | [deterministic: line parse, keys only] | AC-36 |
| Open findings | `findings` rows | [reused: L01] | AC-39 |
| Pending convention candidates | conventions candidates, status `pending`, evidence proof valid | [reused: spec 0007] | AC-66. The column exists: `evidenceValid: boolean('evidence_valid').notNull().default(false)` (`server/src/db/schema/knowledge.ts:138`) |
| Untested high-rank files | ranked paths minus same-directory sibling tests | [deterministic: path predicate, Q4 decision] | AC-67; path only, no line number |
| Section prose + diagram | `completeStructured` | [llm] | Grounded by AC-24 to AC-30 |
| Model choice | `resolveFeatureModel(…,'onboarding')` | [reused: settings] | AC-14 |
| Generation state | `onboarding` table (extended) | [new] | status, reason, started_at, per-section flags. **The row is no longer a single current state:** after AC-58 it carries the *last good* sections and their `generated_at` alongside the *current* generation's status, so a failed refresh can be reported over a tour that still renders (AC-59, AC-60) |
| Last good tour | `onboarding` row, sections of the last `done` generation | [llm] (or [deterministic] where that generation fell back) | Served unchanged while the newest generation is `failed`; its age is stated on screen |
| Tour page, TOC, collapsible section | client | [new] | |
| Diagram fallback slot | `MermaidDiagram`'s new `fallback?: React.ReactNode` prop (`client/src/components/mermaid-diagram/MermaidDiagram.tsx:59`) | [new] | The component returns `null` on its `"invalid"` branch and signals the parent nothing (`:39` `suppressErrors`, `:49-51` catch), so AC-75 was not implementable without it. First-party component, not `client/src/vendor/ui/` |

## Untrusted inputs

All of the following are written by strangers and are **data, never instruction**:

- **File contents** of the allowlisted root files (`README.md` in particular: free prose).
- **File paths** from the index. A path name is attacker-chosen.
- **Script names and values** in `package.json`, and **key names** in `.env.example`.
- **The repository full name.** The `RepoInput` URL regex admits newlines (`server/INSIGHTS.md`
  2026-09-20). It must be wrapped even though it reads like task-line text.
- **Finding titles and bodies.** They are model output steered by PR diffs.
- **Convention candidate rules.**

Obligations:
- `reviewer-core/AGENTS.md` requires all untrusted content to be wrapped with `wrapUntrusted()`.
  AC-41 makes that a testable criterion for this feature's prompt.
- `groundFindings()` does not apply, because this feature produces no findings. Its role here is
  taken by the render step's grounding (AC-24 to AC-28) against the fact path set and the parsed
  scripts.
- The model never supplies a path that is opened (AC-35). That closes the `.git/config` token
  exfiltration route recorded in `server/INSIGHTS.md` 2026-09-20.

## Test plan

| Criteria | Test |
|---|---|
| AC-1, AC-2 | `server/test/contracts.test.ts`: the enum rejects `routes_and_apis` and accepts all five kinds, and the reason enum rejects an unknown value. Region-scoped `diff` of the Onboarding block across both `knowledge.ts` copies in the same test file. |
| AC-3, AC-4 | `server/test/onboarding-routes.test.ts` (hermetic, stubbed container): GET with no generation, with no clone and with no index, each returning five sections in order; and the paired positive case, a `done` tour, also returns five. |
| AC-5, AC-6, AC-7, AC-8, AC-9 | `server/test/onboarding-preconditions.test.ts`: one case per reason, including `clone_path` set but `lstat` failing, flag off with an index row present, and `partial` + `no_files`. A table of combined states asserts the precedence order. Negative: a healthy repo yields `reason: null`. |
| AC-10, AC-11 | `server/test/onboarding-routes.test.ts`: POST under each blocking reason returns 409 with zero `completeStructured` calls and zero `jobs.enqueue` calls. POST under `no_source_files` returns 202, and the resulting sections carry the degraded reason. |
| AC-12 | `server/test/onboarding-routes.test.ts`: 202 + `job_id`, then GET shows `running` with `started_at`. |
| AC-13 | `server/test/onboarding-job.test.ts`: run the handler through a real `JobRunner` with a provider stub that throws `{status: 429}` and then `{status: 503}`. Assert exactly one call. Paired case: a successful stub also gets exactly one call. |
| AC-14 | `server/test/onboarding-service.test.ts`: spy `resolveFeatureModel`, which is called with `'onboarding'`. |
| AC-15, AC-31 | `server/test/onboarding-service.test.ts`: with no last good tour stored, the provider throws, and separately returns schema-invalid output. Row is `failed` / `generation_failed`. A spy on the imported renderer is called with `draft = null`. |
| AC-58, AC-59 | `server/test/onboarding-service.test.ts`: seed a `done` tour with known sections and `generated_at`, then fail a regeneration (throw, and separately a schema-invalid draft). Assert the stored sections and `generated_at` are unchanged by deep equality, and that a following `GET` returns those five sections with the original `generated_at` and `reason: 'generation_failed'`. Paired: the same regeneration succeeding does replace both. |
| AC-16, AC-17 | `server/test/onboarding-service.test.ts` with fake timers: a never-settling provider gives `failed` before 120 000 ms. A provider that resolves after the timeout leaves the row `failed` with no sections written. Static check in the same test: `GENERATION_TIMEOUT_MS < 120_000`. |
| AC-18 | `server/test/onboarding-reap.it.test.ts` (user lane, `NODE_ENV: 'development'` against a testcontainer DB, per `boot-reap.it.test.ts`): a seeded `running` row becomes `failed` after `buildApp`. Paired: under `NODE_ENV: 'test'` it stays `running`. |
| AC-19, AC-20, AC-21 | `server/test/onboarding-concurrency.it.test.ts` (user lane): a fresh `running` row → POST responds 202 with that generation's existing `job_id` and enqueues nothing. A `running` row older than `GENERATION_STALE_MS` → the old one is `failed` and a new job starts. Two concurrent POSTs → exactly one `jobs` row of the onboarding kind. |
| AC-22, AC-23, AC-30 | `server/test/onboarding-render.test.ts`: a draft with two empty bodies → `partial` and those two sections fall back to their deterministic bodies. A full valid draft → `done` with `generated_at`. |
| AC-24, AC-25, AC-26, AC-27, AC-28 | `server/test/onboarding-render.test.ts`: one fixture per rule (unknown link path; `[x](http://e)` and `<http://e>`; a block citing `` `src/nope.ts` ``; a block citing `` `pnpm db:reset` `` with no such script; `A["src/nope.ts"]` in mermaid), each asserting the drop and the `dropped_refs` increment. Paired fixtures with a known path, a known script and a known label must survive unchanged, and `` `pnpm install` `` (a manager built-in, no such script) must survive too. |
| AC-69 | `server/test/onboarding-render.test.ts`: a draft carrying a valid diagram on `critical_paths` and on `architecture` → the `critical_paths` diagram is `null`, the `architecture` one survives. |
| AC-29 | `server/test/onboarding-render.test.ts`: the draft schema's shape has no `title` key, and the output titles equal the per-kind table. |
| AC-32 | `server/test/onboarding-facts.test.ts`: the stubbed facade returns a ranked list, and the `reading_path` links equal it in order, cut at the cap, even when the draft lists the paths in reverse. |
| AC-33, AC-34 | `server/test/onboarding-facts.test.ts`: for each capped list, a source returning cap + 1 items gives `truncated: true`, and exactly cap items gives `truncated: false`. Also: a `README.md` longer than the excerpt limit leaves `truncated` false everywhere. |
| AC-35 | `server/test/onboarding-facts.test.ts`: spy `readTextFileInClone`. Its call set equals the allowlist exactly. No `fs` import in the facts module (asserted by the same test via a module-mock trap). |
| AC-36 | `server/test/onboarding-facts.test.ts`: `.env.example` with `SECRET=hunter2-marker`. The key `SECRET` reaches the facts; `hunter2-marker` appears in neither the assembled messages nor any body. |
| AC-37, AC-65 | `server/test/onboarding-facts.test.ts`: one case per lockfile; plus a clone with a `package.json` and no lockfile → the commands are bare script names and contain none of `pnpm `, `npm `, `yarn `. |
| AC-38, AC-39, AC-40, AC-66, AC-67 | `server/test/onboarding-first-tasks.it.test.ts` (user lane): seeded findings that are accepted, dismissed and open — only the open one is listed, with `file:start_line`. A pending candidate with valid evidence, a pending candidate with `evidence_valid = false`, and an accepted one — only the first is listed. An untested high-rank file is listed as its bare path, matching `/^[^:]+$/`. Zero signals → no items and a draft whose `first_tasks` prose claims tasks is discarded. |
| AC-41 | `server/test/onboarding-prompt.test.ts`: inject `IGNORE PRIOR INSTRUCTIONS` into the repo name, a README line, a path, a script name, an env key, a finding title and a rule. Each occurrence must lie inside an `<untrusted>` block of the assembled messages. |
| AC-42 | `server/test/onboarding-prompt.test.ts`: spy `renderPrompt`, which is called with `'onboarding.system.md'`. |
| AC-68 | `server/test/onboarding-prompt.test.ts`: read `src/prompts/onboarding.system.md` and assert each of the five kind names appears and `routes_and_apis` does not. Paired: the same assertion over the five, so a prompt that dropped one fails too. |
| AC-43 | Validation-phase build check: `cd server && pnpm build && test -f dist/prompts/onboarding.system.md`. Not a vitest. Recorded in `## Phases`. |
| AC-44 | `client/src/components/app-shell/AppShell.test.tsx` (or the nav test that exists): with active repo `r1`, the item's `href` is `/repos/r1/tour`; with no active repo, `resolveHref`'s `_` placeholder applies. |
| AC-45, AC-46 | `client/src/components/app-shell/helpers.test.ts`: `/onboarding` (the wizard) does not map to `'onboarding-tour'`; `/repos/r1/tour` does. |
| AC-47, AC-48, AC-49 | `OnboardingTour.test.tsx` (feature component): five TOC links with `#<kind>` hrefs and matching ids. Headings come from i18n even when the API `title` is `"INJECTED"`. Clicking a header flips `aria-expanded` and hides or shows the body. |
| AC-50, AC-51, AC-54 | `OnboardingTour.test.tsx`: for each status/reason, `getByRole('status')` text equals the i18n sentence and never contains the enum literal. The header subline shows `files_indexed`. The dropped count appears when it is > 0 and is absent when it is 0. |
| AC-52, AC-53 | `OnboardingTour.test.tsx` with a mocked `fetch`: `running` → button disabled and a second GET issued; a blocking reason → button disabled. Paired: `done` → button enabled. |
| AC-57, AC-78 | `OnboardingTour.test.tsx`: `full_name: 'acme/payments-api'` with `generated_at` two hours old → the heading contains `payments-api` and not `acme/`, and the header line carries exactly one time element, derived from `generated_at`. Paired: a `repo_index_state.updated_at` differing from `generated_at` changes nothing in that line. Clock-skew branch (no criterion, see `## Edge cases`): a `generated_at` 30 s in the future renders the "just now" string and no negative interval. |
| AC-60 | `OnboardingTour.test.tsx`: `reason: 'generation_failed'` with sections present and a `generated_at` two days old → the `role="status"` text names both the failed refresh and the age. Paired: `status: 'done'` renders neither phrase. |
| AC-61, AC-62 | `OnboardingTour.test.tsx`: a tour with three `generated: true` and two `generated: false` sections renders exactly two fallback chips, on those two headers. The `reading_path` section always contains the centrality line, under both `done` and `not_generated`. |
| AC-63, AC-64 | `OnboardingTour.test.tsx` with a mocked `fetch`: `reason: 'not_indexed'` → the Re-index control renders, and activating it POSTs `/repos/r1/resync`. `reason: 'no_source_files'` → `queryBy` the control returns null. Paired: `flag_off` and `no_clone` also render no Re-index control. |
| AC-70, AC-71 | `OnboardingTour.test.tsx`: on mount all five bodies are visible and every header is `aria-expanded="true"`. Collapse two, unmount, remount → all five expanded again. Collapse `first_tasks`, click its TOC link → that header is `aria-expanded="true"`. |
| AC-72 | `OnboardingTour.test.tsx`: the TOC container's class list carries the `hidden` + `md:` pair. Noted in `## Non-functional` as a class assertion, not a viewport one. |
| AC-73, AC-74 | `OnboardingTour.test.tsx` with a mocked `fetch`: clicking Regenerate issues the POST within the same act, with no `role="dialog"` ever present. A pending first GET renders the skeleton and no section body; once resolved, the skeleton is gone and the five bodies are present. |
| AC-75 | `OnboardingTour.test.tsx`: `architecture` with `diagram: 'see the drawing above'` (which fails `MERMAID_RE`, so `mermaid` is never imported) → the body prose is still in the document, the "diagram unavailable" i18n line renders, and `container.querySelector('svg')` is null. Second case with `mermaid` module-mocked so `parse` resolves `false` → same three assertions. Paired: `mermaid` mocked with `parse → true` and `render → { svg: '<svg data-ok="1"/>' }` and a `flowchart TD` source → the svg is present and the fallback line is absent. |
| AC-76, AC-77 | `OnboardingTour.test.tsx`: the `run_locally` commands render as an `ol` whose items match the facts order. Each item has a control with an accessible name; activating the second one calls `navigator.clipboard.writeText` (stubbed) with that command's exact string. |
| AC-79 | `OnboardingTour.test.tsx` with a mocked `fetch`: a GET resolving `status: 'running'` carrying the last good five sections and their `generated_at` → all five bodies are in the document while the Regenerate button is disabled (AC-52). Paired: the same `running` payload with no stored sections (`not_generated`-shaped deterministic bodies) still renders five bodies, and the first-GET-in-flight case of AC-74 still renders the skeleton and none of them. |
| AC-80, AC-81 | `server/test/onboarding-prompt.test.ts`: read `src/prompts/onboarding.system.md` and assert it carries the exact-indexed-path instruction, and that backticked tokens ending in `/*` number exactly one. Paired: a fixture copy of that prompt text with `` `src/api/*` `` added to a body paragraph fails the count assertion, so the check is not vacuous. |
| AC-55 | `e2e/flows/<NN>-onboarding-tour.flow.json` (numbered to sort before `10-pr-finding-actions`): open the tour route, `wait --text` for each section heading and the `no_clone` sentence. Read-only, no `"mutates"`. Row added to the `e2e/README.md` coverage table. |
| AC-56 | `plan-verifier` against the diff: no hunk under `repo-intel/pipeline/**`, `modules/repos/constants.ts` (`CLONE_DEPTH`) or the `SUPPORTED_EXT` / `MAX_INDEXED_FILES` lines of `repo-intel/constants.ts`. |

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | | request read, specs + INSIGHTS checked |
| Planning | | spec approved, decisions |
| Implementation | | |
| Validation | | typecheck · lint · tests · e2e · manual |
| Completion | | status done, docs, insights wrap-up |
