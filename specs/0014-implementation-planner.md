---
title: implementation-planner — the planner, re-scoped around a spec it must have
status: done         # draft | approved | in-progress | done
packages: [.claude, specs]
---

## Problem & why

`spec-creator` shipped (spec 0013) and took ownership of phase 2, but `planner` was never re-scoped
around it. Five places in the tree still say the opposite:

- `.claude/agents/planner.md:20-22` — *"Your plan is the thing that gets turned into a spec, not the
  spec itself"*. That was true when nothing wrote specs. It is now backwards: the spec precedes the
  plan.
- `.claude/agents/planner.md:142-145` — the report's `## Spec` section instructs the agent to decide
  a spec's **path** (root `specs/` vs `<pkg>/specs/`) and its **`packages:`** list. That is spec
  authorship, performed by a read-only agent that cannot write the file and cannot ask the user.
- `.claude/agents/planner.md:42` — Step 0 item 1 asks *"is there an existing spec to extend?"*.
  Extending a spec is `spec-creator`'s job, through the clarification relay
  (`.claude/agents/spec-creator.md`).
- `specs/0012-blast-radius.md:613` — `1. **planner** — this spec.` The inversion in production, in
  a spec that is `status: done`. A shipped feature recorded the planner as the author of its own
  requirements. This is the strongest evidence that the confusion was not theoretical.
- `.claude/agents/README.md:16` vs `:17` — `spec-creator` *"Decides what is being built"* and
  `planner` *"Decides what to build"*. Two agents, one verb, one distinction lost. The planner's
  word is **how**.

Two capabilities are missing on top of the overlap, and they are the rest of the problem:

1. **Requirements are consumed silently.** The plan restates none of them, so an ambiguous
   criterion, or one the repo already contradicts, reaches the implementer unchallenged. Nothing in
   the current report format forces the agent to say "I read this criterion and I am not sure what
   it means".
2. **The execution shape is decided ad hoc.** Nothing in the plan says whether the work should run
   in one context or across this repo's subagent chain (`.claude/agents/README.md:63-85`). That
   choice is re-made by hand, differently, every task.

**The adoption cost, stated up front:** no spec in this repo has ever carried `status: approved`.
Across the 13 root specs the index records 5 `done`, 5 `in-progress`, 1 `draft`, and 0 `approved`.
So the hard stop this spec introduces will refuse every task that is not covered by one of the 5
`in-progress` specs, unless the override fires. That is the intended cost of making the absence of
requirements visible, but it is a real cost and it lands on the first day.

## Goals / Non-goals

**Goals**

- Rename `planner` to `implementation-planner`, and strip spec authorship from it entirely.
- A **hard stop** when no spec governs the task: the agent produces no plan rather than inferring
  requirements nobody agreed to.
- A **requirements audit** that restates every governing criterion in the planner's own words and
  gives each one a verdict, so an ambiguity surfaces before implementation instead of during review.
- **Costed improvement proposals**, kept out of the plan's steps until the user accepts them.
- A **mandatory execution-mode recommendation**, carrying both decompositions, so the main session
  can put one question to the user instead of improvising the shape of the work.
- A rename that leaves **no dangling citation**: every reference that moves is repointed to a line
  that exists and says what it is cited for, including the five in `specs/0013-spec-creator.md`.

**Non-goals**

- **No hook enforcing the no-spec-writing rule.** `spec-creator` needed
  `.claude/hooks/spec-scope-gate.py` *because it holds `Write`* — the hook narrows a real capability
  (`.claude/agents/README.md:130-135`). `implementation-planner` keeps
  `disallowedTools: Write, Edit`, so it cannot produce a file at all and there is nothing for a hook
  to add. The asymmetry is deliberate and is recorded here so nobody reads the missing hook as an
  oversight.
- No CI check over `.claude/agents/` frontmatter. Reused verbatim from
  `specs/0013-spec-creator.md:45-46`: there is none today for any agent, and adding one is still its
  own piece of work. Consequently the eight file-level criteria (AC-1 to AC-5, AC-24 to AC-26) are
  checked by a **run-once script whose result is recorded in `## Phases`**, not by CI. There is no
  sanctioned home for such a script today — `scripts/check-claude-skills.sh` validates skills,
  hooks and `settings.json` but does not walk `.claude/agents/`
  (`.claude/agents/README.md:222-226`) — and giving these checks a permanent home is separate work,
  out of scope here.
