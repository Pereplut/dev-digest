# 0001 — Group multi-agent findings by file and line overlap, not by text

Status: accepted · Shipped by [spec 0021](../../../specs/0021-multi-agent-review.md)
(first server ADR; scope: `server/`).

## Context
Several agents review the same diff and each emits its own findings. The results page needs to show
where they agree and where they disagree, so findings from different agents must be matched.
Finding titles, rationales and categories are model-written free text: the same issue is phrased
differently by every agent, and different issues can share a title.

## Decision
Match by geometry only. Two findings are one group when they share a file and their line ranges,
widened by 2 lines on each side, overlap, transitively
(`server/src/modules/reviews/multi-agent-grouping.ts:16,99`). No text similarity, no embeddings, no
model call. Groups are computed on read, not stored.

## Consequences
- Deterministic and unit-testable without a database or a model; output is identical for any
  permutation of the input (`server/test/multi-agent-grouping.test.ts`).
- Free: no extra LLM cost or latency per page view, and no new prompt-injection surface, since nothing
  model-written is fed back into a model.
- Different issues on overlapping lines land in one group; each finding stays visible with its author.
  Rephrasings of one issue on distant lines stay in separate groups. Both are accepted losses.
- The +/-2 tolerance is a constant, not a setting. Changing it needs no migration because nothing is stored.
- A semantic matcher can replace `groupFindings` later without touching the routes or the contract.

## Amendment 2026-10-15
Overlap alone let a file-wide finding swallow everything inside it. A link now also requires the two
ranges' lengths to be within 3× of each other (`MAX_LENGTH_RATIO`). Still geometry only, still no text.
