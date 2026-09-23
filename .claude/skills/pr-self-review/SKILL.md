---
name: pr-self-review
# Manual only (spec 0006): the model cannot auto-invoke it; a person runs /pr-self-review.
disable-model-invocation: true
description: >-
  Reviews ALL local changes (branch commits since main + staged + unstaged + untracked) before a
  pull request exists, by routing every changed file to the repo skills that apply to it — UI skills
  (react-best-practices, react-code-organization, next-best-practices, react-testing-library) on
  client/ files, backend architecture skills (onion-architecture, fastify-best-practices,
  drizzle-orm-patterns, postgresql-table-design) on server/ and reviewer-core/ files, security /
  typescript-expert / zod across both — and records a verdict. Any CRITICAL finding blocks opening,
  pushing or merging the PR (enforced by .claude/hooks/pr-self-review-gate.py). Use before
  `gh pr create`, `git push` or `gh pr merge`; when the gate denies one of them; or when the user
  says "self review", "pr self review", "review my changes before the PR", or runs /pr-self-review.
---

# PR Self Review

Checks the local diff against this repo's own skills **before** anything reaches GitHub. It has two parts:
- **Deterministic:** `scripts/review_scope.py` finds the changes, routes them to skills, applies the
  repo's "Do not touch" rules, and fingerprints the tree.
- **Judgement:** one reviewer subagent per skill (and per chunk of files), plus an adversarial
  check of every CRITICAL. That part is this file.

Routing is data: [skill-map.json](skill-map.json). To change which skill reviews which paths,
edit the map, not this file.

## The gate: why this runs "automatically"
`.claude/hooks/pr-self-review-gate.py` (a `PreToolUse` hook) denies these commands:
- `gh pr create`, `gh pr merge`, `gh pr ready` and `git push`;
- their `gh api` equivalents, unless `review_scope.py check` passes.

The check passes only when:
- `verdict.json` exists;
- its fingerprint matches the **current** local changes, so any edit after the review makes it stale;
- it has **no CRITICAL**.

When the gate denies an action, run this skill, fix what it reports, and retry. The opt-in git hook `scripts/git-hooks/pre-push` runs the same check for pushes made outside Claude.

**Never** work around the gate: no `--no-verify`, no hand-editing `.claude/.pr-self-review/*`, no downgrading a CRITICAL you have not refuted. Committing reviewed work does not invalidate the verdict; changing any content does.

## Procedure

### 1. Plan
```bash
python3 .claude/skills/pr-self-review/scripts/review_scope.py plan    # --base <ref> to override
```
The command writes `.claude/.pr-self-review/plan.json` and prints the reviewer list (`<skill>#<n>`), unmapped files and the **repo-rule CRITICALs**.
- **Nothing to review:** if it prints "Nothing to review", stop; `check` already passes.
- **Repo-rule CRITICALs:** these are migrations edited, lockfile drift, `client/src/vendor/ui` edits, and so on. They come from AGENTS.md and are final: they block, and no agent can downgrade them. Tell the user now; reviewing can continue in parallel.
- **Large plans:** tell the user how many reviewers will run (large branches produce 20+). If they want fewer, they can narrow the diff with `--base`.

### 2. Review, one subagent per reviewer id, all in ONE message (parallel)
Use `Agent` with `subagent_type: "general-purpose"` and this prompt, filling in `<ID>` and `<SKILL>`:

> You are a read-only code reviewer for the DevDigest repo. Do not edit, write, stage or commit anything.
> 1. Run `python3 .claude/skills/pr-self-review/scripts/review_scope.py show <ID>`. It lists your files with the changed line ranges and the exact `git diff` command. Run that diff; untracked files are new in full.
> 2. Read `.claude/skills/<SKILL>/SKILL.md` and whatever rule files it links that are relevant to these files. That skill is your ONLY lens: report nothing outside it.
> 3. Review ONLY the changed lines. Open surrounding code to understand them, but never report pre-existing issues on unchanged lines. Also read the `INSIGHTS.md` of the package the files are in; its entries are known facts about this codebase.
> 4. Grade each finding with the rubric below. When unsure between two levels, pick the lower one.
>    <paste the "Severity rubric" section verbatim>
> 5. Answer with ONLY a JSON array (use `[]` if you found nothing), where each item is:
>    `{"severity":"CRITICAL|WARNING|SUGGESTION","skill":"<SKILL>","file":"<repo-relative path>","line":<int or null>,"rule":"<short kebab-case rule name>","evidence":"<what the code does, quoting it>","fix":"<concrete change>"}`

