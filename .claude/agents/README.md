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
| [researcher](researcher.md) | `sonnet` | `Read` `Grep` `Glob` `Bash` `WebFetch` `WebSearch` `TodoWrite` · **denied** `Write` `Edit` | **Phase 1, before `spec-creator`.** Answers questions in two modes — **repo** (how this codebase works, where something lives, when and why it changed) and **external** (upstream docs, changelogs, issues, standards). Never decides, never edits. |
| [spec-creator](spec-creator.md) | `opus` | `Read` `Grep` `Glob` `Write` `Edit` `Skill` `TodoWrite` · **hook-bound** to `specs/**/*.md` | Writes the phase-2 spec before any plan exists, loading the [spec-authoring](../skills/spec-authoring/SKILL.md) skill for the method: problem, goals/non-goals, user stories, acceptance criteria in **EARS** form, edge cases, input provenance, untrusted inputs. Reads UI mockups from `design/` and reports what they do not cover. Decides *what* is being built; never files, layers or code, and never approves its own spec. |
| [implementation-planner](implementation-planner.md) | `opus` | `Read` `Grep` `Glob` `Bash` `TodoWrite` · **denied** `Write` `Edit` | Turns an **approved** spec into a Development Plan: a requirements audit giving every criterion a verdict and the step that satisfies it, numbered steps that each name a file, its onion ring, the skill that governs it and the test to add, the exact verification commands, improvements as costed proposals, and a recommended execution mode. Decides *how* it gets built; builds nothing, and never touches a spec. |
| [implementer](implementer.md) | `sonnet` | `Read` `Grep` `Glob` `Edit` `Write` `Bash` `Skill` `TodoWrite` | Executes an approved plan across `server/` and `client/`: code, tests, the project skills that route to each touched path, and that package's typecheck, lint and **unit** tests. The Docker `.it.test` lane and e2e are the user's. Verifies its own work only — does not review architecture or security. |
| [test-writer](test-writer.md) | `sonnet` | `Read` `Glob` `Grep` `Edit` `Write` `Bash` `Skill` `Agent` · declares 8 `skills:` | Writes tests for code it did not write, UI and backend — component, unit, or Docker-backed `*.it.test.ts` — then runs the unit suite, plus any `.it.test` it wrote **one file at a time**, under the green-run rule. Writes **test files only**: a production change it needs is reported, not made. |
| [architecture-reviewer](architecture-reviewer.md) | `sonnet` | `Read` `Grep` `Glob` `Bash` `TodoWrite` · **denied** `Write` `Edit` | Grades a change against onion rings, port/adapter rules, engine purity and frontend import direction — **layering, not correctness**; bugs are `/code-review`'s question. Every finding carries four things: the changed `file:line`, the quoted statement, the rule's `path:line`, and the `pnpm arch` line where one exists. Never fixes, never patches. |
| [plan-verifier](plan-verifier.md) | `sonnet` | `Read` `Grep` `Glob` `Bash` `TodoWrite` · **denied** `Write` `Edit` | Checks a finished change against the plan it was meant to implement, item by item — every step, constraint, acceptance criterion and verification claim gets a status and evidence — plus a reverse pass listing diff hunks no item explains. **Runs first among the reviewers** — it is the completeness gate, and the only thing that can see a planned step which produced no diff. Reports gaps, not style. |
| [doc-writer](doc-writer.md) | `sonnet` | `Read` `Grep` `Glob` `Edit` `Write` `Bash` `Skill` `TodoWrite` | **Phase 5, after the reviewers are clean.** Turns a shipped feature into reference documentation, filed per the `docs/` placement table, with Mermaid diagrams where a diagram earns its place. Writes only under `docs/`; never touches `INSIGHTS.md`, `AGENTS.md` or code. |

`Bash` in the four read-only agents is for inspection only, and mostly git (`git log/blame/diff`,
`ls`, `wc`); each file states the ban on mutating commands. Reading and searching go through the
`Read`, `Grep` and `Glob` tools, not the shell: `.claude/settings.json` **denies** `cat`, `rg` and
`find`, because a prefix rule like `Bash(find:*)` also approves `find -exec …`, `find -delete` and
`rg --pre`, each of which runs an arbitrary program. That was caught by this repo's own
`/pr-self-review` on the commit that first added the allowlist.

Two things about that settings file are easy to misread:

- **The `Read(...)` denies bind to the `Read` tool only.** `.env`, `~/.ssh`, `~/.aws` and the
  credential stores (`~/.config/gh`, `~/.npmrc`, `~/.git-credentials`, …) cannot be opened with
  `Read`, and cannot be written either. A shell reader — `cat`, `head`, `tail` — is *not* denied;
  it is simply absent from `allow`, so it prompts. The guarantee is "the Read tool cannot open
  these, and a human sees any shell attempt", not "these files are unreachable".
