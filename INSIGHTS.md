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

### 2026-09-19 — [fix] A command-matching gate must skip heredoc bodies, or it blocks its own commit
**Context:** committing the pr-self-review gate with `git commit -F - <<'EOF'`; one commit-message line began "git push and …".
**Insight:** the tokenizer read that heredoc line as a real `git push` and denied the commit. Stripping heredoc bodies before matching fixed it, and commands after the terminator are still checked.
**Apply:** any PreToolUse Bash matcher should treat heredoc bodies (commit messages, PR bodies) as data; add a test with the trigger word inside a heredoc.
**Evidence:** `.claude/skills/pr-self-review/scripts/review_scope.py:580` (`_strip_heredocs`); `test_review_scope.py:164,169`.

### 2026-09-19 — [tool] A `!`-prefixed prompt command bypasses Claude Code PreToolUse hooks
**Context:** the pr-self-review gate blocked `git push` from Claude; the user ran `! git push` instead.
**Insight:** `!` commands run outside Claude's tools, so the Bash PreToolUse gate never sees them, and the opt-in git `pre-push` hook only fires when `core.hooksPath` is set. The push went through with no verdict.
**Apply:** the Claude gate is not a hard guarantee; to cover manual pushes enable `git config core.hooksPath scripts/git-hooks`.
**Evidence:** `.claude/settings.json:16` (Bash matcher); `scripts/git-hooks/pre-push:1`; push `5502ba1..0f3eec0` succeeded via `!`.

### 2026-09-20 — [tool] A pr-self-review verdict taken with `--base HEAD` dies on the next commit
Extends: "A review fingerprint built from `git diff` output goes stale on `git commit`"
**Context:** reviewed the uncommitted conventions work with `--base HEAD` (13 reviewers instead of 41 vs `origin/main`), got a PASS, then committed. `check` immediately reported the verdict stale.
**Insight:** the content fingerprint survived the commit exactly as designed — what moved was the base. `check` re-resolves the verdict's own `base_ref`, and `HEAD` is a moving ref, so `verdict["base"]` (the old commit) no longer equals the freshly resolved one and the verdict is rejected before the fingerprint is ever compared. Worse, a re-plan after the commit sees an almost-empty diff, so a trivial 1-reviewer round would "pass" the gate without the branch's real content ever being certified.
**Apply:** review against a stable ref (`origin/main`, or the branch point) whenever the work will be committed before it is pushed. `--base HEAD` is only for a check you will consume immediately, without committing in between. Never satisfy the gate with a post-commit re-plan whose diff is empty.
**Evidence:** `.claude/skills/pr-self-review/scripts/review_scope.py:482` (`verdict.get("base") != base`), `:476` (`resolve_base(root, verdict.get("base_ref"))`); verdict `base_ref: HEAD -> 2e8a98a2d1c1` vs `HEAD` now `27f83ba89f3a`.

### 2026-09-23 — [tool] A new `.claude/agents/*.md` is not loadable in the session that created it
**Context:** wrote `.claude/agents/researcher.md`, then immediately tried to smoke-test it with `Agent(subagent_type: "researcher")`.
**Insight:** the subagent registry is resolved at session start, not per call. The call failed with `Agent type 'researcher' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup` — the new file was absent from the list even though it was on disk and its frontmatter parsed. This is unlike `.claude/settings.json`, which an earlier entry records as being picked up mid-session without a restart.
**Apply:** don't treat "agent not found" as broken frontmatter, and don't restart to test one. A **fresh headless process sees the file immediately**: `claude -p --agent <name> "<task>"` from the repo root runs the real registered agent, and an unknown name fails fast by printing the whole available list. Beware that `claude agents --json` does *not* list definitions — it lists running sessions (pid, cwd, sessionId), so it is useless as a registration check.
**Evidence:** `.claude/agents/researcher.md:1-10` (frontmatter parses: `name=researcher`, `model=sonnet`, 5 keys via `yaml.safe_load`); in-session `Agent` calls failed with `Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup`, while `claude -p --agent no-such-agent-xyz` in the same repo printed `Available agents: claude, Explore, general-purpose, Plan, researcher, statusline-setup`. CLI 2.1.280.

