# PR Brief: the Overview block

Shipped by spec [0018](../../specs/0018-pr-brief.md) (commits `ad877b5`, `6614db5`). The block
that renders the generated summary, risk list and reading order at the top of the PR Overview tab.
How the envelope is produced and grounded: [`server/docs/pr-brief.md`](../../server/docs/pr-brief.md).

`PrBriefBlock` (`src/app/repos/[repoId]/pulls/[number]/_components/PrBriefBlock/PrBriefBlock.tsx`)
reads `GET /pulls/:id/brief` on mount via `usePrBrief` and issues `POST /pulls/:id/brief` only when
Generate or Refresh is clicked (`useGenerateBrief`, `lib/hooks/brief.ts`) — never on mount, so
opening a PR page spends no model call.

## The snapshot inside the envelope is never rendered

`PrBrief` requires `intent`, `blast`, `risks` and `history` (see the server doc), so every stored
envelope carries a full copy of the intent classification and the blast-radius result **as they
were at generation time**. The block reads none of it: `PrBriefBlock.tsx` pulls only `summary`,
`risks.risks`, `review_focus`, `missing_inputs` and the `stale` flag off the response
(`PrBriefBlock.tsx:4-7,44-48`). `PrIntentCard` and `BlastRadiusCard` keep their own live hooks
(`OverviewTab.tsx:37-39`) and are unaffected by whether a brief exists at all.

This is a provenance/replay field, not a display one — and the two copies can disagree. On a stale
brief (the stored `head_sha` no longer matches the PR's current head), the snapshotted `intent` and
`blast` can describe an earlier version of the PR while the live cards describe the current one.
Nothing on screen says so: the live cards win because nothing renders the alternative, and the
divergence is invisible by design, not by oversight.

## `summary` renders exactly once

A brief's `summary` has two possible hosts, and the block picks exactly one per render
(`PrBriefBlock.tsx:84-95`):

```tsx
{finishedReview && (
  <VerdictBanner verdict={finishedReview.verdict} summary={brief?.summary ?? null} ... />
)}
{brief && !finishedReview && <p style={s.summary}>{brief.summary}</p>}
```

`finishedReview` is non-null exactly when the pull request has at least one finished review,
computed by the page from `reviews`/`allFindings` and passed down (`OverviewTab.tsx:18-19,29`) —
never read off the brief envelope. So:
- a PR with a finished review shows `summary` inside `VerdictBanner`, and the block's own paragraph
  is suppressed;
- a PR with no finished review shows the paragraph, and no banner is rendered at all (`VerdictBanner`
  requires a non-null `verdict`, so there is nothing to render it with).

The seeded PR (`#482`) has a finished review, so a naive unconditional paragraph plus an
unconditional banner would show the same sentence twice on the one PR every test and flow exercises
— the mutually-exclusive condition above is what prevents that.

## The deep link into Files changed

Activating a review-focus row calls `onFocusFile(item.file)` (`PrBriefBlock.tsx:161`), which the
page wires to `setParams({ tab: "diff", file })` — a single `router.replace` setting both query
keys at once (`page.tsx:75-84`), because two sequential single-key updates would each overwrite the
other's pending navigation.

`DiffTab` reads that `file` as `focusPath` and threads it down to every `DiffViewer`/`DiffGroup`
it renders (`DiffTab.tsx:49,210-223`). A role group that is collapsed by default still opens when
the target file lives inside it (`DiffTab.tsx:249-251`, `COLLAPSED_ROLES`) — otherwise the file
would expand invisibly behind a closed group. `FileCard` is where the expand-and-scroll actually
happens: on mount, if `focusPath === file.path`, it forces `open` to `true` and calls
`scrollIntoView` on its root ref (`FileCard.tsx:79-95`). This is mount-time-only behaviour — `DiffTab`
unmounts on every tab switch, so there is no "second click while already on the tab" case to
support. A `file` value matching nothing in `files[]` renders the diff unchanged, with no error.

## Where to look

| Concern | File |
|---|---|
| The block: rendering, the summary host choice, risk/focus lists | `_components/PrBriefBlock/PrBriefBlock.tsx` |
| Data hooks | `lib/hooks/brief.ts` |
| Overview wiring, `finishedReview` computation | `_components/OverviewTab/OverviewTab.tsx`, `pulls/[number]/page.tsx` |
| The deep link's query-param plumbing | `pulls/[number]/page.tsx:60-84` |
| Deep-link target: group expansion | `_components/DiffTab/DiffTab.tsx` |
| Deep-link target: card expand + scroll | `src/components/diff-viewer/FileCard/FileCard.tsx` |
| i18n strings | `messages/en/brief.json` |
| e2e coverage (seeded, read-only) | `e2e/flows/13-pr-brief.flow.json` |
