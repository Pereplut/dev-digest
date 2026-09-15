# Findings UI

Where review findings appear in the studio, what each surface counts, and which ones allow actions.
Specs:
- [`specs/0002`](../../specs/0002-findings-list-timeline.md)
- [`client/specs/0001`](../specs/0001-review-runs-severity-filter.md)

## Surfaces
| Surface | Component | Data | Counts | Interactive? |
|---|---|---|---|---|
| PR list → FINDINGS column | `app/repos/[repoId]/pulls/_components/PRRow` + `components/findings-summary` | `PrMeta.findings_counts` (server) | Open findings of the PR's **latest run with a review** | Hover or focus opens a **read-only** popover |
| PR → Agent runs → **Timeline** tile | `…/[number]/_components/RunHistory` (`RunFindingsLine`) | `GET /pulls/:id/reviews` (already loaded by the page), `openFindingsByRun` | Open findings of **that run** | Chips aren't clickable; the hover card is read-only |
| PR → Agent runs → **Review runs** card | `ReviewRunAccordion` → `VerdictBanner` → `FindingsPanel` → `FindingCard` | `review.findings` of that run | **Every card rendered** in that run (pills) | Pills filter; each card has **Accept / Reject** |
| Run trace drawer → Findings | `RunTraceDrawer/_components/FindingsSection` | the run's reviews | none | read-only |

### Read-only popover (`components/findings-summary/FindingsPopover.tsx`)
- **Title:** `prReview.findingsSummary.inRunTitle` ("{count} findings in this run"). CSS uppercases it to **"N FINDINGS IN THIS RUN"**.
- **Each preview is plain text:**
  - severity icon (`SeverityBadge compact`)
  - title
  - category (`CategoryTag`)
  - `file:line` (`lineRange`)
  - `% conf` (`ConfidenceNum`)
  - a 2-line rationale
- **No `<button>` or link inside the card.** The `onSelectFinding` prop was removed, and tests assert `within(dialog).queryAllByRole("button")` has length 0.
- **The trigger** (the chips) is a focusable `role="button"` with an `aria-label` such as "1 critical, 1 warning". It is the disclosure control, not part of the preview. Keyboard users need it, and e2e hovers it by that name.
- **Portal:** the card is portalled to `<body>` with `position: fixed`, and clicks are stopped so `PRRow`'s row navigation never fires.
- **Lazy load on the PR list:** `usePrReviews(prId)` loads only on first open. `runFindings(reviews, pr.findings_run_id)` then narrows the result to the counted run.

### Severity pills + filter (`FindingsPanel.tsx`)
```
VerdictBanner (verdict · N findings · PR SCORE)
[▲ 1 CRITICAL] · [! 3 WARNING]              Hide low confidence ◯
FindingCard …   (Accept | Reject)
```
1. `base = visibleFindings(findings, hideLow)`: exactly the list the cards come from, sorted by severity, rejected cards included.
2. `counts = countBySeverity(base)`: a plain group-by on `severity`. **No fetch, no LLM call** on open or on toggle.
3. Pills render only for severities with `count > 0`, in order CRITICAL → WARNING → SUGGESTION, separated by `·`.
4. **Clicking a pill** sets `sevFilter` and `aria-pressed="true"`, and `shown = filterBySeverity(base, sev)`. Clicking it again clears the filter.
5. If the active severity has no cards left (for example, hidden as low confidence), `active` becomes `null` and the full list shows.

Pill number = cards of that severity below, always. That's why pills count rejected findings,
while the list and timeline chips (which count *open* findings) don't.

### Accept / Reject (`FindingCard.tsx`)
- **Placement:** both buttons sit in the card header, so every card shows them, including collapsed ones. A wrapper stops click propagation so they don't toggle the card.
- **Reject** sends the existing `dismiss` action (`useFindingAction` → `POST /findings/:id/:action`). The label is `finding.reject`, the state tag reads "rejected", and the keyboard shortcut `d` is unchanged.
- **Accept** sends `accept`. Both reflect `accepted_at` / `dismissed_at`.
- **Refresh:** after an action, `useFindingAction` invalidates the PR's reviews and the PR list, so the chips and counts update without waiting for the 60s refetch.

## i18n
All strings are in `messages/en/prReview.json`:
- `panel.severityPill.*`, `panel.severityFilter`
- `findingsSummary.inRunTitle`
- `finding.accept` / `finding.reject`
- `findingsTab.*` (the "Timeline" / "Review runs" headings)
- `reviewRun.*`
