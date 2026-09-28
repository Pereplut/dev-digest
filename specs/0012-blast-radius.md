---
title: Blast Radius
status: done
lesson: L04
packages: [server, client, mcp, e2e]
---

## Problem

A reviewer opening a pull request asks one question the diff alone cannot answer: *what else can
this change break?* DevDigest already holds the answer and shows none of it. `repo-intel` builds a
symbol / reference / import-graph index at clone time and precomputes per-file HTTP endpoints and
cron jobs into `file_facts`; `repoIntel.getBlastRadius(repoId, changedFiles)`
(`server/src/modules/repo-intel/service.ts:224`) already turns a changed-file list into changed
symbols, resolved cross-file callers and impacted endpoints. Nothing calls it: a grep for
`getBlastRadius` across `server/src` returns only its own declaration and the facade interface
(`repo-intel/types.ts:147`). The API-facing contract `BlastRadius`
(`server/src/vendor/shared/contracts/brief.ts:39`) is likewise unused, and the MCP tool
`get_blast_radius` is a registered stub that errors on every call
(`mcp/src/registry.ts:326-339`) — spec 0011's one open item.

So this feature is wiring, not new analysis. Nothing is re-parsed at request time and **no LLM is
called on any path**: the request reads a finished index and renders it.

Three pieces exist; the gap between them is the one piece of real logic:

| Already there | Where |
|---|---|
| `repoIntel.getBlastRadius(repoId, changedFiles)` → `BlastResult` | `server/src/modules/repo-intel/service.ts:224` |
| `BlastRadius` Zod contract (`changed_symbols` / `downstream` / `summary`) | `server/src/vendor/shared/contracts/brief.ts:16-44` (+ the client's vendored copy) |
| `get_blast_radius` registered with correct annotations, body stubbed | `mcp/src/registry.ts:326-339`, `mcp/src/core/errors.ts:105` |

`BlastResult` (`repo-intel/types.ts:74-87`) returns a **flat** `callers[]`, each row tagged with the
`viaSymbol` it reaches. The contract wants `downstream[]` **grouped by changed symbol**, with
endpoints and crons attributed per group. That flat→grouped mapping is the logic this spec adds.

## Scope / non-goals

**In scope**

- A new read-only server module `server/src/modules/blast/` exposing `GET /pulls/:id/blast`,
  modelled on `server/src/modules/smart-diff/`.
- An additive contract change: `BlastRadius` gains optional `degraded` / `reason`, mirrored into
  `client/src/vendor/shared`.
- A fix in the `repo-intel` facade: `MAX_CALLERS_PER_SYMBOL` is currently applied as a **total**
  cap. See [§The facade fix](#the-facade-fix--max_callers_per_symbol-is-applied-as-a-total-cap).
- A **Blast radius** card on the PR Overview tab, with four explicit states (loading, populated,
  no callers, degraded) and `file:line` deep links to GitHub.
- A real `get_blast_radius` in `mcp/`, over the same route, replacing the stub.
- An e2e flow asserting the degraded marker, plus a row in the e2e coverage table.

**Non-goals**

- The **Graph** view and the **Prior PRs touching these files** panel from the mock. Both optional
  in the homework; both are their own feature.
- Any LLM-written prose. `summary` is composed from counts.
- Changes to the indexer, to `file_facts` extraction, or to the endpoint regex. Its known false
  positives are documented below and left alone.
- Deeper traversal. Callers are one hop, as the facade already computes them; `BFS_DEPTH` (2) is
  re-exported but not re-implemented here.
- A new repository in `modules/blast/`. Both reads go through `container.reviewRepo`.
- Adding `mcp/` to `scripts/dev.sh`, `scripts/e2e.sh` or CI — deliberately absent
  (`mcp/AGENTS.md:6-14`).

## Design

### 1. Server — `server/src/modules/blast/`

Modelled on `server/src/modules/smart-diff/`, the most recent read-only module over an existing
facade: same file shape, same conventions.

```
server/src/modules/blast/
├── routes.ts      # GET /pulls/:id/blast — transport only
├── service.ts     # tenancy check, fetch inputs, delegate
├── helpers.ts     # buildBlastRadius() — the pure mapping (unit-tested)
└── constants.ts   # re-exports the repo-intel limits; no new magic numbers
```

| Ring | File | May import |
|---|---|---|
| 4 — infrastructure | `routes.ts` | `getContext`, `IdParams`, `@devdigest/shared` types, `./service.js` |
| 3 — application | `service.ts` | `Container`, `./helpers.js`, `./constants.js`, `NotFoundError` |
| 1 — domain core | `helpers.ts`, `constants.ts` | `@devdigest/shared` + stdlib + `repo-intel` types/constants only |

**`routes.ts`** copies `smart-diff/routes.ts:17-29` in shape:

```ts
app.get('/pulls/:id/blast', { schema: { params: IdParams } },
  async (req): Promise<BlastRadius> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.forPull(workspaceId, req.params.id);
  });
```

No `response:` schema — the repo's convention is that the handler's return *type* is the contract
and a test asserts the payload really satisfies it via `BlastRadius.parse()`
(`smart-diff/routes.ts:8-16` states this explicitly). No drizzle, no logic.

**`service.ts`** mirrors `SmartDiffService.forPull`:

1. `container.reviewRepo.getPull(workspaceId, prId)` → `NotFoundError` when absent. **Tenancy
   first**: a pull request in another workspace 404s before the index is touched.
2. `container.reviewRepo.getPrFiles(prId)` → the changed file paths.
3. One facade call: `container.repoIntel.getBlastRadius(pull.repoId, changedFiles)`.
4. `buildBlastRadius(result)` → the contract.

It owns **no repository**. Both reads go through `container.reviewRepo`, the sanctioned way for one
module to read another's entities — the same rationale `SmartDiffService` documents at its
`service.ts:8-11`. It imports no vendor SDK and writes no SQL.

**`helpers.ts` — `buildBlastRadius(result: BlastResult): BlastRadius`**, pure, no I/O:

- Group `result.callers` by `viaSymbol` → one `DownstreamImpact` per changed symbol that has at
  least one caller.
- Map each `BlastCallerRow` → `BlastCaller`: `{ name: row.symbol, file: row.file, line: row.line }`.
- Order each group by `rank` descending, then cap at `MAX_CALLERS_PER_SYMBOL` (20). The facade
  already sorts by rank (`repo-intel/service.ts:376`) and, after the fix below, already caps — the
  helper re-applies both so it is correct in isolation and unit-testable without the facade.
- `endpoints_affected` / `crons_affected`: the union of `result.factsByFile[f]` over the files of
  **that group's surviving callers**, deduped and sorted. `factsByFile` is absent on the degraded
  path (`repo-intel/types.ts:84`) — then both arrays are `[]`. Never throws, never indexes a missing
  key.
- `changed_symbols`: every `result.changedSymbols` row, including symbols with no callers. They
  simply get no `downstream` entry.
- `summary`: counts only, dot-separated in the repo's house style, e.g.
  `2 symbols · 14 callers · 3 endpoints · 1 cron`. Singular/plural handled; zero counts are
  rendered, not omitted. **No model call** — this is the whole of the "no LLM" criterion.
- `degraded` / `reason` pass through unchanged when present, and are omitted otherwise so the
  payload stays minimal on the happy path.

The decl-file exclusion ("a file must not appear among its own symbol's callers") is already
enforced upstream at `repo-intel/service.ts:277` (`if (r.fromPath === sym.file) continue`) and by
the resolved-caller query on the persistent path. The helper does **not** re-implement it; a test
asserts the property holds end to end.

**`constants.ts`** re-exports `MAX_CALLERS_PER_SYMBOL` and `BFS_DEPTH` from
`repo-intel/constants.ts:30,49` rather than redeclaring them, so there is exactly one source of
truth for the two limits (20 callers per symbol, traversal depth 2).

**Registration:** one import plus one entry in `server/src/modules/index.ts`, which already names
`blast` as an expected module in its header comment (`index.ts:24`).

#### Post-review addition — the route is index-only, so AC12 is literally true

Round-1 review found AC12 ("no clone parsing at request time") true only when the persistent index
exists: `RepoIntelService.getBlastRadius` (`repo-intel/service.ts:224`) falls through, when
`tryPersistentBlast` returns `null`, to a best-effort path that calls
`container.codeIndex.symbols()`/`references()` and reads clone files via `readClone`
(`service.ts:243-298`) — reachable from a web request for the first time now that a route calls it.

Fixed by extending the facade signature rather than having the caller second-guess it:
`getBlastRadius(repoId, changedFiles, opts?: { indexOnly?: boolean })`
(`repo-intel/types.ts:147`). With `indexOnly: true`, a `tryPersistentBlast` miss returns the
degraded literal from a new `degradedBlastIndexOnly(repoId)` — which reads only `getIndexState`,
never `codeIndex` — instead of falling through. It picks the reason from the same signal
`tryPersistentBlast` itself bailed on: `flag_off` when the flag is off, `no_data` when no index row
exists, and the persisted row's own `degradedReason` (`index_failed` in practice — `repo_too_large`
and `index_partial` are declared in the `DegradedReason` union but nothing in this codebase
produces them today) otherwise. No new `DegradedReason` value was needed.
`server/src/modules/blast/service.ts` passes `{ indexOnly: true }`; the fallback stays intact,
unopted-in, for the facade's only other consumer shape (none exists in `server/src` today, but the
signature keeps it available). Guarded by
`server/test/repo-intel-blast-index-only.test.ts`, whose `codeIndex` stub throws on every method —
proof the best-effort path is never entered — across `flag_off`, `no_data`, `index_failed` and the
"index IS usable" control case, plus `blast-service.test.ts`'s facade-call-count assertion updated
to include the third argument.

