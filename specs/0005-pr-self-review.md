---
title: PR self-review skill and local merge gate
status: done  # draft | approved | in-progress | done
packages: [.claude, scripts]
---

## Problem
Local changes reach a GitHub PR with no structured review against the repo's own skills. The
UI, backend-architecture, security and contract skills in `.claude/skills/` only apply when an agent
happens to load them. Nothing stops a PR that breaks the onion dependency rule, edits an existing
migration or leaks a secret.

## Scope / non-goals
- **In scope:**
  - a `pr-self-review` skill that reviews all local changes: branch commits since the merge-base with `main`, plus staged, unstaged and untracked files;
  - routing each changed file to the skills that apply to it;
  - a verdict tied to the exact diff;
  - a gate that blocks PR actions while any `CRITICAL` stands.
- **Non-goals:**
  - GitHub-side enforcement (a required status check / branch protection). The user chose a local gate.
  - Replacing CI (typecheck, lint, tests) or `/code-review`.

## Design
Decisions (agreed 2026-09-19):
- **Local gate:** a Claude Code `PreToolUse` hook, plus an opt-in git `pre-push` hook.
- **Only `CRITICAL` blocks.** The scale is the repo's (`CRITICAL`/`WARNING`/`SUGGESTION`).

**Deterministic half:** `.claude/skills/pr-self-review/scripts/review_scope.py` (python3 stdlib).
- `plan`:
  - base = the merge-base with `origin/main`, falling back to `main`;
  - collects the changed files, with renames split into delete + add;
  - routes them with `skill-map.json` and chunks them into reviewer ids `<skill>#<n>`;
  - runs the repo rules and writes `.claude/.pr-self-review/plan.json` (gitignored).
- **Repo rules (always `CRITICAL`, from AGENTS.md "Do not touch"):**
  - an existing migration or snapshot is modified or deleted, or `_journal.json` changes with no new `.sql`;
  - a lockfile changes without its `package.json`, is deleted, or gains a second lockfile beside it;
  - `client/src/vendor/ui` is edited;
  - `skills-lock.json` changes with no skill change.
- **Fingerprint:** sha256 over the base and the current content (plus the exec bit) of every changed path.
  - It deliberately ignores git state, so committing reviewed work keeps the verdict valid; any content edit makes it stale.
  - A first version hashed `git diff` output and untracked files separately, so committing a reviewed untracked file changed the hash. `RepoFlowTest.test_full_flow` caught it.
- **`write-verdict`** refuses when:
  - the tree changed since `plan`;
  - a planned reviewer did not report.

  It merges the rule findings (which can't be downgraded), dedupes by (file, line, rule), and writes `verdict.json` + `report.md`.
- **`check`:**
  - 0 = passing verdict for this exact tree, or no changes at all;
  - 1 = missing or stale;
  - 2 = blocks.

**Routing (`skill-map.json`):**

| Paths | Skills |
|---|---|
| `client/src/**/*.{ts,tsx}` | react-best-practices, react-code-organization, next-best-practices |
| `client/**/*.test.{ts,tsx}` | react-testing-library |
| `server/src/**` (except the vendored `shared` copy) | onion-architecture |
| app/server/routes/platform | fastify-best-practices |
| `db/**` and repositories | drizzle-orm-patterns |
| schema | postgresql-table-design |
| `reviewer-core/src/**` | onion-architecture, typescript-expert |
| `vendor/shared` or a file importing `zod` | zod |
| non-test TS | security, typescript-expert |

Unmapped reviewable files (workflows, configs, scripts) get `security`. The skip list covers docs, lockfiles, migration SQL, vendored UI, i18n messages and e2e flow JSON.

**Judgement half (`SKILL.md`):**
- One read-only `general-purpose` subagent per reviewer id, all in parallel. Each reads its skill and reviews only the changed lines.
- A shared severity rubric:
  - skills' own CRITICAL/HIGH labels are rule priorities, not verdicts;
  - only security, data, dependency-direction, contract, runtime-breakage and repo-rule issues block.
- An adversarial verifier per `CRITICAL`; a refuted one is downgraded to `WARNING`, with the reason.

**Gate (`.claude/hooks/pr-self-review-gate.py`, `PreToolUse` on `Bash|Write|Edit|MultiEdit`):**
- Denies:
  - `gh pr create|merge|ready` and `git push` (but not `--dry-run` or `--delete`);
  - `gh api` POST `…/pulls` and `…/merges`, PUT `…/pulls/N/merge`, and the GraphQL PR mutations;
  - wrapped forms: `bash -c`, `$(…)`, env prefixes, chained commands.
- The deny reason tells the agent to run `/pr-self-review`. That is how the review runs before every PR.
- Also denies hand-writing `verdict.json`.
- Fails open for non-gated commands and closed for gated ones (a check error denies).
- `sys.dont_write_bytecode` is set, because an untracked `__pycache__` would itself change the fingerprint. `.gitignore` now also ignores `__pycache__/`.

**Accepted limits:**
- a local gate can be bypassed with `git push --no-verify` or from the GitHub UI;
- the gate matches command text, so a `cd` into another repo within one command is not tracked;
- heredoc bodies are skipped as data. The first version read a commit-message line "git push and …" as a push and blocked its own commit; the fix and `test_not_gated` cover it.

## Acceptance criteria
- `/pr-self-review` on a diff with UI and backend files launches UI-skill reviewers only for `client/` files and backend-skill reviewers only for `server/`/`reviewer-core/` files.
- A diff with an edited existing migration always ends `BLOCK`.
- With no verdict, a stale verdict or a blocking verdict, the gate denies `gh pr create`, `git push` and `gh pr merge`. With a passing verdict for the current tree, it allows them.
- Committing reviewed changes keeps the verdict valid; editing any changed file makes it stale.
- `scripts/check-claude-skills.sh` runs the unit tests and fails on a route to a missing skill.

## Test plan
- `python3 -m unittest discover -s .claude/skills/pr-self-review/scripts -p 'test_*.py'` covers:
  - routing per area, globs, repo rules and the gated/not-gated command tables;
  - a throwaway-repo flow: plan → block → pass → commit keeps it valid → edit makes it stale → gate decisions, plus a refused partial verdict.
- `bash scripts/check-claude-skills.sh` (CI: `claude-assets.yml`).
- Manual:
  - pipe `PreToolUse` JSON into the gate on the real repo;
  - run `plan` on this branch;
  - run a scratch-branch review with a deliberate onion violation plus a migration edit.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-19 | request read; no existing spec; root INSIGHTS read (python3 hooks, Stop vs UserPromptSubmit, workflow push scope) |
| Planning | 2026-09-19 | plan approved; local gate + CRITICAL-only chosen by the user |
| Implementation | 2026-09-19 | skill, map, review_scope.py, gate, pre-push, check script, docs |
| Validation | 2026-09-19 | 26 unit tests; check-claude-skills.sh green; live gate denied `git push` in-session; scratch-worktree run: 6 reviewers routed per area, 5 CRITICAL found (1 refuted by verifier → WARNING), BLOCK + stale-after-edit confirmed |
| Completion | 2026-09-19 | status done; insights recorded in root INSIGHTS.md |
