---
title: PR Brief
status: approved
lesson: L05
packages: [server, client, e2e]
---

## Problem & why

A reviewer opening a PR in DevDigest gets facts, but never a reading order. The Overview tab today
renders the intent card and the blast-radius card side by side
(`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:22-31`) and
nothing else: no statement of what the PR does, no ranked list of what to read first, no named
risks. The reviewer has to synthesise that themselves from two cards and a nine-file diff.

The parts to answer it are already built and inert:

- `pr_brief` exists as a table — `server/src/db/schema/reviews.ts:145-150`,
  `{ prId uuid PK → pull_requests.id cascade, json jsonb notNull }`, created in
  `server/src/db/migrations/0000_init.sql:211`. **Nothing in `server/src` reads or writes it.**
- `Risk`, `Risks` and `PrBrief` are defined in
  `server/src/vendor/shared/contracts/brief.ts:72-84,140-146`. `Risks` and `PrHistory` are
  referenced nowhere else in the codebase.
- `risk_brief` is a selectable feature model (`contracts/platform.ts:14-20`, registry `:62-67`) and
  changes nothing today — only a test resolves it.
- `VerdictBanner`
  (`client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.tsx`) is a
  pure presentational component used on one tab.

The cost: the three most expensive questions a reviewer asks — *what is this, what could it break,
what do I read first* — are answered by nobody, while a table, a contract and a model setting built
to answer them sit unused.

## Goals / Non-goals

**Goals**

- A **PR Brief** block at the top of the Overview tab: a summary, a `RISK AREAS` list and a
  `REVIEW FOCUS — READ THESE FIRST` list.
- **Exactly one** structured LLM call per generation, over *already-computed facts* only. No diff
  hunk body ever reaches the model.
- Every path the model names is **grounded** against the PR's own `files[]` and the blast map
  before anything is persisted. Ungrounded paths are dropped, not shown.
- The brief is cached in `pr_brief`, bound to the head SHA. Opening a PR page never spends a model
  call; regeneration is always an explicit click.
- The brief generates when inputs are missing (no intent, degraded blast, no issue, no spec links)
  and **states which inputs were missing**.
- A Review focus click opens the Files changed tab with that file expanded.
- Two optional extras, both in scope: the existing `VerdictBanner` reused on Overview carrying the
  brief's summary, and risk rows that expand to reveal `Risk.explanation`.

**Non-goals**

- **Line-level navigation.** A Review focus item carries `file:line` as *text*; the deep link is
  file-level only. Nothing scrolls to the line.
- **`PrHistory` / "Prior PRs touching these files".** The mockup renders this panel under Blast
  radius; it is out of scope. `PrHistory` stays unreferenced, and no criterion mentions it.
- **A job queue.** Generation is a synchronous `POST`. No polling, no `job_id`, no `JobRunner` —
  unlike spec 0017's onboarding generator, which this feature deliberately does not copy.
- **A Project Context Folder.** Spec 0016 is still `draft` with no module, table or route. The
  brief's spec input is the Intent Layer's existing `pr_intent.sources` rows only.
- **A migration.** `pr_brief` already exists; `server/src/db/migrations/**` is do-not-touch and is
  not touched.
