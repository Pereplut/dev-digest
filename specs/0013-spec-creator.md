---
title: spec-creator — the agent that writes specs
status: draft        # draft | approved | in-progress | done
packages: [.claude, specs, design]
---

## Problem & why

Phase 2 of the root [`AGENTS.md`](../AGENTS.md) requires a spec, and nothing in the repo writes
one. `implementation-planner` refuses by design — *"You never touch a spec"*
(`.claude/agents/implementation-planner.md:40`) — because phase 2 also requires decisions to be
**agreed with the user**, and a subagent cannot ask them anything
(`.claude/agents/README.md:123`). So specs are
written by hand, and the seven that carry `status: draft` or `in-progress` in the index — this spec
among them — show how often that step is skipped under time pressure.

The template made it easy to skip well. `## Acceptance criteria` had no required form, so the 16
specs that predate it — 12 in `specs/`, four in `<pkg>/specs/` — state their criteria as prose,
five of them as `- [x]` checkboxes, and not one in EARS form:
`server/specs/0001-pr-list-cost-all-runs.md:35` reads *"Cost responds correctly to new runs"* —
true, useful to a human, and not something a test can fail. A criterion that cannot fail cannot be
traced to a test, which is why `plan-verifier`'s coverage matrix has to infer what a spec meant
rather than read it.

The cost lands twice: an implementer re-derives the requirements from a plan that never had them,
and a reviewer cannot tell a missing feature from a feature nobody specified.

## Goals / Non-goals

**Goals**

- An agent that writes the phase-2 spec **before** `implementation-planner` runs, so requirements precede
  technical decisions.
