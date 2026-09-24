---
title: Smart Diff
status: in-progress  # draft | approved | in-progress | done
lesson: L03
packages: [server, client]
---

## Problem

The **Files changed** tab renders a PR's files in the order GitHub returned them, so
`pnpm-lock.yaml` sits between two files of business logic and the reviewer decides what matters by
reading path names. The review result lives on a different tab — **Agent runs** — so relating a
finding to the code it is about means switching tabs, finding the file again, and scrolling to the
line. Nothing tells the reviewer where to start or what is safe to skim.

Most of the plumbing already exists and is wired to nothing:

| Piece | Where | State |
|---|---|---|
| `SmartDiffRole`, `SmartDiffFile`, `SmartDiffGroup`, `SmartDiff` | `contracts/brief.ts:80-113` | exist, **3 roles only** |
| `SmartDiffResponse` | `contracts/review-api.ts:151-153` | exists, **no producer, no consumer** |
| `smartDiff.*` UI copy | `client/messages/en/prReview.json:59-68` | exists, **referenced by nothing** |
| `SmartDiff` round-trip test | `server/test/contracts.test.ts:110-121` | passes, shape only |
| `"intent/smart-diff"` as a future module | `server/src/modules/index.ts:23` | doc comment only |
| Route, classifier, service, UI | — | absent |
| Comment anchoring under a code line | `diff-viewer/comments.ts:63-106` | exists, reusable verbatim |

So this spec wires and extends existing scaffolding rather than designing from zero.

## Scope / non-goals

**In scope.** Classify every changed file into one of five roles with a pure, HTTP-free function;
serve the grouping over `GET /pulls/:id/smart-diff` against the existing `SmartDiff` contract; render
the groups in the Files changed tab with role labels, file counts and an Original-order escape
hatch; and bring the latest review's findings into the diff in three places — a files-with-findings
counter on the group header, a dot on the file card, and the finding itself under its code line with
working Accept / Dismiss.

**Non-goals.** `pseudocode_summary` (the "What this does" line in the prototype screenshot). A real
`split_suggestion` heuristic — it is filled minimally and nothing consumes it. Repo-intel
enrichment via `getFileRank`, although its own comment already advertises it for smart-diff
(`repo-intel/service.ts:421`). A new e2e flow. Reconciling the drift between the two vendored
contract copies beyond the one file this spec touches. Any new model call — see AC 9.

## Decisions (agreed with the user 2026-09-24)

1. **Classification runs on the server**, as a pure `classifyFile(path)` plus a route, not in the
   browser. The classifier must import and run without HTTP because L08 reuses it as a filter before
   prompt assembly; a client-side implementation would have to be written twice.
2. **Its own module, `modules/smart-diff/`, with no repository of its own.** It reads through
   `container.reviewRepo`, which the container (`platform/container.ts:80-84`) and the onion skill
   both name as the sanctioned cross-module channel. This adds no SQL, imports no other module's
   internals, and keeps the classifier a neutral leaf that `reviews/` can later import without
   coupling itself to `pulls/`.
3. **Rule order is the decision, not the patterns.** First matching rule wins, and the evaluation
   order is deliberately *not* the display order. Three rulings are pinned in the test table:
   `__tests__/__snapshots__/x.snap` → `boilerplate` (the snapshot rule outranks the test rule),
   `.claude/skills/security/SKILL.md` → `wiring` (markdown that configures an agent is wiring, not
   documentation), and `e2e/README.md` → `tests` (`e2e/**` outranks `**/*.md`).
4. **The client is the single source of truth for every finding-derived pixel.** The route's
   `finding_lines` is served for contract compliance and for L08; the dot, the group counter and the
   cards all come from `usePrReviews`, which the page already loads. Mixing the two would let the
   header disagree with the cards below it — see risk 2.
5. **One button, two booleans, for visibility.** `showComments` keeps its documented `false`
   default (`DiffTab.tsx:23`) and `showFindings` defaults to `true`; the button sets both to
   `!(showComments || showFindings)`.