- **Snapshotting intent or blast into the envelope.** Those stay live behind their own endpoints.
- **Automatic regeneration.** A stale brief is labelled, never silently refreshed.
- **An MCP tool.** `mcp/` is not touched.
- **Changing `Risk`'s shape.** `{kind, title, explanation, severity, file_refs}` ships as it is.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| Scope | All P1 criteria, plus exactly two optional extras: the reused `VerdictBanner` on Overview, and expandable risk rows. | Line-level scrolling and `PrHistory` are Non-goals. The mockup's "Prior PRs touching these files" panel is not built. |
| Generation transport | Synchronous `POST /pulls/:id/brief`: one model call, result returned in the response. Module shape follows `server/src/modules/blast/` + `conventions/`, not `onboarding/`. | No queue, no polling, no `202`. The request is bounded by the LLM timeout (see `## Non-functional`), and a double-click is the client's problem to prevent (AC-25). |
| Read transport | `GET /pulls/:id/brief` returns the cached brief or an explicit "none yet" state. | A PR with no brief is a 200 with `brief: null`, not a 404 — the client renders the Generate state from data, not from an error. |
| Staleness | `GET` returns the cached brief with `stale: true` when the stored `head_sha` differs from the PR's current head. | The UI shows an out-of-date hint beside the refresh button. Opening a PR page never spends a model call (AC-19, AC-34). |
| Cached envelope | `pr_brief.json` stores `{ summary, risks, review_focus, head_sha, generated_at, model, missing_inputs[] }`. | Intent and blast are **not** snapshotted; they stay live behind `/intent` and `/blast`. A replayed brief can therefore sit beside a newer blast map, by design. |
| Contract | `PrBrief` in `server/src/vendor/shared/contracts/brief.ts` gains `summary: string` and `review_focus: { file, line, reason }[]`, mirrored byte-identically into `client/src/vendor/shared/contracts/brief.ts`. The two files were diffed on 2026-10-02 and are byte-identical today, so AC-25 preserves a verified premise rather than asserting a hoped-for one. | A cross-package change: server typecheck + tests, `reviewer-core` typecheck, client typecheck (shared `AGENTS.md`). |
| A risk with one good and one invented `file_ref` | Strip the invented ref; keep the risk (AC-9). | A true claim about a real file is not discarded because of one bad citation. The accepted cost: a risk can ship having lost half its evidence, with nothing on screen saying so. |
| Overview with no finished review | No `VerdictBanner`. `summary` renders as a plain paragraph inside the block (AC-49); the banner appears only once a finished review exists (AC-39). | `VerdictBanner.verdict` is required and typed `request_changes\|approve\|comment` with `VERDICT_META[verdict] ?? VERDICT_META.comment` as its only fallback, so rendering it unreviewed would put a neutral "Comment" verdict chip on a PR nobody reviewed — a verdict the product never made. |
| Timeout and failure code | `BRIEF_TIMEOUT_MS = 60_000`, passed as `completeStructured({ timeoutMs })`. A provider failure or timeout throws `AppError` with `statusCode: 502`. | `server/src/app.ts:187-196` re-throws `AppError` with its own status, while a bare `Error` falls through to 500 / `internal_error` — so the 502 must be deliberate (AC-14), not incidental. |
| List caps | The prompt instructs at most 5 risks and at most 6 review-focus items (AC-50). The client renders everything that survives grounding (AC-51) — it never truncates. A review-focus item with `line < 1` is dropped during grounding (AC-52). | The cap is a prompt instruction, not a slice, so an over-long response is visible rather than silently cut. `src/config.ts:0` cannot ship. |
| Refresh control placement | The refresh control and the stale hint live in the block's `SectionLabel` right slot (AC-53, AC-36), **not** inside the verdict banner where the mockup draws the refresh glyph. | A deliberate deviation from `design/pr-brief/pr-overview-brief-generated.png`: the banner does not exist before generation, and does not exist at all on a PR with no finished review, so a control hosted there would vanish in exactly the two states that need it. |
| Empty review-focus list | The `REVIEW FOCUS` section is hidden entirely when `review_focus` is empty (AC-55). No `noFocus` message and no key for one. | Every `client/messages/en/*.json` ships in the RSC payload of every route whether used or not (`client/INSIGHTS.md:52-58`; 12 unused namespaces were 44% of that payload), so a key for a state the spec does not require is a cost paid on every page. Asymmetric with `noRisks` (AC-31) on purpose — zero risks is a *finding*, zero focus items is an absence. |
| e2e seeds, never generates | The flow seeds a `pr_brief` row and asserts the rendered brief; it never clicks Generate brief (AC-46, AC-47). | No flow in `e2e/flows/` triggers a model call — `09-conventions.flow.json:3` says so outright, and `10-onboarding-tour.flow.json:3` is read-only and asserts a degraded state instead of clicking Regenerate. `scripts/e2e.sh` binds no mock provider. The generation path is covered by server tests, not by the browser. |
| Spec input | The Intent Layer's existing spec links: `pr_intent.sources` rows with `kind: 'spec'`, extracted and read at `server/src/modules/reviews/intent.ts:141-156`. | No Project Context Folder dependency. A PR whose review never ran has no spec sources, which is a `missing_inputs` entry (AC-17), not an error. |
| Input budget | 8 000 tokens of model input, counted with `container.tokenizer.count()` (js-tiktoken `cl100k_base`, `server/src/adapters/tokenizer/index.ts:32`). Lowest-priority facts truncate first; what was dropped is recorded. | AC-4 and AC-5. The counted population is defined once in `## Non-functional` and nowhere else. |
| i18n | A new namespace file `client/messages/en/brief.json`, carrying at least `block.intent`, `block.blast`, `block.risks`, `noRisks`, `unavailable`, `unavailableHint`. | No wiring: the loader registers one namespace per filename (`client/src/i18n/request.ts:16-30`). The file needs a key for every state a criterion requires and **no key beyond them** — every `messages/en/*.json` ships in the RSC payload of every route whether it is used or not (`client/INSIGHTS.md:52-58`). |
| Deep link | `?tab=diff&file=<path>`, alongside the existing `?tab` and `?order` params (`page.tsx:60-70`, `DiffTab.tsx:36-42`). `DiffTab` reads `file`, forces that `FileCard` open and scrolls to it. | `DiffViewer`/`FileCard` take a single `defaultOpen` boolean today (`DiffViewer.tsx:19-41`, `FileCard.tsx:57-72`); a **per-path** open signal is new surface on both. |
| Model | Always `resolveFeatureModel(container, workspaceId, 'risk_brief')` (`server/src/modules/settings/feature-models.ts:51-57`). Never a literal model id. | The Settings UI's `risk_brief` selector stops being inert. |
| Grounding | A code-side filter over `files[].path` ∪ blast-map paths, run before persistence. It stands in for `groundFindings()`, which is a findings-shaped API and does not apply here. | AC-8, AC-9, AC-10. The model is never trusted to name a path. |

## User stories

- As a **reviewer opening an unfamiliar PR**, I want one paragraph saying what it does and why, so
  that I can start reviewing without reading the whole diff first.
- As a **reviewer with limited time**, I want a ranked "read these first" list with a reason per
  file, so that I spend my attention where it changes the outcome.
- As a **reviewer**, I want each named risk to carry the file it concerns, so that I can verify the
  claim instead of trusting it.
- As a **reviewer returning to a PR**, I want the brief to appear instantly on reload, so that
  re-reading costs no money and no waiting.
- As a **reviewer of a PR that has moved on**, I want to be told the brief is out of date and to
  decide myself whether to spend a regeneration.
