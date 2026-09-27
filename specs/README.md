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
| [0004-agents-md](0004-agents-md.md) | done | all |
| [0005-pr-self-review](0005-pr-self-review.md) | done | .claude, scripts |
| [0006-agent-skills](0006-agent-skills.md) | in-progress | server, client, reviewer-core, e2e, .claude |
| [0007-conventions-extractor](0007-conventions-extractor.md) | in-progress | server, client, e2e |
| [0008-intent-layer](0008-intent-layer.md) | in-progress | server, client, reviewer-core |
| [0009-prompt-assembly-logging](0009-prompt-assembly-logging.md) | done | server, reviewer-core |
| [0010-smart-diff](0010-smart-diff.md) | in-progress | server, client |
