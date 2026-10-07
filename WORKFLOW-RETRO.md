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

## Reviewer self-assessment, and the one pattern worth carrying

`security#1` ran four rounds and raised six findings. Its own closing read, which it volunteered:
**the only finding that survived contact with measurement unchanged was the first one** — the
denylist tool pin, which it had verified against the code. **Both findings it graded from category
knowledge were wrong, and wrong in the same direction:** it reasoned "this pattern is a known class"
instead of reproducing it.

- `unbounded-yaml-parse-of-pr-input` — retracted by its own measurement. PyYAML shares the aliased
  object; `9**12` nodes parse in 0.002s/12 MB. The guard it prompted was reverted the same day, and
  cost a commit, a round, a rejected-valid-YAML bug, a bypassable grep and a `timeout` dependency
  that misreports all 17 skills when absent.
- `ceiling-note-outweighs-the-code-it-guards` — it then caught that the *revert's* 13-line
  explanation was itself category bait: "billion laughs / expansion bomb / OOM-killed runner" next
  to `safe_load` pattern-matches to the error it had just made.

**The coordinator repeated the failure.** The bad finding was implemented without reproducing it
either — the second failure is the implementer's, not the reviewer's. A finding is a claim; a
reviewer reasoning from a category and an implementer acting on it are two independent chances to
catch the same error, and here both were spent.

*Transferable rule:* a resource-exhaustion or expansion claim gets reproduced against the actual
library before anything is built from it. One `is` check and one timed parse settled this one.
Recorded with the measurement in root `INSIGHTS.md`, 2026-10-01.

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
- [x] **`.claude/agents/spec-creator.md:24-27`** — **measured, and the claim was right.** Two probes
      from a fresh `claude -p --agent spec-creator`: `drizzle-orm-patterns`
      (`allowed-tools: … Bash …`) did not materialise `Bash` → `BASH_NOT_IN_MY_TOOLSET`;
      `spec-authoring`, which loaded cleanly, left the toolset identical →
      `SKILL_LOADED_TOOLSET_UNCHANGED`. Loading a skill adds instructions, never tools, so
      `allowed-tools` grants permission for tools already in the roster rather than adding one.
      The sentence now carries the measurement instead of asserting the comfortable answer, and
      `KNOWN_SAFE` records why `Skill` is admitted. **Residual, left open on purpose:** probe 1's
      skill errored rather than loading and probe 2's declares no `allowed-tools`, so a
      successfully-loading skill that *does* declare them has still not been observed.
- [x] **`.claude/agents/spec-creator.md:26-27`** — the third copy of the tool-pin claim now points
      at the test and its admission rule instead of restating denylist semantics.

### 2026-10-06 — spec 0018 PR Brief · 43 agents · 5,678,817 tokens · stopped: success

Run spanned 2026-10-02 to 2026-10-06: Explore fan-out → spec (3 passes) → plan (2 passes) →
implementation (4 implementers) → plan-verifier → architecture-reviewer + test-writer → doc-writer →
`/pr-self-review` (11 shards × 3 rounds) → push → PR #22.

**Shape and cost (measured, from `<usage>` blocks and `/context`).**

| Phase | Agents | Tokens | Summed duration |
|---|---|---|---|
| Explore fan-out | 3 | 332,180 | 730s |
| Spec + plan | 5 | 756,733 | 1,916s |
| Implementation | 4 | 850,369 | 3,643s |
| Gate + reviewers + docs | 4 | 661,331 | 1,692s |
| `/pr-self-review` ×3 rounds | 27 | 3,078,204 | 3,732s |
| **Total** | **43** | **5,678,817** | **195.2 min** |

**Subagent vs. main thread: 5,678,817 against 627.6k of messages — 9.0×.** None of it visible in
`/context`, which reported 67% of a 1M window while the run had actually spent nearly six times that
window's worth outside it. The previous entry measured 2.9×; this run is three times worse, and the
cause is the review phase, which alone is **54% of all subagent spend**.

