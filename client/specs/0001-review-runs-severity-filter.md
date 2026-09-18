---
title: Review runs severity pills, read-only previews, Accept/Reject
status: done  # draft | approved | in-progress | done
lesson: L01
packages: [client]
parent: specs/0003-hw-validation-alignment.md
---

## Problem
On the PR page, a user can't see at a glance how many findings of each severity a review run
produced, and can't narrow a run's findings to one severity. The findings previews on the PR
list and Timeline were clickable buttons, although they should be read-only. Finding actions
were labelled Accept / Dismiss and appeared only on the expanded card.

## Scope / non-goals
- **In scope:** homework criteria 16–22 on the client:
  - the pills and filter in the Review runs card
  - read-only popovers
  - Accept/Reject on every card
  - the "N findings in this run" title on the PR list
  - moving the Agent runs tab strings into i18n
- **Non-goals:**
  - a severity filter on the PR list or Timeline
  - persisting the filter in the URL
  - new server endpoints

## Design
See [`client/docs/findings-ui.md`](../docs/findings-ui.md).
- **`FindingsPanel`:**
  - `base = visibleFindings(findings, hideLow)`
  - `counts = countBySeverity(base)`
  - pills for severities with a count above 0, as `<button aria-pressed>`
  - `shown = filterBySeverity(base, active)`
  - the filter clears itself when its severity has no cards left
- **`FindingsPopover`:** the `onSelectFinding` prop is removed and items render as `<div>`. `PRRow` and `RunHistory` no longer navigate from the preview.
- **`PRRow`:** `runFindings(reviews, pr.findings_run_id)`; title key `findingsSummary.inRunTitle`.
- **`FindingCard`:** Accept and Reject move into the header and don't propagate clicks. Reject = the `dismiss` action.

## Acceptance criteria
- [x] **Pills:** the expanded Review runs card shows "N CRITICAL · N WARNING · N SUGGESTION" under the verdict and PR SCORE, only for severities that are present.
- [x] **Counts:** each pill's number equals the finding cards of that severity rendered below.
- [x] **Filter:** clicking a pill shows only that severity; clicking it again restores the full list.
- [x] **No network:** counts come from a group-by over loaded findings, with no request on open or on toggle.
- [x] **PR list popover:** titled "N FINDINGS IN THIS RUN".
- [x] **Read-only previews:** severity icon, title, category, file:line, % confidence and rationale, with no buttons.
- [x] **Accept and Reject:** present on every card in the Review runs card.

## Test plan
- **`FindingsPanel.test.tsx`:** pill numbers equal the cards; toggling; no pill for absent severities; interaction with the hide-low toggle; rejected findings are counted.
- **`FindingsPopover.test.tsx`, `PRRow.test.tsx`, `RunHistory.test.tsx`:** the dialog has no buttons, and clicks don't navigate.
- **`FindingCard.test.tsx`:** a collapsed card shows Accept and Reject; Reject calls `dismiss` without expanding the card.
- **e2e:** flow 02 (list popover title) and flow 04 (pills, filter toggle, Reject visible).

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-15 | Audit: no pills or filter; preview items were buttons; "Dismiss" only when expanded |
| Planning | 2026-09-15 | Pills count the cards' own list (rejected included) so criterion 17 holds exactly |
| Implementation | 2026-09-15 | FindingsPanel, FindingsPopover, PRRow, RunHistory, FindingCard, i18n |
| Validation | 2026-09-15 | typecheck ✓, vitest 76/76 ✓ |
| Completion | 2026-09-15 | `docs/findings-ui.md` + `docs/run-cost-ui.md`; e2e flows 02/04 pass 7/7; client build ✓ |
