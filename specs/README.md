# specs — repo-wide

Feature specs for work that spans **more than one package** (single-package
specs go in `<pkg>/specs/`). A spec describes how things **will be**; once
shipped, set `status: done` and move lasting explanation into `docs/`.

File name: `NNNN-short-name.md`. Template:

```markdown
---
title: Run cost badge
status: draft        # draft | approved | in-progress | done
lesson: L01          # optional
packages: [server, client]
---

## Problem
## Scope / non-goals
## Design
## Acceptance criteria
## Test plan
## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | | request read, specs + INSIGHTS checked |
| Planning | | spec approved, decisions |
| Implementation | | |
| Validation | | typecheck · lint · tests · e2e · manual |
| Completion | | status done, docs, insights wrap-up |
```

## Index
| Spec | Status | Packages |
|---|---|---|
| [0001-run-cost-badge](0001-run-cost-badge.md) | in-progress | server, client, e2e |
| [0002-findings-list-timeline](0002-findings-list-timeline.md) | done | server, client, e2e |
| [0003-hw-validation-alignment](0003-hw-validation-alignment.md) | done | all |
