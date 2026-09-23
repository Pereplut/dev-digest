# Agents

Subagent definitions. Each file here is one agent: YAML frontmatter (`name`, `description`, tool
grants, `model`) followed by its system prompt. Claude Code loads them at session start; a caller
invokes one with the `Agent` tool and `subagent_type: "<name>"`, or the main agent delegates on its
own when a task matches the `description`.

Project agents (`.claude/agents/`) take precedence over personal ones (`~/.claude/agents/`), so what
is here is what the team gets. This file is the map — each agent's own file holds its actual rules.

## Catalog

| Agent | Model | Permissions | Responsibility |
|---|---|---|---|
| [researcher](researcher.md) | `sonnet` | `Read` `Grep` `Glob` `Bash` `WebFetch` `WebSearch` `TodoWrite` · **denied** `Write` `Edit` | Answers questions in two modes — **repo** (how this codebase works, where something lives, when and why it changed) and **external** (upstream docs, changelogs, issues, standards). Never decides, never edits. |
| [planner](planner.md) | `opus` | `Read` `Grep` `Glob` `Bash` `TodoWrite` · **denied** `Write` `Edit` | Turns a task into a Development Plan: scope per package, numbered steps that each name a file, its onion ring, the skill that governs it and the test to add, plus the exact verification commands. Decides *what* to build; builds nothing. |
| [implementer](implementer.md) | `sonnet` | `Read` `Grep` `Glob` `Edit` `Write` `Bash` `Skill` `TodoWrite` | Executes an approved plan across `server/` and `client/`: code, tests, the project skills that route to each touched path, and that package's typecheck/lint/tests. Verifies its own work only — does not review architecture or security. |
| [test-writer](test-writer.md) | `sonnet` | `Read` `Glob` `Grep` `Edit` `Write` `Bash` `Skill` `Agent` · declares 8 `skills:` | Writes tests for code it did not write, UI and backend — component, unit, or Docker-backed `*.it.test.ts` — then runs the suite under the green-run rule. Writes **test files only**: a production change it needs is reported, not made. |
| [architecture-reviewer](architecture-reviewer.md) | `opus` | `Read` `Grep` `Glob` `Bash` `TodoWrite` · **denied** `Write` `Edit` | Grades a change against onion rings, port/adapter rules, engine purity and frontend import direction. Every finding carries four things: the changed `file:line`, the quoted statement, the rule's `path:line`, and the `pnpm arch` line where one exists. Never fixes, never patches. |
| [plan-verifier](plan-verifier.md) | `opus` | `Read` `Grep` `Glob` `Bash` `TodoWrite` · **denied** `Write` `Edit` | Checks a finished change against the plan it was meant to implement, item by item — every step, constraint, acceptance criterion and verification claim gets a status and evidence — plus a reverse pass listing diff hunks no item explains. Reports gaps, not style. |
| [doc-writer](doc-writer.md) | `sonnet` | `Read` `Grep` `Glob` `Edit` `Write` `Bash` `Skill` `TodoWrite` | Turns a shipped feature into reference documentation, filed per the `docs/` placement table, with Mermaid diagrams where a diagram earns its place. Writes only under `docs/`; never touches `INSIGHTS.md`, `AGENTS.md` or code. |

`Bash` in the four read-only agents is for inspection only, and mostly git (`git log/blame/diff`,
`ls`, `wc`); each file states the ban on mutating commands. Reading and searching go through the
`Read`, `Grep` and `Glob` tools, not the shell: `.claude/settings.json` **denies** `cat`, `rg` and
`find`, because a prefix rule like `Bash(find:*)` also approves `find -exec …`, `find -delete` and
`rg --pre`, each of which runs an arbitrary program. That was caught by this repo's own
`/pr-self-review` on the commit that first added the allowlist.

Only `test-writer` has the `Agent` tool, and its file limits it to consulting `researcher` about
unfamiliar code — never to delegating its own work. Everything else composes through the main
session (below). `test-writer` is also the only agent using the `skills:` frontmatter key. **On
Claude Code 2.1.280 that key did not preload anything** — two `claude -p --agent` probes could not
recall the listed skills' contents (see root `INSIGHTS.md`). The key is kept as a declaration of
which skills apply to that agent, and its file tells it to load them with the `Skill` tool rather
than assume they are present. Every agent here loads skills on demand.

## Artifacts

