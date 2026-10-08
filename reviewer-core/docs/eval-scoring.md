# Eval scoring

The pure scorer spec [`0019-evals.md`](../../specs/0019-evals.md) (done) needs: given a case's
expectation(s) and one replayed review's grounded findings, compute recall, precision, citation
accuracy and a pass/fail. Server-side wiring (the batch executor, rollup, schema) is
[`server/docs/evals.md`](../../server/docs/evals.md); the UI is
[`client/docs/evals-ui.md`](../../client/docs/evals-ui.md).

## `scoreEvalCase` (`src/eval/score.ts`)

Exported from `src/index.ts` alongside the rest of the public surface
(`reviewer-core/src/index.ts`). Pure: its only import beyond types is `rangesIntersect` from
`../grounding.js` (`src/eval/score.ts:1-2`) — no LLM provider, no database client, no `node:` I/O
module. Call it only with **grounded** findings (`ReviewOutcome.review.findings`); it has no way to
tell raw model output from grounded output, so passing the wrong one silently inflates the metrics.

```ts
scoreEvalCase({
  expectationKind: 'must_find' | 'must_not_flag',
  expectations: { file, startLine, endLine }[],
  findings: Finding[],       // already grounded
  kept: number,              // ReviewOutcome.review.findings.length
  dropped: number,           // ReviewOutcome.dropped.length
}) → { recall, precision, citationAccuracy, pass }
```

## One matcher, shared with grounding

A finding "matches" an expectation when it names the same file and its `[start_line, end_line]`
range intersects the expectation's, inclusive on both ends (`score.ts:43-48`). The range comparison
itself, `rangesIntersect(aStart, aEnd, bStart, bEnd)`, is exported from `grounding.ts`
(`src/grounding.ts:52-58`) as an **O(1)** `min`/`max` comparison, normalising a reversed pair. The
grounding gate's own private `rangeIntersects(lines, start, end)` — a *set*-vs-range check, one call
per hunk line — now delegates to it (`grounding.ts:60-69`), so there is exactly one definition of
"intersects" in the package. The split matters: an eval expectation's or a finding's `end_line` is
model-controlled and unbounded, and the grounding gate's check already walks a bounded set of hunk
lines rather than the (potentially huge) range itself, for exactly that reason — `rangesIntersect`
being O(1) means a finding claiming `end_line: 2_000_000_000` costs the grounding gate the same as
one claiming `end_line: 2` (`grounding.ts:46-51,61-64`).

## Formulas, and the one that inverts

- **`recall`** — matched `must_find` expectations ÷ total `must_find` expectations (`score.ts:56-57`).
- **`precision`** — correct produced findings ÷ total produced findings (`score.ts:69-73`), where
  "correct" **depends on the case's expectation kind** and the two directions are opposites:
  - `must_find`: a finding matching an expectation is the hit.
  - `must_not_flag`: a finding matching the expectation is the **false positive the case exists to
    catch** — it does *not* count as correct. Counting it as correct would score a uniformly-failing
    batch of dismissed-derived cases as 100% precise, inverting the one signal the metric exists to
    produce (`score.ts:63-68`).
- **`citationAccuracy`** — `kept / (kept + dropped)` from the grounding gate's own counts
  (`score.ts:76`), never recomputed from the findings array itself.
- **`pass`** — computed **independently** of the three ratios, not derived from them, so a
  zero-denominator ratio (which reads `1` by convention, see below) can never make a failing case
  read as passing: `must_find` passes iff every expectation is matched; `must_not_flag` passes iff no
  finding matches the forbidden range (`score.ts:79-83`).
- **Zero-denominator rule** — any ratio with nothing to divide returns `1`, never `NaN`, `null` or
  `undefined` (`score.ts:57,73,76`): a `must_not_flag` case has no `must_find` expectations to
  recall, and a run that produced zero findings has nothing to be wrong about.

## What this cannot measure

The scorer only knows file + line-range overlap. It cannot tell a correct finding with a weak
rationale from a strong one, cannot detect a finding that cites the right line for the wrong reason,
and — because each replay is a fresh real model call — cannot distinguish genuine improvement from
run-to-run variance in an *unchanged* configuration. Nothing here reports a confidence interval.