### 2026-09-23 — [tool] `claude -p` grants no web tools, which is what proved the researcher's "Not found" contract
**Context:** first real run of the `researcher` agent, via `claude -p --agent researcher`, on a question that needed upstream Fastify docs.
**Insight:** in headless `-p` the `WebFetch`/`WebSearch` calls returned `"Claude requested permissions to use WebFetch, but you haven't granted it yet."` even though the agent's `tools:` allowlist names them — the frontmatter allowlist is not a permission grant. The agent did the right thing: it answered the repo half, refused to state any upstream claim from memory, set external confidence to `none`, and put both blocked URLs and both search queries verbatim into `## Not found` with "what would settle it".
**Apply:** an accidental permission denial is the cheapest test of a report format that must distinguish "absent" from "I could not look". For a real external-mode run, grant the web tools explicitly — a `permissions.allow` entry in `.claude/settings.json` is enough and `claude -p` then honors it. Fixed here: `["WebFetch", "WebSearch"]`, after which the identical prompt returned three primary Fastify sources with quotes and dates.
**Evidence:** `.claude/agents/researcher.md` ("Never answer from memory", `## Not found` is mandatory); first run `Confidence — External side: none — zero sources fetched`; `.claude/settings.json:2-7` (the allow list); second run cited `raw.githubusercontent.com/fastify/fastify/main/docs/Guides/Migration-Guide-V5.md` verbatim. The agent also reported a WebFetch quote-length cap that forced several small fetches instead of one full-text read, and flagged it in its own confidence line — worth knowing before trusting a single fetch as exhaustive.

### 2026-09-23 — [tool] The `skills:` frontmatter key preloaded nothing, and failed silently
**Context:** `.claude/agents/test-writer.md` declares eight skills under a `skills:` YAML list. A `claude-code-guide` subagent reported, with what it presented as verbatim doc quotes, that "the full content of each listed skill is injected into the subagent's context at startup". I wrote that into the agent body and the agents README before testing it.
**Insight:** measured on CLI 2.1.280, it does not — at least under `claude -p --agent`. Two probes forbidding `Read`/`Grep`/`Bash`/`Skill` both returned `cannot answer without tools`: one for a repo-specific fact (`onion-architecture/SKILL.md:237-250`, the named deviations), one for a trivially recallable one (`engineering-insights/SKILL.md:39-41`, the six entry tags). The agent still loads and works, because unrecognized or inert frontmatter keys are **silently ignored** — nothing warns, nothing fails. The danger was in the prompt: the body told the agent the skills were already in context, so it would have skipped loading them and worked from memory.
**Apply:** never state in an agent's body that something is preloaded without probing it first — ask the agent a question only that content answers, with every read tool forbidden, and require a flat "cannot answer" as the negative. More generally: a subagent's report of "verbatim" documentation is not evidence; this one did not survive a two-minute test. `.claude/agents/` has no CI, so a wrong frontmatter key stays wrong until someone probes for it.
**Evidence:** `.claude/agents/test-writer.md:9-18` (the `skills:` list), `:~100` (the body now says to load them explicitly); both probe runs returned `cannot answer without tools` against ground truth printed from the same files in the same command.

### 2026-09-23 — [tool] A Bash allowlist entry matches the literal command, and a compound is checked part by part
**Context:** `architecture-reviewer` is told to run dependency-cruiser. Its first version prescribed `(cd <abs>/server && pnpm arch)`, which the agent reported as refused; `.claude/settings.json` then gained an exact `Bash(pnpm --dir server arch)` entry.
**Insight:** two separate facts, both measured. (1) `Bash(<cmd>:*)` prefix rules work — `Bash(git log:*)`, `Bash(git blame:*)` and the exact `Bash(pnpm --dir server arch)` all ran unprompted in a headless `claude -p --agent` run. (2) A compound command is **split and each part checked on its own**, against the literal string: with `pnpm --dir server arch` allowlisted, `cd server && pnpm arch` is still refused with `This Bash command contains multiple operations. The following part requires approval: pnpm arch`. Changing directory changes the command text, so it no longer matches the entry — the obstacle is the mismatch, not the `&&` itself.
**Apply:** allowlist the command in exactly the form the caller will type, and prefer a tool's own directory flag (`pnpm --dir <pkg> <script>`, `npm --prefix`) over `cd … &&` — it keeps one stable string to match and survives a different cwd. When writing a command into an agent's prompt, run it through that agent once: a prescribed command that gets denied silently degrades the agent's evidence rather than failing loudly.
**Evidence:** `.claude/settings.json:8-20` (the read-only allowlist); `pnpm --dir server arch` → `187 modules, 602 dependencies cruised`, exit 0; the refusal string above, reproduced after the allowlist was in place.

