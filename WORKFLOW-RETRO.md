# Workflow retrospectives

How multi-agent runs **went** — briefing, sequencing, cost, corrections. Append-only, newest last.

This is not `INSIGHTS.md`. That log records what we learned about the **codebase**; this one records
what we learned about the **orchestration**. A fact about the code goes there, a fact about how the
agents were run goes here, and nothing goes in both.

Written by [`workflow-retro`](.claude/skills/workflow-retro/SKILL.md) (`/retro`, manual-only).
Every figure is read from a tool result; anything unavailable is listed under `## Not measured`
rather than estimated.

---

### 2026-10-01 — spec 0016 Project Context · 5 agents · 490,171 tokens · stopped: success

**Composed by hand as the worked example for the skill's format, from this session's
`<usage>` blocks — not by invoking the skill.**

| # | Agent | Label | Tokens | Tools | Duration | Outcome |
|---|---|---|---:|---:|---:|---|
| 1 | researcher | prompt-assembly | 90,843 | 37 | 2m 42s | returned |
| 2 | researcher | agents-skills-repo | 82,778 | 47 | 3m 13s | returned |
| 3 | researcher | client-surfaces | 67,038 | 43 | 3m 07s | returned |
| 4 | spec-creator | write-0016 | 109,265 | 21 | 7m 10s | returned |
| 5 | spec-creator | closes (resumed, #4) | 140,247 | 20 | 4m 18s | returned |
| | | **total** | **490,171** | **168** | **20m 31s** | |

**Shape.** 1–3 launched in one message (parallel), then 4, then 5 as a resume of 4 rather than a
fresh spawn — so 4's context carried into 5 and the spec did not have to be re-read.

**Subagent vs. main thread: 490,171 tokens against 169.5k of messages — 2.9×.** None of it appears
in `/context`, which reported 210.2k total and showed the session as 21% full. The orchestrator
spent nearly three times the visible conversation on work it could not see the cost of. This is the
single number that most changes how a run should be planned.

**Parallelism: 2.8×.** Three researchers, 543,148 ms summed against 193,365 ms wall. The fan-out
was correctly shaped — three disjoint areas (server prompt path, server persistence, client
surfaces), one message, no serial dependency between them.

**Corrections — agent → coordinator, twice. Both are briefing defects, not agent failures.**

1. **Render order.** The coordinator's brief asserted the Project context block renders "third,
   after System and Skills", having read that off a mockup. `spec-creator` checked the assembler and
   returned the real order (`reviewer-core/src/prompt.ts:262-311`): `system, skills, task,
   pr_description, intent, memory, repo_map, specs, callers, diff`. The mockup only *looked* like
   third place because that run had no task/intent/memory rows to draw. Repeated by 1 pass before
   being caught; the agent wrote the criterion against the verified order rather than inheriting the
   brief's version.
2. **`PromptAssembly` is a fixed-key record.** The brief named a new `PromptSectionName` as the
   contract change. `spec-creator` found that a section name alone is invisible to the client — the
   persisted `PromptAssembly` needs the key too, in both vendored copies. Entered through an
   incomplete brief; caught before it reached the test plan.

Both were verified at source by the coordinator before acceptance, not taken on the agent's word.

**The question asked vs. the question that mattered.** Researcher 1 read `reviewer-core/src/prompt.ts`
in full and correctly reported the unwired `specs` slot and `wrapUntrusted` — but **not** that the
slot emits the literal header `## Project context` (`prompt.ts:301`), the exact string the new
feature collides with. It answered what it was asked. `spec-creator` found it two steps later and
added a guard asserting exactly one such header in the assembled message.

*Brief-template fix:* a research brief about an area a feature will extend must ask **"what would
collide with X"**, not only "does X exist".

**Duplicate coverage — three overlaps across the fan-out, none fatal.** Researchers 1 and 2 both
independently reported `ReviewInput.specs`, `wrapUntrusted` and `safe-read.ts`; 1 and 3 both
reported that `design/` held no feature folder. The overlap is corroboration rather than waste —
two agents converging raised confidence in the unwired-slot finding, which the whole spec rests on.
But no brief said who owned the prompt path, so the duplication was unplanned. *Fix:* one ownership
sentence per brief in a fan-out.

**Capability denials — 1, and the first diagnosis of it was wrong.** Researcher 2 was denied
`find`/`ls` on `server/src/modules/repo-intel/pipeline` and **returned 1 of its 7 questions
unanswered** (whether the repo-intel walker's extension filter skips `.md`). It reported the denial
rather than guessing, which is correct.

This retrospective's first proposal was to grant the permission. **That was wrong, and acting on it
would have reverted a verified security control.** `Bash(find:*)` and `Bash(rg:*)` are in `deny`
deliberately (`.claude/settings.json:43-44`): a `/pr-self-review` security pass found that
`find -exec`, `find -delete` and `rg --pre=COMMAND` execute arbitrary programs, and confirmed by
probe that with `Bash(find:*)` allowed, `find . -maxdepth 0 -exec echo … \;` ran with **no
permission prompt** (root `INSIGHTS.md:172-176`). `ls` was never the problem — it is already
allowed; a deny matches any compound containing the word, so the chained `find` refused the whole
command.

The real root cause is a **contradiction inside the agent file**. `researcher.md:37` tells the agent
that `find` and `rg` are denied and to use `Glob`/`Grep`. But `researcher.md:161` — the output
template the agent imitates — modelled the `How` column as `` `rg '<pattern>' server/src` ``. The
file forbade a command on one line and demonstrated it on another, and the demonstration won.

*Fix applied:* the template now reads `Grep '<pattern>' in server/src`. The permission stays denied.

**The generalisable lesson, and the reason this entry exists:** a retrospective's proposals are
themselves unverified claims. This one named a permission as the gap after reading a denial message,
without checking why the deny existed. Check what a guard is *for* before proposing to remove it —
and prefer the reading where the agent, not the guard, is wrong.

**Unused output: none wasted.** Researcher 3's Donut/coverage findings did not reach the spec, but
they informed the decision to *cut* the coverage donut — a finding that kills scope has earned its
cost.

**Termination: success.** Spec written, `check-specs.sh` green, 50 criteria, `status: draft` awaiting
user approval. No cap hit, no agent died, no stop.

## Not measured

- **Main-thread token consumption.** `/context` reports a 169.5k messages figure for the session at
  one moment; the cumulative cost of the orchestrating thread across the run is not exposed.
- **Dollar cost.** No pricing table in this repo; deliberately not estimated.
- **Overlap between spec-creator's two runs.** No `file:line` citation comparison was done between
  #4 and #5, so how much of #5's 140,247 tokens was re-reading is unknown.
- **Whether the 2.9× subagent ratio is typical.** One run is not a baseline. Re-measure before
  treating it as one.

## Proposed changes — all applied 2026-10-01

- [x] ~~`.claude/settings.json` — allow `ls`/`find` under `server/src/modules/**`~~
      **Rejected on evidence; replaced.** It would have reverted a deliberate security control
      (`INSIGHTS.md:172-176`). Applied instead: `.claude/agents/researcher.md:161` — the output
      template no longer models `rg`, the command line 37 forbids. The deny stands.
- [x] `.claude/agents/researcher.md` — method step 6: when research precedes a feature that will
      extend an area, ask **"what would collide with X"**, not only "does X exist"
      (the `## Project context` header collision was missed by an agent with the file open).
- [x] `.claude/agents/researcher.md` — method step 7: in a fan-out, each researcher states the area
      it treated as its own, so the caller can tell corroboration from unplanned duplication
      (three unplanned overlaps this run).