- As a **maintainer running this locally**, I want the brief to be generated by the model I chose
  in Settings, so that cost and provider stay under my control.

## Acceptance criteria (EARS)

### Generation — `POST /pulls/:id/brief`

- **AC-1** — WHEN `POST /pulls/:id/brief` is called for an existing pull request, the brief service
  shall invoke `llm.completeStructured` exactly once and respond 200 with a body that
  `PrBrief.parse()` accepts. *Counted population:* calls on the `LlmPort` instance the handler
  resolved, between handler entry and handler return, observed by a fake adapter's counter. A
  failing run is a counter reading `0` or `≥ 2`.
- **AC-2** — The brief service shall obtain its model from
  `resolveFeatureModel(container, workspaceId, 'risk_brief')` and shall pass that value as
  `completeStructured({ model })`. A failing run is a `model` argument that differs from the value
  the stubbed resolver returned.
- **AC-3** — The assembled prompt shall contain no diff hunk body: no substring of any
  `files[].patch`, and no line beginning `@@`, `+` or `-` that originates from a patch. A failing
  run is a fixture patch's distinctive line found in the captured `messages`.
- **AC-4** — The sum of `container.tokenizer.count()` over every `messages[].content` string passed
  to that single `completeStructured` call shall be `≤ 8000`.
- **AC-5** — IF the assembled facts exceed 8 000 tokens, THEN the service shall drop whole fact
  blocks in the fixed priority order given in `## Non-functional` and shall append one
  `missing_inputs[]` entry naming each dropped block.
- **AC-6** — The brief service shall wrap the PR title, the PR body, the linked issue text and
  every spec file's content with `wrapUntrusted()` (`server/src/platform/prompt.ts`) before they
  enter the prompt. A failing run is any of those four strings present in `messages` outside a
  wrapper delimiter.
- **AC-7** — The brief service shall pass a Zod schema to `completeStructured` that requires
  `summary: string`, `risks[]` of `Risk` and `review_focus[]` of `{ file, line, reason }`, so that a
  response missing any of them is re-asked and then rejected by the port.
- **AC-50** — The assembled prompt shall instruct the model to return at most 5 risks and at most 6
  review-focus items. A failing run is a captured system message carrying neither limit.

### Grounding

- **AC-8** — WHEN the model response validates, the grounding filter shall remove every
  `review_focus` item whose `file` is in neither `files[].path` nor the blast map's path set.
- **AC-9** — WHEN the model response validates, the grounding filter shall remove from every risk's
  `file_refs` each path in neither set, and shall drop the risk entirely when that leaves
  `file_refs` empty.
- **AC-10** — The brief service shall run the grounding filter before writing the `pr_brief` row, so
  that no persisted envelope contains a path outside `files[].path` ∪ the blast map. A failing run
  is a stored `json` whose risk or review-focus path is absent from both sets.
- **AC-11** — The grounding filter shall compare paths after normalising a leading `./` and
  collapsing repeated `/`, and shall compare the remainder case-sensitively.
- **AC-52** — The grounding filter shall remove every `review_focus` item whose `line` is less than
  `1`, so that no persisted item can render as `path:0`.

### Persistence and failure

- **AC-12** — WHEN generation succeeds, the brief service shall write exactly one `pr_brief` row for
  that `pr_id` whose `json` carries `summary`, `risks`, `review_focus`, `head_sha`, `generated_at`,
  `model` and `missing_inputs`, with `head_sha` equal to the pull request's current head SHA.
- **AC-13** — WHEN a `pr_brief` row already exists for the pull request, the brief service shall
  overwrite it, leaving exactly one row for that `pr_id`.
- **AC-14** — IF the model call fails or exceeds `BRIEF_TIMEOUT_MS` (60 000 ms), THEN the brief
  service shall throw `AppError` with `statusCode: 502`, `POST /pulls/:id/brief` shall respond 502,
  and any stored `pr_brief` row shall be left byte-identical to what it was before. A failing run is
  a 500 / `internal_error` response — which is what a bare `Error` produces
  (`server/src/app.ts:187-196`), and therefore what an un-wrapped provider failure looks like.
- **AC-15** — WHEN a generation completes, the brief service shall emit one structured log record
  carrying `model`, the counted input tokens, `dropped_risks` and `dropped_focus`, so that the
  single-call and budget claims are observable outside the tests.

### Missing inputs

- **AC-16** — IF no `pr_intent` row exists for the pull request, THEN the brief service shall still
  generate and shall include an `intent` entry in `missing_inputs[]`.
- **AC-17** — IF `GET /pulls/:id/blast` reports `degraded: true`, THEN the brief service shall still
  generate, shall send the blast `summary` string it did receive, and shall include a `blast` entry
  in `missing_inputs[]` carrying the degraded `reason`.
- **AC-18** — IF the pull request has no linked issue and no `pr_intent.sources` row with
  `kind: 'spec'` and status `used`, THEN the brief service shall include `issue` and `specs` entries
  in `missing_inputs[]` respectively.
- **AC-19** — IF `files[]` is empty and the blast map is empty, THEN the brief service shall persist
  an envelope with a non-empty `summary`, `risks: []` and `review_focus: []` — every model-named
  path being ungrounded by AC-8 and AC-9.

### Read — `GET /pulls/:id/brief`

