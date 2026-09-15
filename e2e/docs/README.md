# docs — e2e

Durable e2e reference: runner internals, hermetic stack details, locator
strategy notes. Flow format and coverage stay in [`../README.md`](../README.md);
planned work goes in [`../specs/`](../specs/README.md).

| Doc | What |
|---|---|
| [`hermetic-stack.md`](hermetic-stack.md) | What `./scripts/e2e.sh` boots, the seeded values flows assert, cleanup/restore |
| [`locators.md`](locators.md) | Allowed deterministic commands and confirmed agent-browser gotchas (uppercase text, `--exact`, `wait --fn`, no `focus`) |
