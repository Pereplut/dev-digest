# Prompt assembly logging

Answers *"what actually went into this prompt?"* from the logs, without putting
anyone's code in them. Shipped by [spec 0009](../../specs/0009-prompt-assembly-logging.md).

## Turning it on

```bash
LOG_LEVEL=debug pnpm dev                     # the records
PROMPT_LOG_VERBOSE=true LOG_LEVEL=debug pnpm dev   # + hashes, per-skill breakdown, order
```

At the default `LOG_LEVEL=info` nothing is emitted **and nothing is computed** —
the executor skips building the records and skips tokenizing every section
(`run-executor.ts`, the `promptLog` binding). The feature is free when off.

`PROMPT_LOG_VERBOSE` is development-only: `loadConfig` ANDs it with
`NODE_ENV === 'development'`, so setting it in a deployed environment is inert.
When it is set and refused, the server warns once at boot rather than staying
silent about it.

## One record per LLM call

```
DEBUG  prompt assembled
  reqId, runId, prId, agent, provider, model
  mode: "map-reduce"
  chunk: { index: 3, of: 9, label: "src/api/auth.ts" }
  totals:   { chars: 48211, tokens: 12034 }
  sections: [ { name, source, chars, tokens, count?, truncated?, digest? }, … ]
```

**Per call, not per run.** On a map-reduce review every changed file gets its own
assembled prompt, so a 9-file run emits 9 records. This is the reason the record
is not built from `ReviewOutcome.assembly`: that field holds a whole-diff
assembly which, in map-reduce, **was never sent to any model** — see the entry in
[`reviewer-core/INSIGHTS.md`](../../reviewer-core/INSIGHTS.md).

`runId` (= `agent_runs.id`) is the correlation id: it ties these records to the
run's Live Log, its persisted trace, and the SSE stream. `reqId` comes free from
Fastify's per-request child logger, so one HTTP request can be followed into the
runs it started.

## Sections

`chars` measures the content the caller supplied, not the rendered block. The
framing — `## ` headers, `<untrusted>` delimiters, the injection guard — is
excluded, so `totals − Σ sections` is the fixed overhead each call pays.

| `name` | `source` | Origin |
|---|---|---|
| `system` | `db:agents.system_prompt` | the agent row |
| `skills` | `db:skills` | enabled skill links, in link order |
| `task` | `server:taskLine` | PR number/title + repo-intel rank note |
| `pr_description` | `github:pull.body` | capped at 4000 chars → `truncated: true` |
| `intent` | `llm:intent-classifier` | derived intent ([spec 0008](../../specs/0008-intent-layer.md)); omitted when the classifier fails open |
| `memory` | `unwired` | slot exists in the engine; this server never fills it |
| `specs` | `unwired` | as above |
| `repo_map` | `repo-intel:getRepoMap` | token-budgeted repo skeleton |
| `callers` | `repo-intel:getCallerSignatures` | callers of changed symbols |
| `diff` | `git:diff-loader` | the chunk's slice, not the whole diff |

An absent section is **omitted**, never logged as zero — so "no `repo_map` line"
means the slot was empty, which is usually the thing being diagnosed. Seeing
`unwired` means a slot got populated without this table being updated
(`platform/prompt-log.ts`).

## What is never logged

No diff, spec, PR body, repo map, callers or skill **text**, in either mode.

This is structural, not a filter: `PromptSectionInfo` carries a fixed-enum name
and numbers, and has no field that content could occupy. Verbose adds a
**hash**, which is the point — it answers "did this section change between the
two runs?" at zero disclosure.

The two strings that do vary — the chunk label (a repo file path) and the model
id — are passed through `redactCredentials` at the sink, following the rule in
[`platform/redact.ts`](../src/platform/redact.ts): a new log path redacts at its
own write rather than trusting a distant chokepoint.

## Where the code lives

| File | Role |
|---|---|
| `reviewer-core/src/prompt.ts` | measures each section as it renders it (`PromptSectionInfo`) |
| `reviewer-core/src/review/run.ts` | `onPromptAssembled`, fired inside the chunk loop |
| `server/src/platform/prompt-log.ts` | the sink: source labels, redaction, hashing, memoized counting |
| `server/src/modules/reviews/run-executor.ts` | wires the sink, gated on `config.promptLogEnabled` |

The engine stays pure: it has no logger, no tokenizer and no hasher. Counting
(`countTokens`) and hashing (`digestText`) are injected, and the server supplies
them only when they will be used — hashing only in verbose. Provenance is the
caller's to attach, because the same engine runs in CI where these sections come
from the filesystem rather than Postgres.