- **`WebFetch` is domain-scoped**, so `researcher` can reach Claude/Anthropic docs, GitHub and this
  stack's doc sites without a prompt, and anything else is refused. `WebSearch` stays unscoped; a
  query string does reach the search provider.

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
| `spec-creator` | A feature request, optionally with mockups under `design/<feature>/`. It has no `Bash`, so the session must run `bash scripts/check-specs.sh` on what it files | A spec file on disk (`status: draft`, index row added), **plus** a **Spec Report**: `## Spec written` · `## Acceptance criteria` (ID → EARS pattern → test) · `## Design gaps` · `## Uncovered edge cases` · `## Module interactions` · `## UX proposals` · `## Checked and ruled out` · `## Clarification needed` · `## Not specified`. The four analysis tables are proposals — only what the user accepts is folded into the spec on a follow-up turn. |
| `implementation-planner` | A task **plus a spec whose `status:` is `approved` or `in-progress`** | A **Development Plan**: `## Task` · `## Requirements source` · `## Requirements review` (`R1..`, one verdict each) · `## Scope` · `## Constraints` (each with its `path:line`) · `## Steps` · `## Skills for the implementer` · `## Verification` · `## Recommendations` (`P1..`, costed, never in `## Steps`) · `## Clarification needed` · `## Out of scope` · `## Not found` · `## Execution mode` (mandatory, last). Not a file — the plan comes back for approval. Returns `## No spec` and **no plan** when nothing governs the task. |
| `implementer` | An approved plan or spec | Edited working tree, **plus** an **Implementation Report**: `## Changes` · `## Skills applied` · `## Deviations` · `## Verification` (command → verbatim result → green by the rule?) · `## Not done` · `## Handoff`. |
| `test-writer` | A target: code to cover, a plan's test steps, or a spec's test plan | New/edited **test files only**, plus a **Test Report**: `## Target` · `## Tests written` · `## Skills applied` · `## Verification` · `## Needs production change` · `## Not tested` (mandatory) · `## Handoff`. |
| `architecture-reviewer` | A diff (base ref) | A review: `## Scope` · `## Findings` (severity, rule, `file:line`, quoted evidence, rule source, tool evidence) · `## Rule requires` · `## Checked and clean` · `## Pre-existing / known deviations` · `## Not checked` (mandatory). |
| `plan-verifier` | A plan or spec **plus** a diff (base ref); optionally the Implementation Report. **Runs first among the reviewers** | A verification: `## Plan under test` (item counts vs matrix rows) · `## Coverage matrix` (one row per item, Met/Partial/Missing/Contradicted/Unverifiable) · `## Unplanned changes` · `## Verification claims` · `## Referred` · `## Not verifiable`. |
| `doc-writer` | A finished spec, plan or diff | New/edited files under `docs/` with index rows, plus a **Documentation Report**: `## Sources` · `## Written` · `## Placement decisions` · `## Not documented` (mandatory) · `## Handoff`. |

## How they compose

```
      researcher ─► facts      (phase 1 — settle what the spec will assert;
           │                a guessed criterion is one nobody can fail)
           ▼
feature ─► spec-creator ─► spec (draft) + questions ─► you answer ─► spec-creator edits
  + design/     ▲                                                                      │
        loads the spec-authoring skill (EARS, edge cases, provenance)                  │
                                                                                       ▼
                                          YOU approve: status: approved | in-progress  │
                                                                                       │
task + that spec ──────────────────────────────────────────────────────────────────────┘
  │
  ▼
implementation-planner ─► Development Plan
  │    ## Requirements review · ## Steps · ## Constraints · ## Verification ·
  │    ## Recommendations · ## Clarification needed · ## Execution mode
  └────────────────────────────┐
                               ▼
                    YOU decide with AskUserQuestion:
                    multi-agent, or single-agent?
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
          single-agent                      multi-agent
  one implementer context,          implementer × package, parallel
  S1..Sn in order, own tests        only where the file sets differ
              │                                 │
              └────────────────┬────────────────┘
                               ▼
                     Implementation Report
                               │
                               ▼
                        plan-verifier            ◄── GATE, runs first
                 (plan ↔ diff, item by item;         and cheapest
                  base origin/main)
                               │
            Missing / Contradicted ─► back to implementer
                               │
                       all Met ▼
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    architecture-reviewer  /code-review     test-writer
      (layering only)      (correctness)    (backfill, if the
              │                │             plan asked for it)
              └────────────────┼────────────────┘
                               ▼
                        fix loop, then
               plan-verifier again if tests were added
                               │
                               ▼
                spec done ─► doc-writer ─► docs/
                               │
                               ▼
            then: YOU run /pr-self-review ─► push / PR
```

