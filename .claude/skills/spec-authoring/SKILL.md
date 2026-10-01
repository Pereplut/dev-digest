---
name: spec-authoring
description: >-
  How to write a requirement that a tester could fail — acceptance criteria in EARS form, the
  edge-case checklist, input provenance tags, untrusted-input obligations, reading what a mockup
  leaves out, and the test-plan rules `scripts/check-specs.sh` enforces. Use when writing or
  amending a spec under `specs/` or `<pkg>/specs/`, when auditing or restating someone else's
  acceptance criteria, when deciding whether a criterion is testable, or when a plan must trace
  steps back to criteria. Trigger terms — spec, specification, acceptance criteria, EARS,
  requirement, user story, test plan, edge cases, provenance, untrusted input, shall,
  WHEN/WHILE/IF/WHERE.
---

# Spec authoring

The method for writing requirements in this repo. The **shape** of a spec file — which sections,
where it lives, the index row — is defined once in [`specs/README.md`](../../../specs/README.md) and
enforced by `bash scripts/check-specs.sh`. This skill is the other half: how to write the content so
a criterion cannot be satisfied by accident.

Who uses it: [`spec-creator`](../../agents/spec-creator.md) writing a spec; the main session writing
one by hand (which is how the 16 specs predating the template were written);
[`implementation-planner`](../../agents/implementation-planner.md) restating and auditing criteria
in its `## Requirements review`; [`plan-verifier`](../../agents/plan-verifier.md) enumerating `AC*`
against a diff. All four need the same definition of a well-formed criterion, which is why it lives
here rather than inside one agent.

## The bar

A spec is finished when **a competent implementer could build from it and a tester could fail it**.
Read every criterion back and ask what the failing run looks like. If you cannot picture it, the
criterion is prose.

## EARS — how to write an acceptance criterion

