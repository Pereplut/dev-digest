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
**Evidence:** `CLAUDE.md:3-4` (package commands must run from inside each package dir).
