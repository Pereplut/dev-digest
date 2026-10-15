# Evals UI

The client half of spec [`0019-evals.md`](../../specs/0019-evals.md) (done): one `FindingCard`
control and the Agent editor's Evals tab. Server wiring (routes, executor, schema) is
[`server/docs/evals.md`](../../server/docs/evals.md); scoring is
[`reviewer-core/docs/eval-scoring.md`](../../reviewer-core/docs/eval-scoring.md). The Eval Dashboard
page, trend charts and the compare modal are **not built** — spec 0020.

## "Turn into eval case" (`FindingCard`)

A third header control, alongside Accept/Reject, that posts `POST /eval-cases`
(`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:116-145`).
It is deliberately **local state only** — `evalCreated`/`evalError` — and does not go through the
card's `onAction`/`FindingActionKind` prop (`FindingCard.tsx:35,43,67-73`); the member list of
`FindingActionKind` stays `accept | dismiss | learn | reply`. Disabled whenever the finding has
neither `accepted_at` nor `dismissed_at` (`FindingCard.tsx:60-62`): the derived `expectation_kind`
needs one of those two timestamps, so the control simply cannot fire before a decision exists.

On success the control renders a confirmation and disables itself "for the remainder of the page
session" — i.e. for as long as this component instance stays mounted, via `useState`
(`FindingCard.tsx:51,69`), not a server flag. A remount (e.g. the PR-detail list re-filters and
re-renders the card) re-enables it; the real backstop is server-side — a second `POST /eval-cases`
for the same finding hits the `eval_cases_owner_source_uq` partial index and comes back `409`, so a
reload can defeat the client's disable but never create a second case
(server doc, "Schema"). On failure the control stays enabled and renders the API envelope's
`error.message` inline (`FindingCard.tsx:70,145`).

## The Evals tab

`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` — a `SkillsTab`-shaped
sibling (`EvalsTab.tsx`, `helpers.ts`, `styles.ts`, `constants.ts`). Registered as a fourth tab,
`{ key: "evals", labelKey: "editor.tabs.evals" }`
(`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:16`), resolving the pre-existing
`agents.json` key rather than adding a second one.

### Two different "latest batch"s

`GET /agents/:id/eval-runs` returns an agent's batches newest-first; the tab never re-sorts them
(`helpers.ts:9-11`). But the five metric tiles and the case list's pass state must not read a
`cancelled` or still-`queued`/`running` batch as a result — a cancelled sweep's partial numbers stay
on its own row but must never masquerade as a measurement. So the tab keeps **two** derived values:

- `latestBatch(batches)` → `batches[0]`, used only to detect whether something is currently live
  (`helpers.ts:9-11,24-26`).
- `latestCompletedBatch(batches)` → the first entry with `status === 'done'`, scanning the server's
  own newest-first order (`helpers.ts:20-22`) — this is what feeds the tiles and the case list.

A `cancelled`-newest / `done`-older pair is the component test's negative control for exactly this
split (`EvalsTab.test.tsx`).

### Progress reuses the review stream, verbatim

Live progress (`k/cases_total`) comes from `useRunEvents([latest.id])`
(`client/src/lib/hooks/reviews.ts`) — the same hook a review run's live log uses — passed the
batch id as if it were a run id, because the server reuses the same SSE route unchanged (server doc,
"Reusing the review SSE route"). No new event-stream hook exists for evals. The displayed count comes
from a structured field the executor attaches to every per-case verdict event
(`data.evalCase.{index,total}`), not from matching the human-readable message text
(`helpers.ts:76-109`) — matching on prose would silently stop advancing the moment that string is
reworded or translated.

### Refetch on stream completion — not a cosmetic detail

The stream's own `running` flag, not the cached `latest.status`, is the only signal a sweep just
ended. Nothing else automatically refetches the batch list or detail when an SSE stream closes, so
without the tab's own effect a finished (or failed) run would never surface: `live` would stay `true`
forever, "Run all evals" would stay disabled, and the tiles would keep showing placeholders until a
manual reload (`EvalsTab.tsx:56-69`). This was found and fixed during `/code-review` as a MAJOR —
it is edge-case prose in the spec, not an `AC-N` line, so it was invisible to the plan's own
criteria gate. The `wasRunning` ref guard exists to stop the effect from re-invalidating on every
subsequent render once it has already fired once (`EvalsTab.tsx:61-66`).

### Cost tile and the spend confirmation

`formatCostTile` renders the i18n placeholder (never `NaN`/`null`) whenever `cost_usd` is `null` —
which happens whenever any one case in the batch ran on a model absent from the price table
(server doc, "Batch rollup and the null-cost rule") — and otherwise mirrors `formatUsd`'s number
formatting at sub-cent precision (`helpers.ts:41-47`). "Run all evals" opens a confirmation naming the
exact case count before issuing `POST /agents/:id/eval-runs`
(`EvalsTab.tsx:150-169`); the control itself is disabled whenever the agent has zero cases or a batch
is already live (`EvalsTab.tsx:96`).

## Not documented

- **Accessibility and empty-catalogue behaviour** (every string resolving through `next-intl`, pass
  state conveyed by text as well as colour) are asserted by `EvalsTab.test.tsx` and read-consistent
  with the code above, but are not elaborated further here — they are mechanical applications of the
  same pattern documented elsewhere in this package, not new behaviour worth a separate claim.