6. **Empty groups are omitted.** A PR with no docs showing an empty "Docs" header reads as a bug.

## Design

### Contract

`SmartDiffRole` widens from three values to five:

```ts
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
```

Nothing else in the contract changes — `SmartDiffFile`, `SmartDiffGroup`, `SmartDiff` and
`SmartDiffResponse` are already the right shape. The edit is made in the canonical copy
(`server/src/vendor/shared/contracts/brief.ts`) and mirrored **byte-identically** into
`client/src/vendor/shared/contracts/brief.ts`; the two files are identical today
(`md5 4eee43d438b6be87f1158ffaf2f77bea`) and must stay so.

### The classifier

`modules/smart-diff/constants.ts` holds both the display order and the rule table, which is what
P2 asks for:

- `ROLE_ORDER` — `core, tests, wiring, docs, boilerplate`, the order groups are rendered in.
- `CLASSIFY_RULES` — an ordered `{ role, re }[]` evaluated top to bottom: the seven boilerplate
  rules (lockfiles, `dist/`, `build/`, `__snapshots__/`, `*.snap`, `*.generated.*`, `*.min.js`),
  then tests, then wiring, then docs. Plain `RegExp`, so the file stays a dependency-free leaf.

`modules/smart-diff/classify.ts` exports `classifyFile(path): SmartDiffRole` — pure, no DB, no
`this`, no HTTP, modelled on `modules/pulls/status.ts`. It normalises to POSIX and strips `./` and
leading slashes first, because the L08 caller will not always hand it GitHub's spelling, then walks
`CLASSIFY_RULES` and falls back to `core`.

Directory rules match at any depth (`server/dist/**` must not classify as core in this repo); only
`e2e/**` is root-anchored, because here it is a package name.

### The route

`GET /pulls/:id/smart-diff` → `SmartDiffResponse`, in `modules/smart-diff/routes.ts`. Params are
validated by the shared `IdParams`; the response shape is the handler's return-type annotation, as
everywhere else in this repo — there are no `response:` schemas anywhere, so the contract-validation
criterion is met by a test that runs `SmartDiff.parse()` on the real response.

The service checks the workspace **before** any read (`repo.getPull(workspaceId, prId)` → 404
otherwise; a cross-workspace read is the failure mode this repo treats as critical), then reads
`getPrFiles(prId)` and the latest review's open findings, then calls the pure
`buildSmartDiff(files, findings)`.

`buildSmartDiff` buckets files by role, emits buckets in `ROLE_ORDER` skipping empty ones, preserves
the incoming GitHub order *within* each group — which is what makes "Original order" a pure
re-flattening — sets `finding_lines` from each finding's `start_line` (deduped, ascending) and fills
`split_suggestion` minimally: `{ too_big: false, total_lines: Σ(additions + deletions),
proposed_splits: [] }`.

**"Latest review"** reuses the rule the rest of the app already uses
(`pulls/repository/pull.repo.ts:285-306`): the newest **done** run that actually carries a
`kind='review'` review, so a newer failed or review-less run cannot hide it. Open means
`dismissed_at IS NULL`. The one new query, `latestReviewFindings(workspaceId, prId)`, is added to
`ReviewRepository` rather than re-derived in JS, so that rule exists once.

Two states are normal, not errors: **no `pr_files` rows** (they are written as a side effect of a
detail fetch) returns empty groups with `total_lines: 0`, and **no review yet** returns the full
grouping with every `finding_lines` empty. The second is what makes grouping work before the first
review.

### The client

`useSmartDiff(prId)` sits beside `usePullByNumber` in `lib/hooks/core.ts`. Its `enabled: !!prId`
matters: `prId` exists only once the PR-detail query resolved, and that call is what populates
`pr_files`.