**`plan-verifier` goes first, and the ordering is load-bearing.** It is read-only and answers a
cheaper question than anyone else: *was everything promised actually done?* Nothing else can —
`/pr-self-review` reviews changed lines, so an absent step produces no diff and therefore no
reviewer. Running the expensive passes before it grades a half-built module and has `test-writer`
write tests against code that is about to change. A `Missing` or `Contradicted` item means the diff
is not ready for review; only once the matrix is clean do the three passes run, in parallel, on the
**same** diff and sharing none of the implementer's reasoning — that is the point of all three.

They divide by question, not by seniority: `architecture-reviewer` asks "does it sit in the right
place?", `/code-review` asks "is it correct?", `test-writer` asks "is it covered?". Keep that split
in mind when reading a clean report — **`architecture-reviewer` finding nothing says nothing about
bugs**, and before `/code-review` joined this chain a logic error with correct layering and passing
tests reached the gate unopposed. None of them is the gate: `/pr-self-review` still runs, manually,
before anything is pushed.

The mode fork is new and it is the user's: `implementation-planner` recommends one and spells out
both decompositions, and the main session asks with `AskUserQuestion` before any implementation
starts. Neither the agent nor the session picks it.

They hand off **through the main session**, never directly — each subagent returns its result to
Claude, which passes the relevant part to the next. That is also what gives the plan a human
approval point, which phase 2 of the root [AGENTS.md](../../AGENTS.md) requires
("Agree on decisions with the user"), since a subagent cannot ask the user anything.

The contract between `implementation-planner` and `implementer` is the path→skill routing in
[`../skills/pr-self-review/skill-map.json`](../skills/pr-self-review/skill-map.json): the planning
agent writes each step already knowing which skill will govern that file, and the implementer loads
the same skill for the same path. Both carry the same `## Not found` / `## Not done` discipline, so
an open question survives the handoff instead of evaporating.

None of the eight may run `/pr-self-review` (manual-only), push, or open a PR — `.claude/hooks/pr-self-review-gate.py`
blocks those, and the agents are told to ask the user rather than route around it.

## The one enforced boundary