**Parallelism.** Wall clock was not measured (see Not measured). Longest-agent duration is a lower
bound on wall time, so `longest / summed` upper-bounds the speedup: Explore 269s/730s, implementers
1,726s/3,008s, review round 1 324s/2,257s (11 agents, the widest fan-out). No fan-out looks
serialized.

**The delta-re-review discipline saved tool calls, not tokens — measured.**

| Round | Agents | Files under review | Tool uses | Tokens/agent |
|---|---|---|---|---|
| 1 | 11 | 56 | 222 | 101,395 |
| 2 | 9 | 5 | 57 | 117,530 |
| 3 | 7 | 5 | 22 | 129,298 |

Tool uses fell **10×** as the diff shrank from 56 files to 5, exactly as `--since` intends. Per-agent
token cost **rose 28%** across the same span, because a continued agent re-pays its accumulated
context on every message. `pr-self-review/SKILL.md` step 2b justifies continuing agents with a
measured fresh-agent figure (~706k for six re-reviews ≈ 118k each); this run's continued agents cost
117,530 and 129,298 each. The two numbers are not strictly comparable — that figure was one shard six
times, this is different shards — but the saving the step claims is in reads, and it should say so.

**Termination:** success. No cap, no dead agent, no user stop. Three review rounds by choice; see
the correction chain for why stopping at three was the call.

#### Correction chain

**Five agent-corrects-coordinator instances, all on text I authored.** This is the section that
matters, and this run produced more of it than any previous.

1. **The cached-envelope contradiction.** I proposed, in the brief, that the envelope "does not
   snapshot intent/blast" — without checking that `PrBrief`'s four fields are all required
   (`contracts/brief.ts:140-146`). `spec-creator` wrote it into the spec; it survived **two
   spec-creator passes and `check-specs.sh` green at each**, and was caught only by
   `implementation-planner`, which reported that `PrBrief.parse()` would reject the feature's own
   payload. Entered through the brief; cost a third spec round and reversed a user decision.
2. **My enum docblock was wrong in exactly the way it existed to prevent.** I wrote "the first four
   are absent inputs, the rest are budget drops"; `specs` and `issue` are in both groups and
   `TRUNCATION_ORDER` has six members. Caught independently by **`zod` and `typescript-expert`** in
   the same round — corroboration, not duplication.
3. **My comment claimed "no component test can catch this"** in the same commit that added a test
   which does. `react-best-practices` flagged it explicitly **out of its own lens**, noting it
   "invites a future reader to delete the test as impossible".
4. **My comment cited the wrong TypeScript diagnostic code.** Under `satisfies` a missing key is
   TS1360, not TS2741 (TS2741 is the annotation form I replaced). `typescript-expert` **compiled two
   mutations of the shipped file** to establish it.
5. **My own fix created a prompt contradiction.** Wrapping the path blocks moved the authoritative
   file list inside delimiters the system message told the model to "ignore all of". `security`
   caught it one round later.

**Four of the eight defects fixed during `/pr-self-review` were introduced by the fixes themselves**
(items 2–5 above plus the lookup double-assertion). That ratio is the argument for delta re-review
and also the argument for stopping: round 3 still found two more, both in comments, both mine.

**One coordinator-corrects-agent instance worth recording, because the agent's explanation was
plausible and wrong.** The server implementer reported a sibling's `git reset --hard` had wiped the
tree, and wrote an `INSIGHTS.md` entry concluding sibling `Write`/`Edit` calls had coincidentally
restored it byte-for-byte. The real cause was `git stash` — which performs a hard reset internally
and logs `reset: moving to HEAD` — run by the client implementer for a lint baseline. The forensic
tell (`git stash list` empty **and** `git reflog show stash` erroring) is in the corrected entry. An
agent diagnosing an incident it was a victim of will reach for the cause it can see.

#### The question asked vs. the question that mattered

The server `Explore` agent read `contracts/brief.ts` in full and **correctly quoted `PrBrief`'s four
required fields**. It was asked "what exists"; it was not asked "what would reject a payload that
omits them". The contradiction then travelled through two spec passes. Same shape as the previous
entry's header-collision instance, and the same fix: the brief template must ask what would
**collide with or reject** the proposed design, not only what is present.

