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

---

### 2026-10-01 — full session · 7 agents · 728,624 tokens · stopped: success (PR #18 open)

Supersedes the entry above, which covered only the first five agents. Composed from `<usage>`
blocks still in context — **`.claude/.retro/` does not exist; the capture rule never ran.** See
"The capture rule failed on its first session" below.

| # | Agent | Label | Tokens | Tools | Duration | Outcome |
|---|---|---|---:|---:|---:|---|
| 1 | researcher | prompt-assembly | 90,843 | 37 | 2m 42s | returned |
| 2 | researcher | agents-skills-repo | 82,778 | 47 | 3m 13s | returned |
| 3 | researcher | client-surfaces | 67,038 | 43 | 3m 07s | returned |
| 4 | spec-creator | write-0016 | 109,265 | 21 | 7m 10s | returned |
| 5 | spec-creator | closes (resume of 4) | 140,247 | 20 | 4m 18s | returned |
| 6 | general-purpose | security#1 round 1 | 107,753 | 22 | 4m 56s | returned |
| 7 | general-purpose | security#1 round 2 (resume of 6) | 130,700 | 14 | 3m 56s | returned |
| | | **total** | **728,624** | **204** | **29m 23s** | |

**Shape.** One fan-out (1–3, parallel), then two resume-pairs. Both resumes were correct calls:
#5 carried #4's spec context, and #7 re-reviewed only two moved files under `--since` instead of
re-reading all sixteen.

