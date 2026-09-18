---
name: engineering-insights
description: Records practical findings from a coding session (non-obvious dependencies, fixes, measured facts, odd findings, tool quirks, LLM/review-engine behavior) into the INSIGHTS.md of the module folder the agent worked in (client, server, reviewer-core, e2e), each with a date and file:line evidence. Use after every code task as a wrap-up, as soon as a finding is confirmed mid-task, and when the user says "wrap up", "capture insights", or "what did we learn". Writes nothing when there's nothing new.
---

# Engineering Insights

After each code task, the agent itself turns what it learned into short notes
the next session reads before it starts. Each module keeps its own append-only
`INSIGHTS.md`; every entry carries a date and `file:line` proof.

## When to run

1. **Read — after the user's first request.** A `UserPromptSubmit` hook
   (`.claude/hooks/insights-session-start.py`) triggers this once per session.
   Read root `INSIGHTS.md` plus the `INSIGHTS.md` of every module the request
   touches and apply relevant entries. When work moves into another module, read
   that module's file too. Reading never writes.
2. **Capture as you go** — the moment a finding is *confirmed* (fix verified,
   behavior reproduced, number measured). Don't write a guess; wait for the proof.
3. **Wrap-up — after every code task.** Before reporting a code task as done,
   review what the task involved and record the findings that pass the quality bar
   (usually 0–3). Do it yourself; don't wait to be asked.
4. **Safety net — next session.** If a session edited files and no wrap-up ran
   after the last edit, the same hook writes a condensed transcript to
   `.claude/.insights-state/<session>.transcript.md` and asks for the wrap-up over
   it on the next session's first request. Only findings confirmed in that
   transcript count.

## No news, no write

If nothing passes the quality bar, **do not modify any `INSIGHTS.md`** — no
"nothing learned" entry, no session log, no reformatting. Zero entries is the
expected outcome for most tasks; trivial ones (typo fixes, pure renames,
docs-only edits) never produce any.

## What to record

| Tag | Finding | Record things like |
|---|---|---|
| `dep` | Non-obvious dependency | Hidden coupling between files, modules or packages; things that must change together; boot/ordering requirements; an alias or config one package silently relies on |
| `fix` | Fix | Root cause of a failure plus the fix that was verified; recurring errors; silent failures and how they were exposed |
| `measured` | Measured fact | A number you actually measured — timing, size, limit, token count, row count, test duration — and how you measured it |
| `odd` | Odd finding | Surprising behavior that isn't (yet) a bug: drifted copies, dead paths, something that works for the wrong reason |
| `tool` | Library/tool quirk | Surprising behavior of Drizzle, Fastify, Next.js, Zod, Vitest, pnpm/npm, Docker, git/gh, Claude Code; version-specific pitfalls |
| `llm` | LLM / review engine | Prompt or model behavior in reviewer-core, token/cost limits, output-parsing failures, review-quality findings |

Not recorded here: architecture preferences, style, plans — decisions go in
`docs/adr/`, planned work in `specs/`.

## Where to write — the module you worked in

| You worked in | File |
|---|---|
| `server/**` | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| Several packages, `@devdigest/shared` contracts, `scripts/`, Docker, CI, `.claude/` | root `INSIGHTS.md` |

If the finding is really about a different module than the one you edited (e.g.
you worked in `server/` but found a `reviewer-core` quirk), write it in that
module's file. Write each finding once; if it spans modules, use the root file.

## Entry format

Append at the bottom of the file:

```markdown
### YYYY-MM-DD — [tag] Short, searchable title
**Context:** what you were doing / what broke (one line).
**Insight:** the finding, stated as a fact.
**Apply:** what to do (or never do) next time.
**Evidence:** `path/to/file.ts:42` — plus the command, error, or measurement if relevant.
```

- **Date:** today's absolute date (`YYYY-MM-DD`), never "today" or "yesterday".
- **Evidence is mandatory and must include at least one `path:line`** (or
  `path:start-end`) relative to the repo root, pointing at the code or config the
  finding is about. For environment or tool facts, cite the line where it bites
  (the script, workflow, or config that depends on it). No `file:line`, no entry.
- Keep each entry ≤ 6 lines.

## Quality bar

Before writing, the entry must pass all five checks:

1. **Not obvious** — would someone reading the code, README, or error message
   already know it? Then don't write it.
2. **Practical** — an agent with no memory of this session can act on it
   without re-investigating.
3. **Specific** — names the file, function, library, version, limit, or number.
4. **Verified** — backed by a reproduced failure, a confirmed fix, or a measurement.
5. **Located** — has a real `file:line` that exists now.

| Vague (reject) | Useful (accept) |
|---|---|
| "Be careful with migrations." | "[dep] The API never migrates on boot; `pnpm db:generate` only writes SQL — run `pnpm db:migrate` after touching `server/src/db/`." |
| "The LLM sometimes returns bad JSON." | "[llm] Model wraps JSON in ```json fences when the diff contains markdown; strip fences before `JSON.parse` in the review parser." |
| "Indexing is slow." | "[measured] Indexing a 4k-file repo takes ~90 s, 80% in ast-grep; measured with `time` around the index job." |

"Don't do X" entries (failed approaches) are often the most valuable — record them.

## Procedure

1. Pick the target file with the routing table and **read it**.
2. **Dedupe:** if an existing entry covers the same fact, don't add a new one.
   If it's incomplete, append a short follow-up entry that links it
   (`Extends: "<original title>"`).
3. **Contradictions:** never edit or delete old entries. Append a new entry with
   `Supersedes: "<original title>"` explaining what changed.
   *Exception:* a legacy entry missing its `[tag]` or `**Evidence:**` line may get
   those added in place (no rewording). This happened once on 2026-09-15 (spec 0003).
4. Append the new entries at the bottom, in the format above.
5. If the file has grown past ~200 entries, tell the user and propose splitting
   it by tag (e.g. `INSIGHTS-llm.md`) — don't split without asking.
6. Report in one short list what you recorded and where (or "no insights worth
   recording"), so the user can check it. These entries are drafts — the
   human reviews them in the diff.
