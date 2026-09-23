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
