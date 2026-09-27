# Smart Diff: role taxonomy, and where findings attach

The **Files changed** tab does not show a PR in GitHub's order. It shows it in the order a reviewer
should read it, with the latest review's findings sitting on the lines they are about.

Spec: [`specs/0010-smart-diff.md`](../specs/0010-smart-diff.md).

## The split: the server groups, the client renders findings

```
GET /pulls/:id/smart-diff        →  which file belongs to which role, in which order
usePrReviews(prId)  (already loaded)  →  every finding shown on screen
```

The route returns `finding_lines` per file, and **the UI does not read it**. That is deliberate,
and it is the one thing to understand before changing this feature.

The route reports the *latest done review's open findings*; the page holds *every run's findings*,
including dismissed ones, because the Agent runs tab needs them. If the group header counted one
set and the cards below it came from the other, a reviewer would see a header that disagrees with
what is under it. So every finding-derived pixel — the group counter, the file dot, the inline card
— comes from `usePrReviews`, which the page already loaded for the other tab. That is also why the
diff costs **no extra request and no model call**.

`finding_lines` is served because it is part of the `SmartDiff` contract and because L08 consumes
the same payload outside the browser.

## The five roles

| Role | Meaning | Collapsed by default |
|---|---|---|
| `core` | The substance of the change | no |
| `tests` | What proves it works | no |
| `wiring` | Config, barrels, CI — hooks the core into the app | no |
| `docs` | Prose | **yes** |
| `boilerplate` | Lockfiles, generated output, snapshots | **yes** |

Groups render in that order. **Empty groups are omitted** — a PR touching no docs shows no Docs
header, because an empty group reads as a bug rather than as information.

## Rule order is the decision

`server/src/modules/smart-diff/constants.ts` holds two orders, and they are not the same one:

- `ROLE_ORDER` — the display order above.
- `CLASSIFY_RULES` — the order paths are *matched* in: boilerplate, then tests, then wiring, then
  docs, with `core` as the fallback. **The first rule that matches wins and there is no tie-break.**

Three paths make that order visible, and all three are pinned in
`server/test/smart-diff-classify.test.ts`:

| Path | Role | Why |
|---|---|---|
| `__tests__/__snapshots__/x.snap` | `boilerplate` | the snapshot rule sits above the test rule |
| `.claude/skills/security/SKILL.md` | `wiring` | markdown that configures an agent is wiring, not prose |
| `e2e/README.md` | `tests` | `e2e/` is a package here, and its rule sits above every docs rule |

Directory rules match at **any depth** — `server/dist/**` must not read as `core` in this repo —
except `e2e/`, which is root-anchored because here it is a package name.

Changing a pattern without running that test table is how one path quietly moves groups.

## Where a finding lands on a line

`finding.start_line` is a line in the **post-image**, so a finding anchors to `RIGHT:<start_line>` —
the same keying `comments.ts` already used for GitHub review comments, which is why the card lines
up under the code in the same 58px rail.

A finding whose line is not in the patch (a deleted line, or a line outside the hunks) is **not
dropped and not guessed onto a `LEFT:` key**. It goes to a block at the foot of that file, exactly
as outdated comments do. A wrong anchor is worse than a listed one.

Paths are compared through `normalizeFindingPath`, which tolerates `./`, a leading `/`, and the
`a/`/`b/` prefixes a path lifted from a diff header carries. If a real run produces another
spelling, widen that function — never the call sites.

## Why the viewer knows nothing about findings

`client/src/components/diff-viewer/` is a shared component and must not import a route-local
`_components/` file. So it takes a render prop:

```ts
interface DiffFindingApi {
  findings: DiffFindingLike[];
  showFindings: boolean;
  render: (f: DiffFindingLike) => React.ReactNode;   // ← the seam
}
```

`DiffTab` fills `render` with the same `FindingCard` the Agent runs tab uses, so the two views
cannot drift. `FindingRecord` satisfies `DiffFindingLike` structurally, so the real records pass
straight through and `render` recovers the full object by id.

## Visibility

One button, two booleans. `showComments` keeps its old `false` default — the diff stays clean —
while `showFindings` starts `true`, or a reviewer would have to click before seeing the review they
just ran. The button sets both to `!(showComments || showFindings)`.

The **dot and the group counter ignore it**: a marker that disappeared with the cards would read as
"the findings are gone".

## Server placement

Smart Diff is its own module with **no repository of its own**. Both reads go through
`container.reviewRepo`, the composition root's shared repository — the sanctioned way for one module
to read another's entities without importing its internals, which
`.dependency-cruiser.cjs` (`no-cross-module-internals`) forbids.

"Latest review" is not redefined here. `latestReviewFindings` reuses the rule the PR list already
uses: the newest run that is `done` **and** actually carries a `kind='review'` review, so a newer
failed run cannot hide the last good one. Open means `dismissed_at IS NULL`.

Two empty states are normal and return `200`, not an error: a PR whose `pr_files` were never
persisted (they are written as a side effect of a detail fetch) returns empty groups, and a PR with
no review returns the full grouping with every `finding_lines` empty — which is what makes grouping
work before the first review.