### The facade fix — `MAX_CALLERS_PER_SYMBOL` is applied as a total cap

`server/src/modules/repo-intel/service.ts:390` reads:

```ts
callers: callers.slice(0, MAX_CALLERS_PER_SYMBOL),
```

`callers` at that point is the **flat, all-symbols** list, sorted by rank descending
(`service.ts:376`). So the constant named *per symbol* — whose own docstring and the homework both
say per symbol — is enforced as a cap of 20 callers across the entire result. A pull request
touching 10 changed symbols keeps 20 callers total and silently loses the rest, with the
lowest-ranked symbols losing everything: rank is a file-level score, so the cut is not even spread
across symbols.

**Fix, in the facade rather than in `blast/helpers.ts`**, because the truncation happens upstream of
anything the helper can observe: group the rank-sorted `callers` by `viaSymbol`, take the first
`MAX_CALLERS_PER_SYMBOL` of each group, then flatten back to a flat list preserving rank order.
The signature, the flat shape and the `rank` ordering are all unchanged.

Two things this does not disturb:

- `impactedEndpoints` and `factsByFile` are computed from `callerFiles` derived **before**
  truncation (`service.ts:347`), so `factsByFile` becomes a superset of the surviving callers'
  files. Harmless: `buildBlastRadius` only looks up files of callers it kept.
- There is no other consumer to regress. `getBlastRadius` has no call site in `server/src` today,
  and the only test touching it is `server/test/repo-intel-facade-degraded.test.ts`, which exercises
  the degraded path (where the cap is not applied at all).

Guarded by a unit test with more than 20 callers spread over two `viaSymbol` values, asserting both
groups survive at 20 each — a test that fails against the current `slice`.

### 2. Contract — `BlastRadius` gains `degraded` / `reason`

`BlastResult` carries `degraded` + `reason` (`repo-intel/types.ts:85-86`); `BlastRadius` has nowhere
to put them, and dropping them on the server is exactly the silent degradation
`server/INSIGHTS.md` (2026-09-15) records as a hazard. Additive change in **both** vendored copies —
`server/src/vendor/shared/contracts/brief.ts` is canonical, `client/src/vendor/shared/contracts/brief.ts`
is a separate copy that must be mirrored by hand (root `INSIGHTS.md:21-25`,
`server/src/vendor/shared/AGENTS.md`):