### 2026-09-23 — [tool] `claude -p` denies Write/Edit too; `--permission-mode acceptEdits` is the fix
Extends: "`claude -p` grants no web tools, which is what proved the researcher's 'Not found' contract"
**Context:** smoke-testing `doc-writer` in a throwaway worktree. It produced a good document and then did not file it — `git status` showed no new file.
**Insight:** the denial is not limited to web tools. A probe run returned `Claude requested permissions to write to …/server/docs/probe-test.md, but you haven't granted it yet`, and the same run's `INSIGHTS.md` wrap-up edit hit it too. Adding `Write`/`Edit` to `permissions.allow` would remove the prompts from interactive sessions as well, which is too broad for a committed team file; **`claude -p --permission-mode acceptEdits --agent <name>`** grants them for that one run instead. Re-run that way, `doc-writer` wrote `server/docs/health-endpoints.md`, added the index row, and left every `INSIGHTS.md` untouched. The failure mode worth remembering is the agent's, not the harness's: denied the write, it pasted the whole document into its reply, where it is not filed and not indexed.
**Apply:** smoke-test any writing agent with `--permission-mode acceptEdits`, and check `git status`, not the agent's prose, for whether it actually wrote. Tell a writing agent explicitly what to do when a write is refused — report and stop — or it will improvise something that looks like success.
**Evidence:** `.claude/agents/doc-writer.md` ("When a write is refused"); two runs of the identical prompt in the same worktree, the first leaving `git status` unchanged and the second producing `?? server/docs/health-endpoints.md` plus ` M server/docs/README.md`.

### 2026-09-23 — [odd] A "read-only" Bash allowlist wasn't: `find` and `rg` both execute arbitrary programs
Corrects: the phrase "the read-only allowlist" in the entry above about allowlist matching
**Context:** `/pr-self-review` on the commit that introduced `permissions.allow`. The security reviewer raised a CRITICAL on `Bash(find:*)`; the adversarial check refuted the *grading*, and the finding landed as a WARNING.
**Insight:** the grading was right to come down — `.claude/settings.json` is local config, not attacker-reachable, and the review engine gives the model no tools, so untrusted PR text never becomes a Bash command. The *mechanism* was real and I confirmed it directly: with `Bash(find:*)` allowed, `find . -maxdepth 0 -exec echo … \;` ran with **no permission prompt**. `find` also has `-delete` and `-fprintf`; `rg` has `--pre=COMMAND`, which runs an arbitrary binary over every searched file. A prefix rule approves all of them, and none contains a shell operator that would split it into a second, unapproved command. So three entries I labelled "read-only" granted arbitrary execution and recursive deletion to every clone.
**Apply:** before allowlisting a command, check its own flags for an exec or write escape (`-exec`, `-delete`, `--pre`, `-o`, `-i`) — "this tool reads things" is about intent, not capability. Prefer the structured `Read`/`Grep`/`Glob` tools over shell equivalents: they have no such flags. A `deny` entry does work and takes precedence — after adding `Bash(find:*)` to `deny`, the same probe was refused, and so was a compound that merely contained `find`.
**Apply (second half):** match the remedy to the capability. `find` and `rg` go in `deny` because their flags execute programs. `cat`, `head` and `tail` cannot, so they were merely dropped from `allow` — they now prompt, which is the human gate the finding actually asked for. Denying them outright was the first attempt and it backfired within minutes: `deny` matches any compound containing the word, so an ordinary `… | tail -3` in an unrelated command was refused. A deny entry costs every future use of that word, not just the dangerous shape.
**Evidence:** `.claude/settings.json` (`allow` = git read-only plus `ls`/`wc`/`pnpm --dir server arch`; `deny` = `find`, `rg`, and the secret read paths); probe before → `PROBE_AUTO_APPROVED`, after → `Permission to use Bash with command find … has been denied`; `.claude/.pr-self-review/report.md` for the finding as filed. Two side effects worth knowing: `Read(./**/.env.*)` also denies `server/.env.example`, a harmless committed template; and a denied word blocks the whole compound it appears in.