- **AC-20** — `GET /pulls/:id/brief` shall invoke no LLM adapter method, in every state. A failing
  run is a non-zero fake-adapter counter after any `GET`.
- **AC-21** — IF no `pr_brief` row exists for the pull request, THEN `GET /pulls/:id/brief` shall
  respond 200 with `brief: null`.
- **AC-22** — WHILE the stored `head_sha` differs from the pull request's current head SHA,
  `GET /pulls/:id/brief` shall respond 200 with the stored brief and `stale: true`.
- **AC-23** — WHILE the stored `head_sha` equals the pull request's current head SHA,
  `GET /pulls/:id/brief` shall respond 200 with the stored brief and `stale: false`.

### Contract

- **AC-24** — `PrBrief` in `server/src/vendor/shared/contracts/brief.ts` shall carry
  `summary: string` and `review_focus: { file: string; line: number; reason: string }[]`.
- **AC-25** — `client/src/vendor/shared/contracts/brief.ts` shall be byte-identical to
  `server/src/vendor/shared/contracts/brief.ts`.

### Client — the block

- **AC-26** — WHILE `GET /pulls/:id/brief` reports `brief: null`, the Overview tab shall render the
  PR Brief block with a Generate brief control and no risk or review-focus list.
- **AC-27** — WHEN the Generate brief control is activated, the Overview tab shall issue exactly one
  `POST /pulls/:id/brief` and shall disable the control until that request settles. A failing run is
  a second `POST` after a second click while the first is in flight.
- **AC-28** — WHEN a brief is present, the PR Brief block shall render `summary` as visible text.
- **AC-29** — WHEN a brief is present, the PR Brief block shall render one row per risk, each
  carrying `title` and at least one entry of `file_refs`.
- **AC-30** — WHEN a brief is present, the PR Brief block shall render one row per review-focus
  item, each carrying `file`, `line` and `reason`, in the order the envelope stores them.
- **AC-49** — WHILE the pull request has no finished review, the Overview tab shall render the
  brief's `summary` as a paragraph inside the PR Brief block and shall render no `VerdictBanner`. A
  failing run is a `VerdictBanner` in the tree, or a `summary` that is absent because the banner was
  its only host.
- **AC-51** — The PR Brief block shall render every risk and every review-focus item the envelope
  carries, applying no cap of its own. A failing run is an envelope of 8 risks rendering fewer than
  8 rows.
- **AC-31** — IF `risks` is empty, THEN the PR Brief block shall render the `noRisks` message
  instead of an empty list.
- **AC-55** — IF `review_focus` is empty, THEN the PR Brief block shall render no `REVIEW FOCUS`
  heading, count badge or list container.
- **AC-53** — The refresh control shall be rendered in the PR Brief block's `SectionLabel` right
  slot, so that it is present in the generated, stale and no-review states alike. A failing run is a
  refresh control found inside `VerdictBanner`, or absent from a brief rendered without a banner.
- **AC-54** — WHILE a `POST /pulls/:id/brief` is in flight, the PR Brief block shall render its busy
  label on the disabled control and a `Skeleton` in place of the risk and review-focus lists
  (`Skeleton` as used at `DiffTab.tsx:188-190`).
- **AC-32** — IF `missing_inputs[]` is non-empty, THEN the PR Brief block shall render the
  `unavailable` message naming each missing input.
- **AC-33** — WHEN a brief is present, the Overview tab shall continue to render `PrIntentCard` and
  `BlastRadiusCard` alongside the PR Brief block.
- **AC-34** — WHEN the PR detail page mounts with a cached brief, the client shall issue
  `GET /pulls/:id/brief` and no `POST`. A failing run is a `POST` observed on mount.
- **AC-35** — WHEN the refresh control is activated, the client shall issue one
  `POST /pulls/:id/brief` and shall replace the rendered brief with the response.
- **AC-36** — WHILE `GET /pulls/:id/brief` reports `stale: true`, the PR Brief block shall render an
  out-of-date hint adjacent to the refresh control.
- **AC-37** — Each risk row shall spell its severity band as one of the words behind
  `severity.high` / `severity.medium` / `severity.low` in text, so that the band is never carried by
  colour alone.
- **AC-38** — WHERE the expandable-risk extra is enabled, each risk row shall render collapsed and
  shall reveal `explanation` when its disclosure control is activated, with `aria-expanded`
  reflecting the state.
- **AC-39** — WHERE the Overview `VerdictBanner` extra is enabled and the pull request has at least
  one finished review, the Overview tab shall render `VerdictBanner` with the brief's `summary` in
  its `summary` prop.
- **AC-40** — The PR Brief block shall render no literal user-facing string: every string shall come
  from `useTranslations("brief")` against `client/messages/en/brief.json`.
- **AC-41** — The PR Brief block's modules shall contain no value import from `@devdigest/shared`,
  so that `pnpm build` succeeds; the severity union shall be mirrored locally as an `as const`
  literal, as `BlastRadiusCard/helpers.ts:5-12` does.

### Client — the deep link

- **AC-42** — WHEN a review-focus row is activated, the client shall set the URL query to
  `tab=diff` and `file=<the item's file, percent-encoded>` without a full page load.
- **AC-43** — WHEN `DiffTab` mounts with a `file` query value matching a path in `files[]`, it shall
  render that file's `FileCard` expanded and shall call `scrollIntoView` on it.
- **AC-44** — IF the `file` query value matches no path in `files[]`, THEN `DiffTab` shall render
  the diff unchanged and shall raise no error.
