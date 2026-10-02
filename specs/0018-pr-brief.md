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
  radius; it is not built, and nothing on screen comes from it. The one place `history` appears is
  the stored envelope, where it is **always** `{ history: [] }` (AC-58) — `PrBrief.history` is a
  required contract field (`contracts/brief.ts:140-146`) and the empty array exists only to satisfy
  it. That is neither scope creep nor an unimplemented field: no code ever populates it, and no
  criterion reads it.
- **A job queue.** Generation is a synchronous `POST`. No polling, no `job_id`, no `JobRunner` —
  unlike spec 0017's onboarding generator, which this feature deliberately does not copy.
- **A Project Context Folder.** Spec 0016 is still `draft` with no module, table or route. The
  brief's spec input is the Intent Layer's existing `pr_intent.sources` rows only.
- **A migration.** `pr_brief` already exists; `server/src/db/migrations/**` is do-not-touch and is
  not touched.
- **Rendering the envelope's snapshot.** The stored envelope *does* carry `intent` and `blast` (the
  contract requires them), but nothing displays them: the Overview cards keep reading their own live
  endpoints (AC-59, AC-60). The snapshot exists for provenance and replay only.
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
| Cached envelope (**reversed 2026-10-02**) | `pr_brief.json` stores the **full `PrBrief` shape** — `intent`, `blast`, `risks` (the existing `Risks` *wrapper object*, not a bare `Risk[]`) and `history` — **plus** `summary`, `review_focus[]`, `head_sha`, `generated_at`, `model` and `missing_inputs[]`. | The earlier decision ("snapshot none of them") would have made `PrBrief.parse()` reject this feature's own envelope: all four fields are required at `contracts/brief.ts:140-146`. The user chose to keep `PrBrief` as it is rather than relax it, so the envelope grew instead (AC-12, AC-57). `history` is always empty (AC-58). The six added fields are *not* part of `PrBrief`; Zod strips unknown keys rather than rejecting them, so `PrBrief.parse(json)` still succeeds — nothing may make that schema `.strict()`. The wrapper type for the six, and the `{ brief, stale }` GET response, are declared in `contracts/review-api.ts` (both copies) as `PrBriefEnvelope` and `PrBriefResponse`, following the precedent already set there by `PrIntentRecord`/`PrIntentResponse` (`:131-149`) and `SmartDiffResponse` (`:152`) — that file is where this repo keeps API response DTOs built over a `brief.ts` primitive. This leaves AC-24/AC-25 intact: `PrBrief` itself gains `summary` and `review_focus` and nothing else. |
| What the snapshot is for | Provenance and replay. It is **not rendered anywhere**: `PrIntentCard` and `BlastRadiusCard` keep reading `GET /pulls/:id/intent` and `GET /pulls/:id/blast` live, exactly as they do today (AC-59, AC-60). | Without this stated, "Intent and Blast radius sit alongside" is ambiguous between live and snapshotted. **Accepted cost:** the envelope stores data that nothing reads, and on a stale brief the snapshot can differ from the live cards rendered beside it — the cards win on screen, and the difference is invisible. |
| `missing_inputs[]` element type | `{ input: string; reason?: string }`, not a bare string. The client renders `input` and appends `reason` when present (AC-32). | AC-17 requires the `blast` entry to carry its degraded reason, which a plain string cannot hold. AC-5, AC-16, AC-17 and AC-18 all read in terms of `input`. |
| Cross-module access | The brief module shall not import another module's `service.ts` or `repository/**`. It reads through container ports (`container.reviewRepo`, `container.repoIntel`) and composes facts with the siblings' **pure helpers** `buildBlastRadius` (`server/src/modules/blast/helpers.ts:68`) and `buildSmartDiff` (`server/src/modules/smart-diff/helpers.ts:39`). | `no-cross-module-internals` (`server/.dependency-cruiser.cjs:88-97`, severity `error`) matches `^src/modules/[^/]+/(service\|repository)` and **not** `helpers`, and `tsPreCompilationDeps: true` (`:149`) makes even a type-only import count. So the earlier provenance row endorsing a direct `SmartDiffService.forPull` call was unachievable: `pnpm arch` (folded into `pnpm lint`) would have failed the build. Both helper signatures were checked against this constraint on 2026-10-02 and neither needs a value only a sibling service can produce: `buildBlastRadius(result: BlastResult)` (`blast/helpers.ts:68`) takes what `container.repoIntel.getBlastRadius()` returns, and `buildSmartDiff(files, findings)` (`smart-diff/helpers.ts:39`) takes what `container.reviewRepo`'s file and finding reads return. AC-56. |
| Contract | `PrBrief` in `server/src/vendor/shared/contracts/brief.ts` gains `summary: string` and `review_focus: { file, line, reason }[]`, mirrored byte-identically into `client/src/vendor/shared/contracts/brief.ts`. The two files were diffed on 2026-10-02 and are byte-identical today, so AC-25 preserves a verified premise rather than asserting a hoped-for one. | A cross-package change: server typecheck + tests, `reviewer-core` typecheck, client typecheck (shared `AGENTS.md`). |
| A risk with one good and one invented `file_ref` | Strip the invented ref; keep the risk (AC-9). | A true claim about a real file is not discarded because of one bad citation. The accepted cost: a risk can ship having lost half its evidence, with nothing on screen saying so. |
| Overview with no finished review | No `VerdictBanner`. `summary` renders as a plain paragraph inside the block (AC-49); the banner appears only once a finished review exists (AC-39). | `VerdictBanner.verdict` is required and typed `request_changes\|approve\|comment` with `VERDICT_META[verdict] ?? VERDICT_META.comment` as its only fallback, so rendering it unreviewed would put a neutral "Comment" verdict chip on a PR nobody reviewed — a verdict the product never made. |
| Timeout and failure code | `BRIEF_TIMEOUT_MS = 60_000`, passed as `completeStructured({ timeoutMs })`. A provider failure or timeout throws `AppError` with `statusCode: 502`. | `server/src/app.ts:187-196` re-throws `AppError` with its own status, while a bare `Error` falls through to 500 / `internal_error` — so the 502 must be deliberate (AC-14), not incidental. |
| List caps | The prompt instructs at most 5 risks and at most 6 review-focus items (AC-50). The client renders everything that survives grounding (AC-51) — it never truncates. A review-focus item with `line < 1` is dropped during grounding (AC-52). | The cap is a prompt instruction, not a slice, so an over-long response is visible rather than silently cut. `src/config.ts:0` cannot ship. |
| Refresh control placement | The refresh control and the stale hint live in the block's `SectionLabel` right slot (AC-53, AC-36), **not** inside the verdict banner where the mockup draws the refresh glyph. | A deliberate deviation from `design/pr-brief/pr-overview-brief-generated.png`: the banner does not exist before generation, and does not exist at all on a PR with no finished review, so a control hosted there would vanish in exactly the two states that need it. |
| Empty review-focus list | The `REVIEW FOCUS` section is hidden entirely when `review_focus` is empty (AC-55). No `noFocus` message and no key for one. | Every `client/messages/en/*.json` ships in the RSC payload of every route whether used or not (`client/INSIGHTS.md:52-58`; 12 unused namespaces were 44% of that payload), so a key for a state the spec does not require is a cost paid on every page. Asymmetric with `noRisks` (AC-31) on purpose — zero risks is a *finding*, zero focus items is an absence. |
| e2e seeds, never generates | The flow seeds a `pr_brief` row and asserts the rendered brief; it never clicks Generate brief (AC-46, AC-47). | No flow in `e2e/flows/` triggers a model call — `09-conventions.flow.json:3` says so outright, and `10-onboarding-tour.flow.json:3` is read-only and asserts a degraded state instead of clicking Regenerate. `scripts/e2e.sh` binds no mock provider. The generation path is covered by server tests, not by the browser. |
| Spec input | The Intent Layer's existing spec links: the `ref` of each `pr_intent.sources` row with `kind: 'spec'` and status `used`, extracted at `server/src/modules/reviews/intent.ts:141-156`. **Paths only** — the Intent Layer reads a spec's contents to classify intent but persists only the path, `chars` and `truncated` (`reviews.ts:88-94`). | No Project Context Folder dependency, and no clone read added here. A PR whose review never ran has no spec sources, which is a `missing_inputs` entry (AC-18), not an error. |
| Input budget | 8 000 tokens of model input, counted with `container.tokenizer.count()` (js-tiktoken `cl100k_base`, `server/src/adapters/tokenizer/index.ts:32`). Lowest-priority facts truncate first; what was dropped is recorded. | AC-4 and AC-5. The counted population is defined once in `## Non-functional` and nowhere else. |
| i18n | A new namespace file `client/messages/en/brief.json`, carrying at least `block.intent`, `block.blast`, `block.risks`, `noRisks`, `unavailable`, `unavailableHint`. `block.intent` and `block.blast` are the **human-readable labels for `missing_inputs[].input`** (AC-32) — they name an input the brief did without, and are not headings for the live Intent and Blast cards, which carry their own copy in `prReview.json` and are untouched by this feature (AC-59, AC-60). | No wiring: the loader registers one namespace per filename (`client/src/i18n/request.ts:16-30`). The file needs a key for every state a criterion requires and **no key beyond them** — every `messages/en/*.json` ships in the RSC payload of every route whether it is used or not (`client/INSIGHTS.md:52-58`). |
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
  `missing_inputs[]` entry whose `input` names each dropped block.