| Agent | Input | Output |
|---|---|---|
| `researcher` | A question, plus which mode it belongs to (repo / external / both) | A research report: `## Answer`, `## Evidence` (with `path:line` or quoted URLs), `## Confidence`, and a mandatory `## Not found`. Returns `## Clarification needed` instead when the task carries no answerable question. |
| `planner` | A task, plus any existing spec or prior research | A **Development Plan**: `## Spec` · `## Scope` · `## Constraints` (each with its `path:line`) · `## Steps` · `## Skills for the implementer` · `## Verification` · `## Risks & decisions` · `## Out of scope` · `## Not found`. Not a file — the plan comes back for approval. |
| `implementer` | An approved plan or spec | Edited working tree, **plus** an **Implementation Report**: `## Changes` · `## Skills applied` · `## Deviations` · `## Verification` (command → verbatim result → green by the rule?) · `## Not done` · `## Handoff`. |
| `test-writer` | A target: code to cover, a plan's test steps, or a spec's test plan | New/edited **test files only**, plus a **Test Report**: `## Target` · `## Tests written` · `## Skills applied` · `## Verification` · `## Needs production change` · `## Not tested` (mandatory) · `## Handoff`. |
| `architecture-reviewer` | A diff (base ref) | A review: `## Scope` · `## Findings` (severity, rule, `file:line`, quoted evidence, rule source, tool evidence) · `## Rule requires` · `## Checked and clean` · `## Pre-existing / known deviations` · `## Not checked` (mandatory). |
| `plan-verifier` | A plan or spec **plus** a diff (base ref); optionally the Implementation Report | A verification: `## Plan under test` (item counts vs matrix rows) · `## Coverage matrix` (one row per item, Met/Partial/Missing/Contradicted/Unverifiable) · `## Unplanned changes` · `## Verification claims` · `## Referred` · `## Not verifiable`. |
| `doc-writer` | A finished spec, plan or diff | New/edited files under `docs/` with index rows, plus a **Documentation Report**: `## Sources` · `## Written` · `## Placement decisions` · `## Not documented` (mandatory) · `## Handoff`. |

## How they compose

```
question ──► researcher ──► report

task ──────► planner ─────► Development Plan ──► you approve ──► implementer ──► Implementation Report
                                    │                                │                    │
                                    └── skill routing ───────────────┘                    │
                                        (skill-map.json)                                  ▼
                                    ┌─────────────────────────────────────────────────────┤
                                    ▼                          ▼                          ▼
                            plan-verifier          architecture-reviewer            test-writer
                         (plan ↔ diff, item        (layering, evidence)          (coverage backfill)
                          by item)                          │
                                    └──────── fix loop ─────┘
                                                                                          │
                       spec done ──► doc-writer ──► docs/ ◄────────────────────────────────┘

                                    then: you run /pr-self-review  ──►  push / PR
```

The two reviewers read the **same** diff the implementer produced but share none of its reasoning —
that is the point. `plan-verifier` asks "was everything promised done?", `architecture-reviewer`
asks "does it sit in the right place?". Neither is the gate: `/pr-self-review` still runs, manually,
before anything is pushed.

They hand off **through the main session**, never directly — each subagent returns its result to
Claude, which passes the relevant part to the next. That is also what gives the plan a human
approval point, which phase 2 of the root [AGENTS.md](../../AGENTS.md) requires
("Agree on decisions with the user"), since a subagent cannot ask the user anything.

The contract between `planner` and `implementer` is the path→skill routing in
[`../skills/pr-self-review/skill-map.json`](../skills/pr-self-review/skill-map.json): the planner
writes each step already knowing which skill will govern that file, and the implementer loads the
same skill for the same path. Both carry the same `## Not found` / `## Not done` discipline, so an
open question survives the handoff instead of evaporating.

None of the seven may run `/pr-self-review` (manual-only), push, or open a PR — `.claude/hooks/pr-self-review-gate.py`
blocks those, and the agents are told to ask the user rather than route around it.

## Where the agents' rules come from

Three tiers, kept separate on purpose — a reader should be able to tell a cited practice from a
local convention from a judgement call.

**Upstream practice** (Anthropic docs, checked 2026-09-23):

