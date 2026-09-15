# docs — reviewer-core

Durable engine reference: prompt assembly, grounding rules, structured-output
repair, map-reduce, ADRs (`adr/NNNN-title.md`). The pipeline overview stays in
[`../README.md`](../README.md); planned work goes in [`../specs/`](../specs/README.md).

| Doc | What |
|---|---|
| [`cost-aggregation.md`](cost-aggregation.md) | Per-call `costUsd` (OpenRouter `usage.cost` / injected estimator) summed per run; one unpriced call → null |
| [`grounding.md`](grounding.md) | `groundFindings()` drops findings off the diff; the score is recomputed from survivors |
