---
title: Prompt assembly logging
status: done         # draft | approved | in-progress | done
packages: [server, reviewer-core]
---

## Problem
When a review comes back wrong — too expensive, missing context, a section silently empty — there is
today no way to answer *"what actually went into the prompt?"* from the logs. The information exists
but only after the fact and only in the DB: `run_traces.prompt_assembly` plus the per-slot token map
that `countPromptTokens` writes (`server/src/platform/trace-builder.ts:88-98`). Nothing is emitted to
stdout at assembly time, so a run that crashes before the trace is persisted leaves no record at all,
and comparing two runs means querying Postgres.

`assemblePrompt` (`reviewer-core/src/prompt.ts:91`) is the one place every review path funnels
through — the studio server and the CI runner both reach it via `reviewPullRequest` — but it is pure
by contract and has no logger (`reviewer-core/AGENTS.md:12-15`).

Three constraints make this non-trivial:

1. **The prompt carries other people's code.** Diff, PR description, repo skeleton, callers and spec
   chunks are all untrusted, often private repo content. None of it may reach stdout.
2. **Credentials leak through messages, not fields.** `server/src/platform/redact.ts:12` exists
   because a clone URL embeds a PAT; INSIGHTS records a regression where a *second* persist path
   bypassed the chokepoint (`server/INSIGHTS.md:243-247`). A new log sink is exactly such a path.
3. **There is no `reqId`.** `runId` is the de-facto correlation id (`agent_runs.id`), but the inbound
   HTTP request id is never propagated into the background run — `executeRuns` is fire-and-forget
   (`server/src/modules/reviews/service.ts:140`), so an HTTP request cannot be tied to the run it started.

## Scope / non-goals
In scope: one structured log record per assembled prompt on the review path, covering section name,
provenance, size in chars and tokens, selected provider/model, and correlation ids; a local-only
verbose mode; docs and tests.

Not in scope: changing what the prompt contains or its order; logging for the other LLM features
(conventions extractor, intent, onboarding — they assemble their own prompts and are a follow-up);
persisting anything new to the DB; a UI surface; log shipping/aggregation.

## Design

### Where the record is emitted
`assemblePrompt` is the natural chokepoint but is logger-less by design. The server already holds a
logger, the tokenizer, the runId and the returned `PromptAssembly` at `run-executor.ts:204-227` and
`:324-326`, so a server-side-only implementation needs no reviewer-core change.

**That shortcut is wrong for map-reduce, and this is the load-bearing finding of the spec.**
`reviewer-core/src/review/run.ts:142` seeds `assembly` with a *whole-diff* assembly, and `:173`
overwrites it **only when `mode === 'single-pass'`**. So on a map-reduce run:

- `outcome.assembly` describes a prompt that **was never sent to any model**, and
- N real prompts (one per changed file, `run.ts:172`) produce **one** record.

Logging `outcome.assembly` would therefore print a plausible, wrong answer on exactly the large PRs
where the question gets asked. The design instead adds an injected sink, mirroring the existing
`onEvent` port (`run.ts:86`) so reviewer-core stays pure:

```ts
// reviewer-core/src/review/run.ts — ReviewInput
/** Prompt-assembly sink. Metadata only: the engine never hands out section text. */
onPromptAssembled?: (info: PromptAssemblyInfo) => void;
```

emitted inside the chunk loop right after `assemblePrompt` (`run.ts:172`), so there is one record per
real LLM call, carrying the chunk label and index.

### What reviewer-core measures vs what the server adds
reviewer-core has no tokenizer (js-tiktoken is a server adapter, `server/src/adapters/tokenizer/index.ts:14`),
so it emits **names and `chars` only**. The server enriches with `tokens` via the injected
`container.tokenizer.count` and with the run/model context it already owns. This keeps the engine
dependency-free and keeps token counting in the one place that already does it.