EARS (Mavin, Wilkinson, Harwood, Novak — IEEE RE'09) exists to separate the **trigger** from the
**obligation**, so a criterion cannot hide an assumption in a verb. Five patterns:

| Pattern | Shape | Example |
|---|---|---|
| **Ubiquitous** | The `<component>` shall `<response>`. | The API shall record `cost_usd` for every run that reaches `status='done'`. |
| **Event-driven** | **WHEN** `<trigger>`, the `<component>` shall `<response>`. | WHEN a review run finishes, the API shall write exactly one `reviews` row for it. |
| **State-driven** | **WHILE** `<state>`, the `<component>` shall `<response>`. | WHILE a run is `in-progress`, the PR detail page shall show a cancel control. |
| **Unwanted behaviour** | **IF** `<condition>`, **THEN** the `<component>` shall `<response>`. | IF the repo index is missing, THEN `GET /pulls/:id/blast` shall respond 200 with `degraded: true` and a non-empty `reason`. |
| **Optional feature** | **WHERE** `<feature is enabled>`, the `<component>` shall `<response>`. | WHERE smart-diff is enabled for a repository, the review prompt shall carry the ranked hunks. |

Patterns may nest — *WHILE indexing, WHEN the user opens the PR, the page shall …* — but only when
both the state and the event are real. Do not nest to sound thorough.

Every criterion obeys all of these:

- **One ID**: `AC-1`, `AC-2`, … Numbers never get reused, even after a criterion is deleted.
- **One `shall`, one obligation.** An "and" joining two obligations is two criteria.
- **A named component**, not "the system": `the API`, `the PR list`, `the MCP tool
  get_blast_radius`. In a five-package repo "the system" hides which package owns the work.
- **An observable outcome** a test could assert: a status code, a contract field, a DB row, a
  rendered element, a number. "Works correctly", "is fast", "is clear" are not outcomes.
- **A quantity wherever an adjective wants to go.** Not "quickly" — "within 2 s at p95".
- **A trigger that exists in this repo.** If you cannot point at the event, it is a clarification,
  not a criterion.
- **Every criterion appears in `## Test plan`**, by ID, against the test that will check it. A
  criterion no test names is either untestable or unowned — say which.

## Ask which criteria are mechanically checkable

The instinct is to file prompt-shaped or process-shaped criteria as "not unit-testable". Measured
against `specs/0013`, four of its ten such criteria were nothing of the kind — they were claims
about the **artifact on disk** (its section set, unique identifiers, test-plan cross-references, its
index row) and a script now checks all four. Before writing "not unit-testable", ask whether the
criterion constrains the artifact or the behaviour. Artifact claims go to a script; only behaviour
goes to a live run.

State the split explicitly, as `specs/0014` does: *N of M criteria are enforced, the rest are prompt
behaviour with nothing behind them.* A reader who cannot tell which is which will trust all of them
equally.

## Test plan — enumerate, never a range

Each criterion's ID appears **literally** in the first column of `## Test plan`:
`AC-1, AC-2, AC-3` — never `AC-1..AC-3`. Nothing in this repo expands a range and `plan-verifier`
enumerates `AC*` by identifier, so a range reads fine to a human and hides those criteria from every
machine that checks them. `specs/0013` covered three of its criteria only through `AC-1..AC-5`;
`scripts/check-specs.sh` now rejects that by name. Prose in the second column may mention anything —
only the first column is read as a coverage claim.

**Pair every probe with its negative.** A check that only ever asserts the happy path passes at full
green while the hole is open. A refusal test needs a case that must be accepted; a "rejects bad
input" test needs one that accepts good input; a "flags ambiguity" test needs a case where nothing is
ambiguous — otherwise an implementation that refuses or flags everything satisfies it.

**Say what went untested.** A criterion no run exercised is recorded as untested in `## Phases`, not
reported as passing. `specs/0014` predicted before its own validation run that one criterion would
never fire, and said so rather than discovering it later.

## Reading a design

A mockup shows one state of one screen on one screen size. Everything it does not show is what you
are here for. Walk each screen and extract:

- **Every state**: loading, empty, one item, many, too many (what truncates and how it says so),
  error, degraded/partial, permission-denied, offline or stale.
- **Every control**: what it does, what it does while it is doing it, what happens on failure,
  whether it is destructive and whether that is confirmed.
- **Every string**: it becomes an i18n key under `client/messages/en/<namespace>.json` — the repo
  forbids hardcoded copy. Copy shown in the mockup is a draft, not a decision.
- **Layout**: behaviour at phone width, what wraps, what scrolls, what is allowed to overflow.
- **a11y**: focus order, keyboard reachability, what a screen reader announces for a control whose
  meaning is carried by colour or position alone.
- **Where the data comes from**: for every value on the screen, the route or contract field behind
  it, and what the screen does when that field is absent rather than empty.

Anything the mockup does not answer becomes a **proposed default**, never a silent decision.

## Edge cases — the checklist

Walk it every time, so this is not a matter of inspiration. Record the ones that apply, and say
which you checked and ruled out — so a reader can disagree with a dismissal instead of never seeing
it.

Zero / one / many / more than the page holds · a value that is `null` versus absent versus empty
string · a slow backend and a failed one · a request the user cancels or navigates away from ·
two writers at once, and a stale read · a permission the user does not have · text that is long,
right-to-left, or emoji · a number that is negative, zero, or does not divide evenly · pagination
and sort boundaries · a first run with no history · a deleted parent whose child still exists ·
clock skew and time zones where a date is displayed.

## Provenance and untrusted input

**`## Inputs (provenance)`** — a table: `| Input | Source | Provenance | Notes |`. Tag each input:

- `[reused: L0X]` — already built, in the work for lesson `L0X` or in a numbered spec
  (`[reused: spec 0012]`); this feature consumes it and does not rebuild it. Name the module or
  route it comes from.
- `[deterministic: <how>]` — computed in code, no LLM anywhere on the path. Say what computes it.
- `[llm]` — produced by a model, therefore not reproducible and not a source of truth.
- `[new]` — this feature creates it.

**`## Untrusted inputs`** — anything the feature reads that a stranger wrote: PR titles and bodies,
diffs, file contents, repository and branch names, commit messages, review comments. For each one
say that it is data and never instruction, and name the obligation:
[`reviewer-core/AGENTS.md`](../../../reviewer-core/AGENTS.md) requires all untrusted content to be
wrapped with `wrapUntrusted()`, and grounding via `groundFindings()` is mandatory. If the feature
puts untrusted text into a prompt, an acceptance criterion must say so — **this is the one place a
missing requirement is a security bug.**

If there are none, write "None — every input is repo-local and deterministic" and say why. Do not
delete the section; `specs/README.md` forbids it.

## Non-functional — state a ceiling, not a gap list

Perf, security and a11y obligations need a number or a named standard, or they are not requirements.
And when the feature ships a control — a guard, a gate, a check — describe **what it cannot do**
rather than listing the gaps you know about. A gap list is a promise that everything absent from it
is covered, and it will be wrong by the next round (root `INSIGHTS.md`, 2026-09-23). Name the
enforcement coverage honestly: which criteria have something behind them and which are prose.

## Never invent a requirement to fill a section

An unknown goes in `## [NEEDS CLARIFICATION]` and in the report — never into an acceptance criterion
as a guess. A spec that reads complete and is partly invented is worse than a short one with open
questions. Each question carries a **proposed default** and what each choice would cost, so it can
be answered in one word. Two to four per round; ten means not enough has been read yet.

## Keep analysis out of the spec

Design gaps, uncovered edge cases, module contracts and UX ideas are **proposals**. They belong in
the report that accompanies the spec, not in the spec itself — only what the user accepts comes back
into the file. Writing them straight in means the user approves a spec and silently approves the
author's opinions with it.