**Parallelism: 2.8× on the only fan-out** — 543,148 ms summed against 193,365 ms wall. The other
four agents were genuinely sequential (each needed the previous one's output), so there is no
missed fan-out to report.

**Subagent vs. main thread.** At the one point `/context` was run — after agent 5 — subagent spend
was 490,171 tokens against 169.5k of messages, **2.9×**, with `/context` showing the session 21%
full and none of the subagent cost. The final ratio is **not measured**: `/context` was not re-run,
so the current message count is unknown, and 728,624 ÷ 169,500 would divide by a stale denominator.

## The capture rule failed on its first session

`AGENTS.md` gained the rule mid-session: append a usage row to `.claude/.retro/<session>.runs.jsonl`
as each `<task-notification>` arrives. **Two agents returned after that rule existed and neither was
recorded.** `.claude/.retro/` was never created.

This was predicted in `workflow-retro/SKILL.md` ("prompt discipline with no enforcement, which this
repo knows drifts") and the prediction was confirmed within the hour, by the session that wrote it.
The numbers survived only because nothing compacted — on a long run they would be gone, which is
the exact failure the rule exists to prevent.

*Conclusion:* the rule does not work as prose. See proposed changes.

## Corrections — six, and five of them correct the coordinator

| # | Claim | Corrected by | Passes it survived |
|---|---|---|---|
| 1 | "Project context renders third, after System and Skills" — read off a mockup | `spec-creator`, against `prompt.ts:262-311` | 1 (the brief) |
| 2 | Brief named `PromptSectionName` as the whole contract change | `spec-creator` — `PromptAssembly` is a fixed-key record, invisible to the client without its own key | 1 |
| 3 | The tool pin is sound | `security#1` — it was a **denylist**; verified it passed `Artifact` | 0 (caught same session) |
| 4 | "Three of these commits are already-merged duplicates" | `git cherry` — all five patches absent from main | 1, stated to the user |
| 5 | Retro proposal: grant the `find` permission | my own read of `INSIGHTS.md:172-176` — would have reverted a verified control | 1, written into a tracked file |
| 6 | (attempt) mutate `spec-creator.md` to test the pin | auto-mode classifier, as self-modification | 0 |

**#5 is the one that matters.** This skill's own first output contained a proposal that would have
re-granted arbitrary execution and recursive deletion to every clone. It was caught **only because
the user asked to apply all three proposals**, which forced a read of `settings.json`. Had they
accepted the summary, it would have shipped. A retrospective's proposals are unverified claims, and
nothing downstream reviews them — the rule added to the skill after this is the mitigation.

**#3 is the second.** A reviewer found a real defect in a file written earlier in the same session,
in work that had already passed its own tests. The denylist→allowlist inversion was proven by
mutation: the old pin passed `Artifact`, the new one fails it along with `Bash` and `NotebookEdit`.

## The question asked vs. the question that mattered

Researcher 1 read `reviewer-core/src/prompt.ts` in full and reported the unwired `specs` slot — but
not that the slot emits the literal header `## Project context` (`prompt.ts:301`), the exact string
the new feature takes. `spec-creator` found it two steps later. Fixed as `researcher.md` method
step 6 during this session.

## Duplicate coverage — three overlaps, all corroborating

Researchers 1 and 2 both reported `ReviewInput.specs`, `wrapUntrusted` and `safe-read.ts`; 1 and 3
both reported the missing `design/` folder. None wasted — the unwired-slot finding carries the whole
spec and two independent reports raised confidence in it. But no brief assigned ownership, so the
overlap was unplanned. Fixed as `researcher.md` method step 7.

## Capability denials — two, one with a cost and a root cause

- **Researcher 2**, denied `find`/`ls` on `repo-intel/pipeline`, **returned 1 of 7 questions
  unanswered**. Root cause was not the permission: `researcher.md:37` forbids `rg`/`find` while
  `researcher.md:161`'s output template *demonstrated* `rg`. The demonstration won. Fixed.
- **The coordinator**, blocked by the auto-mode classifier from mutating `spec-creator.md` to test
  the new pin. Correct refusal; the test was run against in-memory copies instead, losing nothing.

## Gate events — both correct, neither a nuisance

`/pr-self-review` refused twice: the first push as **stale** after the fix changed content, and
`write-verdict` as **tree-changed-since-plan** after the fix was committed. Both were real staleness,
both resolved by re-running `plan` rather than working around the gate. One wasted operation: a
cherry-pick of `d77a955` conflicted in four files, which was the cheapest way to *prove* it depends
on commits not in main — informative, not waste.

**Termination: success.** PR #18 open, self-review PASS (0 CRITICAL, 1 WARNING, 3 SUGGESTION).

## Not measured

- **Current main-thread token count.** `/context` was run once, after agent 5; the final figure is
  unknown and was deliberately not extrapolated.
- **Dollar cost.** No pricing table in this repo.
- **Read-overlap between the two resume pairs.** No `file:line` citation comparison was done
  between #4/#5 or #6/#7, so how much of their 270,947 combined tokens was re-reading is unknown.
- **Whether 2.8×/2.9× are typical.** Two sessions is not a baseline.

## Proposed changes

- [ ] **`.claude/hooks/` — add a `SubagentStop` hook that writes the usage row**, and delete the
      `AGENTS.md` prose rule it replaces. Evidence: the rule was added mid-session and ignored by
      the same session, twice. `workflow-retro/SKILL.md` already names this as the remedy if rows
      go missing. *This adds an automatic hook: it runs on every subagent return, in every session.*
- [ ] **`.claude/agents/spec-creator.md:24-27`** — it asserts `Skill` "cannot run the scripts a
      skill ships (that needs the `Bash` you lack)" with no evidence, and
      `drizzle-orm-patterns/SKILL.md:4` declares `allowed-tools: … Bash …`. Measure it
      (`claude -p --agent spec-creator` invoking that skill, from a fresh process), then state the
      measured answer or drop the claim. Tracked as the open WARNING on PR #18.
- [ ] **`.claude/agents/spec-creator.md:26-27`** — a third copy of the tool-pin claim, still
      describing the retired denylist semantics. Found by `security#1` but not filed (unchanged
      file). Point it at the test rather than restating it, per the same rule applied to
      `spec-scope-gate.py` this session.