- **AC-45** — WHEN `DiffTab` mounts with a `file` query value whose path sits in a role group that
  is collapsed by default (`COLLAPSED_ROLES`, `DiffTab/constants.ts`), it shall expand that group
  before expanding the file.

### e2e

- **AC-46** — WHEN the e2e flow opens the Overview tab of the seeded `acme/payments-api` pull
  request, for which the seed has written a `pr_brief` row, it shall find the rendered summary, the
  risk list and the review-focus list without activating the Generate brief control. A failing run
  is a flow step that clicks Generate, or a browser run that issues a model call.
- **AC-47** — WHEN that seeded envelope carries a `blast` entry in `missing_inputs[]` — the state
  the seeded repo really produces, because `clone_path` is `null` and no index exists
  (`e2e/flows/11-pr-blast-radius.flow.json:2-3`) — the flow shall find the `unavailable` text naming
  the missing blast input.
- **AC-48** — WHEN the e2e flow activates the first review-focus row, the browser shall land on the
  Files changed tab with that file's card expanded.

## Edge cases

- **Zero / one / many risks.** Zero renders the `noRisks` message (AC-31). Many is bounded by a
  prompt instruction (AC-50), never by a client slice (AC-51), so a model that ignores the
  instruction produces a visibly long block rather than a silently truncated one.
- **Zero review-focus items.** The whole section disappears (AC-55) — the one list whose empty state
  is an absence rather than a message.
- **A review-focus `line` of `0` or a negative number.** The contract types `line` as an integer and
  nothing forbids `0`. Navigation is file-level (Non-goal), so an out-of-range line would be display
  text only — but `src/config.ts:0` is a visible lie, so AC-52 drops the item at grounding time
  rather than rendering it.
- **A path the model invents.** AC-8, AC-9, AC-10. The failure mode this feature exists to prevent.
- **A path that differs only by `./` or a doubled slash.** AC-11 — otherwise a correct citation is
  dropped as ungrounded and the reviewer silently loses a true risk.
- **A path differing by case.** AC-11 keeps the comparison case-sensitive, which is what the index
  and GitHub both use; the accepted cost is that `SRC/config.ts` is dropped rather than repaired.
- **Every input absent at once.** Intent missing, blast degraded, no issue, no specs: AC-16, AC-17,
  AC-18 all fire together, and the brief still generates.
- **An empty diff.** AC-19 — grounding empties both lists, and the summary stands alone.
- **A stale read.** The head SHA may change between `GET` (which reported `stale: false`) and the
  user's later `POST`; `POST` always stamps the head it saw, last write wins (AC-12, AC-13).
- **Two writers at once.** Two concurrent `POST`s make two model calls and two writes; the later
  write wins. The client prevents the common case by disabling the control (AC-27). There is no
  lock, deliberately — no queue is in scope.
- **Navigating away mid-generation.** The `POST` completes server-side and the row is written; the
  discarded response costs the reader nothing, and the next `GET` shows it.
- **A failed generation over a good brief.** AC-14 — the previous brief keeps rendering untouched,
  and the 502 is distinguishable from a crash (which would be a 500).
- **A risk that loses half its evidence.** AC-9 strips an invented `file_ref` and keeps the risk;
  nothing on screen says a reference was removed. Accepted (Decisions), and AC-15's `dropped_*`
  counts are where it is observable at all.
- **Long text.** A summary of several hundred characters, a 140-character path, or a `reason`
  longer than its row: the mockup shows none of these wrapping (Design gaps).
- **Emoji / RTL text in the PR title or a risk title.** Carried as data through `wrapUntrusted()`
  (AC-6); rendering is the browser's.
- **A degraded reason this repo cannot produce.** Of the five `DegradedReason` values, only
  `no_data` and `index_failed` are produced by any code path, so AC-17 asserts on the reason string
  the service received, never on `index_partial` or `repo_too_large`.
- **Checked and ruled out:** pagination and sort boundaries (neither list paginates); permission
  denied (single local workspace, no per-user authorisation anywhere in `server/src/modules`); a
  deleted parent with a live child (`pr_brief.pr_id` cascades on delete, `reviews.ts:145-150`);
  offline mode (no offline story exists in this client); clock skew (`generated_at` is stored but
  the mockup displays no timestamp — see Design gaps).

## Non-functional

- **Model calls.** Exactly one per generation (AC-1), zero per read (AC-20). *Counted population:*
  invocations of `llm.completeStructured` on the adapter instance the request resolved, from
  handler entry to handler return, measured by a fake adapter in a unit test and reported in the log
  record of AC-15. No other definition of "a call" is used anywhere in this spec.
- **Input budget.** ≤ 8 000 tokens (AC-4). *Counted population:* the concatenation of every
  `messages[].content` string in that one call, counted with `container.tokenizer.count()` —
  js-tiktoken `cl100k_base` (`server/src/adapters/tokenizer/index.ts:32`) — immediately before the
  call is issued. Not the provider's own `tokens_in`, which is counted with a different encoding
  and arrives only afterwards. A failing run is a unit test, on a fixture whose facts exceed the
  budget, reading a count `> 8000`.
- **Truncation priority.** Facts are dropped whole-block, lowest first:
  `specs` → `smart-diff groups` → `blast caller list` (the blast `summary` string is never dropped)
  → `issue` → `PR body` → `diff statistics`. `intent` and the PR title are never dropped. Each drop
  appends a `missing_inputs[]` entry (AC-5).
