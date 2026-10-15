# docs — server

Durable server reference: module deep dives, data model notes, ADRs
(`adr/NNNN-title.md`). The overview and API map stay in [`../README.md`](../README.md);
planned work goes in [`../specs/`](../specs/README.md).

| Doc | What |
|---|---|
| [`run-cost.md`](run-cost.md) | Where a run's USD cost comes from, how it's stored, and the PR list's total over all successful runs |
| [`findings-counts.md`](findings-counts.md) | The PR list's open finding counts per severity for the latest run with a review |
| [`intent-layer.md`](intent-layer.md) | Why a PR was opened: the cheap-model classifier, its server-computed confidence band, quote verification, and the two untrusted hops |
| [`prompt-logging.md`](prompt-logging.md) | The `prompt assembled` debug record: what each section contributes, and why no section text is ever logged |
| [`pr-brief.md`](pr-brief.md) | PR Brief generation: the one-call pipeline, the budget and grounding filters, and why the stored envelope is a deliberate schema overflow |
| [`evals.md`](evals.md) | The eval batch executor: schema, the new-executor decision, cost-null propagation, the one-terminal-status guarantee, boot reap, and reusing the review SSE route |
| [`multi-agent-review.md`](multi-agent-review.md) | Multi-agent fan-out: the one-transaction parent/child rows, why validation is a 400 in the service, `Promise.allSettled` isolation, the grouping rule, and the `GET /agents` estimates |
| [`adr/0001-group-findings-by-line-overlap.md`](adr/0001-group-findings-by-line-overlap.md) | ADR: group findings across agents by file and line overlap, not text similarity |