| Rule | Source |
|---|---|
| A subagent is a narrow specialist that works in its own context and returns only a summary | [sub-agents](https://code.claude.com/docs/en/sub-agents) |
| `description` drives delegation — keep it short, say what *and* when, use "use proactively"; a 15k-token total triggers a startup warning, so detail belongs in the body | same |
| `tools` is an allowlist, `disallowedTools` a denylist applied first | same |
| Model choice is a cost lever — hence `opus` for judgement, `sonnet` for execution | same |
| Separate research and planning from implementation; hand the plan across the context boundary as a written artifact | [best-practices](https://code.claude.com/docs/en/best-practices) |
| Overlapping or excessive tools distract an agent — hence no web tools on `planner`, no `Agent` tool anywhere | [writing-tools](https://www.anthropic.com/engineering/writing-tools-for-agents) |
| Review a diff against the plan: *"Check that every requirement is implemented… Report gaps, not style preferences"* — `plan-verifier`'s whole mandate | [best-practices](https://code.claude.com/docs/en/best-practices) |
| Why a fresh reviewer beats self-review: it *"sees only the diff and the criteria you give it, not the reasoning that produced the change"* | same |
| Reviewer bias: *"A reviewer prompted to find gaps will usually report some, even when the work is sound"* — hence both reviewers are told that "nothing found" is a complete answer | same |
| Evidence bar cuts false positives: behaviour claims need *"a `file:line` citation in the source, not an inference from naming"* | [code-review](https://code.claude.com/docs/en/code-review) |
| Read-only reviewers are documented practice, not local taste — the built-in `Explore` subagent is *"read-only tools; Write and Edit are denied"* | [sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Over-long documents get half-ignored — hence `doc-writer`'s "short enough to be read" rule | [best-practices](https://code.claude.com/docs/en/best-practices) |

**This repo** (the constraints the agents encode):

| Rule | Source |
|---|---|
| The 5-phase workflow; what to read before planning; "agree with the user" before a spec is approved | [root AGENTS.md](../../AGENTS.md) |
| Do-not-touch: migrations, lockfiles, `client/src/vendor/ui` (except `nav.ts`), the dev DB volume | same |
| Per-package typecheck / lint / test commands, and the cross-package rule for `reviewer-core` and `vendor/shared` | same + each `<pkg>/AGENTS.md` |
| Onion rings and where a new file goes | [onion-architecture](../skills/onion-architecture/SKILL.md) |
| Engine purity; `wrapUntrusted()`; mandatory grounding | [reviewer-core/AGENTS.md](../../reviewer-core/AGENTS.md) |
| Path→skill routing | [skill-map.json](../skills/pr-self-review/skill-map.json) |
| The `CRITICAL` / `WARNING` / `SUGGESTION` rubric, and "skill labels are not verdicts" — reused verbatim by `architecture-reviewer` so its results compare with the gate's | [pr-self-review](../skills/pr-self-review/SKILL.md) |
| Where each document lands, and the `docs/` ↔ `specs/` ↔ `INSIGHTS.md` split | [root AGENTS.md](../../AGENTS.md), [docs/README.md](../../docs/README.md), [specs/README.md](../../specs/README.md) |
| Diagrams | [mermaid-diagram](../skills/mermaid-diagram/SKILL.md) |
| The green-run rule (a non-zero `skipped` count is not a pass), typecheck-vs-tests independence, the client value-import trap, "lint is clean" ≠ new code was linted | root and per-package `INSIGHTS.md` |
| `/pr-self-review` is manual-only; the gate blocks push and PR creation | [AGENTS.md](../../AGENTS.md), `.claude/hooks/pr-self-review-gate.py` |

**Not sourced — local judgement**, recorded so nobody mistakes it for documented practice:

- The *planner-subagent → implementer-subagent* composition itself. Upstream documents
  session→session (write a spec, start a fresh session) and the reverse direction (a subagent
  reviewing a finished diff against a plan), not this.
- The mandatory `## Not found` / `## Not done` sections. Our own invention, and the part that has
  earned its keep: it is what distinguishes "this does not exist" from "I could not look".
- Returning a `## Clarification needed` report instead of asking — forced by subagents having no way
  to prompt the user.
- The tool-call budgets (~25–30) and the specific opus/sonnet split.

## Agents vs skills

[`../skills/README.md`](../skills/README.md) has the full comparison. Short version: a **skill** is
knowledge pulled into the *current* agent's context when it becomes relevant; an **agent** is a
*separate* context with its own model, tools and system prompt. Reach for an agent when the work
would pollute the caller's context, or when it needs tighter permissions than the caller has —
`researcher`, `planner`, `architecture-reviewer` and `plan-verifier` are read-only by construction
and cannot touch the tree whatever they
are asked.

## Adding an agent

One `<name>.md` file here, plus a row in the catalog and the artifacts table above.

- `tools` is an **allowlist**; omitting it inherits everything, which is rarely what you want.
- `disallowedTools` is a denylist applied before `tools`. Setting both is redundant, but it keeps
  the intent legible if someone widens `tools` later.
- `model`: `sonnet`, `opus`, `haiku`, `fable` or `inherit`.
- Subagents **cannot invoke slash commands** — never write a prompt that depends on one.
- Give it a report format. An agent that returns prose forces the caller to re-read what it read.

**Testing a new agent:** it is *not* loadable in the session that created it — the registry resolves
at session start. A fresh process sees it immediately, so verify with
`claude -p --agent <name> "<task>"` from the repo root; an unknown name fails fast and prints the
full available list. (`claude agents --json` lists running *sessions*, not definitions.)

## Not covered by CI

`scripts/check-claude-skills.sh` validates `.claude/skills/*/SKILL.md` frontmatter, catalog links,
the hooks and `settings.json` — it does **not** walk this directory. Agent frontmatter here is
unvalidated, so a typo in `name` or `tools` fails silently at load time rather than in CI.