- **AC-6** — The brief service shall wrap the PR title, the PR body, each spec file **path** and the
  linked issue **reference** with `wrapUntrusted()` (`server/src/platform/prompt.ts`) before they
  enter the prompt. A failing run is any of those four strings present in `messages` outside a
  wrapper delimiter. Paths and references, not documents: `IntentSourceRow` is
  `{kind, ref, chars, truncated, status}` with **no text field**
  (`server/src/db/schema/reviews.ts:88-94`), so `pr_intent.sources` persists spec paths and never
  spec contents; and the linked issue is a bare `#123` match on the PR body, by spec 0008's decision
  D4, with no second GitHub call (`server/src/modules/reviews/intent.ts:115-120`). This feature adds
  neither a clone read nor a GitHub call to recover either body.
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
  that `pr_id` whose `json` carries all ten envelope fields — `intent`, `blast`, `risks` (as the
  `Risks` wrapper object), `history`, `summary`, `review_focus`, `head_sha`, `generated_at`, `model`
  and `missing_inputs` — with `head_sha` equal to the pull request's current head SHA.
- **AC-57** — WHEN generation succeeds, the stored `json` shall satisfy `PrBrief.parse()` without
  modification to that schema. A failing run is a parse error, or a diff that makes `PrBrief`
  `.strict()` or relaxes any of its four required fields to pass.