- **Timeout.** `completeStructured` is called with `timeoutMs: BRIEF_TIMEOUT_MS` = 60 000 ms, and a
  breach surfaces as `AppError` / 502 (AC-14). Nothing else bounds a synchronous `POST`.
- **a11y.** Severity is spelled in text (AC-37); colour is decoration only. Review-focus rows are
  keyboard-activatable controls, and the risk disclosure carries `aria-expanded` (AC-38).
- **Security.** Four untrusted strings reach the prompt and all four are wrapped (AC-6). The
  grounding filter (AC-8, AC-9, AC-10) is the only thing standing between a model-written path and
  what the reviewer is told is in their PR.
- **What this spec's controls cannot do.** The grounding filter checks the `file` and `file_refs`
  *fields*; it does not scan `summary`, `title`, `explanation` or `reason` prose, so a model may
  still name a non-existent path inside a sentence and nothing will catch it. The budget is checked
  on the input only — nothing caps the response size beyond the provider's own limits. `wrapUntrusted()`
  is a delimiting convention, not a parser: it reduces instruction-following on untrusted text, it
  does not prevent it. And nothing in this feature verifies that a `reason` is *true* of the file it
  names; grounding proves the path exists in this PR, nothing more.
- **Enforcement honesty.** Of the 55 criteria, 52 are mechanically checkable by a test or a build
  (unit, component, integration or e2e). Three are not fully checkable by a running test and are
  checked by reading the diff as well: AC-3's "no patch substring" is asserted against a fixture, so it proves the
  fixture's patch is absent, not that no patch can ever reach the prompt; AC-11's normalisation is
  asserted on the cases listed and not on the space of all paths; AC-41's "no value import" holds
  only for the modules the test enumerates plus whatever `pnpm build` happens to exercise.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| PR intent (`intent`, `in_scope`, `out_of_scope`) | `getIntent(prId)`, `server/src/modules/reviews/repository/pull.repo.ts:113`; route `GET /pulls/:id/intent` | `[reused: spec 0008]` `[llm]` upstream | Absent until a review has run → AC-16. |
| Blast radius `summary` string | `server/src/modules/blast/helpers.ts:31-38` | `[reused: spec 0012]` `[deterministic: built from counts, no model call]` | Sent verbatim; never dropped by the budget. |
| Blast caller file list | `BlastRadius.downstream[].callers[].file` | `[reused: spec 0012]` `[deterministic: ast-grep index]` | Half of the grounding path set (AC-8, AC-9). Consumed as a **set of file paths only**: blast data is keyed on `(file, symbol)` and never on a bare symbol name — `renderWithIntl` is declared in 8 files in this repo (`server/INSIGHTS.md:392-399`), so no criterion here groups or keys by symbol. |
| Diff statistics `files[]{path, additions, deletions}` | `GET /pulls/:id`, `contracts/platform.ts:224-254` | `[deterministic: GitHub API]` | The other half of the grounding path set. Paths and counts only — never `patch` (AC-3). |
| Smart Diff role groups | `SmartDiffService.forPull(workspaceId: string, prId: string): Promise<SmartDiff>` — `server/src/modules/smart-diff/service.ts:17-20` | `[reused: spec 0010]` `[deterministic: path patterns]` | Lets the model rank reading order by role. A service call, not an HTTP hop. |
| PR title and description | `pull_requests` row, written by the GitHub adapter | `[reused: L01]` **untrusted** | Wrapped (AC-6). |
| Linked issue text | gathered in `server/src/modules/reviews/intent.ts:120` | `[reused: spec 0008]` **untrusted** | Absent → AC-18. |
| Spec file contents | `pr_intent.sources` rows, `kind: 'spec'`, status `used` — `intent.ts:141-156` | `[reused: spec 0008]` **untrusted** | Lowest truncation priority. No Project Context Folder is involved. |
| Model id and provider | `resolveFeatureModel(container, workspaceId, 'risk_brief')`, `settings/feature-models.ts:51-57` | `[reused: FEATURE_MODELS registry, contracts/platform.ts:14-20,62-67]` | AC-2. |
| Token counter | `container.tokenizer.count()`, `adapters/tokenizer/index.ts:32` | `[reused: platform adapter]` `[deterministic: js-tiktoken cl100k_base]` | AC-4. |
| `pr_brief` table | `server/src/db/schema/reviews.ts:145-150`, migration `0000_init.sql:211` | `[reused: existing schema]` | No migration (Non-goal). |
| `VerdictBanner` | `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/` | `[reused: existing component]` | `verdict` is required and typed `request_changes\|approve\|comment`, so it is rendered only where a finished review supplies one — AC-39, AC-49. |
| `summary`, `risks[]`, `review_focus[]` | the one `completeStructured` call | `[llm]` | Not reproducible, not a source of truth; grounded before persistence. |
| The grounding filter, the envelope, both routes, the block, `brief.json`, the `file` deep link | this feature | `[new]` | — |

## Untrusted inputs

Four strings a stranger wrote reach the prompt, and one more reaches the grounding sets:

- **PR title** and **PR body** — written by the PR author.
- **Linked issue title and body** — written by whoever opened the issue.
- **Spec file contents** — read from the clone or from the diff's post-image
  (`intent.ts:141-156`), so a PR can add a spec file whose contents it controls entirely.