If an agent's answer is not a valid JSON array, send it one `SendMessage` asking for the JSON only.

**Note the head sha before you launch them** (`git rev-parse HEAD`). Step 2b needs it.

### 2b. Re-running a reviewer after you fix something

Fixing anything makes the verdict stale, so some reviewers must run again. Two rules, both about not paying twice for the same reading:

- **Only re-run the reviewers whose files actually changed.** Intersect the changed paths with each agent's `files` in `plan.json`; leave the rest alone and carry their reports forward verbatim. Do not assume which ones those are — a one-line fix in a shared file can touch five shards, and a report about code that has since changed must never go in `findings.json`.
- **Continue the same agent with `SendMessage`, do not spawn a new one.** A fresh agent re-reads the whole shard, the SKILL and the INSIGHTS from zero; the original still has all of it and its own earlier reasoning. Give it:

  > Round <n>. Re-run `… review_scope.py show <ID> --since <sha from the round you last reported on>`. It lists only what moved since then, with the diff inline — do not re-run git for it, and do not re-derive findings on the files it lists as unchanged. I fixed: <what>. I did NOT fix: <what>. Report the full array again for this shard: the findings that still stand, plus anything new.

  `--since` also prints "Nothing in this shard changed" when a re-run was not needed at all, which is the cheapest possible answer.

Measured on the branch this rule came from: one shard re-reviewed six times by six fresh agents cost ~706k tokens, and every run re-read the same 30 files to check the 3 that had moved.

**If your own fix introduces a finding, that is a normal outcome, not a reason to keep patching.** On this branch a "fix" for two false denials introduced two arbitrary-file reads; reverting it was correct and cheaper than a ninth round.

### 3. Verify every CRITICAL (skip rule findings)
A false CRITICAL blocks a merge, so each one must survive an adversarial check. For each
reviewer CRITICAL, launch one more `general-purpose` agent, all in one message, with this prompt:

> Try to REFUTE this finding. It came from a code review of local changes in DevDigest. Read the code at `<file>:<line>` and everything it depends on. Also read the rule in `.claude/skills/<skill>/SKILL.md`.
> Finding: <the JSON>
> A CRITICAL is only valid if (a) the code on a changed line really does this, (b) it meets the CRITICAL bar in the rubric, and (c) no guard elsewhere already prevents the impact.
> Answer with ONLY `{"verdict":"confirmed"|"refuted","reason":"<one or two sentences with file:line>"}`.

- **Confirmed:** the finding stays CRITICAL.
- **Refuted:** set `"severity": "WARNING"`, `"downgraded_from": "CRITICAL"` and `"verification": "<reason>"`.

### 4. Record the verdict
Write `.claude/.pr-self-review/findings.json`. It must go in that dir, which is gitignored; a file anywhere else would change the fingerprint. The shape:
```json
{"agents_completed": ["security#1", "onion-architecture#1"], "findings": [ /* every reviewer finding, after step 3 */ ]}
```
`agents_completed` must list **every** reviewer id in the plan. Then:
```bash
python3 .claude/skills/pr-self-review/scripts/review_scope.py write-verdict .claude/.pr-self-review/findings.json
```
The command merges in the repo-rule findings, dedupes by (file, line, rule), and writes `verdict.json` + `report.md`. It exits `0` on pass and `2` on block.

It **refuses** (exit 1) in two cases:
- a reviewer is missing;
- the tree changed since `plan`.

In either case, restart from step 1. Never patch around it.