- **AC-58** — The brief service shall write `history` as `{ history: [] }` in every envelope it
  persists. A failing run is a non-empty `history` array, which would mean something started
  populating a Non-goal.
- **AC-13** — WHEN a `pr_brief` row already exists for the pull request, the brief service shall
  overwrite it, leaving exactly one row for that `pr_id`.
- **AC-14** — IF the model call fails or exceeds `BRIEF_TIMEOUT_MS` (60 000 ms), THEN the brief
  service shall throw `AppError` with `statusCode: 502`, `POST /pulls/:id/brief` shall respond 502,
  and any stored `pr_brief` row shall be left byte-identical to what it was before. A failing run is
  a 500 / `internal_error` response — which is what a bare `Error` produces
  (`server/src/app.ts:187-196`), and therefore what an un-wrapped provider failure looks like.
- **AC-15** — WHEN a generation completes, the brief service shall emit one structured log record
  carrying `model`, the counted input tokens, `dropped_risks`, `dropped_focus` and `missing_inputs`
  as the flat list of its entries' `input` values, so that the single-call and budget claims are
  observable outside the tests. The `reason` strings stay out of the log line: they are rendered to
  the reader (AC-32) and repeating them here would put a degraded-index message into every log
  record for nobody to act on.

### Missing inputs

