# Insights — e2e

Append-only log of non-obvious e2e learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — [dep|fix|measured|odd|tool|llm] title` then **Context / Insight / Apply / Evidence** (`file:line` required).
Written via the [`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill.

---

### 2026-09-15 — Flows 02/04/05 assume a single seeded repo
**Context:** flows fail when run with `npm test` against a normal dev DB.
**Insight:** the home route redirects to the *first* repo, so any extra imported repo sends flows to the wrong PR list.
**Apply:** use `./scripts/e2e.sh` (fresh, ephemeral Postgres) — and never `docker compose down -v` to "reset" the dev DB.

### 2026-09-15 — [tool] `wait --text` matches rendered text, including CSS `text-transform`
**Context:** the new "Cost" column step in flow 02 timed out although the column rendered.
**Insight:** agent-browser matches the page's rendered text, so a header styled `textTransform: "uppercase"` reads "COST", not the i18n string "Cost".
**Apply:** assert the text as displayed (check the component's styles for `textTransform`), or wait on a value in the cell instead of its header.
**Evidence:** `e2e/flows/02-repo-pulls-detail.flow.json:8`; `client/src/app/repos/[repoId]/pulls/styles.ts:104`.

### 2026-09-15 — [tool] On WSL/Ubuntu, `agent-browser install` alone leaves Chrome unable to start
**Context:** every flow failed on its first `open` step, before any assertion.
**Insight:** the downloaded Chrome for Testing needs system libraries that aren't installed by default (`libnspr4`, `libnss3`, `libasound2`); it exits with code 127 and the runner only reports "Command failed: agent-browser open".
**Apply:** install with `agent-browser install --with-deps` (needs sudo), or `sudo apt-get install -y libnss3 libnspr4 libasound2t64`; diagnose with `agent-browser open about:blank` and `ldd <chrome> | grep "not found"`.
**Evidence:** `e2e/README.md:53` (setup step without `--with-deps`).
