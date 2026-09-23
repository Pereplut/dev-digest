---
title: Intent Layer
status: in-progress  # draft | approved | in-progress | done
packages: [server, client, reviewer-core]
---

## Problem
A review starts from the diff and never asks **why** the PR exists. A reviewer agent therefore
cannot tell an intentional behaviour change from an accidental one, and cannot say whether a change
is outside what the author set out to do. The PR title, body, linked ticket and any linked plan or
spec all carry that information and none of it reaches the reviewer as *intent* — the body is passed
through verbatim as `prDescription` and nothing interprets it.

**Most of this feature is already scaffolded and wired to nothing:**

| Piece | Where | State |
|---|---|---|
| `pr_intent` table (`intent`, `in_scope`, `out_of_scope`) | `server/src/db/schema/reviews.ts:83-90` | exists |
| `Intent`, `PrIntentRecord` | `contracts/brief.ts:9-14`, `review-api.ts:59-61` | exist |
| `upsertIntent`, `getIntent` | `modules/reviews/repository/pull.repo.ts:53-72` | exist, **zero callers** |
| Feature-model slot `review_intent` | `contracts/platform.ts:52-57` | exists; Settings → Models already renders its picker with no server-side effect |
| `"derive intent"` as a run step | `platform/run-logger.ts:7` | doc comment only |
| Module, route, service, prompt slot, UI | — | absent |

So this spec wires and extends existing scaffolding rather than designing from zero.

## Scope / non-goals

**In scope.** Classify the motivation of a PR with a separate cheap model, selectable in settings;
persist it with the sources it was derived from and a server-computed confidence band; pass it into
the review prompt as its own slot; surface it on the PR page; record it in the run trace.

**Non-goals.** The rest of `PrBrief` (blast radius, risks, history). Intent for the CI runner. A
standalone "derive intent" button. Fixing the linked-issue regex (`octokit.ts:128` makes the keyword
optional, so any `#123` matches). Reconciling the drift between the vendored contract copies.
Fetching the linked ticket's body — decision D4.

## Decisions (agreed with the user 2026-09-23)

1. **Confidence comes from which sources were available, not from the model.** The model is never
   asked for a confidence number, and no `model_confidence` column is added. Anthropic's docs take
   no position on self-reported confidence; independent research says it is poorly calibrated. A
   deterministic band is reproducible and explainable in the UI.
2. **Fail-open.** Any failure in the intent step leaves the review to run without the slot, matching
   every other enrichment in `run-executor.ts`.
3. **One classification per PR version, shared by all agents in a run.** The user asked to key it on
   `head_sha`; this spec keys it on a hash of the *classifier inputs* (`head_sha` + title + body +
   resolved spec contents), because `head_sha` does not change when the author edits the description
   or the linked spec — which is exactly what changes the intent.
4. **The linked ticket contributes its reference only**, not its body. No extra GitHub call, no
   `linked_issue` column.

## Design

### Data sources
Already available: PR title, body (`pull_requests.body`, persisted and already in the prompt),
linked-ticket reference (regex-extracted at `octokit.ts:127-135`), branch name, changed paths,
commit subjects.

New work — **resolving a linked plan or spec**. A link in the body is a repo-relative `.md` path or
a same-repo blob URL. Resolution order:
1. If the file is in the diff, take it from the hunks — no filesystem access, and it is the version
   this PR proposes.
2. Otherwise read it from the clone through the hardened reader.

Guards, all required: same repo, `.md` only, reject `..`, absolute paths and `.git/`, at most 3
files, each capped. Reuse `readTextFile` (`conventions/service.ts:304-330`) and `isSafeRelativePath`
(`conventions/helpers.ts:69`) by moving both to `server/src/platform/safe-read.ts` so conventions and
intent share one audited implementation; the existing symlink, `.git/` and size tests are the safety
net for that move.

A spec that cannot be read is recorded with `status: unreadable` and caps the band at `medium` — it
is never silently dropped.

**Known limit:** `GitClient.readFile` takes no ref (`adapters.ts:226`) and the clone tracks the
default branch, so a spec not in the diff is read as it is on the default branch. Accepted; the path
is recorded in `sources`.

### Call sequence
`deriveIntent` runs once per request in `ReviewRunExecutor.executeRuns`, beside `loadDiff`, before
any agent starts:

gather sources → input hash, reuse stored intent on an exact match →
`resolveFeatureModel(ws, 'review_intent')` → `llm.completeStructured({schema: IntentClassification})`
under a timeout → verify every quote against the exact text that was sent → band the confidence →
`upsertIntent` → return the prompt block. On **any** error: log, return `undefined`, continue.

