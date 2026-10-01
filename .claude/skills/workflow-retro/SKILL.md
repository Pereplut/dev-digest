---
name: workflow-retro
disable-model-invocation: true
description: >-
  Reviews how a multi-agent run went, not what it produced: agents launched and in what order,
  tokens and wall-clock each spent, where work was duplicated, which agent corrected which, what a
  brief failed to ask, and every tool denial an agent hit. Composes a dated entry in
  WORKFLOW-RETRO.md plus proposed changes the user approves. Manual-only; it never edits
  .claude/agents/** and never reports a number it did not read from a tool result.
---

# Workflow retrospective

`INSIGHTS.md` records what we learned about **the codebase**. This records what we learned about
**the orchestration** — how the agents were briefed, sequenced and spent. Different readers,
different lifetimes, separate logs. Never write orchestration findings into `INSIGHTS.md`, and
never write engineering findings here.

Invoked only by the user typing `/retro`. It spawns no agents of its own: everything it needs is
already in the session or on disk.

## The one rule that makes the rest possible

**Never report a number you did not read from a tool result.** Every figure in a retrospective
cites where it came from — a `<usage>` block, `/context` output, a file. A figure that is not
available is written `not measured`, never estimated, never inferred from "about how long it felt".

This repo has twice shipped a claim nothing could check: an uncited "~20 minutes" that sat in a
skill file until a reviewer asked for its source, and a prose count that drifted into four files
across two documents *after* being announced fixed (root `INSIGHTS.md`, 2026-10-01). A
retrospective that estimates is worse than no retrospective, because it launders a guess into a
record.

Keep **measured** and **inferred** in separate columns, always. "researcher spent 90,843 tokens" is
measured. "researcher found this hard" is inferred, and must quote the report line it came from.

## Capture: during the run, not at the end

A retrospective composed at the end of a long session is composed from a **compacted** transcript,
and the numbers are already gone. Measured 2026-10-01 against
`.claude/.insights-state/<session>.transcript.md`: 21 agent returns, 6 task-notifications, and
**1 surviving `<usage>` block**. The narrative survives condensation; the measurements do not.

Two reasons, both structural:

- Most agent returns arrive as a **SubagentHandback message, which carries no usage data at all**.
  The numbers come only in the separate `<task-notification>`.
- The condenser keeps the conversation, not the notification blocks.

So the orchestrating session appends one row **as each notification arrives**, to
`.claude/.retro/<session-id>.runs.jsonl`:

```json
{"order":1,"agent":"researcher","label":"prompt-assembly","tokens":90843,"tools":37,"ms":162486,"parallel_with":[2,3],"outcome":"returned"}
```

`order` is launch order. `parallel_with` lists the orders launched in the same message — that is
what makes the parallelism figure computable later. `outcome` is `returned`, `late`, `failed`,
`denied` or `superseded`.

This capture step is a **workflow rule, not part of this skill** — `/retro` is manual-only, so it
cannot run mid-session to record anything. It is prompt discipline with no enforcement, which this
repo knows drifts. If rows go missing often, the fix is a `SubagentStop` hook, not a sterner
sentence here.

**When rows are missing, say so.** A retrospective over 3 captured rows of 7 agents reports three
agents measured and four `not measured` — it never scales up, averages, or quietly reports the
three as if they were the run.

## What to compose

Read the rows, the agent reports still in context, and `/context` if the user has run it. Then
write the sections below. Omit any section with nothing real in it rather than writing "none" —
except `## Not measured`, which is never omitted.

### 1. Cost and shape

A table of every agent: order, type, label, tokens, tool uses, duration, outcome. Then:

- **Total subagent tokens vs. the main thread's message tokens.** These diverge hard and the
  orchestrator cannot see it: measured 2026-10-01, 490,171 subagent tokens against 169.5k of
  messages — **2.9×**, none of it visible in `/context`. If the ratio is large, the orchestrator has
  been spending most of the budget blind.
- **Parallelism: wall-clock against summed agent duration.** Three researchers launched together
  ran 193s wall against 543s summed — 2.8×. A ratio near 1.0 on independent work is a fan-out that
  was serialized by mistake.
- **Termination mode** — success, cap, user stop, or dead agent. Record it always. The previous
  effort's root cause was found by *hitting the cap*, not by any review round: the stop forced
  "why does this keep happening?" instead of "what is wrong this round?".

### 2. The correction chain — the highest-value section

Who corrected whom, and **does the error trace back to the coordinator's brief?** Agent-corrects-agent
is ordinary. Agent-corrects-coordinator is a briefing defect, and it is invisible to every other
review in this repo.

Two worked instances:

- A coordinator asserted a prompt section rendered "third, after System and Skills", having read it
  off a mockup. `spec-creator` checked the assembler and returned the real order. The brief was the
  defect, not the spec.
- A wrong count ("a fifth commit point") went brief → `spec-creator` → a skill's `description:`, and
  **four passes repeated it** because it came from the coordinator. A verifier reading end-to-end
  traced it back to the source.

For each: what was claimed, who caught it, how many passes repeated it first, and where it entered.
A claim that entered through a brief and survived N passes is the strongest signal this skill
produces — it measures how far an unchecked assertion travels.

### 3. The question asked vs. the question that mattered

An agent answers what it was asked. Where a later step found something an earlier agent **had the
file open for and did not report**, that is a brief-template defect, not agent failure.

Worked instance: a researcher read `prompt.ts` in full and correctly reported an unwired `specs`
slot, but not that the slot emits the literal header `## Project context` — the exact string the new
feature would collide with. It was never asked. The fix is a brief that asks *"what would collide
with X"*, not only *"does X exist"*.

Record the fix as a brief-template line, because that is the artifact that changes.

### 4. Duplicate coverage

Compare `file:line` citations across reports from the same fan-out. Report the overlapping set and
the tokens spent on the duplicate half. Overlap is not automatically waste — two reviewers
converging on one line is corroboration, and should be named as such. Two researchers independently
reading the same file because neither brief said who owned it is paid-for duplication, and the fix
is one ownership sentence per brief.

### 5. Capability denials

Every tool refusal an agent hit, with what it cost. These are the cheapest findings to act on and
the easiest to lose — the agent mentions it once, in a "could not find" row, and nobody collects it.

Worked instance: a researcher denied `find`/`ls` on a module directory **could not answer one of its
seven questions**, and said so. That is one permission entry away from fixed, and recurs on every
future task in that area until someone notices.

### 6. Unused output

Agent conclusions that never reached the shipped artifact. Check the report's claims against the
spec, plan or code that actually landed. Distinguish *wasted* (nobody read it) from *spent well*
(it informed a decision to cut something) — a finding that killed a feature earned its cost.

### 7. Not measured

Never omitted. Every agent with no captured row, every figure unavailable, and why. A retrospective
whose limits are invisible reads as complete.

## Proposed changes

End with a checklist the user accepts or rejects. Each proposal names the file, the change, and
**the observation that earned it** — never a proposal without evidence from this run.

```
## Proposed changes
[ ] .claude/agents/researcher.md — output template models `rg`, which line 37
    of the same file forbids (researcher used rg, denied, 1 of 7 questions
    returned unanswered)
[ ] .claude/agents/researcher.md — brief template: ask "what would collide
    with X", not only "does X exist" (header collision missed, caught 2 steps later)
```

**Never edit `.claude/agents/**` yourself, and never edit `.claude/settings.json`.** An agent
rewriting the instructions that govern it, from its own self-assessment, is a loop with no outside
check. Propose; the user applies.

### Before proposing against a guard, find out what it is for

A proposal that would weaken a guard — a permission broadened, a cap raised, a review step dropped,
a deny entry removed — is not finished when it is labelled as a trade. **Go read why the guard
exists first, and say what you found in the proposal line.** Search `INSIGHTS.md`, the spec, and the
git history for the entry that put it there. If you cannot find a reason, say that too — "no
recorded rationale" is a different claim from "the rationale does not apply here", and the user is
entitled to know which one you are making.

**Prefer the reading where the agent, not the guard, is wrong.** A denial usually means an agent
reached for the wrong tool, not that the control is miscalibrated. Exhaust that explanation before
proposing to remove anything.

This rule exists because this skill's own first run got it wrong. It read a `find` denial, named the
permission as the gap, and proposed granting it — which would have reverted a control a
`/pr-self-review` security pass had added on evidence: `find -exec`, `find -delete` and
`rg --pre=COMMAND` execute arbitrary programs, and a probe confirmed that with `Bash(find:*)`
allowed, `find . -maxdepth 0 -exec echo … \;` ran with **no permission prompt** (root
`INSIGHTS.md:172-176`). The real defect was a contradiction inside the agent file: `researcher.md:37`
forbade `rg`, and `researcher.md:161`'s output template demonstrated it. The demonstration won.

Two things follow, and the second is the one that generalises:

- A retrospective's proposals are **themselves unverified claims**. Nothing downstream checks them —
  there is no reviewer for this skill's output — so the verification has to happen here, before the
  line is written.
- **Check your own worked examples against your own rules.** The example above once showed the
  rejected `allow find` proposal as a model, which is the same defect it was diagnosing. A document
  that forbids something in prose and demonstrates it in a code block teaches the code block.

## Writing it

Append to `WORKFLOW-RETRO.md` at the repo root. Newest last, same as `INSIGHTS.md`. One entry:

```markdown
### 2026-10-01 — spec 0016 Project Context · 5 agents · 490,171 tokens · stopped: success
**Shape:** 3 researchers in parallel (2.8× speedup), then spec-creator twice (write, then closes).
**Subagent vs. main thread:** 490,171 vs 169.5k messages — 2.9×, invisible in `/context`.
**Corrections:** spec-creator → coordinator, twice. Both from claims read off a mockup...
**Not measured:** —
```

The title line carries agents, tokens and termination mode so the log is skimmable without opening
an entry.

**No news, no write.** A run with nothing notable — no corrections, no duplication, no denials, no
surprising cost — produces **no entry**. Say "nothing worth recording from this run" and stop. A log
padded with uneventful runs stops being read, and then the eventful ones are lost too.

## What this skill deliberately does not do

- **No dollar cost.** This repo has no pricing table and model IDs vary. A cost figure would be
  invented, which the first rule forbids.
- **No agent quality scores.** "researcher: 7/10" is a fabricated number wearing a metric's clothes.
  Report what happened and let the reader judge.
- **Never read `/tmp/.../tasks/*.output`.** Those are full JSONL transcripts; the harness forbids it
  and reading one would overflow the context this skill runs in.
- **No engineering findings.** A fact about the codebase goes to `engineering-insights` and
  `INSIGHTS.md`. If a run produced both, run both skills — do not merge the logs.
