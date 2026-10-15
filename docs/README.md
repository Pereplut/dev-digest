# docs — repo-wide

Durable, cross-package reference: how things **are**. Package-specific docs live
in `<pkg>/docs/`; planned work lives in [`../specs/`](../specs/README.md).

| Path | What |
|---|---|
| [`agent-prompts/`](agent-prompts/README.md) | Reviewer agent system prompts and model choice |
| [`skills.md`](skills.md) | Skills: data model, prompt placement, import and trust |
| [`conventions.md`](conventions.md) | Conventions Extractor: sampling without a model, evidence proof, the merge fingerprint |
| [`smart-diff.md`](smart-diff.md) | Smart Diff: the role taxonomy and its rule order, and where findings attach in the diff |
| [`export-to-ci.md`](export-to-ci.md) | Export to CI: the PR it opens, the workflow and runner, pull-based ingest, trust checks, data model |
| [`adr/0001-pull-based-ci-ingest.md`](adr/0001-pull-based-ci-ingest.md) | ADR: poll GitHub for CI results instead of a webhook |
| [`adr/0002-ship-runner-bundle-into-target-repo.md`](adr/0002-ship-runner-bundle-into-target-repo.md) | ADR: ship the whole runner bundle into the target repo |
| `adr/NNNN-title.md` | Architecture decision records (context → decision → consequences) |