### Schema
`prIntent` gains, all nullable or defaulted: `category`, `confidence`, `rationale`, `sources`
(jsonb), `evidence` (jsonb), `input_hash`, `head_sha`, `provider`, `model`, `tokens_in`,
`tokens_out`, `cost_usd`, `derived_at`. Additions only, in one `db:generate` pass —
`server/INSIGHTS.md:212-216` records that a migration mixing adds and drops hangs drizzle-kit
non-interactively.

`category` is a closed set enforced in Zod: `feature, bugfix, refactor, performance, security, docs,
test, chore, dependency, revert, unknown`.

**Banding** (pure helper, no model input):
- `high` — a spec or ticket reference was used **and** at least one valid quote comes from it
- `medium` — a substantive body with at least one valid quote; also the ceiling when a linked spec
  exists but could not be read
- `low` — anything else, including an empty body

### API
`GET /pulls/:id/intent` → `{ intent: PrIntentRecord | null }`, with the workspace check in
`ReviewService.getIntent`. `PrIntentRecord` is extended; `Intent` in `brief.ts` is left alone because
`PrBrief` consumes it. `PromptAssembly.intent` and `RunTrace.intent_call` are added in `trace.ts`.
The `IntentClassification` output schema is server-only, in `modules/reviews/intent-prompt.ts`, with
`.max()` on every field — the conventions precedent. Contracts are canonical in
`server/src/vendor/shared` and hand-mirrored into the client copy.

### Prompt
New optional slot, positioned **task → PR description → `## Derived intent (unverified, confidence: <c>)`
→ memory → repo skeleton → specs → callers → diff**: it follows the description it summarises and
precedes the code context. Rendered by `formatIntentBlock()` capped at `MAX_INTENT_CHARS = 1500`,
wrapped with `wrapUntrusted('derived-intent', …)` because the text was shaped by attacker-controlled
input, and omitted entirely when absent.

In the classifier prompt every source is separately wrapped, including the repo name and title, and
the instructions and no-override policy sit in the system message outside all blocks.

**Citations cannot be combined with structured outputs** in one Anthropic request (400). So the model
returns quotes inside the schema and the **server** verifies them: at least 12 characters, not
punctuation only, and present as a continuous whitespace-normalised run in the named source. A quote
that fails is stored with `valid: false`, not dropped.

### UI
`_components/PrIntentCard/` renders in `OverviewTab` above the description (`OverviewTab.tsx:8-24`
currently receives only `prBody` and gains a `prId` prop). It shows the category, a confidence badge
whose text and accessible name come from i18n — **not colour alone** — the intent sentence,
in-scope and out-of-scope lists, source chips with an unreadable spec marked as a warning, and
evidence quotes with unverified ones flagged. At `low` it adds a hint that the intent was inferred
from indirect signals. It renders nothing when `intent` is null. Copy lives under `intent.*` in
`client/messages/en/prReview.json`.

The settings row already exists; only the registry default and description change.

### Logging
`runLog.step('Deriving PR intent (<provider>/<model>)', …, {kind:'tool'})` fanned to every run in the
request, then one line: `Intent: <category> · confidence <c> · sources <kinds> [· reused]`, or
`Intent skipped: <redacted>`. The trace gets `prompt_assembly.intent`, an `intent` entry in
`PROMPT_TOKEN_SLOTS`, `intent_call` with provider/model/reuse/duration/tokens/cost, and `specs_read`
filled with the spec paths actually used.

**Cost** stays on the `pr_intent` row and in `intent_call`; it is **not** added to
`agent_runs.cost_usd`, because the call is shared by N agents and would be counted N times. The PR
list COST column therefore excludes it, deliberately.

## Acceptance criteria
1. A review of a PR whose body links a spec stores a `pr_intent` row with `confidence: high` or
   `medium`, the spec listed in `sources`, and at least one verified quote.
2. A review of a PR with an empty body still stores a row, banded `low`, with the indirect sources
   listed; the card shows the inferred-from-indirect-signals hint.
3. A linked spec that cannot be read appears in `sources` with `status: unreadable` and the band is
   capped at `medium`.
4. When the classifier throws or the model is misconfigured, the run still completes `done`, the
   trace has `intent_call: null`, and the prompt is byte-identical to one built without the feature.
