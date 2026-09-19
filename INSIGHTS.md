# Insights — repo-wide

Append-only log of non-obvious, cross-package learnings. Package-specific ones
go in `<pkg>/INSIGHTS.md`. Newest at the bottom.

Entries are written via the [`engineering-insights`](.claude/skills/engineering-insights/SKILL.md)
skill (tags: `dep`, `fix`, `measured`, `odd`, `tool`, `llm`). Entry format:

```markdown
### YYYY-MM-DD — [tag] Short title
**Context:** what you were doing / what broke.
**Insight:** the finding, stated as a fact.
**Apply:** what to do differently next time.
**Evidence:** `path/to/file.ts:42` (required) — plus the command, error, or measurement.
```

---

### 2026-09-15 — [odd] `@devdigest/shared` exists in two copies
**Context:** Setting up per-package CLAUDE.md files.
**Insight:** `server/src/vendor/shared` is aliased by server and reviewer-core;
`client/src/vendor/shared` is a separate copy and has already drifted
(`adapters.ts`, `trace.ts`, `knowledge.ts`, `eval-ci.ts`, `productionize.ts`).
**Apply:** a contract change the UI consumes must be mirrored into the client copy by hand.
**Evidence:** `server/src/vendor/shared/CLAUDE.md:6-8` (the two aliases and the client's own copy).

### 2026-09-15 — [tool] Mixed package managers
**Context:** Running tests across packages.
**Insight:** `server/` and `client/` use pnpm; `reviewer-core/` and `e2e/` use npm (they ship `package-lock.json`).
**Apply:** use the manager matching the lockfile; don't add a second lockfile.
**Evidence:** `.github/workflows/client.yml:45` (`pnpm install --frozen-lockfile`), `.github/workflows/reviewer-core.yml:45` (`npm ci`).

### 2026-09-15 — [dep] CI path filters encode cross-package aliases
**Context:** Reading `TESTING.md`.
**Insight:** e.g. `reviewer-core/**` triggers `server-unit` because the server type-checks against `../reviewer-core/src`.
**Apply:** when adding a new path alias, add the matching `paths:` filter to the consuming package's workflow.
**Evidence:** `.github/workflows/server-unit.yml:19-21` (`paths:` includes `reviewer-core/**`).

### 2026-09-15 — [tool] No `jq` in the dev environment; write hook scripts in python3
**Context:** Building the engineering-insights Stop hook, which parses hook stdin JSON.
**Insight:** `jq` is not installed, and `node` lives under `~/.nvm`, so it may be missing from a hook's non-interactive PATH; `/usr/bin/python3` is always there.
**Apply:** write `.claude/hooks/*` scripts in python3 (stdlib `json`), not jq/node one-liners.
**Evidence:** `.claude/hooks/insights-session-start.py:1` (python3 shebang); `jq: command not found`; `which node` → `~/.nvm/versions/node/v22.23.2/bin/node`.

### 2026-09-15 — [tool] Claude Code Stop hooks fire after every reply, not at session end
**Context:** Wiring `.claude/hooks/insights-wrapup.py` into `.claude/settings.json`.
**Insight:** a Stop hook that returns `{"decision":"block"}` unconditionally loops or nags on every reply. A project `settings.json` created mid-session was picked up without `/hooks` or a restart.
**Apply:** return early when `stop_hook_active` is true, and keep per-session state (transcript offset) so each batch of work triggers only one reminder.
**Evidence:** `.claude/settings.json:3` (the hook event now used instead); the removed `.claude/hooks/insights-wrapup.py` had the `stop_hook_active` guard + `claude-insights-hook/<session>.offset`.

### 2026-09-15 — [tool] Pushing a commit that touches `.github/workflows/` needs the `workflow` token scope
**Context:** `git push` of the CLAUDE.md/INSIGHTS.md branch, which also edited comments in the e2e workflow.
**Insight:** a default `gh auth login` token can't push any change under `.github/workflows/`, even comment-only; GitHub rejects the whole push.
**Apply:** run `gh auth refresh -h github.com -s workflow` before pushing workflow edits, or keep workflow changes in a separate commit/PR.
**Evidence:** `.github/workflows/e2e-web.yml:5` — push rejected until the `workflow` scope was granted.

### 2026-09-15 — [tool] The insights loop runs on the first prompt, not on Stop
Supersedes: "Claude Code Stop hooks fire after every reply, not at session end"
**Context:** `.claude/hooks/insights-wrapup.py` (Stop hook) was removed; the insights loop moved to `UserPromptSubmit`.
**Insight:** Stop still fires after every reply. Once-per-session behavior now comes from a `<session>.started` marker, and past sessions are wrapped up once via `<session>.handled` markers in `.claude/.insights-state/`.
**Apply:** extend `.claude/hooks/insights-session-start.py` rather than adding a Stop hook; delete a session's markers there to re-run its wrap-up.
**Evidence:** `.claude/hooks/insights-session-start.py:106-109` (started guard), `:120` (handled marker); `.claude/settings.json:3`.

### 2026-09-15 — [tool] Parallel agent shell calls share one working directory
**Context:** verifying run cost by running reviewer-core, server and client checks as parallel Bash calls, each starting with `cd <pkg>`.
**Insight:** the calls share a shell session, so a `cd` in one leaks into the others — `pnpm typecheck` "in server/" actually ran reviewer-core's scripts and the server results were bogus.
**Apply:** wrap each parallel package command in a subshell with an absolute path: `(cd /abs/server && pnpm …)`; confirm with `pwd` in the output.
**Evidence:** `AGENTS.md:3-4` (package commands must run from inside each package dir).

### 2026-09-18 — [llm] A subagent's `file:line` evidence may be quoting a doc, not the repo state
**Context:** an Explore audit reported `package.json` as `skip-worktree`, citing `server/CLAUDE.md:25`; a Plan agent then ran `git ls-files -v` and got `H`.
**Insight:** a subagent finding *looks* like evidence because it carries a `file:line`, but the cited line can be documentation that was already stale. The audit had faithfully quoted a wrong doc.
**Apply:** before building a spec on a subagent's finding, check whether its evidence is a command's output or a doc; if it's a doc, re-derive it from the command yourself.
**Evidence:** `server/AGENTS.md:25` (the claim, now hedged to "some clones"); `git ls-files -v server/package.json` → `H`.

### 2026-09-18 — [tool] Claude Code reads only CLAUDE.md; AGENTS.md needs an import stub
**Context:** moving the repo's agent docs to the cross-tool `AGENTS.md` name (spec 0004).
**Insight:** there is no setting, env var or fallback that makes Claude Code read `AGENTS.md`. The documented options are a `CLAUDE.md` containing a bare `@AGENTS.md` import (resolved relative to the importing file, up to 4 hops, expanded when that `CLAUDE.md` loads — nested ones included) or a symlink. A backticked `` `@AGENTS.md` `` is literal text and is **not** imported.
**Apply:** keep every `AGENTS.md` paired with its `CLAUDE.md` stub; `scripts/check-agent-docs.sh` enforces it. Content edits go in `AGENTS.md`; anything the `#` memory shortcut appends to a `CLAUDE.md` should be moved across.
**Evidence:** `CLAUDE.md:5` (the import), `scripts/check-agent-docs.sh:20` (the bare-line check); `code.claude.com/docs/en/memory.md`.

### 2026-09-18 — [odd] `skills-lock.json` owns only 6 of the 11 installed skills; the catalog README is stale
**Context:** deciding whether a new frontend-organization skill should extend `react-best-practices` — i.e. whether local edits to it would survive a skill sync.
**Insight:** the lockfile is not a manifest of `.claude/skills/`. Locked *and* present: `drizzle-orm-patterns`, `fastify-best-practices`, `next-best-practices`, `postgresql-table-design`, `typescript-expert`, `zod`. Purely local (safe to edit): `react-best-practices`, `react-testing-library`, `security`, `mermaid-diagram`, `engineering-insights`. Locked with **no directory at all**: `architecture-patterns`, `github-workflow-automation`. Separately, `.claude/skills/README.md:3` claims a `.cursor/skills/ → ../.claude/skills` symlink "for Cursor compatibility" — there is no `.cursor` directory and nothing under it is tracked, so Cursor currently gets none of these skills.
**Apply:** before editing a skill, check it against `skills-lock.json` (not the catalog table) — a locked skill's local edits are lost on sync. Don't trust the catalog README's claims about Cursor wiring; that symlink still needs creating if cross-tool support is wanted.
**Evidence:** `skills-lock.json` (6 sourced entries matching directories), `.claude/skills/README.md:3` (the symlink claim), `.claude/skills/README.md:9-19` (catalog listing skills the lockfile doesn't own); `git ls-files .cursor` → empty.

### 2026-09-19 — [fix] A review fingerprint built from `git diff` output goes stale on `git commit`
**Context:** building the pr-self-review verdict, which must survive committing reviewed work but not any edit.
**Insight:** hashing `git diff --binary <base>` plus the untracked files separately gives different bytes for the same content once a new file moves from untracked to committed. The verdict went stale on commit. Hashing each changed path's *current content* (plus the exec bit), with no reference to git state, fixes it.
**Apply:** any "was this exact tree reviewed/tested" fingerprint should hash the content of the changed paths, not the output of a git command whose format depends on staging state.
**Evidence:** `.claude/skills/pr-self-review/scripts/review_scope.py:113` (content-based fingerprint); `test_review_scope.py:254` failed with `1 != 0` before the fix.

### 2026-09-19 — [tool] A Python hook that imports a sibling module writes an untracked `__pycache__/`
**Context:** the pr-self-review gate imports `review_scope.py`, whose fingerprint covers untracked files.
**Insight:** the import alone creates `scripts/__pycache__/*.pyc`. That is an untracked file, so the reviewed tree changed just because the gate ran; `.gitignore` did not cover `__pycache__/`.
**Apply:** set `sys.dont_write_bytecode = True` before importing in hooks and tests (or `PYTHONDONTWRITEBYTECODE=1` in CI). `__pycache__/` is now ignored repo-wide as a backstop.
**Evidence:** `.claude/hooks/pr-self-review-gate.py:54`; `git status` showed `?? .claude/skills/pr-self-review/scripts/__pycache__/review_scope.cpython-312.pyc`.

### 2026-09-19 — [llm] An adversarial verifier downgrades an injection that has no caller yet
**Context:** end-to-end pr-self-review run on a planted diff with `sql.raw` interpolating `repoId` in a new service function.
**Insight:** the security reviewer graded it CRITICAL. The refute-agent downgraded it because nothing calls the function, so no request/LLM input reaches it and it misses the "exploitable" bar. The onion reviewer's CRITICAL on the same line (a service importing drizzle) was confirmed, so the diff still blocked. The verifier is strict about reachability, and layering rules are what catch latent bugs in dead code.
**Apply:** don't expect the security lens alone to block unreached code; keep the architecture CRITICALs (dependency direction) in the rubric, because they are unconditional.
**Evidence:** `.claude/skills/pr-self-review/SKILL.md:65` (verify step), `:139` (skill labels vs verdicts); scratch-run report: `security … sql-injection-raw-interpolation _(was CRITICAL: no caller exists yet)_`.