```ts
export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  degraded: z.boolean().optional(),      // new
  reason: z.string().optional(),         // new
});
```

Both optional, so `PrBrief` (`brief.ts:120`) keeps compiling and no existing export is renamed or
removed — what the shared `AGENTS.md` requires. `reason` is `z.string()`, not an enum of
`DegradedReason`: the contract package must not import server module types, and the client mirrors
the five values locally (see the i18n keys below). The route response still validates as
`BlastRadius` literally.

Changing `server/src/vendor/shared/` is a cross-package change: `server/` and `reviewer-core/`
typecheck and tests, plus the client copy.

#### Post-review addition — `DownstreamImpact.capped`

Round-1 review found the client's "capped" note lying: it fired on
`group.callers.length >= CALLER_DISPLAY_CAP`, so a symbol with exactly 20 REAL callers and nothing
dropped was told "Showing the 20 highest-ranked callers" — indistinguishable, client-side, from a
symbol that actually lost callers to the cap. Only the server (which sees the pre-cap row count in
`blast/helpers.ts`) can say truthfully whether truncation happened. Fixed with an additive optional
field on `DownstreamImpact`, mirrored in both vendored copies:

```ts
export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
  capped: z.boolean().optional(),        // new — true only when this group was actually truncated
});
```

`server/src/modules/blast/helpers.ts` sets `capped: true` only when `rows.length >
MAX_CALLERS_PER_SYMBOL` for that group (i.e. the slice at `MAX_CALLERS_PER_SYMBOL` really dropped a
row), and omits the key otherwise — the same minimal-payload convention as `degraded`/`reason`. The
client (`BlastRadiusCard.tsx`) renders `blast.cappedCallers` only when `group.capped` is true, never
from `callers.length` alone.

### 3. Client — the Blast radius card

```
client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/
├── BlastRadiusCard.tsx
├── BlastRadiusCard.test.tsx
├── helpers.ts          # caller-row label + href building
├── styles.ts
└── index.ts
```

Reference pattern is the sibling `PrIntentCard/` — same file shape, same
`<section aria-labelledby>` + `<SectionLabel icon=…>` header, same "absence is normal, render
nothing" discipline. UI primitives are reached through `src/components/ui-client.ts`, never the
vendor path directly (`client/INSIGHTS.md:58-61`).

**Hook** — `usePrBlast(prId)` in `client/src/lib/hooks/core.ts`, copying `useSmartDiff`
(`core.ts:183`):

```ts
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
```

`enabled: !!prId` stays and is not "modernised" into `useSuspenseQuery`, which has no `enabled`
option — and `pr_files` is written as a side effect of the PR-detail fetch, so dropping the gate
races an empty table (`client/INSIGHTS.md:132-136`).

**Wiring** — `page.tsx:139` passes only `prBody` and `prId` to `OverviewTab`. Add `repoFullName`
and `headSha`; both are in scope at that call site (`page.tsx:84` — nullable — and `pr.head_sha`,
required on `PrMeta` at `platform.ts:188`). `OverviewTab` renders `<BlastRadiusCard>` after
`<PrIntentCard>` and before the description.

**GitHub links** — `githubBlobUrl(repoFullName, sha, file, line)`
(`client/src/lib/github-urls.ts:24`) rendered through `MonoLink` (re-exported at
`ui-client.ts:55`), which already sets `target="_blank"` + `rel="noopener noreferrer"`. Same pairing
as `FindingCard.tsx:47-50`, so caller rows and finding rows behave identically. `repoFullName` is
`null` until the repo loads: a caller row then renders as plain `file:line` text, never a broken
href.

**States** — four, all explicit:

| State | Render |
|---|---|
| Loading (`isLoading`, not `isFetching`) | `Skeleton` rows |
| Error | nothing — the card is an enrichment, not the page |
| Populated | summary chips, then one collapsible row per changed symbol with callers and the endpoints/crons beneath |
| No callers | `EmptyState` with `blast.emptyTitle` / `blast.emptyBody`, not a blank box |
| `degraded: true` | a warning `Chip` (`color="var(--warning)" icon="AlertTriangle"`) with `role="status"`, naming the reason, **above** whatever data did come back |

Gating loading on `isLoading` rather than `isFetching`, giving the degraded marker a real
`role="status"`, and querying the collapsible by its exact accessible name are all recorded
requirements for testability (`client/INSIGHTS.md:126-142`).

**Hard client constraint** — only `import type` from `@devdigest/shared`. A value import of the Zod
schema typechecks and passes vitest but breaks `next build`, because the vendored barrel re-exports
with `.js` specifiers webpack cannot resolve; enforced by `client/eslint.config.mjs:55-64` and
documented at `client/INSIGHTS.md:83-87`. The five `DegradedReason` values needed at runtime are
mirrored locally in `BlastRadiusCard/helpers.ts`, the way `DiffTab/constants.ts:1-14` mirrors its
enum, with an unknown `reason` falling back to the `no_data` sentence rather than rendering a raw
key.

### 4. i18n — the `blast` group in `prReview.json`, use verbatim

A new `blast` group **inside** `client/messages/en/prReview.json`. *Not* a new `blast.json`: every
`messages/en/*.json` ships to every route, so a new namespace costs every page
(`client/INSIGHTS.md:52-55`). Keys are camelCase; plurals use the ICU form already used by
`reviewRun.findings`.