5. A second review of the same PR with unchanged inputs makes no LLM call and logs `· reused`.
6. The review prompt contains the intent block after the PR description and before memory, wrapped
   in `<untrusted source="derived-intent">`, and the trace reports `prompt_tokens.intent`.
7. An `IGNORE PRIOR INSTRUCTIONS` line in the PR title, body or linked spec never appears outside an
   `<untrusted>` block in either prompt.
8. `GET /pulls/:id/intent` returns the record, and 404s for a PR in another workspace.

## Test plan
- **reviewer-core** (`test/prompt.test.ts`, `run.test.ts`): slot absent without intent; correct
  position; wrapped; an embedded `</untrusted>` escaped; truncated at 1500; `low` carries its
  caveat; `intent` reaches the assembly.
- **server unit**: `intent-helpers.test.ts` — link extraction accepts relative `.md` and same-repo
  blob URLs, rejects other hosts/repos, `..`, absolute paths, `.git/`, non-`.md`, and stops at 3;
  quote verification rejects punctuation-only and out-of-order quotes; the banding table; hash
  stability; the character budget. `intent-prompt.test.ts` — every source and the repo name wrapped,
  injected text never outside a block, instructions only in the system message. `intent.test.ts`
  (stub LLM + stub repository, no Docker) — provider error yields `undefined`; a matching hash makes
  no call; a spec in the diff is taken from the hunks; a symlinked spec is `unreadable` and caps the
  band; an empty body gives `low`; a failing quote is stored `valid: false`.
- **server integration** (`intent.it.test.ts`): a review with the mock LLM writes the row; `GET`
  returns it; cross-workspace 404; the trace carries `prompt_assembly.intent`,
  `prompt_tokens.intent`, `intent_call`, `specs_read`; an LLM throw still ends `done` with intent
  null; the new columns exist.
- **client**: `PrIntentCard.test.tsx` — category and confidence badge found by accessible name;
  `low` shows the hint; unverified evidence marked; unreadable-spec chip; `null` renders nothing.
  `OverviewTab.test.tsx` — the description still renders.
- **e2e**: no new flow; existing flows must stay green and the card must not appear with no seeded
  intent. Run by the user.

## Risks
1. **Abstain vs. always answer.** Anthropic documents letting the model say "I don't know" and
   retracting what it cannot quote; the requirement is to always produce an intent. Resolution:
   always produce one, band it `low`, and allow `category: 'unknown'` — when unknown the card says
   so rather than showing an invented purpose.
2. **Injection over two hops.** The body and a linked `.md` are author-controlled, feed the
   classifier, and its output feeds the review prompt. Defences: wrapping at both hops, the existing
   guard, the closed category set, length caps, server-side quote verification. **Ceiling:** a
   malicious `.md` that really exists in the repo can still steer the classifier; the guard only
   stops it from suppressing findings.
3. **Arbitrary read through a body-chosen path**, mitigated by the allowlist and the hardened
   reader. Moving that reader touches security-sensitive code.
4. **The current default model is not cheap.** `review_intent` defaults to `openai/gpt-4.1`
   (≈ $0.016 per call, as much as the whole seeded PR). The Settings picker always saves
   `provider: "openrouter"` (`SettingsModels.tsx:30-33`), so any choice needs an OpenRouter key.
   Proposed default `openai/gpt-4.1-mini` (≈ $0.0032, priced in `pricing.ts:31`, same provider).
   Anthropic recommends Haiku 4.5 for this class of task, which would need an Anthropic key.
5. **Silent degradation** is the price of fail-open: a misconfigured model makes every review quietly
   run without intent. Only the `Intent skipped` log line and `intent_call: null` reveal it.
6. **Latency** — one cheap call before the agents start, under a timeout, skipped on reuse.
7. **Ticket depth** — per D4 only the identifier is used, and the optional-keyword regex may name the
   wrong ticket.
8. **Classifier location** — prompt logic belongs in `reviewer-core`, but the conventions precedent
   keeps its classifier in the server. Following the precedent leaves the CI runner without intent.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-23 | request read; specs + INSIGHTS checked; found the feature already scaffolded and unwired |
| Planning | 2026-09-23 | researcher ×3 (repo ×2, external ×1), planner; 4 decisions agreed; spec draft |
| Implementation | 2026-09-23 | 16 steps; server + reviewer-core + client; 3 INSIGHTS entries; `server/docs/intent-layer.md` |
| Validation | 2026-09-23 | typecheck · lint · unit + integration green; **e2e and manual dev-app check still owed by the user** |
| Completion | | status done, docs, insights wrap-up |