- Acceptance criteria in **EARS** form (Mavin, Wilkinson, Harwood, Novak — IEEE RE'09), so each one
  separates its trigger from the system's obligation and names an outcome a test can assert.
- A spec that carries its own open questions instead of hiding them, and a round trip that closes
  them through the user.
- Analysis of mockups under `design/`: the states they do not show, the edge cases they do not
  cover, the module contracts they imply, and UX improvements — delivered as **proposals**.
- A write boundary that is **enforced**, not requested: the agent can write specs and nothing else.

**Non-goals**

- Retrofitting the 12 existing specs. They keep their `## Problem / ## Scope / ## Design` shape.
- Deciding files, layers, onion rings or commands. That is `implementation-planner`
  (renamed and re-scoped by [spec 0014](0014-implementation-planner.md)).
- Approving a spec. `status: approved` is the user's, always.
- Figma or any live design tool. Mockups arrive as image files.
- A CI check over `.claude/agents/` frontmatter. There is none today for any agent; adding one is
  its own piece of work.
- Guarding spec **content**. The gate polices paths, not what a spec says.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| Template: adopt the slide's sections, or keep the repo's? | Merge — the repo wrapper (frontmatter, `NNNN-short-name.md`, index row, `## Phases`, `## Test plan`) keeps the slide's body sections inside it | `specs/README.md` changes once; the 12 older specs stay as they are and are not retrofitted |
| How does an agent that cannot prompt the user ask a question? | Agent + relay: it files a draft with `## [NEEDS CLARIFICATION]`, the main session asks, the agent is resumed with the answers and edits the same file | The agent keeps its own context; the user keeps the approval point phase 2 requires |
| What counts as a "design" it analyses? | Mockup images, the existing repo code and UI, and a prose description — not Figma links | No new permission scope; `Read` renders the images |
| How hard is the write boundary? | A `PreToolUse` hook, not prose | The first enforced agent boundary in the repo; it costs the agent its `Bash` tool (see below) |
| Language of the spec file | English, like every spec before it | EARS keywords stay `WHEN` / `WHILE` / `IF…THEN` / `WHERE` / `shall` |
| Where does it sit relative to the planning agent? | Before it — spec first, plan second | The agent (renamed `implementation-planner` by [spec 0014](0014-implementation-planner.md)) gains a spec to read instead of inferring one — and now refuses to plan without an approved one |
| Are mockups committed to the repo? | Yes, under `design/<feature>/` | A spec's visual evidence travels with the repo; nothing in the tooling depends on it, so it can be reversed later |
| Does the agent fill the `lesson:` frontmatter key? | No — it leaves it out | Nothing in the repo maps a lesson number to anything, so filling it would be a guess. The user adds it when it matters |

## User stories

- As a developer starting a feature, I want a spec whose acceptance criteria I can hand to a test
  writer unchanged, so that I do not re-derive the requirements while implementing.
- As a developer with a mockup, I want to be told which screen states it never draws, so that I
  find the empty and error states before the review does.
- As a reviewer, I want every criterion to name the test that checks it, so that I can tell an
  unimplemented requirement from an unspecified one.
- As the repository owner, I want the spec-writing agent unable to touch code, so that delegating
  requirements work carries no risk to the tree.

## Acceptance criteria (EARS)

| ID | Criterion | Pattern |
|---|---|---|
| **AC-1** | The `spec-creator` agent shall write every new spec with the section set defined in `specs/README.md`. | ubiquitous |
| **AC-2** | Every acceptance criterion the agent writes shall carry an `AC-N` identifier that is unique within its spec. | ubiquitous |
| **AC-3** | Every acceptance criterion the agent writes shall be referenced by its identifier in that spec's `## Test plan`. | ubiquitous |
| **AC-4** | The agent shall never write `status: approved`. | ubiquitous |
| **AC-5** | WHEN the agent creates a spec file, it shall add a row for it to that directory's `README.md` index. | event-driven |
| **AC-6** | WHEN `spec-creator` issues a `Write`, `Edit`, `MultiEdit` or `NotebookEdit` whose resolved target is not `specs/**/*.md` or `<pkg>/specs/**/*.md`, the PreToolUse gate shall deny the call and return a reason naming the allowed paths. | event-driven |
| **AC-7** | WHEN the gate evaluates a target, it shall resolve symlinks and `..` segments before matching, so that the decision follows where the path lands rather than how it is written. | event-driven |
| **AC-8** | WHEN the agent receives answers to its clarification questions, it shall edit the same spec file, add one `## Decisions` row per answer, and remove the answered items from `## [NEEDS CLARIFICATION]`. | event-driven |
| **AC-9** | WHILE a spec has an unanswered question, the agent shall keep that question in `## [NEEDS CLARIFICATION]` and keep `status: draft`. | state-driven |
| **AC-10** | IF a hook payload carries no `agent_type`, THEN the gate shall allow the call unchanged. | unwanted behaviour |
| **AC-11** | IF the gate has attributed a call to `spec-creator` but cannot resolve its target, THEN the gate shall deny the call. | unwanted behaviour |
| **AC-12** | IF a write of the agent's is denied, THEN the agent shall report the denial verbatim as the first line of its reply and stop, without reproducing the spec body in the reply. | unwanted behaviour |
| **AC-13** | IF `spec-creator`'s `tools:` list gains a tool that writes files by another route (`Bash`, `Agent`, `Task`, `NotebookEdit`), THEN `test_spec_scope_gate.py` shall fail. | unwanted behaviour |
| **AC-14** | WHERE mockups exist under `design/<feature>/`, the agent shall report every screen state its `## Reading a design` checklist covers that the mockups do not show. | optional feature |
| **AC-15** | WHERE the agent proposes a design change, a UX improvement or an extra edge case, it shall place it in its report and not in the spec file. | optional feature |

## Edge cases

| Case | Handling |
|---|---|
| The task is too vague to specify | No file is written. The agent returns `## Clarification needed` alone (AC-9 does not apply — there is no spec yet). |
| An mcp-only spec is the right answer | `mcp/` has no `specs/` directory. The agent creates it with a `README.md` modelled on `client/specs/README.md`; the gate allows it, since `mcp/specs/README.md` matches `<pkg>/specs/**/*.md`. |
| Two specs are opened in the same directory concurrently | Numbering collides. `NNNN` is taken from the directory listing at write time; a collision is the user's to resolve, and the index row makes it visible. |
| The spec supersedes an older one | `supersedes:` in frontmatter. The agent does not edit the superseded file — it cannot say `status: done` on someone else's spec. |
| A mockup shows a state the code cannot produce | It becomes a `## Design gaps` row, not a criterion. A criterion whose trigger does not exist is unfalsifiable. |
| `design/<feature>/` is empty or absent | AC-14 does not fire. The agent says so in `## Not specified` rather than inventing screens. |
| The agent runs out of budget mid-spec | It files what it has with `## [NEEDS CLARIFICATION]` and `## Not specified` populated. A short spec with visible holes beats a long one with invisible ones. |
| A `specs` directory is a symlink pointing outside the repo | Denied — AC-7 resolves before matching. |
| The hook receives a malformed payload | Allowed, and the call is not gated. The caller may be the main session, and denying its writes because a payload was unreadable is a worse failure than not gating one call. |

## Non-functional

- **Latency.** The gate runs on every `Write`/`Edit` in every session, so it must stay cheap: no
  imports beyond the standard library, and no subprocess. The comparable `pr-self-review-gate.py`
  measured 41 ms per call, of which ~17 ms is bare interpreter startup (root `INSIGHTS.md`,
  2026-09-23); this hook does strictly less work than that one.
- **Security.** The boundary is a narrowing of one agent, never a repo-wide lock: it must fail open
  for the main session (AC-10) and closed for the agent (AC-11).
- **No CI coverage of the agent itself.** `scripts/check-claude-skills.sh` validates skills and
  `settings.json` but does not walk `.claude/agents/`, so this agent's frontmatter is unvalidated
  and a typo in `name` or `tools` fails silently at load. AC-13's test is the only thing standing
  in for it.
- **Enforcement coverage: 9 of 15 criteria.** The hook and its suite carry AC-6, AC-7, AC-10, AC-11
  and AC-13; `scripts/check_specs.py` carries AC-1, AC-2, AC-3 and AC-5 by reading the spec on disk.
  The remaining six (AC-4, AC-8, AC-9, AC-12, AC-14, AC-15) are prompt behaviour with nothing behind
  them. AC-4 in particular stays deliberately unenforced: guarding spec *content* is a non-goal, so
  "never write `status: approved`" is a prompt rule and the gate will not catch a violation.
- **The spec checker is structural only.** It answers "is this spec shaped like a spec", never "is
  this criterion well-formed EARS" or "does the named test exist". Its docstring states that ceiling
  rather than listing gaps, per root `INSIGHTS.md` (2026-09-23) — a gap list is a promise that
  everything absent from it is covered.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| The feature request | The user, or the calling session | `[new]` | The only input with no fixed shape. |
| Mockups | `design/<feature>/*.png` | `[new]` | Read as images; one state per file. |
| The spec template and section rules | `specs/README.md` | `[deterministic: read from the repo]` | Single source; the agent restates it but does not own it. |
| Existing specs and their numbering | `specs/`, `<pkg>/specs/` | `[deterministic: directory listing]` | `NNNN` is the next free number in that directory. |
| Repo conventions and the do-not-touch list | root `AGENTS.md`, `<pkg>/AGENTS.md` | `[reused: spec 0004 — agents-md]` | |
| Gotchas that contradict a design | root and per-package `INSIGHTS.md` | `[reused: spec 0006 — agent skills]` | An entry that contradicts the design is a finding, not a detail. |
| Caller identity at the gate | The PreToolUse payload's `agent_type` | `[deterministic: set by the harness]` | Measured on CLI 2.1.285; see `.claude/agents/README.md`. |
| The PR-action gate this one sits beside | `.claude/hooks/pr-self-review-gate.py` | `[reused: spec 0005 — pr-self-review]` | Unchanged; the two hooks are independent entries under one `PreToolUse` event. |

No input on any path reaches an LLM provider outside the agent's own turn; nothing here is `[llm]`.

## Untrusted inputs

- **Cloned foreign repositories, `server/clones/**`.** The agent has `Read`, `Grep` and `Glob` over
  the whole tree, and that path holds code and documentation written by strangers — including their
  own `AGENTS.md` and `CLAUDE.md` files, which are shaped exactly like instructions to an agent.
  The agent's prompt must treat everything under `server/clones/` as **data about a repository**,
  never as direction, and it has no reason to read it while writing a spec.
- **Mockups and the feature request** come from the user of this session, so they are trusted input
  in the ordinary sense — but any *text quoted inside a mockup* (a rendered PR title, a sample
  review comment) is stranger-written content and must not be copied into the spec as a
  requirement.
- The agent produces no prompt and calls no model, so `wrapUntrusted()` and `groundFindings()`
  (`reviewer-core/AGENTS.md`) do not apply to it. They apply to any feature it specifies that puts
  untrusted text into a prompt — and where that happens, the spec must carry it as a criterion.

## Test plan

| Covers | Test |
|---|---|
| AC-6, AC-7 | `.claude/hooks/test_spec_scope_gate.py` — `SpecPathTest` and `HookEndToEndTest`: 9 allowed paths and 28 denied ones, the denied corpus built from how a write can *land* outside (traversal, absolute, symlinked `specs/`, wrong extension, dotted directory, two levels down), each run through the real hook process. |
| AC-7 | `test_a_symlinked_specs_dir_is_judged_by_where_it_lands`, paired with `test_a_real_specs_dir_in_the_same_shape_is_allowed` so the negative cannot pass for the wrong reason. |
| AC-10 | `test_the_main_session_is_untouched`, `test_other_agents_are_untouched`. |
| AC-11 | `test_a_spec_creator_payload_with_no_path_is_denied`; `test_a_malformed_payload_does_not_block_the_main_session` pins the other direction. |
| AC-6 (coverage of all four tools) | `test_every_write_tool_is_covered`, plus `test_the_registered_matcher_covers_the_write_tools` so the hook is actually reached. |
| AC-13 | `AgentContractTest.test_the_agent_holds_no_tool_that_writes_by_another_route`. |
| AC-1 | `scripts/check_specs.py` — the section set, read out of `specs/README.md`'s template block rather than copied, so adding a section enforces it. Paired negative: `test_a_missing_section_fails`, plus `test_the_required_list_comes_from_the_readme_template`, which adds a section to the template and requires the spec to fail, then pass once it carries it. |
| AC-2 | `scripts/check_specs.py` — every `AC-N` declared at most once. Paired negative: `test_a_reused_identifier_fails`. |
| AC-3 | `scripts/check_specs.py` — every `AC-N` referenced **literally** in `## Test plan`; range notation (`AC-1..AC-5`) is rejected by name, because nothing in the repo expands a range and `plan-verifier` enumerates `AC*` by identifier. Paired negatives: `test_a_criterion_absent_from_the_test_plan_fails`, `test_range_notation_is_rejected_even_though_it_covers_every_criterion`, and `test_enumerating_the_same_criteria_passes` so the rule cannot pass by rejecting everything. |
| AC-5 | `scripts/check_specs.py` — a row for the spec in its directory's `README.md`. Paired negative: `test_a_spec_with_no_index_row_fails`. |
| AC-4, AC-8, AC-9, AC-12, AC-14, AC-15 | Not mechanically checkable — they are prompt behaviour. Checked by a live run: `claude -p --agent spec-creator` on a real feature with mockups, then reading the file it produced. Recorded in `## Phases`. AC-4 is the one that stays unenforced by design: the gate polices paths, not content (see `## Goals / Non-goals`). |

The suite is verified by mutation rather than by being green: six guards were each broken
deliberately, five failed a test. The sixth — the containment check — is redundant with the
structural check and is documented as such in the hook rather than left looking tested.

## Phases

| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-30 | Slide template + EARS paper read; `specs/README.md`, the 7 agents, `pr-self-review-gate.py` and `settings.json` surveyed |
| Planning | 2026-09-30 | 8 decisions agreed with the user — see `## Decisions`. The draft's two open questions (committed mockups, the `lesson:` key) were answered the same day, so `## [NEEDS CLARIFICATION]` emptied and was removed |
| Implementation | 2026-09-30 | `spec-creator.md`, `spec-scope-gate.py` + 15 tests, `settings.json`, `specs/README.md`, `design/`, agent catalog, `AGENTS.md` |
| Validation | 2026-09-30 | 15/15 tests ✓ · 6-mutant pass (5 caught, 1 documented-redundant) ✓ · `check-agent-docs.sh` ✓ · `check-claude-skills.sh` ✓ · live: gate denied `server/src/probe-boundary.ts` verbatim and allowed `client/specs/0099-*.md` with its index row, both confirmed by `git status` |
| Completion | | pending: user approval of this spec (`status: approved`), then `/pr-self-review` |