| Key (under `prReview.blast`) | English copy |
|---|---|
| `title` | `Blast radius` |
| `subtitle` | `what this change can reach` |
| `loading` | `Reading the code index…` |
| `chip.symbols` | `{count, plural, one {# changed symbol} other {# changed symbols}}` |
| `chip.callers` | `{count, plural, one {# caller} other {# callers}}` |
| `chip.endpoints` | `{count, plural, one {# endpoint} other {# endpoints}}` |
| `chip.crons` | `{count, plural, one {# cron job} other {# cron jobs}}` |
| `callersLabel` | `Callers` |
| `endpointsLabel` | `Endpoints reached` |
| `cronsLabel` | `Cron jobs reached` |
| `expandSymbol` | `Show callers of {symbol}` |
| `collapseSymbol` | `Hide callers of {symbol}` |
| `noCallersForSymbol` | `No caller outside its own file` |
| `cappedCallers` | `Showing the {count} highest-ranked callers` — rendered only when the server's `DownstreamImpact.capped` is `true` (post-review addition, §2), never from a client-side `callers.length` comparison; a group with exactly `{count}` real callers and nothing dropped renders no note at all |
| `openOnGitHub` | `Open {file} line {line} on GitHub` |
| `emptyTitle` | `Nothing downstream` |
| `emptyBody` | `No file outside this PR references the symbols it changes. That is not a clean bill of health — only a reference the index could resolve counts as a caller.` |
| `degraded.label` | `Partial map` |
| `degraded.reason.flag_off` | `Code indexing is switched off on this server, so this map was never built.` |
| `degraded.reason.index_failed` | `Indexing this repository failed, so there are no callers to read.` |
| `degraded.reason.index_partial` | `This repository is only partly indexed, so callers are missing.` |
| `degraded.reason.repo_too_large` | `This repository is too large to index in full, so callers are missing.` |
| `degraded.reason.no_data` | `This repository has not been indexed yet, so there is nothing to read.` |

`expandSymbol` / `collapseSymbol` are the collapsible's accessible name and are what the tests
query by. `degraded.label` plus one `degraded.reason.*` sentence render together inside the
`role="status"` chip, so the marker always says *why* the map is partial — a marker without a reason
is the failure this spec is fixing, not a nicety. The five reason keys are exactly
`DegradedReason` (`server/src/modules/repo-intel/types.ts:27-32`).

### 5. MCP — `get_blast_radius` becomes real

Three edits in `mcp/`, no new ring-3 module: spec 0011's "No Middle Man" rule says a tool that only
forwards calls the port directly and projects the result in ring 1
(`mcp/AGENTS.md` ring-consequences list).

1. **`src/ports.ts`** (ring 2 — plain TS, no Zod, no SDK): add
   `getBlastRadius(prId: string): Promise<BlastRadiusWire>` beside `getPullByNumber`. Implement in
   `src/adapters/http/index.ts` as `GET /pulls/${seg(prId)}/blast`. Use `seg()`, which **rejects**
   `''`, `'.'`, `'..'` and non-strings rather than encoding them — its `typeof` clause is
   load-bearing, because ids arrive through a blind `as T` cast (`mcp/INSIGHTS.md:63-68`).
2. **`src/core/project.ts`** (ring 1 — no Zod, no SDK, no `fetch`): add `projectBlast(...)`
   following the `projectFinding` / `projectConvention` shape. Keys snake_case. Carry `degraded` and
   `reason` through, so the agent is told the map is partial instead of silently reading a thin one.
3. **`src/registry.ts`** (ring 4 — the only place the SDK, Zod and `CallToolResult` appear): replace
   the stub body. `GetBlastRadiusInput` (`registry.ts:192-198`) and `READ_ONLY_ANNOTATIONS` are
   already correct and stay untouched. New flow inside the existing `withApiErrors`:
   `listRepos()` → `resolveRepoSlug` → `repositoryUnknownText` on miss → `getPullByNumber` → `null`
   ⇒ the unknown-pull-request text below → `getBlastRadius(pull.id)` →
   `okJson(projectBlast(…))`. Replace the `description`, delete the
   `` `get_blast_radius` is registered but not implemented. `` line from `INSTRUCTIONS`
   (`registry.ts:50`), and retire `blastRadiusStubText` from `core/errors.ts:105`.

Four things that break if missed:

- **`MockDevDigestApi`** (`src/adapters/mocks.ts`) must gain `getBlastRadius`, or every
  `registry.test.ts` case fails — that suite runs a real MCP client against the mock API. Its
  fixture covers both a populated map and a degraded one.
- **`registry.test.ts:221-231`** asserts the stub always errors and never calls the port. Replace
  it, do not delete it: the new cases assert a real map comes back, and that an unknown pull request
  number produces the recovery text.
- **`token-budget.test.ts`** bounds the serialised tool surface in both directions
  (`TOKEN_CEILING = 2000`, floor at 75% of the measured value). A longer description moves the
  measurement — **re-measure and update `MEASURED_AT_WRITING`**, never nudge the ceiling to fit
  (`mcp/INSIGHTS.md:27-31`).
- **Field-level `.meta({ examples })` only.** The SDK drops `examples` from any object with a
  transform anywhere below it, silently. `GetBlastRadiusInput` has no transform today, but the rule
  is cheap and the failure is invisible (`mcp/INSIGHTS.md:57-61`).

#### Post-review addition — `projectBlast` caps `downstream` at `MAX_BLAST_DOWNSTREAM_GROUPS`

The facade fix above replaced a 20-*total* caller cap with a correct 20-*per-symbol* cap, which
means the total is now `20 × changed symbols` with nothing re-capping it. This codebase's own
manual-demo data (§7) has a 37-symbol PR (`Pereplut/dev-digest#9`), so an uncapped result can
serialise up to ~740 caller rows — fine for the page (a human scrolls it), but `get_blast_radius`
pushes all of it into an agent's context in one tool call, and `token-budget.test.ts` bounds only
the *tool surface* (the `tools/list` schema/description), never a call result.