`spec-creator` is the only agent whose write scope is **enforced** rather than asked for.
`doc-writer` and `test-writer` state their limits in prose (`doc-writer.md:23`, "You may write
only: `docs/**`") and nothing checks them. `.claude/hooks/spec-scope-gate.py` denies every
`Write`/`Edit`/`MultiEdit`/`NotebookEdit` from `spec-creator` whose resolved target is not
`specs/**/*.md` or `<pkg>/specs/**/*.md`.

It works because a `PreToolUse` hook can see who is calling. Measured here on CLI 2.1.285, three
runs of a throwaway agent:

| Caller | `agent_id` | `agent_type` |
|---|---|---|
| The main session's own `Write` | absent | absent |
| `Agent` tool, `subagent_type: <name>` | set | `"<name>"` |
| `claude -p --agent <name>` | absent | `"<name>"` |

So `agent_type` is the key to use and `agent_id` is not — it is absent in `--agent` mode. A
`permissions.deny` entry could not do this job: permission rules cannot be scoped to an agent, so
denying `Write(server/**)` would deny it to the main session too, and an allow rule cannot carve an
exception out of a deny. Agent frontmatter has no path key either. The same probe showed that a
`hooks:` block **in agent frontmatter** does fire, and only for that agent — a viable alternative,
not used here because one hook in `settings.json` is one place to look.

**What the boundary is worth.** It closes `Write` and `Edit`, which are the only ways
`spec-creator` can write, *because its `tools:` list grants no `Bash` (a shell redirect reaches any
path) and no `Agent` (it could delegate the write)*. That coupling is invisible to the hook, so
`test_spec_scope_gate.py` pins the tool list: widen it and a test fails, rather than the boundary
quietly becoming decorative. Content is **not** policed — "never write `status: approved`" is a
prompt rule with nothing behind it.

`Skill` was added to that list on 2026-10-01, deliberately and after checking rather than by
assumption. It is not in the test's `WRITE_CAPABLE` set and does not belong there: a skill is
instructions, it cannot write, and the scripts some skills ship need the `Bash` this agent still
lacks. So the agent can load [spec-authoring](../skills/spec-authoring/SKILL.md) for the method
while the gate stays exactly where it was. If a future tool is added, check it against the same two
questions — can it write, and can it run something that writes — before trusting the boundary.

## Where the agents' rules come from

Three tiers, kept separate on purpose — a reader should be able to tell a cited practice from a
local convention from a judgement call.

**Upstream practice** (Anthropic docs, checked 2026-09-23):

| Rule | Source |
|---|---|
| A subagent is a narrow specialist that works in its own context and returns only a summary | [sub-agents](https://code.claude.com/docs/en/sub-agents) |
| `description` drives delegation — keep it short, say what *and* when, use "use proactively"; a 15k-token total triggers a startup warning, so detail belongs in the body | same |
| `tools` is an allowlist, `disallowedTools` a denylist applied first | same |
| Model choice is a cost lever — hence `opus` for judgement, `sonnet` for execution, though cost can override the split outright: `architecture-reviewer` and `plan-verifier` are judgement agents that run `sonnet` here because the cost saving was the point of that change, not a reclassification of what they do | same |
| Separate research and planning from implementation; hand the plan across the context boundary as a written artifact | [best-practices](https://code.claude.com/docs/en/best-practices) |
| Overlapping or excessive tools distract an agent — hence no web tools on `implementation-planner`, no `Agent` tool anywhere | [writing-tools](https://www.anthropic.com/engineering/writing-tools-for-agents) |
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

- The *spec-creator → implementation-planner → implementer* chain itself. Upstream documents
  session→session (write a spec, start a fresh session) and the reverse direction (a subagent
  reviewing a finished diff against a plan), not this.
- Relaying the **execution-mode** choice: the planning agent recommends one decomposition, spells
  out both, and the main session asks with `AskUserQuestion`. Upstream documents neither the fork
  nor the relay.
- Refusing to plan at all without an approved spec. It is a prompt rule with nothing behind it —
  unlike `spec-creator`'s write boundary there is no hook, because an agent holding no `Write`
  cannot produce a spec file by accident. What it *can* still do is plan from a draft, and only its
  own prompt stops it.
- The mandatory `## Not found` / `## Not done` sections. Our own invention, and the part that has
  earned its keep: it is what distinguishes "this does not exist" from "I could not look".
- Returning a `## Clarification needed` report instead of asking — forced by subagents having no way
  to prompt the user. `spec-creator` extends it into a round trip: it files a draft with
  `## [NEEDS CLARIFICATION]`, the main session asks the user, and the agent is resumed with the
  answers and edits the same file. Upstream documents neither the loop nor the relay.
- Enforcing an agent's write scope with a `PreToolUse` hook keyed on `agent_type`. The payload
  fields are documented; using them as a per-agent permission layer is ours, and it is only as good
  as the `tools:` list it is paired with.
- Keeping the analysis (`## Design gaps`, `## UX proposals`, …) out of the spec file and in the
  report, so an agent's suggestions need a human "yes" before they become requirements.
- The tool-call budgets (~25–30) and the specific opus/sonnet split.

## Agents vs skills

[`../skills/README.md`](../skills/README.md) has the full comparison. Short version: a **skill** is
knowledge pulled into the *current* agent's context when it becomes relevant; an **agent** is a
*separate* context with its own model, tools and system prompt. Reach for an agent when the work
would pollute the caller's context, or when it needs tighter permissions than the caller has —
`researcher`, `implementation-planner`, `architecture-reviewer` and `plan-verifier` are read-only by
construction and cannot touch the tree whatever they are asked.

## Adding an agent

One `<name>.md` file here, plus a row in the catalog and the artifacts table above.

- `tools` is an **allowlist**; omitting it inherits everything, which is rarely what you want.
- `disallowedTools` is a denylist applied before `tools`. Setting both is redundant, but it keeps
  the intent legible if someone widens `tools` later.
- `model`: `sonnet`, `opus`, `haiku`, `fable` or `inherit`.
- Subagents **cannot invoke slash commands** — never write a prompt that depends on one.
- Give it a report format. An agent that returns prose forces the caller to re-read what it read.
- To bound *where* it writes, a `PreToolUse` hook on `agent_type` is the only mechanism (see above),
  and it holds only while the `tools:` list grants nothing else that writes — `Bash` and `Agent`
  both defeat it. Pin the tool list in a test, or the boundary decays silently.

**Testing a new agent:** it is *not* loadable in the session that created it — the registry resolves
at session start. A fresh process sees it immediately, so verify with
`claude -p --agent <name> "<task>"` from the repo root; an unknown name fails fast and prints the
full available list. (`claude agents --json` lists running *sessions*, not definitions.)

## Not covered by CI

`scripts/check-claude-skills.sh` validates `.claude/skills/*/SKILL.md` frontmatter, catalog links,
the hooks and `settings.json` — it does **not** walk this directory. Agent frontmatter here is
unvalidated, so a typo in `name` or `tools` fails silently at load time rather than in CI.

A `name:` that does not match its filename is therefore uncaught — unlike skills, which fail at
`scripts/check-claude-skills.sh:86-89`. After renaming an agent file, probe it from a fresh process
(see **Testing a new agent**); nothing else will tell you.