**Provenance is the server's to attach, not the engine's** (revised during implementation). The
`source` column below reads `db:agents.system_prompt`, `db:skills` — but reviewer-core is shared with
the CI runner, where the same sections come from the **filesystem**, not Postgres
(`reviewer-core/src/review/run.ts:25-26`: "the caller turns AgentManifest skill slugs into bodies —
DB in the studio, fs in the runner"). Baking those labels into the engine would make it lie in one of
its two consumers. So `PromptSectionInfo` carries `{ name, chars, count?, truncated? }` and each
caller maps slot → source label itself; the table below is the **server's** mapping.

`chars` measures the content the caller supplied, not the rendered block. The framing — `## ` headers,
`<untrusted>` delimiters, the injection guard — is therefore excluded, and shows up as
`totals.chars − Σ sections.chars`. That difference is itself useful: it is the fixed overhead the
prompt pays per call, and on a map-reduce run it is paid N times.

Tokens and hashes are **injected ports** for the same reason, following the precedent of
`countPromptTokens`, which already injects `count` "so this stays pure" (`trace-builder.ts:85`):
`PromptParts.countTokens` and `PromptParts.digestText`. The engine gains no tokenizer and no hasher;
the server passes `countTokens` only when a record will actually be emitted, and `digestText` only in
verbose. Since `assemblePrompt` runs once per chunk, the server's counter is memoized — on a
map-reduce run the system prompt, skills, repo map and callers are byte-identical across every chunk
and only the diff slice differs.

### The record
One pino line per assembled prompt, `(obj, msg)` order per house style:

```
INFO  prompt assembled
  reqId: "req-7"                  // NEW — propagated from the HTTP request
  runId: "2f0c…"                  // the correlation id (agent_runs.id)
  prId, agent, provider, model    // already on the executor's pino lines today
  mode: "map-reduce"              // single-pass | map-reduce
  chunk: { index: 1, of: 9, label: "src/api/auth.ts" }
  totals: { chars: 48211, tokens: 12034 }
  sections: [
    { name: "system",         source: "db:agents.system_prompt", chars:  1840, tokens:  412 },
    { name: "skills",         source: "db:skills",               chars:  6120, tokens: 1503, count: 3 },
    { name: "pr_description", source: "github:pull.body",        chars:  4000, tokens:  961, truncated: true },
    { name: "repo_map",       source: "repo-intel:getRepoMap",   chars:  5900, tokens: 1488 },
    { name: "callers",        source: "repo-intel:getCallerSignatures", chars: 2210, tokens: 540 },
    { name: "diff",           source: "git:diff-loader",         chars: 28141, tokens: 7130 },
  ]
```

`source` is a fixed provenance enum, not free text — one label per slot, decided from the map above:

| Section | `source` | Origin |
|---|---|---|
| `system` | `db:agents.system_prompt` | `server/src/db/schema/agents.ts:17` |
| `skills` | `db:skills` | `run-executor.ts:369-375` → `skillsRepo.enabledForAgent` |
| `memory` | `none` (never populated today) | `run-executor.ts:318` records `memoryPulled: []` |
| `specs` | `none` (never populated today) | `run-executor.ts:319` records `specsRead: []` |
| `repo_map` | `repo-intel:getRepoMap` | `server/src/modules/repo-intel/service.ts:402` |
| `callers` | `repo-intel:getCallerSignatures` | `repo-intel/service.ts:457` |
| `pr_description` | `github:pull.body` | `run-executor.ts:219`, capped at 4000 chars (`prompt.ts:37`) |
| `diff` | `git:diff-loader` | `server/src/modules/reviews/diff-loader.ts:12` |
| `task` | `server:taskLine` | `server/src/modules/reviews/helpers.ts:94` + `buildRankNote` |

Absent sections are **omitted**, matching how the prompt itself omits empty slots (`prompt.ts:118-126`)
and how `countPromptTokens` skips null slots — so "no `repo_map` line" means the slot was empty, which
is the diagnostic people actually want.

Note `PromptAssembly` has no `diff` or `task` slot of its own — both live inside `user`
(`prompt.ts:136-145`). Rather than extend the contract (which would force a hand-mirror into both
vendored `@devdigest/shared` copies, per `INSIGHTS.md:15-20`), the engine measures `diff` and `task`
from the parts it already has in hand at `run.ts:172`.

### Safety — what is never logged
The record is **metadata only by construction**: the emitted type carries `chars`/`tokens` numbers and
fixed enum labels, with no field able to hold section text. This is stronger than redacting a
free-text message, and it is the reason the diff/spec/PR-description content cannot leak by accident.

On top of that:
- Every string that could carry an operator-supplied value (the chunk `label`, which is a repo file
  path, and `model`) goes through `redactCredentials` at the sink — following the standing rule that a
  new log path redacts at its own write rather than trusting a distant chokepoint (`INSIGHTS.md:243-247`).
- Secrets are structurally out of reach: they live behind `SecretsProvider` and never enter
  `AppConfig` or the prompt parts (`server/AGENTS.md:17`).
- The line is emitted at `debug` level, so the default `info` level (`config.ts:86`) keeps it off
  entirely in normal operation; it costs nothing when disabled.

### Verbose mode, local only
`PROMPT_LOG_VERBOSE` follows the established three-part flag pattern (`EnvSchema` entry as
`z.string().optional()`, typed `AppConfig` boolean, `=== 'true'` coercion — `config.ts:19-28,62-70,88-89`),
**and is additionally hard-gated on `config.nodeEnv === 'development'`**:

```ts
// server/src/platform/config.ts
promptLogVerbose: parsed.PROMPT_LOG_VERBOSE === 'true' && parsed.NODE_ENV === 'development',
```

so setting it in a deployed environment is inert rather than dangerous — the env var alone cannot
turn it on. If it is set true while `nodeEnv !== 'development'`, the server logs one `warn` at boot
saying it was ignored, so the operator is not left believing it worked.

Verbose **still logs no content**. It adds:
- `sha256` (first 12 hex) per section — lets two runs be diffed for "did this section change?"
  without ever revealing what it says;
- the per-skill breakdown (`[{ name, chars, tokens }]`) behind the `skills` aggregate;
- `order` — the rendered section sequence, to catch ordering regressions like the one at
  `INSIGHTS.md:103-106` where the task line sat outside the injection guard.

A hash is the whole point: it answers "changed / not changed" and "same prompt as the cheap run?",
which is what the non-verbose numbers cannot, at zero disclosure. **Open question D2 below** asks
whether you also want a truncated preview of the *trusted* sections only.

### Correlation id
`runId` stays the correlation id — it is already in every executor pino line, keys the SSE bus and the
trace.

**The planned `reqId` plumbing turned out to be unnecessary** (found during implementation). Fastify
gives each request a child logger already bound to `reqId`, and that same `req.log` is what the route
passes down (`reviews/routes.ts:48` → `service.ts:140` → the executor). So every record emitted through
it carries `reqId` for free — confirmed in the dev server's own output (`reqId: "req-1"` on the
request lines). Adding a second `reqId` into the context object would have duplicated a binding that
already exists. No code was written for this; it is documented instead.