`projectBlast` (`core/project.ts`, still ring 1 — no Zod, no SDK, no network) now ranks
`result.downstream` by caller count descending and keeps only the top
`MAX_BLAST_DOWNSTREAM_GROUPS` (= **10**, a module constant declared beside `MAX_FINDING_TEXT_CHARS`
with the reasoning in its comment: 10 groups × the server's own 20-per-symbol cap bounds the worst
case at 200 caller rows, an order of magnitude below the 37-symbol/~740-row uncapped worst case,
while the common case — a handful of symbols with real callers — is returned whole). When groups
are actually dropped, the projection carries `omitted_downstream_groups` and
`omitted_downstream_callers` (snake_case, additive, present only on real trimming) so the agent is
told the map was trimmed rather than silently reading a short one. This is MCP-only: the route, the
`BlastRadius` contract and the page are untouched, and keep serving the server's full, uncapped
`downstream`. Guarded by `mcp/test/core/project.test.ts` (no omission at/under the cap; trimming plus
both omitted counts over the cap; ranking-not-input-order). `token-budget.test.ts` needed no
re-measurement — `registry.ts`'s tool schema/description did not change, only a ring-1 result
transform, confirmed by re-running the suite unchanged at `MEASURED_AT_WRITING = 1668`.

`mcp/AGENTS.md` gets a pointer to this spec alongside 0011, since its "strings are verbatim from
the spec" rule now spans two specs.

### 6. MCP strings — use verbatim

`mcp/AGENTS.md:50-54` requires every tool description and error text to come from the spec
character-for-character, diffed rather than retyped. These are acceptance criteria, not
illustrations.

#### `get_blast_radius` description

> Get the blast radius of a pull request — which symbols it changes, which callers reach them, and which HTTP endpoints and cron jobs sit behind those callers. Identify the pull request by repository slug and PR number as shown on GitHub, not by an internal id. This reads a code index DevDigest built when it cloned the repository: it is read-only, cheap, and calls no model, so prefer it over reading the diff yourself to guess what a change affects. An empty `downstream` means no caller outside the changed files resolved — not that the change is safe; a `degraded` flag with its `reason` means the index is missing or partial, so the map under-reports rather than being complete.

#### Unknown pull request — error text

| Situation | Text |
|---|---|
| Pull request unknown | `No pull request #<n> in <repo>. DevDigest only knows pull requests it has synced from GitHub — open that repository in the DevDigest UI and refresh its pull request list, then call get_blast_radius again. If the number came from a link or a branch name, check it against GitHub first: this is the PR number, not an internal id.` |

Placeholders `<n>` and `<repo>` are the tool's own `pull_number` and `repo` arguments, echoed back
verbatim as `repositoryUnknownText` echoes `given`. The text names a recovery because an error with
no next action is the one shape spec 0011 rules out, and a bare API message is what
`mcp/INSIGHTS.md:39-43` records as the concrete regression.

The description's closing clause is deliberate: `get_blast_radius` returning an empty map is
ambiguous in exactly the way `findings: []` on a `done` run is (`mcp/INSIGHTS.md:45-49`), and
`degraded`/`reason` are what separate "nothing reaches this" from "nothing was indexed".

Every other non-2xx keeps its existing treatment through `apiErrorText(status, body, message)` —
the 404 class already names where ids come from. No new error text is introduced beyond the one
above, and `blastRadiusStubText` is deleted rather than left unused.

### 7. e2e and the manual demo

**`e2e/flows/11-pr-blast-radius.flow.json`** — the hermetic stack (`./scripts/e2e.sh`) seeds only
`acme/payments-api`, whose `clone_path` is `null` and which has no `repo_index_state` row, so the
flow asserts the **degraded marker and its reason sentence**, not real callers. Read-only,
deterministic locators, a `label` on every step, numbered after the existing `10-pr-finding-actions`.
Plus a row in the `e2e/README.md` coverage table. The populated state is covered by client unit
tests and the manual demo.

**Manual demo — the data already exists.** The dev stack holds `Pereplut/dev-digest` cloned to
`server/clones/Pereplut/dev-digest` and indexed to `status: full`, 312 files,
`indexer_version: 2`. No seed change and no new PR are needed:

| PR | Changed symbols with callers | Caller files | Impacted endpoints |
|---|---|---|---|
| **#2** feat(cost) | 20 | 15 | 20 |
| **#11** feat(observability) | 5 | 11 | 22 |
| #9 feat: intent layer | 37 | 12 | 10 |

Either #2 or #11 clears "≥ 2 real callers and ≥ 1 HTTP endpoint" with room to spare. The single
best symbol to point at is `getContext` (`server/src/modules/_shared/context.ts`): 36 references
from 8 files, 7 of them route files carrying 27 endpoints between them. The degraded state demos
from the same stack via `acme/payments-api#482`.

### 8. Known data-quality caveats — observed, not fixed here

Recorded so the PR description can be honest and nobody "fixes" the numbers by loosening the index:

- Only **640 of 6,416** references resolve a `decl_file`, and a caller counts only when its
  reference resolved to a changed file (`repo-intel/service.ts:315-317`). Precision over recall: the
  map under-reports rather than lying. `blast.emptyBody` says so in the UI.
- `getResolvedCallers` inner-joins `file_rank` (`repo-intel/repository.ts:558-586`), so a caller in
  a file with no rank row is **silently dropped** — harmless on a `full` index, visible on
  `partial`.
- The endpoint regex has false positives: it reads client-side `api.get("/settings")` calls and test
  fixtures as endpoints (`client/src/lib/hooks/core.ts` alone yields 11). An endpoint chip may name
  a call site rather than a route.
- **Crons are effectively always 0** — two files in the whole index have any, and both are the
  extractor and its own test. Render the count honestly; build no cron-heavy UI for it.

### 9. How it gets built

Per L03's pipeline, and the PR description names which subagent did what:

1. **planner** — this spec.
2. **implementer** — server (module + facade fix), then contract, then client, then mcp; each
   package's typecheck, lint and tests as it goes.
3. **architecture-reviewer** ∥ **plan-verifier** on the finished diff. The first checks onion
   boundaries (`.dependency-cruiser.cjs` rules `no-cross-module-internals` and `routes-no-drizzle`);
   the second checks the diff against this spec item by item.