**The diff viewer stays generic.** `components/diff-viewer/` is shared and must not import a
route-local component, so findings arrive through a render prop mirroring the existing
`DiffCommentApi`: a new pure `diff-viewer/findings.ts` exports `DiffFindingApi
{ findings, showFindings, render(f) }` plus `keyForFinding` (`RIGHT:${start_line}`),
`normalizeFindingPath` and `partitionFindings(findings, renderedKeys) → { matched, offPatch }` —
the same shape as `partitionThreads`, which is how an off-patch finding ends up listed at the foot
of the file instead of vanishing. `FindingRecord` is structurally assignable to the viewer's
minimal `DiffFindingLike`, so `DiffTab` passes the real records straight through and its `render`
closes over the full record by id.

Anchoring is `RIGHT:<start_line>` only. A finding on a deleted line, or outside the patch, goes to
the off-patch block rather than being guessed onto a `LEFT:` key — a wrong anchor is worse than a
listed one.

Three existing components change: `DiffViewer` keys its children by `file.path` instead of the array
index (index keys scramble each card's open state the moment the list is regrouped) and forwards two
new props; `FileCard` takes `defaultOpen` (the `AUTO_EXPAND_MAX_LINES` heuristic is otherwise
`useState`-initialised and cannot be overridden) and a findings dot next to the path, kept visually
separate from the existing message-icon count of human GitHub comments; `CodeLine` draws the left
severity stripe and the right-hand label and renders the finding under the row in the same 58px rail
(`cs.thread`) the comment threads use, so a finding lines up under the code exactly like a comment.

**Grouping is route-local.** The role labels are `prReview.smartDiff.*` keys while everything inside
`diff-viewer/` speaks the `shell` namespace, so the group header lives under `DiffTab/_components/`
and the join from group paths to `PrFile` objects lives in a pure `DiffTab/helpers.ts`. Paths in
`pr.files` that no group covered render as a final unlabelled section — `pr.files` comes live from
GitHub while the route reads the DB copy, so the two lists can genuinely differ and nothing may be
silently dropped.

The severity words on a line are `blocker / warning / suggestion`, which is not what the shared
`SEV[].label` says (`Critical / Warning / Suggestion`), so they are new i18n keys; the colour still
comes from `SEV[severity].c` and no new palette is introduced.

## Acceptance criteria

1. Files changed shows groups in the order core → tests → wiring → docs → boilerplate, each with a
   role label and a file count. (P1)
2. A lock file is classified `boilerplate`; docs and boilerplate are collapsed on open. (P1)
3. After Run review, each group header shows a counter of **files** that have findings — two files
   holding five findings show `2`. (P1)
4. A file with findings shows a dot beside its path, distinct from the GitHub-comment counter. (P1)
5. Expanding such a file shows, under the finding's line, its severity, title and explanation. (P1)
6. **Original order** restores GitHub's order. (P1)
7. Patterns and role order live in one constants file, and a `path → role` unit table covers the
   three deliberate rulings from decision 3. (P2)
8. The route's response passes `SmartDiff.parse()`, and the enum is widened in both `brief.ts`
   copies, which remain byte-identical. (P2)
9. Viewing Smart Diff makes no model call, and grouping works before the first review. (P2)
10. A line with a finding carries a severity-coloured stripe and the label blocker / warning /
    suggestion. (P2)
11. Accept / Dismiss in the inline card change the finding's persisted state. (P2)
12. A finding whose line is not in the patch appears in a block at the end of that file rather than
    disappearing. (P2)
13. One button hides both the findings and the GitHub comments. (P2)
14. A PR in another workspace returns 404 from the route.

## Test plan

- **server unit** — `test/smart-diff-classify.test.ts`: a `path → role` table written *before* the
  implementation, carrying the three deliberate rulings plus nested lockfiles, `server/dist/index.js`
  (the `dist` rule must outrank the barrel rule), `.it.test.ts`, `e2e/flows/*.flow.json`, bracketed
  Next.js route paths, and the `core` fallback; plus two guard tests — `ROLE_ORDER` as a set equals
  `SmartDiffRole.options`, and every rule's role is a member of it. That pair is what fails loudly if
  the enum is widened in one copy only. `test/smart-diff-build.test.ts`: group order, empty groups
  omitted, `finding_lines` deduped and ascending, `total_lines`, and zero files.
- **server integration** — `test/smart-diff.it.test.ts`: seeds a repo, PR, `pr_files`, a done run, a
  review and findings; asserts `SmartDiff.parse()` on the real response (AC 8), the lock file in
  `boilerplate`, `finding_lines` on the core file, a dismissed finding excluded, a PR with no review
  returning the same groups with empty `finding_lines` (AC 9), and 404 across workspaces (AC 14).
- **client** — `diff-viewer/findings.test.ts` (pure: key building, off-patch partitioning, path
  normalisation, two findings on one line); `FileCard.test.tsx` (`defaultOpen={false}` beats the
  auto-expand heuristic, the dot, the off-patch block); `CodeLine.test.tsx` (stripe, label, gated
  rendering); `DiffGroupHeader.test.tsx` (labels, file count, `2` for two files with five findings);
  `DiffTab.test.tsx` (group order, collapsed roles, Original order restores the incoming order,
  fallback when the query returns nothing, the single visibility button); `DiffTab/helpers.test.ts`
  (the path join, leftovers, files-not-findings counting).
- **e2e** — no new flow; the existing `05-pr-diff` and `10-pr-finding-actions` must stay green, and
  the three tab labels must not change since flows click them by accessible name.
- **manual** — the dev app: the five groups, the collapsed roles, Run review, the counter, the dot,
  the inline card, Accept/Dismiss, and the Original-order toggle. `pnpm build` in `client/` is part
  of verification, not optional: a value import from `@devdigest/shared` passes typecheck and vitest
  and only fails in the Next build.

## Risks

1. **Two sources of truth for findings.** The route returns `finding_lines` (latest done review,
   open only) while the UI renders from `usePrReviews` (all runs, including dismissed). They can
   disagree. Mitigated by decision 4 — the route drives grouping only — but a later reader will be
   tempted to "fix" the redundancy, so it is written down here.
2. **Finding paths may not match `PrFile.path`** (a leading `./`, a diff `a/`/`b/` prefix, an
   absolute path from a model), which would silently hide findings. `normalizeFindingPath` plus its
   unit test is the mitigation; extend it there, never at a call site.
3. **The dot and the group counter ignore the visibility toggle** — only the inline cards and the
   off-patch block honour it, so hiding annotations cannot look like it deleted data.
4. **`FileCard.open` stays uncontrolled**, so `defaultOpen` applies at mount only and switching
   Smart ↔ Original resets manual expansions. Making it controlled is a larger refactor than this
   feature justifies.
5. **Open vs. all findings** for the dot and counter: open (`dismissed_at IS NULL`) is chosen so
   dismissing the last finding clears the dot, matching the PR list's counts. The brief says only
   "files with findings"; this is a one-line change if the grader reads it the other way.
6. **AC 1 says five groups; empty ones are omitted** by decision 6, so a PR touching only three
   roles shows three headers. Deliberate, and the demo PR is built to populate all five.
7. **`pnpm arch` is not in CI** — the boundary rules that justify the module placement only run in
   local `pnpm lint`, so validation has to be run locally.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-24 | brief + screenshots read; specs and INSIGHTS checked; found the contract, the i18n and the anchoring machinery already present and unwired |
| Planning | 2026-09-24 | Explore ×3, Plan ×1; 6 decisions; module placement revised to `modules/smart-diff/` once `container.reviewRepo` was confirmed as the sanctioned seam |
| Implementation | 2026-09-24 | contract widened in both copies; `modules/smart-diff/` (constants, classify, helpers, service, routes) + `latestReviewFindings` on the shared review repo; client `useSmartDiff`, `diff-viewer/findings.ts`, DiffViewer/FileCard/CodeLine, OffPatchFindings, DiffGroupHeader, DiffTab; `docs/smart-diff.md` |
| Validation | 2026-09-24 | server typecheck · lint (incl. `pnpm arch`) · 368 unit · 8 integration; reviewer-core 63; client typecheck · lint · 229 · `pnpm build`; e2e and the dev-app check still owed |
| Completion | | status done, docs, insights wrap-up |
