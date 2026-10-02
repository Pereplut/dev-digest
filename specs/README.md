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
supersedes: specs/NNNN-old-name.md   # optional
---

## Problem & why
## Goals / Non-goals
## User stories
## Acceptance criteria (EARS)
## Edge cases
## Non-functional
## Inputs (provenance)
## Untrusted inputs
## [NEEDS CLARIFICATION]
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

Section notes:

- **Acceptance criteria (EARS)** — one `AC-N` per criterion, in [EARS](https://alistairmavin.com/ears/)
  form: *ubiquitous* (`shall`), *event-driven* (`WHEN …`), *state-driven* (`WHILE …`),
  *unwanted behaviour* (`IF … THEN …`), *optional feature* (`WHERE …`). One `shall` each, a named
  component rather than "the system", and an outcome a test can assert. IDs are unique within the
  spec and are never reused, even after a criterion is deleted. Every ID reappears in
  `## Test plan`.
- **Test plan** — the first column claims coverage, so **enumerate identifiers there, never a
  range**: `AC-1, AC-2, AC-3`, not `AC-1..AC-3`. Nothing in this repo expands a range, and
  [`plan-verifier`](../.claude/agents/plan-verifier.md) enumerates `AC*` by identifier — a range
  reads fine to a human and hides those criteria from every machine that checks them. Prose in the
  second column is free to mention anything; only the first column is read as a coverage claim.
- **Inputs (provenance)** — where each input comes from, tagged `[reused: L0X]` (built in an
  earlier lesson), `[deterministic: <how>]` (computed in code, no LLM), `[llm]`, or `[new]`.
- **Untrusted inputs** — anything a stranger wrote that this feature reads (PR text, diffs, file
  contents, repo names). Name the `wrapUntrusted()` / `groundFindings()` obligation from
  [`reviewer-core/AGENTS.md`](../reviewer-core/AGENTS.md). Write "None, because …" rather than
  deleting the section.
- **[NEEDS CLARIFICATION]** — open questions; delete the heading once it empties. A `## Decisions`
  table (`| Question | Decision | Consequence |`) may follow `## Goals / Non-goals` once they are
  answered.
- **Phases** — filled in as the work moves, one row per workflow phase.

`specs/0013-spec-creator.md` is the worked example. The 12 specs numbered below it predate this
template and keep their original `## Problem / ## Scope / ## Design` shape; they are not retrofitted.
[`spec-creator`](../.claude/agents/spec-creator.md) writes new specs in this format.

**`bash scripts/check-specs.sh`** enforces the mechanical half of the above: the section set (read
from the template block on this page, not copied), unique `AC-N` identifiers, every identifier
enumerated in `## Test plan`, and an index row. A spec is checked only if it carries
`## Acceptance criteria (EARS)`, so the 16 older specs — 12 here, four under `<pkg>/specs/` — are
exempt by construction. What it deliberately does not check is in its own docstring.

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
| [0011-mcp-server](0011-mcp-server.md) | draft | mcp, server |
| [0012-blast-radius](0012-blast-radius.md) | done | server, client, mcp, e2e |
| [0013-spec-creator](0013-spec-creator.md) | draft | .claude, specs, design |
| [0014-implementation-planner](0014-implementation-planner.md) | done | .claude, specs |
| [0015-impl-skill](0015-impl-skill.md) | in-progress | .claude, scripts, specs |
| [0016-project-context](0016-project-context.md) | draft | server, client, reviewer-core |
| [0017-onboarding-generator](0017-onboarding-generator.md) | approved | server, client, e2e |