4. `/pr-self-review` — **manual only** (`disable-model-invocation: true`), so the agent asks the
   user to run it. Any `CRITICAL` blocks the PR and the gate hook denies `git push` until a passing
   review covers the exact diff. Never bypassed.

## Acceptance criteria

1. A **Blast radius** block renders on the PR Overview tab.
2. It opens with a summary of changed symbols, callers, endpoints and crons.
3. Under each changed symbol: its callers as `file:line`, and beneath them the endpoints that symbol
   reaches.
4. On `Pereplut/dev-digest#2` (or #11) the block shows **≥ 2 real callers and ≥ 1 HTTP endpoint**.
5. Clicking a `file:line` opens exactly that line on GitHub, pinned to the PR's head SHA.
6. No callers ⇒ readable copy, not a blank box. `degraded: true` ⇒ a distinct `role="status"` marker
   naming the reason in words.
7. `get_blast_radius` in `devdigest-mcp` returns the same map as the page, carrying `degraded` and
   `reason`; the stub text and its helper are gone.
8. `GET /pulls/:id/blast` 404s for an unknown pull request **and** for one in another workspace,
   before the index is read.
9. The route's payload satisfies `BlastRadius.parse()` in a test.
10. `MAX_CALLERS_PER_SYMBOL` is enforced **per `viaSymbol`**, asserted by a test that fails against
    the current total-cap `slice`.
11. Both limits come from `repo-intel/constants.ts`; `modules/blast/constants.ts` declares no new
    number.
12. No LLM call on any path. `GET /pulls/:id/blast` never triggers clone parsing: it calls
    `repoIntel.getBlastRadius(repoId, changedFiles, { indexOnly: true })`, and when no persistent
    index is usable the facade returns the degraded literal directly instead of falling through to
    its best-effort path (which reads the clone at request time) — asserted by a test whose
    `codeIndex` stub throws if the best-effort path is ever entered. Every other caller of the
    facade keeps the pre-existing fallback; `indexOnly` is additive and opt-in.
13. A changed symbol's declaring file never appears among its own callers.
14. The MCP description and the unknown-pull-request text match §6 verbatim.
15. `mcp/` `npm run arch` passes; the SDK stays confined to `registry.ts` and `entry/*`.
16. The e2e flow asserts the degraded marker and its reason sentence.

## Test plan

| Layer | How |
|---|---|
| Ring 1 — the mapping | `server/test/blast-helpers.test.ts`: flat→grouped by `viaSymbol`; rank ordering; per-symbol cap at 20 (and `capped: true` is reported only when a row was actually dropped, never at exactly 20 real callers); endpoints/crons attributed from `factsByFile` over the group's caller files only; `factsByFile` absent ⇒ empty arrays, no throw; zero-caller symbol present in `changed_symbols` and absent from `downstream`; `summary` counts and pluralisation; the helper passes every row it is given straight through, grouped by `viaSymbol` alone — it does not filter by matching a caller's file against some other symbol's decl file (post-review: the original "decl file never a caller" case here was vacuous — its only fixture caller lived in a different file from the decl file, so it passed under any implementation; that invariant is enforced upstream and tested for real at Ring 1 — the facade fix below) |
| Ring 1 — the facade fix | `server/test/repo-intel-blast-cap.test.ts`: > 20 callers over two `viaSymbol` values keep 20 each, rank order preserved. `server/test/repo-intel-blast-decl-exclusion.test.ts` (post-review addition): stubs `container.codeIndex.references()` to return one same-file and one other-file reference for the same symbol and asserts only the other-file one survives `getBlastRadius`'s best-effort path (`repo-intel/service.ts:277`) — the real enforcement point for AC13 |
| Ring 1 — indexOnly bailout (post-review) | `server/test/repo-intel-blast-index-only.test.ts`: `RepoIntelService.getBlastRadius(..., { indexOnly: true })` against a `codeIndex` stub whose every method throws — proof the best-effort (clone-parsing) path is never entered — across `flag_off` (repo-intel disabled), `no_data` (no index row), `index_failed` (persisted `degraded`/`failed` row) and a control case where the persistent index IS usable, to show `indexOnly` only bites on the bailout |
| Ring 3 — service | Unknown pull request and cross-workspace pull request both `NotFoundError`, asserted **before** `repoIntel.getBlastRadius` is called (spy never invoked). Fake the container with an explicit stub object, **never** `as unknown as` — `server/tsconfig.json` excludes `test/**`, so a structural cast typechecks green while the test dies at runtime (`server/INSIGHTS.md:114-116`). The facade-call assertion checks the full argument list, including the third `{ indexOnly: true }` argument (post-review) |
| Ring 4 — route | Route test asserting 200 + `BlastRadius.parse(payload)` succeeds, degraded fields present when the facade reports them and absent when it does not. Hermetic (no `test/helpers/pg.ts`), so **not** `*.it.test.ts` |
| Contract | `BlastRadius.parse` accepts a payload without `degraded`/`reason` (back-compat) and with them; `DownstreamImpact.capped` likewise back-compat both ways; the client copy is byte-compatible for these fields |
| Client — component | `BlastRadiusCard.test.tsx` per state: skeleton on `isLoading`; populated tree; collapsible queried by its exact accessible name (`blast.expandSymbol`); empty state copy; degraded chip found via `role="status"` with the reason sentence; `href` equals `githubBlobUrl(repo, sha, file, line)`; `repoFullName === null` ⇒ text, no link; unknown `reason` ⇒ the `no_data` sentence; the capped note renders only when `group.capped` is `true`, and NOT at exactly 20 real callers with `capped` unset |
| Client — wiring | `OverviewTab.test.tsx` renders the card between `PrIntentCard` and the description, and passes `repoFullName` / `headSha` through — asserted by rendering both through the mock, not just `prId` (post-review: the original mock rendered only `prId`, so a swapped/mistyped prop would have passed) |
| MCP — ring 1 | `projectBlast` unit tests: snake_case keys, concise shape, `degraded`/`reason` carried through; (post-review) `downstream` capped at `MAX_BLAST_DOWNSTREAM_GROUPS`, ranked by caller count rather than input order, `omitted_downstream_groups`/`omitted_downstream_callers` present only when groups were actually dropped and absent at/under the cap |
| MCP — ring 4 | `registry.test.ts` through `MockDevDigestApi`, no network: a real map comes back; an unknown pull request number returns §6's text; an unknown repo still returns `repositoryUnknownText` |
| MCP — adapter | `seg()` rejects `''`, `'.'`, `'..'` and a non-string `prId` without calling `fetch` |
| MCP — budget | Re-measure the serialised tool surface, update `MEASURED_AT_WRITING`, keep `TOKEN_CEILING = 2000` and the 75% floor. (Post-review: the downstream-group cap changed a ring-1 result transform, not `registry.ts`'s tool schema/description, so `tools/list` output — and `MEASURED_AT_WRITING = 1668` — is unchanged; re-run confirmed the suite still passes both directions.) |
| MCP — protocol | `npx @modelcontextprotocol/inspector --cli <entry> --method tools/list` — `get_blast_radius` shows `readOnlyHint: true`, no `outputSchema`, `additionalProperties: false`. Pass env with `-e`, never a shell prefix (`mcp/INSIGHTS.md:33-37`) |
| e2e | `./scripts/e2e.sh` from the root, including `11-pr-blast-radius.flow.json` |
| Manual | §7's steps on the dev stack: `Pereplut/dev-digest#2` for the populated state, `acme/payments-api#482` for degraded; server logs show index reads only — no AST parse, no import-graph rebuild, no LLM call |

Per-package verification:

| Package | Commands |
|---|---|
| `server/` | `pnpm typecheck` · `pnpm lint` (eslint + `pnpm arch`) · `pnpm exec vitest run --exclude '**/*.it.test.ts'` · `pnpm exec vitest run .it.test` |
| `client/` | `pnpm typecheck` · `pnpm lint` · `pnpm test` |
| `reviewer-core/` | `npm run typecheck` · `npm test` — required by the `vendor/shared` change |
| `mcp/` | `npm run typecheck` · `npm run lint` · `npm test` |
| root | `./scripts/e2e.sh` · `./scripts/check-agent-docs.sh` after `git add -N` the new files (it enumerates via `git ls-files`, so untracked work passes vacuously — root `INSIGHTS.md:235-239`) |

Two green-run rules apply. An `.it.test` summary with a non-zero `skipped` count, a non-zero exit,
or a FAIL in an untouched file is **not** a pass (`server/INSIGHTS.md:108-112`). And `pnpm arch`
does not gate CI (`server/INSIGHTS.md:90-94`), so run `pnpm lint` locally and believe it only after
watching a deliberately broken rule fire.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-28 | request read; `specs/` checked — no prior blast spec, `0011-mcp-server.md:42,387-407` names the stub as its one deferred item and points at the unwired backend; root + `server/` + `client/` + `mcp/` INSIGHTS read. Confirmed the gap is wiring: `getBlastRadius` (`repo-intel/service.ts:224`) and `BlastRadius` (`brief.ts:16-44`) both exist, and a grep for `getBlastRadius` across `server/src` finds only the declaration and the facade interface — no consumer |
| Planning | 2026-09-28 | spec approved. Decisions: collapsible tree, no Graph view; `degraded`/`reason` added to `BlastRadius` in both vendored copies rather than a side channel; `summary` from counts, no LLM on any path; new `server/src/modules/blast/` modelled on `smart-diff/` with no repository of its own; the flat→grouped mapping isolated in `helpers.ts` as a pure function; `MAX_CALLERS_PER_SYMBOL` fixed in the facade (`repo-intel/service.ts:390` applies it as a total cap of 20 across all symbols, contradicting its name and docstring — no other consumer to regress); i18n in the existing `prReview.json`, not a new namespace; MCP tool wired with no ring-3 service (No Middle Man), description and unknown-PR text spec-owned; e2e asserts the degraded marker only, since the hermetic seed has no clone; demo from the existing `Pereplut/dev-digest` index (#2: 20 symbols / 15 caller files / 20 endpoints), no seed change |
| Implementation | 2026-09-28 | Built in package order per §9: server (`modules/blast/{routes,service,helpers,constants}.ts`, registered in `modules/index.ts`; the facade fix at `repo-intel/service.ts:390` replaced with `capCallersPerSymbol` grouping by `viaSymbol` before flattening) → contract (`degraded`/`reason` added to `BlastRadius` in both vendored `brief.ts` copies) → client (`BlastRadiusCard/` modelled on `PrIntentCard/`, wired into `OverviewTab.tsx` and `page.tsx`, `usePrBlast` added to `lib/hooks/core.ts`, `blast` group added to `messages/en/prReview.json`) → mcp (`ports.ts` + `adapters/http/index.ts` `getBlastRadius`, `core/project.ts` `projectBlast`, `registry.ts` real tool body replacing the stub, `blastRadiusStubText` retired) → e2e (`11-pr-blast-radius.flow.json` against the degraded `acme/payments-api#482` seed). — **Post-review fixes (this pass, four items):** (1) `blast-helpers.test.ts`'s AC13 case was vacuous — its only fixture caller lived in a file different from the decl file, so it passed under any implementation; rewritten to assert the mapping is a straight pass-through by symbol name (never filtered by file), and the real AC13 enforcement is now driven for real by a new `server/test/repo-intel-blast-decl-exclusion.test.ts` that stubs `container.codeIndex.references()` with one same-file and one other-file reference and asserts only the other-file caller survives the facade's best-effort path (`repo-intel/service.ts:277`). (2) `OverviewTab.test.tsx`'s `BlastRadiusCard` mock rendered only `prId`, so a swapped/mistyped `repoFullName`/`headSha` prop would have passed silently; the mock now renders all three and two tests assert the exact values, including a null/undefined case. (3) The "capped" note fired on `group.callers.length >= CALLER_DISPLAY_CAP`, telling a symbol with exactly 20 real callers and nothing dropped that it was truncated — the client cannot know that, only the server can. Added an additive optional `capped: z.boolean()` to `DownstreamImpact` in both vendored `brief.ts` copies (kept byte-identical), set in `blast/helpers.ts` only when a group's pre-cap row count exceeds `MAX_CALLERS_PER_SYMBOL`, and the client now renders the note only when `group.capped` is `true`. (4) This Phases table and `specs/README.md`'s index row, previously stale. |
| Validation | 2026-09-28 | Commands run this pass, verbatim tails in the implementer's report: `server/` — `pnpm typecheck` clean; `pnpm lint` → `eslint` 0 errors / 5 pre-existing warnings (none in touched files) + `pnpm arch` → 0 errors, 1 pre-existing non-gating `no-orphans` warning on `model-router.ts` (untouched by this work, documented `server/INSIGHTS.md` 2026-09-18); `pnpm exec vitest run --exclude '**/*.it.test.ts'` → **390 tests passed, 0 skipped, 36 files** (up from 387 before this pass — 3 new/rewritten server tests). `client/` — `pnpm typecheck` clean; `pnpm lint` → 0 errors / 5 pre-existing warnings (none in touched files); `pnpm test` → **255 tests passed, 0 skipped, 39 files** (up from 251 — 4 new client tests); `pnpm build` → compiles, all 9 routes generate. `mcp/` — untouched this pass; `npm run typecheck` clean, `npm run lint` (`eslint` + `npm run arch`) 0 violations, `npm test` → **103 tests passed** (unchanged). `reviewer-core/` — required because the vendored contract changed; `npm run typecheck` clean, `npm test` → **63 tests passed** (unchanged). Both vendored `brief.ts` copies confirmed byte-identical via `diff`. **Not run this pass** (unchanged by these four fixes, so not re-verified): `pnpm exec vitest run .it.test` (Docker), `./scripts/e2e.sh`, the MCP protocol/inspector check, and a fresh manual dev-app pass on `Pereplut/dev-digest#11` / `acme/payments-api#482` — those live checks were performed during the original implementation pass (recorded there as: `getContext`, 36 references from 8 files, 7 route files / 27 endpoints on #11; degraded marker with `no_data` reason on `acme/payments-api#482`; server logs showed index reads only) and were not repeated here since no server code on the read path changed, only the truthfulness of one client-rendered note. The original implementation's MCP token-surface measurement (1446 → 1668 after the real tool description replaced the stub, `MEASURED_AT_WRITING` in `token-budget.test.ts`) likewise stands unchanged, since `mcp/` was not touched this pass. |
| Completion | 2026-09-28 | `status: done`; `specs/README.md` index row updated to match. Durable explanations already live in this spec (§§1–8) and in the module `INSIGHTS.md` files touched along the way; no further `docs/` write was judged necessary for a wiring feature with no new architecture. `/pr-self-review` has not been run — per root `AGENTS.md`, that is manual-only and left for the user. |
| Implementation (round 3 — post-review) | 2026-09-28 | Two findings from a further review, both closed: (1) AC12's "no clone parsing at request time" only held when the persistent index existed — `RepoIntelService.getBlastRadius` fell through to a best-effort path reading `container.codeIndex` and the clone (`repo-intel/service.ts:243-298`), newly reachable from `GET /pulls/:id/blast`. Fixed with an additive `opts?: { indexOnly?: boolean }` on the facade signature (`repo-intel/types.ts:147`); `blast/service.ts` passes `{ indexOnly: true }`; a miss returns the degraded literal from a new `degradedBlastIndexOnly` (reads only `getIndexState`, picking `flag_off`/`no_data`/the persisted row's own `degradedReason` — no new `DegradedReason` value needed) instead of falling through. Guarded by `server/test/repo-intel-blast-index-only.test.ts`, whose `codeIndex` stub throws on every method. (2) `projectBlast`'s per-symbol cap fix left the GROUP count uncapped — `20 × changed symbols`, up to ~740 caller rows for this codebase's own 37-symbol demo PR, pushed whole into an agent's context by `get_blast_radius`. Fixed with `MAX_BLAST_DOWNSTREAM_GROUPS = 10` (`mcp/src/core/project.ts`, beside `MAX_FINDING_TEXT_CHARS`): `projectBlast` ranks `downstream` by caller count and keeps the top 10, reporting `omitted_downstream_groups`/`omitted_downstream_callers` when it actually trims. MCP-only — the route, contract and page are unchanged and keep the full map. Both changes recorded in the `server/` and `mcp/` `INSIGHTS.md`. |
| Validation (round 3) | 2026-09-28 | `server/` — `pnpm typecheck` clean; `pnpm lint` → 0 errors / 5 pre-existing warnings (none in touched files) + `pnpm arch` → 0 errors, the same 1 pre-existing non-gating `no-orphans` warning; `pnpm exec vitest run --exclude '**/*.it.test.ts'` → **394 tests passed, 0 skipped, 37 files** (up from 390 — 4 new tests in `repo-intel-blast-index-only.test.ts`). `mcp/` — `npm run typecheck` clean; `npm run lint` (`eslint` + `npm run arch`) → 0 violations; `npm test` → **106 tests passed** (up from 103 — 3 new tests in `core/project.test.ts`), `token-budget.test.ts` unchanged at `MEASURED_AT_WRITING = 1668`. `client/` — untouched this pass; `pnpm typecheck` clean, `pnpm test` → **255 tests passed, 0 skipped, 39 files** (unchanged). `reviewer-core/` — not required (no `vendor/shared` or `reviewer-core/` change this pass). **Not run this pass**: `pnpm exec vitest run .it.test` (Docker), `./scripts/e2e.sh`, the MCP protocol/inspector check, and a fresh manual dev-app pass — unaffected by these two fixes (server: one facade branch's reason selection; mcp: a ring-1 result transform), so not re-verified live; left for the user per the standard e2e/manual carve-out. |