Second instance: the loading-state race (`usePrBrief` destructuring only `data`) was found by a
review shard reading the destructure. No earlier agent — implementer, `plan-verifier`, `test-writer`
— was asked "which states of this hook does the component ignore", and no test could reach it,
because every component test stubs the hook to resolve synchronously.

#### Duplicate coverage

Overlap across shards is by design — `skill-map.json` assigns one file to several lenses — so most of
it is corroboration and should be read as such:

- The orphaned JSDoc: `zod` and `typescript-expert`, independently, same round.
- The missing rate limit: `security` (SUGGESTION) and `fastify` (WARNING), round 1.
- `RISK_SEVERITIES` mirror and the dead `focusRow` style: `react-code-organization` and
  `typescript-expert`.
- Logic inline in `page.tsx`: `react-best-practices` and `react-code-organization`.

No instance of two agents reading the same file because no brief said who owned it.

#### Capability denials

**The `git` brace-expansion guard fired three times, all from the same mistake: a Python brace in the
same command as a `git` invocation.** The guard is correct — `git diff {a,b}` is one token to the
checker and two paths to git — and the defect is mine for co-locating them. It is not free, though:
the second denial **silently cost a ledger row**. The `doc-writer` append and a Python totals
computation were in one command; the denial killed both, and order 16 was missing from the ledger
until this retrospective recovered it from a notification still in context.

#### Unused output

The verdict carries **31 SUGGESTIONs and 3 WARNINGs that were not acted on**. These were spent well
rather than wasted: they are recorded in `.claude/.pr-self-review/report.md` with file, line and fix,
and two of the WARNINGs (index-keyed expansion state, missing `aria-live`) are the specific things
the still-undone manual dev-app walk would surface.

**One phase-4 reviewer never ran.** Root `AGENTS.md` names three parallel reviewers after the gate —
`architecture-reviewer`, `/code-review`, `test-writer` — and lists only `.it.test`, `./scripts/e2e.sh`
and `/pr-self-review` as the user's. `/code-review` is therefore the session's to invoke, and this
session did not invoke it. `architecture-reviewer` stated plainly that a clean layering report "says
nothing about bugs — that is `/code-review`'s question", and three `pr-self-review` shards deferred
findings to it by name. **No correctness-focused review of this diff has happened.**

#### Not measured

- **Wall-clock time for every fan-out.** Only per-agent durations were captured; the ledger has no
  launch/return timestamps, so the parallelism figures above are bounds, not measurements.
- **Main-thread tokens per phase.** The 627.6k is a single `/context` reading at the end.
- **7 of 43 rows were captured retroactively** (`capture` field set) from notifications still in
  context — `doc-writer` and all six round-3 reviewers. They are measured, but they survived by luck:
  one compaction and they were gone.
- **Dollar cost** — no pricing table in this repo.
- **Whether the three review rounds converged.** Rounds 2 and 3 each found new defects; nothing
  establishes that a fourth would not.

## Proposed changes

```
[ ] .claude/skills/pr-self-review/SKILL.md step 2b — state that --since saves READS, not
    tokens. Measured this run: tool uses fell 10x (222 -> 22) as the diff shrank 56 files
    -> 5, while tokens/agent ROSE 101,395 -> 129,298, because a continued agent re-pays its
    accumulated context each message. The step currently cites ~706k/6 fresh re-reviews
    (~118k each) as the thing to avoid; continued agents here cost 117,530 and 129,298 each.
[ ] .claude/agents/researcher.md + the Explore brief template — ask "what would reject or
    collide with the proposed design", not only "does X exist". Evidence: the server Explore
    agent quoted PrBrief's four required fields correctly and was never asked whether an
    envelope omitting them would parse; the contradiction survived two spec passes and
    check-specs green before implementation-planner caught it.
[ ] AGENTS.md phase 4 — add /code-review to the session's own checklist, or state who runs
    it. It is named as one of three parallel reviewers and is not in the user-only list, and
    this run skipped it: no correctness review of a 4,697-line diff has happened.
[ ] AGENTS.md "Whenever a subagent's <task-notification> arrives" — note that the append must
    be its own Bash call. A ledger append co-located with a command the brace guard denies
    takes the row with it; that is how order 16 was lost this run.
[ ] No change proposed to the git brace guard. I checked why it exists before writing this:
    the denial text states the mechanism (git diff {a,b} is one token to the checker, two
    paths to git) and root INSIGHTS.md:172-176 records a probe where an allowed Bash(find:*)
    let find -exec run with no prompt — the same class of guard, added on evidence. The
    defect here is mine for putting a Python brace in a git command; the fix is the line
    above, not a weaker guard.
```