- **AC-16** — IF no `pr_intent` row exists for the pull request, THEN the brief service shall still
  generate, shall store `intent` as the placeholder `{ intent: '', in_scope: [], out_of_scope: [] }`
  so the envelope still satisfies `PrBrief.parse()` (AC-57, and `Intent` requires all three fields —
  `contracts/brief.ts:9-13`), and shall include a `missing_inputs[]` entry with `input: 'intent'`.
  That entry is the only signal that the stored intent is a placeholder and not a classification; a
  non-empty sentinel such as `'unknown'` is forbidden, because AC-59 means nobody would ever see it
  and a later reader replaying the envelope could mistake it for something the model produced.
- **AC-17** — IF the blast facts report `degraded: true`, THEN the brief service shall still
  generate, shall send the blast `summary` string it did receive, and shall include a
  `missing_inputs[]` entry with `input: 'blast'` whose `reason` is the degraded reason it received.
- **AC-18** — IF the pull request has no linked issue and no `pr_intent.sources` row with
  `kind: 'spec'` and status `used`, THEN the brief service shall include `missing_inputs[]` entries
  with `input: 'issue'` and `input: 'specs'` respectively.
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
- **AC-28** — WHEN a brief is present, the Overview tab shall render `summary` as visible text
  **exactly once**: inside `VerdictBanner` where one is rendered (AC-39), and as a paragraph inside
  the PR Brief block otherwise (AC-49). A failing run is the same summary text present twice in the
  tree — the state the seeded pull request produces, since it has a finished review with its own
  `summary` and `score` (`server/src/db/seed.ts:142-154`) — or absent from both hosts.
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
  `unavailable` message naming each entry's `input`, appending that entry's `reason` where one is
  present.
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

- **AC-59** — The PR Brief block shall render no value taken from the envelope's `intent`, `blast`
  or `history` fields. A failing run is a snapshot-only string (one absent from the live endpoints'
  responses) found in the block's output.
- **AC-60** — `PrIntentCard` and `BlastRadiusCard` shall continue to source their content from
  `GET /pulls/:id/intent` and `GET /pulls/:id/blast`, not from the brief envelope. A failing run is
  either card rendering with those requests stubbed out but a brief present.

### Server — module boundaries

- **AC-56** — The `brief` module shall import no other module's `service.ts` or `repository/**`,
  composing blast and smart-diff facts through `buildBlastRadius`
  (`server/src/modules/blast/helpers.ts:68`) and `buildSmartDiff`
  (`server/src/modules/smart-diff/helpers.ts:39`) and reading data through container ports. A
  failing run is a `no-cross-module-internals` error from `pnpm arch`
  (`server/.dependency-cruiser.cjs:88-97`), which a type-only import also triggers
  (`tsPreCompilationDeps: true`, `:149`).

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
- **A spec the model is told about but never shown.** `pr_intent.sources` stores a spec **path**,
  not its text (`reviews.ts:88-94`), and the linked issue is a bare `#123` reference
  (`intent.ts:115-120`). So the prompt says *a document called `specs/0012-blast-radius.md` is
  attached to this PR* while showing none of it. The model may therefore reference a spec it has not
  read, and may infer content from a filename. Accepted: the alternative is a clone read and a
  GitHub call this feature does not add. The path is still untrusted (AC-6) — a short attacker-chosen
  string is still an attacker-chosen string.