### 2026-09-23 — [tool] Permission syntax that was verified, and one grant that survives a settings change
**Context:** fixing the three WARNINGs from the second `/pr-self-review` round — a hardcoded home path, an incomplete secret blocklist, and unscoped `WebFetch`.
**Insight:** three facts, each measured rather than assumed. (1) **`~` expands** in a permission path: with `Read(~/.claude/deny-probe.txt)` in `deny`, writing that file failed with `File is covered by a Read deny rule in your permission settings and cannot be written` — which also shows a `Read(...)` deny blocks writes to the same path. So `Read(//home/komp/.ssh/**)` was not just ugly, it was needless; `~/.ssh/**` works and follows whoever runs the clone. (2) **`WebFetch(domain:<host>)` works**, verified both ways from a fresh process: `fastify.dev` (listed) fetched fine, `example.com` (not listed) returned `Claude requested permissions to use WebFetch, but you haven't granted it yet`. (3) **A session-scoped grant outlives the settings edit that removed it** — in the session that made the change, `example.com` still fetched successfully, while a fresh process refused it. The running session had been granted `WebFetch` while the bare entry was still in `allow`.
**Apply:** verify a permission rule from a **fresh `claude -p` process**, never from the session that edited settings — the editing session can hold a grant the file no longer gives, so it will tell you a rule works when it does not. To probe a deny path safely, point it at a file you create yourself under `$HOME` instead of a real credential store.
**Evidence:** `.claude/settings.json` (`allow` holds 16 `WebFetch(domain:…)` entries; `deny` holds `~/.ssh/**`, `~/.aws/**`, `~/.config/gh/**`, `~/.claude/.credentials.json`, `~/.claude.json`, `~/.npmrc`, `~/.git-credentials`, `~/.docker/config.json`); the three probe outputs quoted above.

### 2026-09-23 — [fix] A prefix allowlist cannot see a command's flags; a PreToolUse hook can
Extends: "A 'read-only' Bash allowlist wasn't: `find` and `rg` both execute arbitrary programs"
**Context:** the third `/pr-self-review` round on the same file. Having denied `find` and `rg` for `-exec`/`--pre`, the reviewer found the same class on git: `git diff|log|show --output=<file>` **writes and truncates** that path. Measured unprompted before the fix — `git diff --output=… --stat HEAD` exited 0 and created the file — while all three sat on the allowlist as "read-only".
**Insight:** this is unwinnable with allowlist edits. `Bash(git diff:*)` matches a command **prefix**, so it approves every flag that follows, and each utility has dozens. A `deny` entry cannot close it either: deny matching is prefix/word based, and `git diff HEAD --output=x` puts the flag *after* the subcommand. Three rounds of narrowing found three different flag escapes, which is the signal that the mechanism is wrong, not the list. The fix belongs where the command is already tokenized: `.claude/hooks/pr-self-review-gate.py` now calls `review_scope.write_escape()`, which reuses the existing heredoc-stripping segmenter and denies unconditionally — no verdict makes an arbitrary file write acceptable, so it is checked before the review state. The hook's cheap pre-filter needed `--output` added, or the command never reached the check.
**Apply:** when an allowlist entry keeps sprouting exceptions, stop editing the list and move the check to a hook that parses the command. Redirection (`git diff > file`) is the shell's, not git's, so it stays allowed and is the correct substitute.
**The lesson that cost the most:** three review rounds in a row faulted not the code but my **description** of it. I called the allowlist "read-only"; then said the hook "closes the class"; then wrote an "out of scope" list that review found incomplete twice, alongside a claim to err closed that was false for the one spelling that had just shipped broken. Each time the code was roughly as good as it could cheaply be, and each time the prose promised more.
**Apply:** for a control like this, document the **ceiling**, never a list of gaps. A gap list is a promise that everything absent from it is covered, and it will be wrong by the next round. The ceiling here: it catches the plain spelling of a mistaken flag, anyone who wants to evade it can (an unknown wrapper, `eval`, a variable holding "git", `bash -lc`, a quote inside the word `git`), and it is not a barrier at all — `git diff > file` and the `Write` tool are allowed and reach the same paths. Assume any shape without a test is uncovered.
**A structural fact worth keeping:** a raw-text pre-filter can never be as wide as a check over de-quoted tokens. Two spellings walked through the hook's filter this way — `--out\put=`, then `gi"t"`. Treat such a filter as a cost optimisation, never as part of the guard.
**On the tests:** the first suite was green while two live bypasses worked, because every case spelled the flag literally and none exercised the pre-filter — it asserted what the implementation did rather than testing it. A test that cannot fail is not evidence.
**Evidence:** `.claude/hooks/pr-self-review-gate.py:22` (pre-filter), the unconditional deny below it; `review_scope.py` `write_escape()` + `_segments()` + `_program_and_args()`; `test_review_scope.py` `WriteEscapeTest` (14 escape shapes, 8 clean, plus the pre-filter agreement test). 32 tests pass. Probes: before the fix both bypasses created a 328-byte file unblocked; after it, both return ``Blocked `git --output` ``.
