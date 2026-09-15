# Grounding gate

The review engine keeps only findings that point at real changed lines, and computes the score
from the findings that survive. This drops hallucinated locations before they reach the database
or the UI.

## `groundFindings(findings, diff)` (`src/grounding.ts:52`)
1. `buildLineIndex(diff)` (`:24`) maps each file in the unified diff to the set of line numbers present in its hunks.
2. For each finding, the gate checks two conditions:
   - **File not in the diff:** the finding is dropped with `"file '<path>' not present in diff"` (`:62`).
   - **No diff line inside `start_line..end_line`:** the finding is dropped with a range reason (`:76`).
3. It returns `{ kept, dropped }`, and the dropped findings keep their reasons for the run trace.

`groundingSummary(result)` (`:87`) renders `"kept/total passed"`. It is stored as `agent_runs.grounding` and
shown in the trace drawer.

## Score comes from the survivors (`src/review/run.ts:205-208`)
```ts
review: { ...merged, findings: ground.kept, score: scoreFromFindings(ground.kept) }
```
- **The model's self-reported score is never trusted.** It is recomputed from the kept findings (`scoreFromFindings` in `src/review/reduce.ts`), so the score, the findings list and the CI gate agree.
- **The Findings UI shows only grounded findings.** PR list counts, Timeline chips, Review runs pills and the trace all use them. See [`client/docs/findings-ui.md`](../../client/docs/findings-ui.md).

## Rules for changes
- Keep grounding mandatory. A "soft" mode that keeps ungrounded findings would break the score/findings agreement.
- Grounding works on the **same diff** the prompt was built from. When `sliceDiff` splits a large PR, each chunk's findings are still grounded against the full diff after reduce.
- Tests: `test/run.test.ts` (engine) and `server/test/grounding.test.ts` (server re-export).