- No renaming of `## Steps`, `## Constraints` or `## Verification`.
- No new machinery for multi-agent mode — no `Workflow` tool, no ultracode, no new agent files.
- No retrofit of the three historical `planner` references.
- Not a change to `spec-creator`'s behaviour. `.claude/agents/spec-creator.md` gets two reference
  renames and one reciprocal clause pointing at the new name, and nothing else. (The five
  references in `specs/0013-spec-creator.md` are a separate matter — that is the spec document, not
  the agent, and it is in scope; see `## Decisions`.)
- Not a change to `plan-verifier`, `implementer` or their prefixes.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| What is "multi-agent mode"? | This repo's own subagent chain in `.claude/agents/README.md`. **Amended 2026-10-01 — the order changed after this spec reached `done`:** `implementer` (one per package, parallel **only** where the packages are independent) → **`plan-verifier` as the completeness gate** → then, in parallel on the same diff, `architecture-reviewer` (layering) + `/code-review` (correctness, run by the user) + `test-writer` (backfill) → `plan-verifier` again as a delta if tests were added. As originally written this row read `implementer → test-writer → plan-verifier + architecture-reviewer`; `.claude/agents/README.md` is canonical and `AGENTS.md` phase 4 carries the same order | No new machinery, no new agent files, no dependency on the `Workflow` tool or ultracode. The recommendation is expressible entirely in agents that already exist. The reorder put the cheap read-only gate before the expensive passes, so a diff with `Missing` steps is never graded or tested against |
| How does the mode question reach the user? | Relay. A mandatory `## Execution mode` section carries the recommendation **and both decompositions**; the main session asks with `AskUserQuestion` before implementation starts | The agent never prompts and needs no `Agent` tool. The user still owns the choice, and gets it as one question with both options already worked out |
| Which `status:` values govern? | `approved` and `in-progress` **only** | `draft` stops ("nobody agreed to it"); `done` stops with a **distinct** message ("shipped — new work needs a new spec or one declaring `supersedes:`"). Two arms, because the remedies differ |
| Escape hatch for spec-less trivial work? | A narrow, **stamped** override: the agent still hard-stops unless the caller's prompt carries an explicit override phrase, in which case it plans but stamps `## Requirements source` as `override — no spec`, and every requirement row must quote the user's own words as its source | The absence of a spec stays visible in the artifact instead of being silently absorbed. A plan-verifier or reviewer reading the plan later can see there were no agreed requirements |
| Frozen heading names | `## Steps`, `## Constraints` and `## Verification` keep their exact spelling | `.claude/agents/plan-verifier.md:47-52` enumerates plan items by literal heading (`S*` from `## Steps`, `C*` from `## Constraints`, `V*` from `## Verification`) and `.claude/agents/implementer.md:144` cites a `Plan step` column. Renaming any of them silently breaks two downstream agents |
| Row ID prefixes | The requirements audit uses `R1..` and the proposals `P1..` | Chosen because `plan-verifier` already claims `S*`, `C*`, `V*` and `AC*` (`plan-verifier.md:47-52`). Reusing `AC-n` inside a plan would make `plan-verifier` enumerate the same criterion twice, from two sources, with two wordings |
| `## Risks & decisions` | Deleted | It was the only report section with no downstream reader. Questions now go to `## Clarification needed`; proposals to `## Recommendations`; a real hazard becomes a `## Constraints` row with its `path:line`, where `plan-verifier` audits it as a `C*` item instead of ignoring it |
| The three historical `planner` references | Left untouched: `specs/0008-intent-layer.md:216`, `specs/0012-blast-radius.md:613` (both dated `## Phases` logs) and `server/INSIGHTS.md:308` (append-only) | They record which agent actually ran at the time. Rewriting them would falsify a dated log to satisfy a naming rule |
| Is `specs/0013-spec-creator.md` exempt from the rename? | **No.** All five of its `planner` references (`:10`, `:11`, `:29`, `:42`, `:58`) are updated. None of the five sits inside a quotation, so no quoted text is rewritten: at `:10` the token is the prose *subject* and the quoted evidence is the italic sentence beside it, which carries no agent name; `:11` is a citation path | AC-4's exempt set stays at **file level** — no line-level exemption is needed and 0013 does not join it. (The set is five files, not four: `.claude/skills/postgresql-table-design/SKILL.md` carries PostgreSQL's *query planner* and was missing from the first draft of AC-4.) Two of the five references also assert something that spec 0014 makes false (`:42` "That is `planner`, unchanged" and `:58`'s consequence cell "`planner` is unchanged"); both drop the claim and point at 0014 |
| What is the override phrase? | The literal `no spec: proceed anyway`, matched case-insensitively, required to appear in the caller's prompt | AC-10 and AC-11 name the exact string, so both become testable. The `## No spec` report does **not** print the phrase: advertising the bypass at the moment someone is annoyed by the stop is the wrong moment to advertise it, so a caller who does not know it hits the stop |
| Does the `description` keep `spec` as a delegation trigger? | No. `spec` survives exactly once, as an **input** ("Turns an approved spec into a Development Plan"), and the anti-trigger reads "never authors **requirements**" rather than "never writes specs" | The router does not see the word `spec` beside a verb it could read as a capability, so spec-less work stops being routed to an agent that would only hard-stop. The drafted description is 92 words |

## User stories

- As a developer starting a task, I want the planner to refuse when no agreed spec covers the work,
  so that I find out requirements are missing before an implementer invents them.
- As a developer with a governing spec, I want every criterion restated and given a verdict, so that
  I learn which ones are ambiguous while it is still cheap to ask.
- As a developer, I want the planner's improvement ideas costed in steps and files and kept out of
  the plan, so that I can decline one without unpicking it from the work.
- As the main session, I want one mandatory section carrying both execution decompositions, so that
  I can put a single `AskUserQuestion` to the user instead of choosing the shape of the work myself.
- As a reviewer reading a plan months later, I want to see whether it was built on an agreed spec or
  on an override, so that I can tell an unimplemented requirement from an unspecified one.
- As the repository owner, I want the two planning agents to own different verbs, so that neither
  can be asked to do the other's job by a caller reading only the catalog.

## Acceptance criteria (EARS)

| ID | Criterion | Pattern |
|---|---|---|
| **AC-1** | The `implementation-planner` agent file's frontmatter `name` shall be `implementation-planner`, matching its filename stem `.claude/agents/implementation-planner.md`. | ubiquitous |
| **AC-2** | The `implementation-planner` agent file's frontmatter shall declare `disallowedTools` containing both `Write` and `Edit`. | ubiquitous |
| **AC-3** | The `implementation-planner` report format shall contain the headings `## Steps`, `## Constraints` and `## Verification` spelled exactly as `plan-verifier.md:47-52` enumerates them. | ubiquitous |
| **AC-4** | No tracked file outside the exempt set shall contain the token `planner` that is not immediately preceded by `implementation-` (the slug) or `Implementation ` (the title form, as in the agent file's own `# Implementation planner` heading); the exempt set is `.claude/skills/postgresql-table-design/SKILL.md`, `specs/0008-intent-layer.md`, `specs/0012-blast-radius.md`, `server/INSIGHTS.md` and this spec. | ubiquitous |
| **AC-5** | The `implementation-planner` report shall contain no `## Risks & decisions` heading. | ubiquitous |
| **AC-6** | IF no spec with `status: approved` or `status: in-progress` covers the task and the caller's prompt does not contain `no spec: proceed anyway`, THEN `implementation-planner` shall return a `## No spec` report containing no `## Steps` section. | unwanted behaviour |
| **AC-7** | WHEN `implementation-planner` returns `## No spec`, it shall name every specs directory it searched, quote the nearest candidate spec's `status:` line with its line number, and state that no plan was produced and no spec was drafted. | event-driven |
| **AC-8** | IF the nearest governing candidate is `status: draft`, THEN `implementation-planner` shall stop with a message stating that nobody has agreed to it and that the user — not the agent — sets `status: approved` (`.claude/agents/spec-creator.md:31`). | unwanted behaviour |
| **AC-9** | IF the nearest governing candidate is `status: done`, THEN `implementation-planner` shall stop with a message distinct from the `draft` message, stating that the spec has shipped and that new work needs a new spec or one declaring `supersedes:`. | unwanted behaviour |
| **AC-10** | WHERE the caller's prompt contains the literal phrase `no spec: proceed anyway` (matched case-insensitively), `implementation-planner` shall produce a plan whose `## Requirements source` reads `override — no spec`. | optional feature |
| **AC-11** | WHILE a plan is stamped `override — no spec`, every `## Requirements review` row's `Source` shall be a verbatim quotation of the user's own words. | state-driven |
| **AC-12** | Every `## Requirements review` row's `Source` shall be either a `path:line` in the governing spec together with its `AC-N`, or a verbatim quotation of the user's words, and nothing else. | ubiquitous |
| **AC-13** | Every `## Requirements review` row's `Verdict` shall be exactly one of `clear`, `ambiguous`, `contradicted by repo`, `missing`. | ubiquitous |
| **AC-14** | IF a restatement and the criterion it restates are not obviously the same requirement, THEN `implementation-planner` shall record that row's verdict as `ambiguous`. | unwanted behaviour |
| **AC-15** | WHEN a row's verdict is `ambiguous` or `contradicted by repo`, `implementation-planner` shall raise a numbered question in `## Clarification needed` that names that row's ID. | event-driven |
| **AC-16** | WHEN a row's verdict is `contradicted by repo`, `implementation-planner` shall include the contradicting `path:line` in that row. | event-driven |
| **AC-17** | IF a requirement's verdict is `missing`, THEN `implementation-planner` shall record it in `## Recommendations` as a proposed criterion and shall not place it in `## Steps`. | unwanted behaviour |
| **AC-18** | Every `## Requirements review` row's `Satisfied by` shall be non-empty, holding step IDs, `## Out of scope`, or the `## Clarification needed` question that blocks it. | ubiquitous |
| **AC-19** | The `## Requirements source` section shall state both the governing spec's acceptance-criterion count and the `## Requirements review` row count, and the two shall be equal. | ubiquitous |
| **AC-20** | Every `## Recommendations` row shall state its cost as a count of steps and files, and no `## Recommendations` entry shall appear in `## Steps`. | ubiquitous |
| **AC-21** | The report shall contain a `## Execution mode` section as its last section, carrying one recommendation with reasoning, a multi-agent decomposition naming the owning agent and step IDs per wave, a single-agent ordered sequence, and an explicit statement that this is a recommendation and not a choice. | ubiquitous |
| **AC-22** | IF no `## Requirements review` row carries the verdict `clear`, THEN `implementation-planner` shall return `## Clarification needed` alone, with no `## Steps` section. | unwanted behaviour |
| **AC-23** | The report shall always contain a `## Clarification needed` section, reading `none` when there are no open questions. | ubiquitous |
| **AC-24** | The `implementation-planner` frontmatter `description` shall contain the token `spec` exactly once, naming an approved spec as the agent's input. | ubiquitous |
| **AC-25** | The `implementation-planner` frontmatter `description` shall contain the phrase `never authors requirements`. | ubiquitous |
| **AC-26** | Every `path:line` citation repointed by this work shall resolve to a line that exists and contains the content it is cited for. | ubiquitous |

## Edge cases

| Case | Handling |
|---|---|
| Zero specs match the task | AC-6 fires. `## No spec` names each directory searched so the caller can see the search was real, not assumed. |
| Exactly one spec matches, but `draft` | AC-8's arm. Distinct from AC-9 because the remedy is a user approval, not a new spec. |
| Exactly one spec matches, but `done` | AC-9's arm. The message names `supersedes:` so the caller knows the sanctioned route forward. |
| Several specs match, with different statuses | The governing spec is the one the agent quotes in `## Requirements source`; the others go in `## Not found` with their statuses. If none is `approved`/`in-progress`, AC-6 fires regardless of how many candidates there were. |
| A spec's `status:` line is absent or malformed | Treated as not governing — AC-6 fires, and `## No spec` quotes the frontmatter it did find. A plan built on an unparsed status is a plan built on a guess. |
| Override phrase present **and** a governing spec exists | The spec wins: `## Requirements source` names the spec, not the override. The override is an escape hatch for absence, not a way to bypass an agreed spec. |
| Override phrase present and the user's words carry no requirement at all | Zero rows can be `clear`, so AC-22 fires and no `## Steps` are produced. |
| Every row is `clear` | `## Clarification needed` reads `none` (AC-23) and the plan is complete. |
| One row `ambiguous`, the rest `clear` | The plan is still produced. Withholding a whole plan over one ambiguous criterion delivers nothing; AC-15 carries the question alongside it. |
| The spec has more criteria than the agent could review in budget | AC-19's counts will not match, which is the failure signal. The agent reports the shortfall in `## Not found` rather than padding the table. |
| A criterion the repo already contradicts | `contradicted by repo` plus the contradicting `path:line` (AC-16) plus a question (AC-15). It never becomes a step that would fail review. |
| The agent finds no improvement to propose | `## Recommendations` reads `none`. `.claude/agents/README.md:154` records that an agent prompted to find something will find something whether or not there is anything, so "none" is stated as a complete answer. |
| A residual `planner` token in a file created after the rename | AC-4's check is over tracked files at check time, so it catches new occurrences too, not just the rename's own leftovers. |
| `specs/0013-spec-creator.md` holds five `planner` references | **Resolved** — it is not exempt. `:10`, `:11`, `:29`, `:42`, `:58` are all updated; none sits inside a quotation, so no quoted text changes. `:42` and `:58` additionally drop the now-false claim that `planner` is unchanged. These five are the only non-exempt residue by construction, so AC-4's check cannot pass — or usefully run — until they land. |
| A repointed citation keeps its old line number | `specs/0013-spec-creator.md:11` cites `` .claude/agents/planner.md:20 ``, where **both the file and the line cease to exist**. Repointing the path but not the line leaves a dangling `path:line`, which root `INSIGHTS.md` (2026-09-18) records as worse than a stale sentence because it still looks like proof. AC-26 covers it; AC-4's token check would not. |
| The renamed agent is invoked in the session that renamed it | It is not loadable there (root `INSIGHTS.md`, 2026-09-23) and the call fails with an `Available agents:` list. Every probe runs in a fresh process. |

## Non-functional

- **The write-boundary ceiling, not a gap list.** Root `INSIGHTS.md` (2026-09-23, `:176`) records
  that a control must document its ceiling, because a gap list is a promise that everything absent
  from it is covered. The ceiling here: `disallowedTools: Write, Edit` closes the two tools that
  write. `permissions.allow` only **auto-approves** commands — it does not deny the rest
  (`.claude/agents/README.md:33-37`), so a `Bash` redirect to a spec path would **prompt** rather
  than fail. The guarantee is therefore *"cannot write without a human seeing it"*, **not** *"cannot
  write"*. `specs/0013-spec-creator.md:56` records the same coupling from the other side: the hook
  there holds only because that agent's `tools:` list grants no `Bash` and no `Agent`.
- **Enforcement coverage is 1 criterion in 26.** `disallowedTools` is the only enforcement this
  agent has, and it covers exactly AC-2. Seven further criteria (AC-1, AC-3, AC-4, AC-5, AC-24,
  AC-25, AC-26) are checkable by a script against files on disk. The remaining 18 are prompt
  behaviour with nothing behind them.
- **One ordering dependency.** After the rename, `specs/0013-spec-creator.md`'s five references are
  the only non-exempt `planner` residue in the tree by construction, so AC-4's check is guaranteed
  to fail until those five edits land. It is therefore not a useful signal earlier in the work, and
  the implementation order must put those edits before the check is first run.
- **No CI coverage of `.claude/agents/**`.** `scripts/check-claude-skills.sh` validates skills,
  hooks and `settings.json` but does not walk the agents directory
  (`.claude/agents/README.md:222-226`), so a `name:`↔filename mismatch fails **silently at load**
  (root `INSIGHTS.md:140`: unrecognized or inert frontmatter keys are silently ignored — nothing
  warns, nothing fails). AC-1's check is the only thing standing in for it.
- **Registration requires a fresh process.** A renamed agent is not loadable in the session that
  renamed it (root `INSIGHTS.md`, 2026-09-23, `:125-129`), so every probe uses
  `claude -p --agent implementation-planner` from the repo root. `claude agents --json` lists running
  sessions, not definitions, and is not a registration check.
- **Budget.** The tool-call budget stays at roughly 30 calls (`.claude/agents/planner.md:181`), now
  covering the requirements audit as well. When it runs out the agent files the plan it has and moves
  the rest into `## Not found`.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| The task | The user, or the calling session | `[new]` | The only input with no fixed shape. |
| The governing spec and its `status:` | `specs/NNNN-*.md`, `<pkg>/specs/NNNN-*.md` | `[reused: spec 0013 — spec-creator]` | Written by `spec-creator`, approved by the user. Quoted with its line number, never paraphrased. |
| The override phrase `no spec: proceed anyway` | The caller's prompt | `[new]` | Literal, case-insensitive. Its presence is what distinguishes a stamped plan from a hard stop; it is deliberately not printed in the `## No spec` report. |
| The four frozen item prefixes `S*` `C*` `V*` `AC*` | `.claude/agents/plan-verifier.md:47-52` | `[reused: spec 0006 — agent skills]` | Constrains this spec's own choice of `R*` and `P*`. |
| The `Plan step` column contract | `.claude/agents/implementer.md:144` | `[reused: spec 0006 — agent skills]` | Why `## Steps` cannot be renamed. |
| The subagent chain used for the multi-agent decomposition | `.claude/agents/README.md:63-85` | `[reused: spec 0006 — agent skills]` | Existing agents only; no new machinery. |
| Path→skill routing | `.claude/skills/pr-self-review/skill-map.json` | `[deterministic: read from the repo]` | Unchanged from `planner`. |
| Do-not-touch list, naming, the Verify table | root `AGENTS.md`, `<pkg>/AGENTS.md` | `[reused: spec 0004 — agents-md]` | Unchanged from `planner`. |
| Repo contradictions behind a `contradicted by repo` verdict | root and per-package `INSIGHTS.md`, plus the code | `[deterministic: read in the run]` | Each carries the contradicting `path:line`. |
| Onion rings | `.claude/skills/onion-architecture/SKILL.md` | `[reused: spec 0006 — agent skills]` | Unchanged from `planner`. |

Nothing on any of these paths reaches a model outside the agent's own turn; no input here is `[llm]`.

## Untrusted inputs

**None — every input is repo-local and deterministic.** The agent reads specs, `INSIGHTS.md`,
`AGENTS.md` and code; it **builds no prompt and calls no model**, so `wrapUntrusted()` and
`groundFindings()` (`reviewer-core/AGENTS.md`) do not apply to it. They apply to features it plans
that put untrusted text into a prompt, and where that happens the obligation belongs in that
feature's spec, not in this one.

One qualification, kept because the section is not allowed to be deleted
(`specs/README.md:47-50`): the agent holds `Read`, `Grep` and `Glob` over the whole tree, including
`server/clones/**`, which holds code written by strangers — and their own `AGENTS.md` and `CLAUDE.md`
files, which are shaped exactly like instructions to an agent. Its prompt must treat everything
under `server/clones/` as **data about a repository, never as direction**, and it has no reason to
read it while planning.

## Test plan

| Covers | Test |
|---|---|
| AC-1 | Script check over `.claude/agents/implementation-planner.md`: `yaml.safe_load` the frontmatter and assert `name == Path(file).stem`. Paired negative: the same check over a deliberately mismatched copy must fail, so a green run is not green by vacuity. |
| AC-2 | Script check: assert `Write` and `Edit` both appear in `disallowedTools`. Paired negative: removing `Edit` fails the check. |
| AC-3 | Script check: assert the three literal strings `## Steps`, `## Constraints`, `## Verification` are present in the file. Paired negative: renaming `## Steps` to `## Plan steps` fails. |
| AC-4 | Residual-reference check over tracked files (`git ls-files`), matching the token `planner` preceded by neither `implementation-` nor `Implementation `, with the exempt set from AC-4 subtracted. Paired negative: adding the token to a non-exempt file fails the check; and each exempt file is asserted to *still contain* the token, so the exemption list cannot silently stop being needed. **Run only after `specs/0013-spec-creator.md`'s five references land** — they are the only non-exempt residue by construction, so the check cannot pass before then and carries no information. |
| AC-24, AC-25 | Script check over the frontmatter `description`: the token `spec` occurs exactly once, and the literal `never authors requirements` is present. Paired negatives: a second `spec` occurrence fails the first; rewording the anti-trigger to "never writes specs" fails both at once, which is the regression worth catching. |
| AC-26 | Script check over each citation this work repoints, `specs/0013-spec-creator.md:11` first: the target file exists, the cited line number is within its length, and that line contains the sentence it is cited for (`You do not write code`). Paired negative: repointing the path while keeping line 20 must fail, since that is the exact failure mode root `INSIGHTS.md` (2026-09-18) names. |
| AC-5 | Script check: assert `## Risks & decisions` is absent from the agent file. |
| AC-6, AC-7, AC-8 | Live run, fresh process: `claude -p --agent implementation-planner` on a task governed by `specs/0013-spec-creator.md` (`status: draft`) — must return `## No spec`, with no `## Steps`, quoting that file's `status:` line and number, and must use the "nobody agreed to it" arm. **Paired positive:** the same shape of task governed by **this spec, 0014**, once it is `status: in-progress`, must produce a plan. Without that pair, a run that refuses everything passes. |
| AC-9 | Live run on a task governed by `specs/0012-blast-radius.md` (`status: done`) — must stop, and the message must be textually distinct from the AC-8 run's, naming `supersedes:`. Asserted by diffing the two stop messages, not by reading one. |
| AC-10, AC-11 | Live run with the override phrase and no governing spec: `## Requirements source` must read `override — no spec` and every `Source` cell must quote the prompt. **Paired negative:** the identical task *without* the phrase must hard-stop (AC-6), which is what proves the phrase is doing the work. |
| AC-12, AC-13, AC-18, AC-19 | Live run against **this spec, 0014**, once it is `status: in-progress`: assert every `Source` cell matches one of the two permitted forms, every `Verdict` is one of the four literals, no `Satisfied by` cell is empty, and the two counts in `## Requirements source` are equal and equal to **26** — counted independently from this file, not taken from the report. The probe is self-hosting: 0014 carries 26 criteria in a countable table, which is exactly what AC-19 needs, and no throwaway fixture has to be maintained. |
| AC-14, AC-15, AC-16 | Same run. The assertions are on the **linkage rules**, not on a predicted verdict: every row whose verdict is `ambiguous` or `contradicted by repo` has a numbered `## Clarification needed` question naming its ID, and every `contradicted by repo` row carries a `path:line`. **Paired negative:** at least one row must be `clear` and the run must not mark all 26 `ambiguous` — a planner that flags everything would otherwise satisfy AC-15 trivially. AC-16's positive arm fires only if the planner finds a real contradiction; if it finds none, AC-16 is untested and that is recorded rather than forced (see the note below). |
| AC-17, AC-20 | Same runs: assert no `missing` requirement and no `P*` proposal appears in `## Steps`, and that each `P*` row's cost is expressed in steps and files with no time unit. **Paired negative:** a run on a task with nothing to improve must produce `## Recommendations: none` rather than a padded list. |
| AC-21 | Every live run above: assert `## Execution mode` is present, is the last section, names agents and step IDs per wave, carries both decompositions, and carries the "recommendation, not a choice" label. |
| AC-22 | Live run with the override phrase and a prompt carrying no extractable requirement: assert `## Clarification needed` is returned alone and `## Steps` is absent. |
| AC-23 | The AC-12 run (all criteria clear) must still contain `## Clarification needed`, reading `none`. Paired with the AC-14 run, where it is non-empty. |
| Registration | `claude -p --agent implementation-planner` from the repo root in a **fresh process** resolves the agent; `claude -p --agent planner` must fail with an `Available agents:` list that does not contain `planner`. |
| No-spec-writing (the `disallowedTools` boundary) | Live run instructing the agent to issue a `Write` to `specs/0099-probe.md` **despite believing it will be refused**, passing only on a clean `git status`. Root `INSIGHTS.md` (2026-09-30, `:253-256`) records that an agent's polite refusal exercises zero lines of the guard, so the instruction must push past the prompt. |

**The asymmetry this plan has to state.** `specs/0013-spec-creator.md:159` put its prompt-behaviour
criteria under a live run, and that was defensible because the hook underneath them carried 15 unit
tests: the live run there was a **wiring check** on top of real coverage. This agent has no hook.
`disallowedTools` is the only enforcement and it covers exactly one criterion (AC-2). Seven more are
script checks over files on disk. For the remaining **18**, **the prompt is the system** — so a live
run here is not a wiring check, it is the only check there is.

That makes root `INSIGHTS.md` (2026-09-30, `:253`, *"An agent obeys its prompt before the hook
fires, so a live run can test nothing"*) cut the **other way**: there is no hook to under-exercise,
so a polite refusal *is* the behaviour under test, and AC-6 through AC-9 are tested by exactly the
refusal that would have been worthless there. The trap that remains is a different one — a single
happy-path run proves nothing. So **every probe above carries its paired negative**, in the shape
`specs/0013-spec-creator.md:154` used when it paired the symlinked `specs/` directory with a real
directory of the same shape. The one exception is the boundary probe, which needs the opposite
treatment: there the prompt must be pushed past, because the refusal is what hides the guard.

**One criterion may end the run untested.** AC-16's obligation only fires on a `contradicted by
repo` verdict, and no criterion in this spec is *known* to be contradicted by the repo — the probe
cannot manufacture one without seeding a fixture, which this plan deliberately does not do. If the
self-hosted run produces no contradicted row, AC-16 is recorded as untested in that run's `##
Phases` note rather than being reported as passing. That is the honest cost of dropping the seeded
fixture, and it is one criterion, not a class of them.

## Phases

| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-30 | `planner.md`, `spec-creator.md`, `plan-verifier.md`, the agent catalog, root `INSIGHTS.md` and `specs/README.md` read; the five evidence sites and the 0/13 `approved` count confirmed. Three clarifications raised and answered the same day, so `## [NEEDS CLARIFICATION]` emptied and was removed — see the last three `## Decisions` rows |
| Planning | 2026-09-30 | 11 decisions agreed with the user — see `## Decisions`. `status: approved` set by the user, making this the **first** spec in the repo to carry that status (the other 13 went `draft → in-progress → done`, which `## Problem & why` records as the adoption cost of AC-6) |
| Implementation | 2026-09-30 | `git mv` (index records `R`, so `--follow` survives) + the rewritten 424-line body; sweep of 7 files — `README.md` (catalog, artifacts, 4 prose sites rewrapped, 2 judgement bullets, CI note, mode paragraph, diagram redrawn), `AGENTS.md:121`, `spec-creator.md:9,17` + the reciprocal clause on rule 2, `test-writer.md:43`, `0013` ×5. Three historical logs left untouched |
| Validation | 2026-09-30 | 8 file-level criteria ✓ (AC-1/2/3/5/24/25 scripted; AC-4 clean with the exempt set subtracted and all 5 exempt files asserted to still carry the token; AC-26 repointed `0013:11` to `implementation-planner.md:40`, verified to contain *"You never touch a spec"*). Fresh-process pair ✓ — `planner` fails with an `Available agents:` list, `implementation-planner` resolves. Live: `0013` (`draft`) → `## No spec`, no `## Steps`, `status:` quoted with its line (AC-6/7/8) ✓; paired positive on this spec (`approved`) → full plan, 26/26 counts equal (AC-19), closed verdict vocabulary only (AC-13), no empty `Satisfied by` (AC-18), `Blocked: R26` matching the one `ambiguous` row (AC-15), `## Execution mode` last and labelled (AC-21) ✓. `check-agent-docs.sh` ✓ · `check-claude-skills.sh` ✓ · `test_spec_scope_gate.py` 15/15 ✓ · diagram max width 88 cols. **AC-16 untested**: no `contradicted by repo` row arose, the cost of self-hosting that `## Test plan` predicted. AC-9/10/11/22 not probed. No typecheck/lint/e2e — the change is markdown only |
| Completion | 2026-09-30 | `status: done`. No `docs/` move — the durable explanation is the agent file itself and `.claude/agents/README.md`. Insights wrap-up: 2 entries. Pending on the user: `/pr-self-review` (note `skill-map.json:4` skips `**/*.md`, so it will route zero reviewers) and the commit |