- **A snapshot that disagrees with the live cards.** A stale brief's stored `intent`/`blast` can
  differ from what `PrIntentCard` and `BlastRadiusCard` fetch beside it. The cards win, because
  nothing renders the snapshot (AC-59, AC-60), and the divergence is invisible by design.
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
  `specs` (the path list) → `smart-diff groups` → `blast caller list` (the blast `summary` string is
  never dropped) → `issue` (the `#123` reference) → `PR body` → `diff statistics`. `intent` and the
  PR title are never dropped. Each drop appends a `missing_inputs[]` entry (AC-5). The two cheapest
  blocks sit at the top of the list on purpose: a spec path list and an issue reference cost almost
  nothing, so under budget pressure the first thing lost is also the least informative.
- **Timeout.** `completeStructured` is called with `timeoutMs: BRIEF_TIMEOUT_MS` = 60 000 ms, and a
  breach surfaces as `AppError` / 502 (AC-14). Nothing else bounds a synchronous `POST`.
- **a11y.** Severity is spelled in text (AC-37); colour is decoration only. Review-focus rows are
  keyboard-activatable controls, and the risk disclosure carries `aria-expanded` (AC-38).
- **Security.** Four untrusted inputs reach the prompt — PR title, PR body, spec **paths**, issue
  **reference** — and all four are wrapped (AC-6). Two documents a reader might assume are in the
  prompt are not: spec contents and the issue body. The grounding filter (AC-8, AC-9, AC-10) is the
  only thing standing between a model-written path and what the reviewer is told is in their PR.
- **What this spec's controls cannot do.** The grounding filter checks the `file` and `file_refs`
  *fields*; it does not scan `summary`, `title`, `explanation` or `reason` prose, so a model may
  still name a non-existent path inside a sentence and nothing will catch it. The budget is checked
  on the input only — nothing caps the response size beyond the provider's own limits. `wrapUntrusted()`
  is a delimiting convention, not a parser: it reduces instruction-following on untrusted text, it
  does not prevent it. And nothing in this feature verifies that a `reason` is *true* of the file it
  names; grounding proves the path exists in this PR, nothing more.
- **Enforcement honesty.** Of the 60 criteria, 57 are mechanically checkable by a test or a build
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
| Smart Diff role groups | `buildSmartDiff(…)` — `server/src/modules/smart-diff/helpers.ts:39`, over data read from container ports | `[reused: spec 0010]` `[deterministic: path patterns]` | Lets the model rank reading order by role. **Not** `SmartDiffService.forPull`: importing a sibling's `service.ts` is a `no-cross-module-internals` error (AC-56). Same for blast — `buildBlastRadius`, `blast/helpers.ts:68`. |
| PR title and description | `pull_requests` row, written by the GitHub adapter | `[reused: L01]` **untrusted** | Wrapped (AC-6). |
| Linked issue **reference** (`#123`) | a regex match on the PR body — `server/src/modules/reviews/intent.ts:115-120` | `[reused: spec 0008]` `[deterministic: regex]` **untrusted** | The identifier only, never the issue body: spec 0008's decision D4 forbids a second GitHub call, and this feature does not add one. Absent → AC-18. |
| Spec file **paths** | `pr_intent.sources` rows, `kind: 'spec'`, status `used` — `intent.ts:141-156` | `[reused: spec 0008]` **untrusted** | Paths, never contents: `IntentSourceRow` is `{kind, ref, chars, truncated, status}` with no text field (`server/src/db/schema/reviews.ts:88-94`). Lowest truncation priority. No Project Context Folder is involved. |
| Model id and provider | `resolveFeatureModel(container, workspaceId, 'risk_brief')`, `settings/feature-models.ts:51-57` | `[reused: FEATURE_MODELS registry, contracts/platform.ts:14-20,62-67]` | AC-2. |
| Token counter | `container.tokenizer.count()`, `adapters/tokenizer/index.ts:32` | `[reused: platform adapter]` `[deterministic: js-tiktoken cl100k_base]` | AC-4. |
| `pr_brief` table | `server/src/db/schema/reviews.ts:145-150`, migration `0000_init.sql:211` | `[reused: existing schema]` | No migration (Non-goal). |
| `VerdictBanner` | `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/` | `[reused: existing component]` | `verdict` is required and typed `request_changes\|approve\|comment`, so it is rendered only where a finished review supplies one — AC-39, AC-49. |
| `summary`, `risks[]`, `review_focus[]` | the one `completeStructured` call | `[llm]` | Not reproducible, not a source of truth; grounded before persistence. |
| The grounding filter, the envelope, both routes, the block, `brief.json`, the `file` deep link | this feature | `[new]` | — |

