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
```