### 2026-10-07 — spec 0019 Evals · 41 agents · 6,206,542 tokens · stopped: success

**Shape:** spec in 4 `spec-creator` rounds → `implementation-planner` → 4 implementer waves (2a‖2b)
→ `plan-verifier` gate → `architecture-reviewer` ‖ `test-writer` ‖ `/code-review` → 2 fix agents in
parallel → `/pr-self-review` 14 reviewers, then 8 resumed for a delta round.
**Subagent vs. main thread:** 6,206,542 subagent tokens against **699.2k** of messages — **8.9×**,
none of it visible in `/context`'s own breakdown. The previous entry measured 2.9× on a 5-agent run;
this is triple that on 41 agents, and the orchestrator saw none of it while spending it. (`/context`
was run at 740.8k/1m total, 74%: messages 699.2k, system+tools 24.8k, skills 6.5k, memory 6.4k.
Measured after the run, so it includes this retro's own composition.)
**Termination:** success. One user interruption at the start ("stop. proceed with plan mode instead
of auto") before any agent launched. One external block: `git push` rejected 5× with GitHub HTTP 500
across both HTTPS and SSH while githubstatus.com read all-operational; it cleared ~20 min later with
no change from us. `git push --dry-run` succeeding throughout was what localised it to the
pack-upload path rather than to the commit.

**Parallelism** (summed agent duration ÷ longest in the group, from the `ms` column):

| Group | n | summed | longest | ratio |
|---|---|---|---|---|
| phase-1 researchers | 2 | 805s | 597s | 1.3× |
| waves 2a ‖ 2b | 2 | 2300s | 1506s | 1.5× |
| arch-reviewer ‖ test-writer | 2 | 321s | 199s | 1.6× |
| `/pr-self-review` round 1 | 14 | 4123s | 599s | **6.9×** |
| `/pr-self-review` round 2 | 8 | 1249s | 283s | 4.4× |

The 14-way fan-out is the only group where parallelism paid properly. The 1.3× and 1.5× pairs are
two-agent groups with one long pole each — fine, but not worth calling parallel.

**The delta re-review rule, measured on the same 8 shards.** Round 1: 226 tool uses. Round 2 after
resuming the same agents with an explicit delta: **63**. Same shards, same skills, 3.6× fewer calls
(23.6 → 7.9 per agent). Six of the 14 shards were never woken at all.

**`--since` was unusable and the skill does not cover why.** Round 1 reviewed *uncommitted* work on
top of `15db3cc`; by round 2 it was committed as `a65850a`, so `--since 15db3cc` hands a reviewer the
entire feature, not the delta — confirmed by running it against `postgresql-table-design#1`, whose
two files the fixes never touched and which came back with the whole schema diff. No sha represents
what round 1 saw. The delta was computed by intersecting the changed paths against each shard's
`files` in `plan.json` instead.

**Corrections — four trace to the coordinator's brief.**

1. **`rangesIntersect` / AC-11.** The coordinator accepted `implementation-planner`'s O(1) default
   without amending the spec, leaving AC-11 requiring "the bounded iteration of `rangeIntersects`".
   `spec-creator` round 4 flagged it unprompted: under the accepted default AC-11 is literally false
   and `plan-verifier` would have read it as `Contradicted`. Entered via the brief, survived 1 pass.
2. **`loadSkills`.** The coordinator's plan §4 recommended lifting it whole into
   `modules/skills/helpers.ts`; the spec carried that forward. `implementation-planner` overruled it,
   citing `server/INSIGHTS.md:472-478` — that would put I/O into the one file class `pnpm arch`
   cannot police, the exact trap already recorded. Entered via the brief, survived 1 pass.
3. **The bare-hunk diff fixture.** Wave 3 flagged `evals-executor.it.test.ts`'s `DIFF` as a headerless
   hunk that parses to `files: []`, and said it had not fixed it. The coordinator fixed **that one
   file**, recorded an INSIGHTS entry saying so, and did not grep for the pattern. Two more files held
   the identical constant. The integration lane found them on its first run (`waitFor timed out` in
   `evals-cancel.it.test.ts`, LLM never called). One `grep -rn "const DIFF" server/test` would have
   caught all three.
4. **The terminal-write guard test.** The coordinator commissioned the guard but not how to prove it.
   `typescript-expert#3` compiled four predicate variants through `PgDialect` and found the test
   passes when `or` replaces `and` — params are byte-identical, so the one substitution that would
   overwrite every live batch is the one the test cannot see. A test written for a
   coordinator-commissioned fix, passing in the catastrophic case.

Reverse direction, recorded for balance: `spec-creator` round 2 wrote an AC-72 boot test that could
never pass (the reap is inside `if (config.nodeEnv !== 'test')`), and the coordinator caught it by
reading `app.ts`. Agent-to-agent: `implementation-planner` miscounted `EvalBatchRecord` at 16 fields;
wave 1 caught it against AC-7's own list of 15 and followed the criterion over the plan.

**The question asked vs. the question that mattered.** `architecture-reviewer` (order 14) returned
zero violations and was right: no changed file imports anything forbidden. `onion-architecture#1`
(order 23) found that `eval-run-executor.ts` matched **neither** gate —
`.dependency-cruiser.cjs:29`'s `(service|run-executor)\.ts$` nor `eslint.config.mjs:64`'s glob — so
the one file driving real model calls could import `drizzle-orm` with both checks green. The brief
asked "does this violate the rules"; nobody asked "do the rules cover this file". Verified by the
coordinator afterwards: forbidden import → `pnpm arch` 1 error, reverted → clean.

Second instance, same shape: `plan-verifier` enumerates `AC-N` and passed 77/77. The requirement
*"the tab refetches `GET /eval-runs/:batchId` on stream completion"* was written as prose in
`## Edge cases`, so the completeness gate could not see it, and `/code-review` found the UI never
refetched — a finished sweep never reaching the screen.

**Duplicate coverage — mostly corroboration, one paid-for.** Four reviewers independently reached the
same `PATCH /eval-cases/:id` 500 from four different links in the chain (`fastify#1` the body schema,
`drizzle#1` the `.set({})` throw site in `mapUpdateSet`, `zod#1` the missing refine, `typescript-expert#2`
the `return row!`). Two independently reached the void-return finding in round 2. That is corroboration
and it is why the defect was believed without further checking. The paid-for duplication is structural:
`/pr-self-review` plans against `origin/main`, and this branch carries 14 committed commits of **spec
0018 that had already passed `/pr-self-review` in a prior session** — so 114 files were reviewed where
the 0019 change set is smaller. The 0018 share of the 1,741,815 round-1 tokens is **not measured**.

**Capability denials.** The git/shell brace guard fired **3×** this run — on a `wc` call carrying a
Python brace, on a `git diff` with a Python brace, and on a heredoc containing JSON. Cost: 3 retries,
and the third nearly lost the retro ledger append a second time (worked around with `Write` + `cat`).
The previous entry already proposed the fix for exactly this and it has not been applied. `find` was
denied once (used `ls`), and one compound `cd && head && find` was denied and split.

**Unused output.** Order 3, the course-`evals/` package survey: 98,813 tokens, 597s, returned *after*
the plan's §4 had already been drafted from direct reads of `package.json`, the file tree and one case
file. Spent well rather than wasted — it contributed two things that reached the plan (the
`permissionMode: "bypassPermissions"` safety note, and that the README's "ships with no example cases"
claim is false) — but the plan did not wait for it and would have shipped unchanged without it.

**Capture drift, again.** The ledger stopped at order 18 of 41. The 23 rows for `/pr-self-review` were
back-filled at the end from notifications still in context, which worked only because the context had
not compacted — precisely the failure the previous entry proposed a `SubagentStop` hook for. One row
(order 15, `test-writer`) had been recorded `0/0/0` when its notification did carry usage; corrected to
92,358 / 17 / 198,731 and marked as back-filled.

**Not measured:** session wall-clock; the spec-0018 share of round-1 review cost; a systematic
`file:line` overlap diff across the 14 reports — the convergences named above were read from the
reports, not computed. The main-thread ratio was `not measured` when this entry was written and was
filled in afterwards, once the user ran `/context`; the figure is post-run, so it includes composing
this entry. **The capture rule should extend to it:** `/context` costs nothing and is unavailable
retroactively once a session compacts, so the orchestrator should run it at the point the last agent
returns, not hope to be asked.

## Proposed changes
[ ] `.claude/agents/spec-creator.md` brief template — require the coordinator to paste the routed
    `insights-for.sh` output into the brief. Evidence: order 4 wrote 62 criteria having read no
    INSIGHTS at all (it has no `Bash`, so the router is unavailable to it, and it said so); round 2
    then folded in 6 routed entries, two of which changed criteria (Drizzle `numeric` is always a
    string; one unpriced call nulls a whole run's cost). **No proposal to grant it `Bash`** — I
    checked why it lacks it: `.claude/hooks/spec-scope-gate.py` confines it to `specs/`, and a spec
    writer that can run commands is a different threat model. The agent is not wrong here; the brief is.
[ ] `.claude/agents/architecture-reviewer.md` brief template — ask "is each changed file actually
    matched by the gates that should govern it?", not only "does it violate them". Evidence: order 14
    clean, order 23 found `eval-run-executor.ts` outside both the dependency-cruiser regex and the
    ESLint zone; coordinator confirmed by adding a forbidden import and watching `pnpm arch` fail.
[ ] `.claude/skills/spec-authoring/SKILL.md` — a requirement a tester could fail must be an `AC-N`,
    never prose. Evidence: the stream-completion refetch lived in `## Edge cases`; `plan-verifier`
    enumerates `AC-N`, passed 77/77, and the UI shipped never refetching until `/code-review` found it.
[ ] `AGENTS.md` phase 3 (fix commissioning) — when a fix is delegated, require the implementer to
    state how its new test fails, and to show it. Evidence: order 18 mutation-checked both fixes and
    reported the failure messages; order 33's guard test was not mutation-checked, and order 41 showed
    it passes under the `or`-for-`and` substitution that would overwrite every live batch.
[ ] `AGENTS.md` phase 3 — before recording a fix as done, grep the repo for the pattern. Evidence: the
    headerless-diff fixture was fixed in 1 of 3 files and written up as fixed; the Docker lane failed
    on the other two, costing a full ~193s lane run plus diagnosis.
[ ] `.claude/skills/pr-self-review/SKILL.md` §2b — record whether `--since` is usable when the prior
    round reviewed *uncommitted* work, and whether `--base` narrowing still yields a verdict the gate
    accepts. Evidence: `--since 15db3cc` returned the whole feature for a shard the fixes never
    touched; and the coordinator kept the default base — re-reviewing 14 already-reviewed commits of
    spec 0018 — because it believed narrowing would break the fingerprint and **did not verify that
    belief**.
[ ] `AGENTS.md` phase 5, beside the `.runs.jsonl` rule — the orchestrator should run `/context` when
    the last agent returns, and record `messages` next to the subagent total. Evidence: this entry
    shipped with the ratio as `not measured` and was corrected only because the user happened to run
    `/context` afterwards; the figure is now post-run and therefore slightly inflated. It is the one
    number in §1 the orchestrator cannot reconstruct later, for the same reason the usage rows cannot
    — the session compacts and it is gone.
[ ] No new proposal on the brace guard. The previous entry's line still stands unapplied and this run
    hit it 3 more times; the recurrence is the evidence, not a reason to weaken the guard.
