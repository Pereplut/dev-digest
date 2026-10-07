# docs — client

Durable client reference: screen/component deep dives, state and data-fetching
notes, ADRs (`adr/NNNN-title.md`). The route map stays in [`../README.md`](../README.md);
planned work goes in [`../specs/`](../specs/README.md).

| Doc | What |
|---|---|
| [`findings-ui.md`](findings-ui.md) | Where findings appear (PR list chips + read-only popover, Timeline, Review runs pills + severity filter, Accept/Reject, trace), and what each surface counts |
| [`run-cost-ui.md`](run-cost-ui.md) | `RunCostBadge` states and where the PR list, Timeline and trace drawer read cost from |
| [`pr-brief-ui.md`](pr-brief-ui.md) | The PR Brief block: why the envelope's snapshot is never rendered, how `summary` avoids rendering twice, and the review-focus deep link into Files changed |