- **File paths** (`files[].path`, blast caller files) — attacker-chosen names, which this feature
  both sends and compares against.

All of them are **data, never instruction**. `reviewer-core/AGENTS.md` requires untrusted content to
be wrapped with `wrapUntrusted()` (`server/src/platform/prompt.ts`) — AC-6 makes that a criterion
rather than a convention, because this is the one place a missing requirement is a security bug.

`groundFindings()` does not apply here: it is shaped for findings with line anchors inside a diff,
and this feature's output has no diff anchors. The equivalent obligation is the grounding filter of
AC-8, AC-9 and AC-10 — every model-named path checked against `files[].path` ∪ the blast map, before
persistence, with no "best effort" branch. A brief is allowed to be empty; it is not allowed to be
ungrounded.

Two residual exposures are stated rather than closed: model prose (`summary`, `reason`,
`explanation`) is not path-scanned (`## Non-functional`), and the clone read that produced the spec
contents happened in the Intent Layer, under its own caps (`INTENT_MAX_SPEC_CHARS`), not under this
feature's.

## Test plan

| Criteria | Test |
|---|---|
| AC-1 | `server/test/brief.service.test.ts` — fake LLM adapter counts invocations; asserts exactly 1 on success, and asserts a second generation also counts 1 (not cumulative). |
| AC-2 | Same file — stubbed `resolveFeatureModel` returns a sentinel model id; asserts `completeStructured` received it, and a second case asserts no literal fallback when the resolver throws. |
| AC-3 | Same file — fixture `files[]` carrying a distinctive patch line; asserts the line is absent from every captured message, and a positive control asserts the fixture's *path* is present. |
| AC-4 | Same file — oversized fixture; asserts `tokenizer.count()` over the captured messages is `≤ 8000`, and a small fixture asserts the budget does not truncate when it need not. |
| AC-5 | Same file — oversized fixture asserts the specs block is absent and `missing_inputs` contains `specs`; the small fixture asserts `missing_inputs` is empty. |
| AC-6 | `server/test/brief.prompt.test.ts` — asserts each of the four untrusted strings appears only inside `wrapUntrusted()` delimiters; a control asserts a trusted string (the blast summary) is not wrapped. |
| AC-7 | Same file — asserts the schema passed to `completeStructured` rejects a response missing `summary` and one missing `review_focus`, and accepts a complete one. |
| AC-50 | Same file — asserts the captured system message states both limits; a control asserts a response of 7 risks is still accepted by the schema, because the cap is an instruction and not a validation rule. |
| AC-8 | `server/test/brief.grounding.test.ts` — model response with one in-PR focus file and one invented one; asserts only the invented one is removed. |
| AC-9 | Same file — a risk with both file refs invented (dropped), a risk with one invented (ref stripped, risk kept), a risk fully grounded (untouched). |
| AC-10 | `server/test/brief.repo.it.test.ts` — asserts the persisted `json` contains no path outside `files[].path` ∪ blast paths; a control asserts the grounded paths survived. |
| AC-11 | `server/test/brief.grounding.test.ts` — `./src/a.ts`, `src//a.ts` accepted against `src/a.ts`; `SRC/a.ts` rejected. |
| AC-52 | Same file — review-focus items with `line` of `0` and `-3` are removed; a control asserts `line: 1` survives. |
| AC-12 | `server/test/brief.repo.it.test.ts` — asserts one row, all seven envelope fields present, `head_sha` equal to the pull's head. |
| AC-13 | Same file — generate twice; asserts a single row and the second envelope's `generated_at`. |
| AC-14 | `server/test/brief.routes.it.test.ts` — LLM adapter throws, and a second case times out; both assert `statusCode === 502` (not merely `>= 500`, so a bare `Error` falling through to 500 fails the test) and a byte-identical stored `json`. A control asserts the success path does write. |
| AC-15 | `server/test/brief.service.test.ts` — logger spy; asserts one record with `model`, input tokens, `dropped_risks`, `dropped_focus`. |
| AC-16 | Same file — no `pr_intent` row; asserts generation succeeds and `missing_inputs` contains `intent`; a control with an intent row asserts it does not. |
| AC-17 | Same file — blast stub returns `degraded: true, reason: 'no_data'`; asserts the blast `summary` still reached the prompt and `missing_inputs` carries `blast` with that reason. |
| AC-18 | Same file — no issue and no `spec` source rows; asserts both entries; a control with both present asserts neither. |
| AC-19 | Same file — empty `files[]` and empty blast map; asserts a non-empty `summary` with `risks: []` and `review_focus: []`. |
| AC-20 | `server/test/brief.routes.it.test.ts` — fake LLM counter asserted at 0 after `GET` in the cached, empty and stale states. |
| AC-21 | Same file — `GET` with no row asserts 200 and `brief: null`. |
| AC-22 | Same file — stored `head_sha` mutated; asserts 200, the stored brief and `stale: true`. |
| AC-23 | Same file — matching head; asserts `stale: false`. |
| AC-24 | `server/test/contracts.test.ts` — `PrBrief.parse()` on a fixture carrying `summary` and `review_focus`; a negative case asserts a fixture missing them fails. |
| AC-25 | `server/test/contracts.test.ts` — byte comparison of the two `brief.ts` files (the check `scripts/` already applies to vendored copies, or a new `readFileSync` equality assertion). |
| AC-26 | `client/…/_components/PrBriefBlock/PrBriefBlock.test.tsx` — `brief: null` renders the Generate control and no lists. |
| AC-27 | Same file — two clicks while the first `POST` is pending; asserts one `fetch` to the brief route and a disabled control. |
| AC-28 | Same file — asserts the `summary` text is in the document. |
| AC-29 | Same file — two risks; asserts each title and at least one file ref is rendered. |
| AC-30 | Same file — asserts `file`, `line` and `reason` per row and the rendered order equals the envelope order. |
| AC-31 | Same file — `risks: []` renders the `noRisks` message; a control with one risk asserts the message is absent. |
| AC-49 | Same file — a brief with no finished review asserts the `summary` paragraph is present and no `VerdictBanner` is in the tree; the control is AC-39's reviewed case. |
| AC-51 | Same file — an envelope of 8 risks and 9 review-focus items asserts 8 and 9 rendered rows, so no client-side cap can creep in. |
| AC-53 | Same file — asserts the refresh control is inside the block's `SectionLabel` right slot in the no-review state, where no banner exists; a control asserts it is still there in the reviewed state and not duplicated inside the banner. |
| AC-54 | Same file — with a pending `POST`, asserts the busy label, the disabled control and the `Skeleton`; after it resolves, asserts the lists replaced the skeleton. |
| AC-55 | Same file — `review_focus: []` asserts no `REVIEW FOCUS` heading, badge or list; a control with one item asserts all three. |
| AC-32 | Same file — `missing_inputs: ['intent','blast']` renders the `unavailable` message naming both; empty `missing_inputs` renders none. |
| AC-33 | `client/…/OverviewTab/OverviewTab.test.tsx` — asserts `PrIntentCard` and `BlastRadiusCard` still render with a brief present. |
| AC-34 | `client/…/PrBriefBlock/PrBriefBlock.test.tsx` — on mount, asserts a `GET` and zero `POST`s. |
| AC-35 | Same file — refresh click asserts one `POST` and the re-rendered new summary. |
| AC-36 | Same file — `stale: true` renders the hint beside refresh; `stale: false` renders no hint. |
| AC-37 | Same file — asserts the severity word is present as text for each of `high`, `medium`, `low`. |
| AC-38 | Same file — collapsed on first render, `explanation` absent; after activation, present with `aria-expanded="true"`. |
| AC-39 | `client/…/OverviewTab/OverviewTab.test.tsx` — with a finished review, asserts `VerdictBanner` renders the brief `summary` in its `summary` prop; the no-review counterpart is AC-49. |
| AC-40 | `client/…/PrBriefBlock/PrBriefBlock.test.tsx` — render under a message provider missing the `brief` namespace; asserts no English literal survives (the next-intl fallback marks it). |
| AC-41 | `client/pnpm build` in CI, plus a lint assertion that the block's modules import from `@devdigest/shared` only under `import type`. |
| AC-42 | `client/…/PrBriefBlock/PrBriefBlock.test.tsx` — asserts the router push target equals `?tab=diff&file=src%2Fapi%2Fusers.ts` for a path with slashes. |
| AC-43 | `client/…/DiffTab/DiffTab.test.tsx` — `file` matching a path asserts that card expanded and `scrollIntoView` called once. |
| AC-44 | Same file — `file=does/not/exist.ts` asserts the diff renders and no error is thrown. |
| AC-45 | Same file — `file` inside a `COLLAPSED_ROLES` group asserts the group expanded and the card expanded. |
| AC-46 | `e2e/flows/13-pr-brief.flow.json` over a seed that writes a `pr_brief` row for the seeded `acme/payments-api` pull request — asserts the summary, the risk list and the review-focus list render with no Generate click anywhere in the flow. The flow's header states "nothing triggers a model call", as `09-conventions.flow.json:3` does. It declares no `"mutates"` key, and because `e2e/run.ts:64-66` sorts flows by filename it runs after the gated mutating flow `12-pr-finding-actions`; it therefore asserts only seeded brief content and navigation, never finding counts, which that flow changes. |
| AC-47 | Same flow — asserts the `unavailable` text naming the missing blast input, the seeded envelope carrying `blast` in `missing_inputs[]`. |
| AC-48 | Same flow — activates the first review-focus row and asserts the Files changed tab with that file's card expanded. |

Untested by construction, and recorded as such rather than reported as passing: AC-3, AC-11 and
AC-41 hold only over the cases their tests enumerate (`## Non-functional`, Enforcement honesty).

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-10-02 | Assignment and five mockups read; mockups copied into `design/pr-brief/` so a subagent can read them (root `INSIGHTS.md` 2026-10-02 records why a path outside the repo fails silently). Three parallel repo surveys established that `pr_brief`, the `PrBrief` contract and the `risk_brief` model slot already exist and are entirely unused, that no Project Context Folder exists, and that no deep-link into Files changed exists. `scripts/insights-for.sh` routed 75 of 192 entries. |
| Planning | 2026-10-02 | `spec-creator` drafted 48 criteria, then amended to 55 after the user settled four clarifications and four facts were resolved from the code (byte-identical contract copies, `SmartDiffService.forPull`, `AppError`/502 mapping, and the finding that no e2e flow ever calls a model). `check-specs.sh` green. Approved by the user. |
| Implementation | | |
| Validation | | typecheck · lint · tests · e2e · manual |
| Completion | | status done, docs, insights wrap-up |