### 5. Report to the user
Report these things, keeping the full tables in `report.md`:
- the status (PASS / BLOCK);
- counts per severity;
- every CRITICAL, as `file:line`, skill, what's wrong and the fix;
- the WARNINGs in one short list.

On **BLOCK**, say plainly that the PR must not be opened, pushed or merged until the CRITICALs are fixed and this skill has been re-run. Offer to fix them. After fixing, run the whole procedure again: the old verdict is stale by construction.

## Severity rubric
Use one scale, the repo's own: `CRITICAL` / `WARNING` / `SUGGESTION`.

**CRITICAL.** It blocks the merge. Only these, and only on changed lines:
- **Security:** an exploitable flaw. Examples:
  - injection (SQL, command or path) from request or LLM input;
  - a secret or token committed or logged;
  - a route that reads or writes another workspace's data without the workspace check;
  - `dangerouslySetInnerHTML` or markdown HTML fed with untrusted content.
- **Data:** loss or corruption. Examples:
  - a destructive migration or query without a guard;
  - an unscoped `UPDATE`/`DELETE`;
  - a race that can double-apply a write.
- **Architecture:** a dependency-direction break.
  - **Backend (onion-architecture):**
    - a domain/service ring importing Drizzle, octokit, simple-git, openai, `@anthropic-ai/sdk`, ast-grep or p-queue directly instead of through a port;
    - `adapters/**` or `platform/**` importing `modules/**`;
    - a port in `vendor/shared` importing an implementation;
    - `reviewer-core/src` importing anything but `@devdigest/shared` and the stdlib;
    - a `routes.ts` running a DB query itself.
  - **Frontend (react-code-organization):** shared code (`src/components`, `src/lib`) importing from a feature or from `app/`.
- **Contracts:** an API response or `@devdigest/shared` schema change that breaks an existing consumer, e.g. a renamed or removed field or a changed type with no client update.
- **Runtime breakage:** code that will throw or hang on a normal path. Examples:
  - a React rules-of-hooks violation;
  - a server-only module (DB, secrets) imported into a `'use client'` component;
  - a floating promise that can crash the process.
- **Repo rules:** anything `review_scope.py` reports (migrations, lockfiles, vendored UI, skills lock).

**WARNING:** a real defect or skill-rule violation that doesn't meet the bar above, e.g.:
- a missing error handling path;
- an N+1 query;
- logic placed in the wrong layer without a forbidden import;
- a weak test (implementation-detail queries, `fireEvent` where `userEvent` fits).

**SUGGESTION:** style, naming, readability, optional refactors. **Style is never CRITICAL**, and nothing on an unchanged line is reported.

**Skill labels are not verdicts.** Several skills label their own rules CRITICAL / HIGH / MEDIUM, including onion-architecture, react-code-organization, react-best-practices, zod and security. Those labels rank rules *inside that skill*; zod, for example, marks whole categories CRITICAL. A violated rule is CRITICAL here **only** if it also meets one of the bullets above. Otherwise:
- a skill-CRITICAL or HIGH rule becomes WARNING;
- MEDIUM and LOW become SUGGESTION.

## Files
| File | Role |
|---|---|
| `skill-map.json` | path globs → skills; skip list; chunk size |
| `scripts/review_scope.py` | `plan` / `show` (`--since REF` for a delta re-review) / `write-verdict` / `check`; also the gate's command matcher |
| `scripts/test_review_scope.py` | `python3 -m unittest discover -s .claude/skills/pr-self-review/scripts -p 'test_*.py'` |
| `.claude/hooks/pr-self-review-gate.py` | the PreToolUse gate |
| `scripts/git-hooks/pre-push` | opt-in: `git config core.hooksPath scripts/git-hooks` |
| `.claude/.pr-self-review/` (gitignored) | `plan.json`, `findings.json`, `verdict.json`, `report.md` |

**Limits**, all accepted in spec 0005:
- This is a **local** gate. `git push --no-verify` without the git hook, or merging in the GitHub UI, bypasses it.
- The gate matches the shell command text. A `cd` into another repo inside the same command is not tracked.