## Decisions (agreed with the user 2026-09-23)
1. **Dedicated sink, stdout only.** A new `onPromptAssembled` port + pino at `debug` — *not* the
   `RunLogger`. `RunLogger.event` fans out to the browser SSE stream **and** the persisted
   `run_traces.log` doc (`run-logger.ts:50-53`); prompt metadata would then reach every connected UI
   client and be stored. An ops log does not need that blast radius.
2. **Verbose logs no content.** Hashes (sha256, 12 hex) + per-skill breakdown + section order only.
   No previews, not even of the trusted `system`/`skills` sections — the "no field can hold section
   text" invariant stays absolute in both modes, which is what makes criterion 4 testable as written.
3. **Review path only.** `reviewPullRequest` / `run-executor`. The conventions extractor
   (`server/src/modules/conventions/service.ts:147`), intent and onboarding assemble their own prompts
   and get wired to the same helper in a follow-up.

## Acceptance criteria
1. A review run at `LOG_LEVEL=debug` emits one `prompt assembled` record **per LLM call** — so a
   9-file map-reduce run emits 9, each with its own chunk label, not 1.
2. Every record carries `runId`, `prId`, `agent`, `provider`, `model`, `mode`, and per-section
   `name` / `source` / `chars` / `tokens`, plus totals.
3. At the default `info` level, a run emits no prompt records.
4. No diff, PR description, spec, repo-map, caller or skill **text** appears in any record, in either
   mode — asserted by a test that runs a review whose diff contains a canary string and greps the
   captured log records for it.
5. `PROMPT_LOG_VERBOSE=true` with `NODE_ENV=production` resolves to `false` and warns once.
6. Absent optional sections are omitted rather than logged as zero.
7. `reviewer-core` stays pure: no logger, no tokenizer, no `process.env`; `npm run lint`/`typecheck` clean.

## Test plan
| Test | Where | Asserts |
|---|---|---|
| per-call emission | `reviewer-core/test/` | a map-reduce input with 3 files fires `onPromptAssembled` 3×, with chunk index/label; single-pass fires 1× |
| section metadata | `reviewer-core/test/` | omitted slots absent; `chars` matches the rendered section; `truncated` set when the PR body is capped |
| **content canary** | `server/test/` | a diff containing `CANARY_SECRET_STRING` produces records whose JSON does not contain it (both modes, verbose on and off) |
| verbose gating | `server/test/` (config unit) | `PROMPT_LOG_VERBOSE=true` × `NODE_ENV` matrix → only `development` yields `true` |
| redaction | `server/test/` | a chunk label / model carrying `https://x:ghp_…@host` is redacted at the sink |
| correlation | `server/test/` | records for one review carry the same `runId`; `reqId` present when a request id was supplied |

Commands: `reviewer-core/` `npm run typecheck && npm run lint && npm test`; `server/` `pnpm typecheck && pnpm lint`
and `pnpm exec vitest run --exclude '**/*.it.test.ts'` (a reviewer-core change requires the server suite
too, per root AGENTS.md). No client, e2e, DB or migration impact.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-23 | request read; no existing spec; root + server + reviewer-core INSIGHTS read — redaction chokepoint (`INSIGHTS.md:243`), task-line/guard ordering (`:103`), vendored-contract mirror cost (`INSIGHTS.md:15`) all apply |
| Planning | 2026-09-23 | spec approved; 3 decisions agreed (dedicated stdout sink · verbose without content · review path only) |
| Implementation | 2026-09-23 | step 1 — reviewer-core `PromptSectionInfo` + per-call `onPromptAssembled` + injected `countTokens`/`digestText`. step 2 — `platform/prompt-log.ts`, the dev-only flag, executor wiring, docs. Deviations: provenance and `reqId` both moved out of scope (see Design) |
| Validation | 2026-09-23 | reviewer-core 53 ✓ · server 252 ✓ · both typecheck + lint clean · `pnpm arch` clean (only the pre-existing `model-router` orphan) · manual run of the real engine + real pino/tiktoken: 3 records for 3 files, per-chunk diff sizes 131/143/155, zero canary leaks |
| Completion | 2026-09-23 | status done; durable explanation moved to [`server/docs/prompt-logging.md`](../server/docs/prompt-logging.md); 2 insights recorded (`reviewer-core` map-reduce assembly trap, `server` Fastify `reqId` binding). `/pr-self-review` still owed by the user before push |