## Untrusted inputs

Four strings a stranger wrote reach the prompt, and one more reaches the grounding sets:

- **PR title** and **PR body** — written by the PR author.
- **Spec file paths** — written into the PR body by the author and extracted at
  `intent.ts:141-156`. A path, not a document: `pr_intent.sources` has no text column
  (`reviews.ts:88-94`). A filename is short, but it is still attacker-chosen prose that the model
  reads.
- **Linked issue reference** — a `#123` substring the author put in the body
  (`intent.ts:115-120`). The issue's own title and body never reach this prompt.
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

Two residual exposures are stated rather than closed. Model prose (`summary`, `reason`,
`explanation`) is not path-scanned (`## Non-functional`). And the prompt names documents it does not
show — a spec path and an issue number — so the model can describe a spec it never read, and a
filename chosen to read like an instruction gets the wrapping of an untrusted string but the
attention of a fact.

## Test plan

| Criteria | Test |
|---|---|
| AC-1 | `server/test/brief.service.test.ts` — fake LLM adapter counts invocations; asserts exactly 1 on success, and asserts a second generation also counts 1 (not cumulative). |
| AC-2 | Same file — stubbed `resolveFeatureModel` returns a sentinel model id; asserts `completeStructured` received it, and a second case asserts no literal fallback when the resolver throws. |
| AC-3 | Same file — fixture `files[]` carrying a distinctive patch line; asserts the line is absent from every captured message, and a positive control asserts the fixture's *path* is present. |
| AC-4 | Same file — oversized fixture; asserts `tokenizer.count()` over the captured messages is `≤ 8000`, and a small fixture asserts the budget does not truncate when it need not. |
| AC-5 | Same file — oversized fixture asserts the specs block is absent and `missing_inputs` contains `specs`; the small fixture asserts `missing_inputs` is empty. |
| AC-6 | `server/test/brief.prompt.test.ts` — asserts the PR title, PR body, each spec path and the `#123` reference appear only inside `wrapUntrusted()` delimiters; a control asserts a trusted string (the blast summary) is not wrapped; a second control asserts no spec *content* and no issue *body* is in the prompt at all, since neither is available to this feature. |
| AC-7 | Same file — asserts the schema passed to `completeStructured` rejects a response missing `summary` and one missing `review_focus`, and accepts a complete one. |
| AC-50 | Same file — asserts the captured system message states both limits; a control asserts a response of 7 risks is still accepted by the schema, because the cap is an instruction and not a validation rule. |
| AC-8 | `server/test/brief.grounding.test.ts` — model response with one in-PR focus file and one invented one; asserts only the invented one is removed. |
| AC-9 | Same file — a risk with both file refs invented (dropped), a risk with one invented (ref stripped, risk kept), a risk fully grounded (untouched). |
| AC-10 | `server/test/brief.repo.it.test.ts` — asserts the persisted `json` contains no path outside `files[].path` ∪ blast paths; a control asserts the grounded paths survived. |
| AC-11 | `server/test/brief.grounding.test.ts` — `./src/a.ts`, `src//a.ts` accepted against `src/a.ts`; `SRC/a.ts` rejected. |
| AC-52 | Same file — review-focus items with `line` of `0` and `-3` are removed; a control asserts `line: 1` survives. |
| AC-12 | `server/test/brief.repo.it.test.ts` — asserts one row, all ten envelope fields present (including `risks` as a `{risks: [...]}` wrapper, not a bare array), `head_sha` equal to the pull's head. |
| AC-57 | Same file — `PrBrief.parse(row.json)` succeeds; a negative control asserts an envelope missing `intent` fails, so the test proves the schema is still doing work. |
| AC-58 | Same file — asserts `json.history` deep-equals `{ history: [] }` on a PR that has merged predecessors touching the same files, so an "it was empty anyway" pass is impossible. |
| AC-13 | Same file — generate twice; asserts a single row and the second envelope's `generated_at`. |
| AC-14 | `server/test/brief.routes.it.test.ts` — LLM adapter throws, and a second case times out; both assert `statusCode === 502` (not merely `>= 500`, so a bare `Error` falling through to 500 fails the test) and a byte-identical stored `json`. A control asserts the success path does write. |
| AC-15 | `server/test/brief.service.test.ts` — logger spy; asserts one record with `model`, input tokens, `dropped_risks`, `dropped_focus`. |
| AC-16 | Same file — no `pr_intent` row; asserts generation succeeds, `missing_inputs` contains `{input: 'intent'}`, and the stored `intent` is exactly `{intent: '', in_scope: [], out_of_scope: []}` so `PrBrief.parse()` still accepts it; a control with an intent row asserts neither the entry nor the placeholder appears. |
| AC-17 | Same file — blast stub returns `degraded: true, reason: 'no_data'`; asserts the blast `summary` still reached the prompt and `missing_inputs` carries `{input:'blast', reason:'no_data'}`. |
| AC-18 | Same file — no issue and no `spec` source rows; asserts entries with `input: 'issue'` and `input: 'specs'`; a control with both present asserts neither. |
| AC-56 | `cd server && pnpm arch` (folded into `pnpm lint`, run in CI) — a clean run over the new `src/modules/brief/**`. The negative is the rule's own fixture behaviour: the rule is `severity: 'error'`, so a deliberate local import of `../smart-diff/service.js` must fail the run before the criterion is trusted. |
| AC-19 | Same file — empty `files[]` and empty blast map; asserts a non-empty `summary` with `risks: []` and `review_focus: []`. |
| AC-20 | `server/test/brief.routes.it.test.ts` — fake LLM counter asserted at 0 after `GET` in the cached, empty and stale states. |
| AC-21 | Same file — `GET` with no row asserts 200 and `brief: null`. |
| AC-22 | Same file — stored `head_sha` mutated; asserts 200, the stored brief and `stale: true`. |
| AC-23 | Same file — matching head; asserts `stale: false`. |
| AC-24 | `server/test/contracts.test.ts` — `PrBrief.parse()` on a fixture carrying `summary` and `review_focus`; a negative case asserts a fixture missing them fails. |
| AC-25 | `server/test/contracts.test.ts` — byte comparison of the two `brief.ts` files (the check `scripts/` already applies to vendored copies, or a new `readFileSync` equality assertion). |
| AC-26 | `client/…/_components/PrBriefBlock/PrBriefBlock.test.tsx` — `brief: null` renders the Generate control and no lists. |
| AC-27 | Same file — two clicks while the first `POST` is pending; asserts one `fetch` to the brief route and a disabled control. |
| AC-28 | Same file — asserts the `summary` text appears **exactly once** in the document, in both fixtures: a reviewed pull request (text inside `VerdictBanner`, no block paragraph) and an unreviewed one (text in the block paragraph, no banner). A single `getAllByText(summary)` of length 1 is the assertion; `getByText` alone would throw on the duplicate rather than name it. |
| AC-29 | Same file — two risks; asserts each title and at least one file ref is rendered. |
| AC-30 | Same file — asserts `file`, `line` and `reason` per row and the rendered order equals the envelope order. |
| AC-31 | Same file — `risks: []` renders the `noRisks` message; a control with one risk asserts the message is absent. |
| AC-49 | Same file — a brief with no finished review asserts the `summary` paragraph is present and no `VerdictBanner` is in the tree; the control is AC-39's reviewed case. |
| AC-51 | Same file — an envelope of 8 risks and 9 review-focus items asserts 8 and 9 rendered rows, so no client-side cap can creep in. |
| AC-53 | Same file — asserts the refresh control is inside the block's `SectionLabel` right slot in the no-review state, where no banner exists; a control asserts it is still there in the reviewed state and not duplicated inside the banner. |
| AC-54 | Same file — with a pending `POST`, asserts the busy label, the disabled control and the `Skeleton`; after it resolves, asserts the lists replaced the skeleton. |
| AC-55 | Same file — `review_focus: []` asserts no `REVIEW FOCUS` heading, badge or list; a control with one item asserts all three. |
| AC-32 | Same file — `missing_inputs: [{input:'intent'}, {input:'blast', reason:'no_data'}]` renders the `unavailable` message naming both inputs and the `no_data` reason beside the second; empty `missing_inputs` renders none. |
| AC-59 | Same file — the envelope's `intent.intent` and `blast.summary` are set to sentinel strings absent from the stubbed live endpoints; asserts neither sentinel appears anywhere in the block's output. |
| AC-33 | `client/…/OverviewTab/OverviewTab.test.tsx` — asserts `PrIntentCard` and `BlastRadiusCard` still render with a brief present. |
| AC-60 | Same file — with a brief present but `GET /pulls/:id/intent` and `GET /pulls/:id/blast` stubbed to fail, asserts **neither card is in the tree** and no snapshot-only sentinel string renders anywhere. Both cards return `null` on absent data by design (`PrIntentCard.tsx:28`, `BlastRadiusCard.tsx:71`) — they have no error state, and this feature does not add one. The control is the normal case, where each card shows its endpoint's value. |
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
| Planning | 2026-10-02 | `spec-creator` drafted 48 criteria, then amended to 55 after the user settled four clarifications and four facts were resolved from the code (byte-identical contract copies, `AppError`/502 mapping, and the finding that no e2e flow ever calls a model). `check-specs.sh` green. Approved by the user. |
| Planning — amendment 2 | 2026-10-02 | `implementation-planner` found four spec↔code contradictions; the user ruled on all four and the spec went to 60 criteria. **The cached-envelope decision was reversed**: the envelope is the full `PrBrief` shape plus six transport fields, because all four of `PrBrief`'s fields are required and the user chose to keep the contract rather than relax it (AC-12, AC-57, AC-58). AC-6 was corrected — `pr_intent.sources` stores spec *paths* and the issue is a bare `#123` reference, so two of its four "untrusted strings" never existed. `missing_inputs[]` became `{input, reason?}`. `SmartDiffService.forPull` was replaced by `buildSmartDiff`/`buildBlastRadius`, which `no-cross-module-internals` permits (AC-56). |
| Planning — amendment 3 | 2026-10-02 | The reissued plan found three more gaps, all confirmed against the code and fixed here without renumbering. **AC-28 now renders `summary` exactly once** — it was unconditional while AC-39 also put the summary in `VerdictBanner`, so on the seeded pull request, which has a finished review (`server/src/db/seed.ts:142-154`), the same text rendered twice; the mockups draw it once, inside the banner. AC-16 now fixes the placeholder `intent` an envelope carries when no `pr_intent` row exists, since `Intent` requires all three fields and AC-57 requires the envelope to parse. AC-60's test row asked two cards to show an error state neither has — both `return null` on absent data (`PrIntentCard.tsx:28`, `BlastRadiusCard.tsx:71`) — so it now asserts their absence instead, and this feature still adds no error UI. |
| Implementation | | |
| Validation | | typecheck · lint · tests · e2e · manual |
| Completion | | status done, docs, insights wrap-up |
