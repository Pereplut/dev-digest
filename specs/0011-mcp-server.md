---
title: MCP server
status: in-progress
lesson: L04
packages: [mcp, server]
---

## Problem

DevDigest has no programmatic surface. The API is ~50 flat routes on `localhost:3001` with no
authentication (`server/src/adapters/auth/local.ts:14` `LocalNoAuthProvider` always returns the
seeded user and default workspace) and no OpenAPI document, so every external consumer writes its
integration from scratch by reading `server/src/modules/*/routes.ts`.

The roadmap already names the answer: `README.md:90` — `| L04 | devdigest-mcp server · Blast Radius
(reads repo-intel) |`, and `server/src/modules/repo-intel/README.md:41` marks
`getBlastRadius(repoId, files)` as "used by L04". Nothing has been built: no MCP dependency, no
`.mcp.json`, no prior spec.

An MCP server gives coding agents (Claude Code, Claude Desktop) five operations over DevDigest
without any of them knowing the HTTP surface.

## Scope / non-goals

**In scope**

- A new package `mcp/` (`@devdigest/mcp`) exposing five tools: `list_review_agents`,
  `review_pull_request`, `get_findings`, `get_repo_conventions`, `get_blast_radius` (stub).
- Two transports from one tool registry: stdio (primary) and Streamable HTTP (optional).
- One new route in `server/`: findings for a run, with severity/category filters and pagination.
- Ring enforcement in `mcp/` (dependency-cruiser + ESLint zones), per the `onion-architecture` skill.
- Package scaffolding required by `scripts/check-agent-docs.sh`.

**Non-goals**

- Authentication, API keys, multi-tenancy. The MCP server inherits the API's single-workspace,
  localhost-only posture. stdio is chosen partly so this is not exposed on a port.
- Code execution / "Code Mode" tool surface. That pattern pays off at hundreds of endpoints
  (Cloudflare: 2,500 endpoints, 1.17M → ~1,000 tokens); at five tools the sandbox is pure cost.
- A single router/meta tool. Sentry measured 14,000 → 720 tokens this way but **+110% latency**
  (11.29s → 23.81s), and it forfeits schema-validated arguments and tool-search discoverability.
- A real blast-radius implementation. See [§Design → get_blast_radius](#get_blast_radius-stub).
- MCP **Resources** and **Prompts**. `get_repo_conventions` is arguably better as a resource — a
  resource costs one line in `resources/list` and never enters the model's tool section at all, and
  `server/src/modules/conventions/skill-body.ts` already merges accepted candidates into one body.
  Deferred to a second iteration: this spec was asked for a tool, and Resources carry their own
  surface (templates, annotations, subscriptions).
- Changes to `client/`. `client/src/vendor/shared` is a separate vendored copy; the client does not
  use the new contract, so it is not mirrored.

## Design

### Protocol and SDK baseline

The MCP specification changed incompatibly on **2026-07-28**: `initialize` and protocol-level
sessions are gone, every request carries `_meta`, and servers **MUST** implement `server/discover`.
The TypeScript SDK forked accordingly:

| Package | Version | Line |
|---|---|---|
| `@modelcontextprotocol/server` | `2.x` | current, `2026-07-28` |
| `@modelcontextprotocol/fastify` | `2.x` | first-party Fastify adapter |
| `@modelcontextprotocol/sdk` | `1.30.x` | legacy-era, maintenance only |

We target the v2 line. Current APIs: `new McpServer(...)`, `server.registerTool(name, config,
handler)`, `createMcpHandler(factory)`, `serveStdio(factory)`, handler context named `ctx`, errors as
`ProtocolError`. Removed and not to be used: variadic `server.tool()`, schema-keyed
`setRequestHandler(CallToolRequestSchema, …)`, `SSEServerTransport`.

### Why a separate package (and why the Zod split stops mattering)

`server/` and `reviewer-core/` run **Zod 3.25.76** (`server/package.json:42`,
`reviewer-core/package.json:15`). `@modelcontextprotocol/server@2.x` requires **Zod ≥ 4.2**. A
separate package with its own `package.json` is the only way to avoid two Zod copies in one package.

The ring layout below makes this a non-issue rather than a workaround: **Zod 4 and the MCP SDK live
only in ring 4.** Rings 1–3 use plain TypeScript types, so the two Zod versions never meet — schemas
do not cross a boundary inward. This mirrors `server/src/vendor/shared/adapters.ts`, where every port
is a plain `export interface` (`:82` `LLMProvider`, `:143` `GitHubClient`, `:268` `AuthProvider`).

Node: repo requires ≥ 22 and runs 22.23.2; SDK v2 needs ≥ 20, MCP Inspector ≥ 22.19. Compatible.

### Rings in `mcp/`

An MCP server is a **primary (driving) adapter** in Cockburn's sense — the same role as
`routes.ts`. It is transport, not logic.

| Ring | Files under `mcp/src/` | Contents | Must not import |
|---|---|---|---|
| **1 — core** | `core/project.ts`, `core/errors.ts` | Pure free functions: concise/detailed projection, severity and category filtering, truncation, agent rollup, conventions rendering, `ApiErrorBody` → error text | MCP SDK, `zod`, `fetch` |
| **2 — port** | `ports.ts` | `interface DevDigestApi`, plain TS types only | any implementation |
| **3 — application** | `tools/run-review.ts`, `tools/findings.ts` | Only genuine orchestration: slug → repo id → pull id → start; run → findings + status | MCP SDK, `fetch` |
| **4 — transport/infra** | `registry.ts`, `adapters/http/`, `adapters/mocks.ts`, `container.ts`, `entry/stdio.ts`, `entry/http.ts` | Tool registration (names, descriptions, annotations, Zod-4 input schemas), HTTP adapter, mock, composition roots | inner rings outward |

Consequences that are load-bearing:

- **The MCP SDK is imported only in `registry.ts` and `entry/*`.** Rings 1–3 return plain data;
  wrapping into `{ content: [...] }` / `isError` happens in exactly one place. This is the
  "a service never imports a vendor SDK" rule. The repo already shows the cost of skipping it:
  ast-grep was imported directly by `repo-intel/service.ts` with no test seam until it got a port.
- **`DevDigestApi` is a port with all five steps** (port → adapter → mock → container → consume).
  `adapters/http/` is the only file that knows the base URL or calls `fetch`; `adapters/mocks.ts`
  is deterministic with no network. Every tool is therefore unit-testable offline, the same property
  `server/test/routes-smoke.test.ts` has when it boots the app with no database.
- **No Middle Man.** `list_review_agents`, `get_repo_conventions` and `get_blast_radius` get no
  service that only forwards — the handler calls the port and passes the result through a ring-1
  projection. Rings are relaxed: ring 4 → ring 1 is allowed.
- **The token budget is ring 1.** Projection, concise/detailed, truncation and filtering are pure
  functions, so the acceptance criteria below are testable rather than aspirational.

### The port

```ts
// mcp/src/ports.ts — ring 2. Plain TypeScript. No Zod, no SDK.
export interface DevDigestApi {
  listRepos(): Promise<RepoSummary[]>;                    // GET /repos        → slug → id
  listAgents(): Promise<AgentSummary[]>;                  // GET /agents
  getPullByNumber(repoId: string, n: number): Promise<PullDetail | null>;
                                                          // GET /repos/:id/pulls/:number
  startReview(pullId: string, target: RunTarget): Promise<StartedRun[]>;
                                                          // POST /pulls/:id/review
  getRunFindings(runId: string, q: FindingQuery): Promise<RunFindingsPage>;
                                                          // GET /runs/:id/findings   ← new
  listReviews(pullId: string): Promise<ReviewWithFindings[]>;
                                                          // GET /pulls/:id/reviews
  listRunsForPull(pullId: string): Promise<RunListItem[]>;
                                                          // GET /pulls/:id/runs
  getConventions(repoId: string, q: ConventionQuery): Promise<ConventionsPage>;
                                                          // GET /repos/:id/conventions
}
```

`listRunsForPull` was added during implementation: it is what makes the `N of M agents done` clause
computable in `repo`+`pull_number` mode, and its `ranAt` is what `currentWave` clusters on.

`listRepos` is required because the API keys pull-request reads on the internal repo **uuid**
(`GET /repos/:id/pulls/:number`) while every tool takes a human `owner/name` slug. Resolution is
ring-3 work, not a new server route.

### Data access: HTTP adapter, never a second Container

The MCP process does **not** build a `Container` and does **not** call `buildApp()`. Two reasons,
both verified:

- `server/src/app.ts:96` calls `reapStaleRuns()` at boot on an explicit single-API-instance
  assumption (comment at `app.ts:88-93`). A second process on the same database would reap the
  API's live runs.
- `ReviewService.runReview` (`server/src/modules/reviews/service.ts:140`) does
  `void this.executor.executeRuns(...)` — fire-and-forget in its own process — and the SSE run bus
  (`server/src/platform/sse.ts`, consumed at `reviews/routes.ts:64`) lives there too. Starting runs
  from the MCP process would mean the studio UI never sees their events.

The adapter is a thin `fetch` wrapper modelled on `client/src/lib/api.ts:21` (`apiFetch`), mapping
`ApiErrorBody` (`server/src/vendor/shared/contracts/platform.ts:314`) onto the error texts below.

### Transports

`entry/stdio.ts` is primary: no port, no Origin/Host surface, and the specification's own guidance
for local servers is to "use the `stdio` transport to limit access to just the MCP client".
`entry/http.ts` mounts Streamable HTTP via `@modelcontextprotocol/fastify`. Both are composition
roots over the same `registry.ts` and are the only places that choose a port implementation.

Three mounting hazards, recorded because each fails silently:

1. Fastify has already parsed the body — pass it as the **third argument** to `toNodeHandler`, or the
   handler tries to read a consumed stream.
2. Auth reaches the handler through the raw request: `node(Object.assign(req.raw, { auth }), reply.raw, req.body)`,
   surfacing as `ctx.http.authInfo`.
3. `createMcpFastifyApp()` arms DNS-rebinding protection by default; mounting into an existing app
   means composing the `hostHeaderValidation` hook yourself, because the bare handler "trusts its
   caller entirely".

In stdio, **stdout is the JSON-RPC channel** — all diagnostics go to stderr. MCP's own `logging`
subsystem is deprecated as of 2026-07-28.

### The one new route in `server/`

Today findings hang off `reviews`, there is no findings-by-run endpoint, and there is no severity
filter or findings pagination anywhere (`specs/0002-findings-list-timeline.md:25` lists a
`?severity=` deep link as a non-goal). Without a route, `get_findings` would fetch every review of a
pull request to discard most of it — exactly the response bloat this design is trying to avoid.

`GET /runs/:id/findings`, consistent with the existing `/runs/:id/trace` and `/runs/:id/events`.
As built:

- Query (`RunFindingsQuery`): `severity` and `category` are optional and use the **repeated-key**
  form (`?severity=CRITICAL&severity=WARNING`), a single value being coerced to a one-element array;
  `limit` is 1–200 defaulting to **20** (not `PageQuery`'s site-wide 100); `cursor` is opaque.
- Response (`RunFindingsPage`): `findings` (each `Finding` plus `review_id`, `accepted_at`,
  `dismissed_at`), the run's own `status`, and `next_cursor`.
- **404** for an unknown run or a run in another workspace; **400** `invalid_cursor` for a cursor that
  fails to decode.
- Ordering is **severity-worst-first**, `findings.id` breaking ties — findings carry no timestamp, so
  `(severityRank, id)` is the total order used by both `ORDER BY` and the keyset predicate. This is
  what makes `get_findings`'s "20 highest-severity findings" true without re-sorting in the MCP layer.
- A still-running run returns `findings: []` with a live `status`: findings are persisted only when a
  run completes, so empty-plus-running is a valid state, not an error.
- `grounding` travels with `status`, because `findings: []` on a **`done`** run is ambiguous on its
  own. Live on `acme/payments-api#482` a run completed, spent 3,185 input tokens and $0.000489, and
  returned zero findings — not because the code was clean but because all four `pr_files` rows carry
  `patch = NULL` (the repo has `clone_path: null`). Its tally read `0/0 passed`; a genuine review of
  the same shape reads `11/11 passed`. Without the field a consumer reports "no issues found" for a
  review that examined nothing. `get_findings` omits it in `repo`+`pull_number` mode on purpose:
  grounding is per-run, and that path merges the latest review of every agent.

| Ring | File | Work |
|---|---|---|
| 4 | `server/src/modules/reviews/routes.ts` | New `GET`. Transport only: parse → `getContext` → service → status |
| 3 | `server/src/modules/reviews/service.ts` | New `ReviewService` method; returns findings **plus run status**, so a poll needs one call |
| 4 | `server/src/modules/reviews/repository/review.repo.ts` | The query. Already the home of findings queries (`:61`, `:81-118`). `severity`, `category`, `limit`, `cursor` resolve **in SQL**, never as a JS post-filter |
| 3→1 | `server/src/modules/reviews/helpers.ts:38` | Reuse `findingRowToDto`; do **not** map inside the repository |
| 2 | `server/src/vendor/shared/contracts/findings.ts` | `RunFindingsQuery` + `RunFindingsPage`. Route schemas come from `@devdigest/shared`; cursor semantics mirror `modules/_shared/schemas.ts:33` `PageQuery` (opaque cursor, `limit` ≤ 200) |

Two known deviations are preserved deliberately, not "fixed" in passing: no route declares a
`response:` schema, so this one does not either; and `run.repo.ts` returns mapped DTOs while new code
maps through `helpers.ts`.

Changing `server/src/vendor/shared` is a cross-package change: run `server/` typecheck and tests.

### Tool surface

No `devdigest_` prefix. Claude Code namespaces MCP tools as `mcp__devdigest__<tool>`; a self-applied
prefix would produce `mcp__devdigest__devdigest_list_agents` in every call and every permission rule.
Anthropic's `github_list_prs` guidance is about tools passed directly in the API's `tools` array.
Discoverability is unaffected — tool search indexes the namespaced name, which already contains
`devdigest`.

Two names differ from the original request, both for unambiguity: `list_agents` →
`list_review_agents` (in a context where the caller is itself an agent, "agents" is ambiguous) and
`run_agent_on_pull_request` → `review_pull_request` (verb-first, names the workflow rather than the
mechanism, and matches how a user phrases the request).

| Tool | Input | `readOnly` / `destructive` / `idempotent` / `openWorld` |
|---|---|---|
| `list_review_agents` | `response_format` | ✓ / ✗ / ✓ / ✗ |
| `review_pull_request` | `repo`, `pull_number`, `agent?` | ✗ / ✗ / **✗** / ✓ |
| `get_findings` | `run_id?` \| `repo`+`pull_number`, `severity[]?`, `category[]?`, `limit=20`, `cursor?`, `response_format` | ✓ / ✗ / ✓ / ✗ |
| `get_repo_conventions` | `repo`, `status[]=['accepted']`, `category?`, `response_format` | ✓ / ✗ / ✓ / ✗ |
| `get_blast_radius` | `repo`, `pull_number` | ✓ / ✗ / ✓ / ✗ |

All four annotation fields are set explicitly on all five tools, because the protocol defaults are
the pessimistic ones: `readOnlyHint` defaults to `false`, `destructiveHint` to **`true`**,
`idempotentHint` to `false`. A read tool that omits them is treated as destructive and
non-idempotent, and clients will prompt for confirmation on every call.

`severity`, `category` and `status` accept **either a bare scalar or an array**, normalising to an
array (`oneOrMany` in `mcp/src/registry.ts`). This mirrors `RunFindingsQuery` on the API side, so the
tool is no stricter than the route it wraps. Found in live testing: an array-only schema turned the
natural `severity: "CRITICAL"` into a hard validation error and a wasted turn — while the tool's own
stub text shows the array spelling, which made the trap easy to fall into.

Every schema is `.strict()` (`additionalProperties: false`). `outputSchema` is omitted on all five:
the model is the only consumer, and the specification asks a tool returning `structuredContent` to
*also* serialise the JSON into a text block, which naively doubles the payload.

`input_examples` appear only on the two tools with an optional parameter to demonstrate — measured
effect on complex parameter handling is 72% → 90%, at ~20–50 tokens for a simple example.

#### Descriptions — use verbatim

**`list_review_agents`**

> List the review agents configured in this DevDigest workspace, with the model and provider each one uses. Call this before `review_pull_request` when the user names a reviewer by description rather than by id — the `id` returned here is what that tool expects. Disabled agents are included and marked as such, because a disabled agent cannot be run but is still worth reporting. This is cheap and read-only, so prefer calling it over guessing an agent id.

**`review_pull_request`**

> Start a review of one pull request with one or more of the configured review agents. This is asynchronous: it returns a `run_id` per agent immediately and the review continues in the background, so follow it with `get_findings` using that `run_id` rather than expecting findings in this response. Identify the pull request by repository slug and PR number as shown on GitHub, not by an internal id. Rate-limited to 10 calls per minute, and each run spends money on LLM calls — do not retry a call that already returned run ids.

**`get_findings`**

> Get the findings a review produced — the issues, risks and suggestions it raised — for one run or for a whole pull request. Pass the `run_id` returned by `review_pull_request` to read just that agent's result, or pass `repo` and `pull_number` to read the latest findings from every agent. While a run is still executing this returns its status and no findings, so poll it rather than starting the review again. It defaults to a concise projection and the 20 highest-severity findings; raise `limit` or ask for `detailed` only when you need the rationale and suggested fix, because full findings are large.

**`get_repo_conventions`**

> Get the coding conventions DevDigest extracted from a repository — the rules it holds new code to, each with the file and line range that evidences it. Returns only accepted conventions by default, because pending and rejected candidates are review artefacts rather than rules. Use it to learn a repository's house style before writing code in it, or to explain why a review finding was raised. If the repository has never been scanned this returns an empty rule set together with the scan status, not an error.

**`get_blast_radius`**

> Not implemented yet: every call returns an error, so do not call it. Planned — which symbols a change touches, which callers reach them, and which endpoints are impacted. Until then use `get_findings` and `get_repo_conventions` for the same pull request.

#### Parameter descriptions — use verbatim

| Parameter | `.describe()` text |
|---|---|
| `repo` | ``Repository slug as `owner/name`, e.g. `acme/web`.`` |
| `pull_number` (in `review_pull_request`) | `The pull request number as shown on GitHub, not an internal id.` |
| `agent` | ``Agent id from `list_review_agents`. Omit to run every enabled agent.`` |
| `run_id` | ``Run id from `review_pull_request`. Use this OR repo+pull_number, not both.`` |
| `severity` | `Keep only these severities. Omit for all.` |
| `cursor` | ``Opaque `next_cursor` from a previous response.`` |
| `status` (conventions) | `Which candidates to include. Defaults to accepted rules only.` |
| `response_format` (agents) | `concise: id, name, model, enabled. detailed adds description, strategy, ci_fail_on, skill_count.` |
| `response_format` (findings) | `concise: file, line, severity, title. detailed adds rationale and suggestion.` |
| `response_format` (conventions) | `concise: category, rule, evidence path. detailed adds the evidence snippet.` |

Deliberately undescribed, because the name carries it: `pull_number` in `get_findings` and
`get_blast_radius`, `category`, `limit`.

#### Server `instructions` — use verbatim

> DevDigest is a local-first AI pull-request reviewer. Reviews are asynchronous.
>
> Ordering: `review_pull_request` returns a `run_id` and finishes in the background. Read results with `get_findings` using that `run_id`. Do not call `review_pull_request` twice for the same pull request while a run is in flight — poll `get_findings` instead.
>
> Identity: every tool takes a repository slug (`owner/name`) and a GitHub pull request number. Internal ids are never required, except the `run_id` and `agent` id that these tools hand you.
>
> Cost: `review_pull_request` spends money on LLM calls and is limited to 10 calls per minute. Every other tool is read-only and cheap.
>
> Severities are `CRITICAL`, `WARNING`, `SUGGESTION`. A `CRITICAL` finding is what blocks a pull request.
>
> `get_blast_radius` is registered but not implemented.

This field carries what no single tool description can say — cross-tool ordering and operational
constraints — and stays short: the more instructions are crammed in, the less reliably a model
follows all of them. Measured on GitHub's MCP server, good instructions produced a 25% overall
improvement in consistent workflow execution.

#### Error texts — use verbatim

Errors are context, not dead ends, and "errors as prompts" is only verifiable on concrete strings.
These are acceptance criteria, not illustrations. All are tool-execution errors (`isError: true`),
which reach the model and let it self-correct; protocol errors are reserved for malformed requests
and unknown tools.

The `N of M agents done` denominator counts the **current review wave**, reconstructed client-side
because the API gives a batch no identity: `currentWave` in `mcp/src/core/project.ts` walks the pull's
runs newest-first and cuts at the first gap over 60s, since `review_pull_request` creates all of a
review's `agent_runs` rows in one loop (observed 723/727/730/732 ms apart) while separate reviews are
minutes or days apart. A "latest run per agent" tally instead counted history — including a `failed`
run whose agent had been deleted, which with `agentId: null` keyed on its own run id and inflated M to
a total that could never be reached.

The "still executing" case has two variants because the `N of M agents done` clause is not derivable
from a run id alone: `GET /runs/:id/findings` returns neither `pr_id` nor any sibling-run information.
In `repo` + `pull_number` mode the pull id is known, so `GET /pulls/:id/runs` supplies the count; in
`run_id` mode the clause is omitted rather than fabricated.

| Situation | Text |
|---|---|
| Run still executing, identified by `run_id` | `Run <id> is still executing (status: running). Call get_findings again with the same run_id in a few seconds. Do not call review_pull_request again.` |
| Run still executing, identified by `repo` + `pull_number` | `Run <id> is still executing (status: running, 2 of 3 agents done). Call get_findings again with the same run_id in a few seconds. Do not call review_pull_request again.` |
| Agent disabled | `Agent "<name>" is disabled and cannot be run. Enabled agents: <list>. Omit the agent parameter to run all enabled agents.` |
| Repository unknown | `No repository "<given>" in this workspace. Did you mean "<closest>"? Call list_review_agents to see the workspace, or add the repository in the DevDigest UI.` |
| Both `run_id` and `repo` | `Pass either run_id or repo+pull_number, not both. run_id reads one agent's result; repo+pull_number reads the latest from every agent.` |
| API unreachable | `Cannot reach the DevDigest API at <url>. Start it with ./scripts/dev.sh from the repository root.` |
| Stub called | `get_blast_radius is not implemented yet. For impact analysis on this pull request, call get_findings (severity: ["CRITICAL"]) and get_repo_conventions instead.` |

These six do not cover every failure, and the gap showed up in live testing: an unknown id returned the
API's own `Run not found` — three words, no recovery. So any other non-2xx keeps the API's message and
gains a recovery clause chosen by status class (404 → where run and agent ids come from and that
`repo`+`pull_number` is the alternative; 400/422 → re-check the argument shapes; 429 → names the
10-per-minute review limit; 5xx → an API fault where retrying is reasonable; anything else → nothing
appended, rather than invented advice). `apiErrorText(status, body, fallback)` in
`mcp/src/core/errors.ts`; the status is a separate parameter from `ApiErrorBody.error.code`, which
carries the API's own semantic vocabulary (`invalid_run_request`, `invalid_cursor`) and must not be
conflated with an HTTP status.

### Token budget

Five tools cost a **measured 1,446 cl100k tokens** of definitions (6,310 chars of `tools` JSON;
`list_review_agents` 937 chars, `review_pull_request` 1,259, `get_findings` 1,925,
`get_repo_conventions` 1,442, `get_blast_radius` 741). The 2.5–3.5k figure earlier in this spec's
history was an estimate made before the schemas existed and was ~2.4× too high — the test's ceiling is
**2,000**, ~38% headroom, not the 4,000 the estimate would have justified. A ceiling derived from a
guess is a ruleset that never fails. For scale: a five-server setup (GitHub,
Slack, Sentry, Grafana, Splunk) runs ~55k tokens; tool-selection accuracy degrades past 30–50 tools;
tool search is worth its extra round-trip from ~10 tools up, and below that loading everything
upfront is faster. Claude Code enables tool search by default and its `auto` threshold is 10% of the
context window, which this never approaches.

So definitions are not the cost centre — **results are**. Claude Code warns at 10,000 tokens of tool
output and truncates at 25,000 by default. The levers used here:

- `response_format` enum, defaulting to **concise** (Anthropic's own example measures a detailed
  format at 206 tokens against 72 concise).
- `severity`/`category` enums, `limit` defaulting to 20, opaque `cursor`.
- Filtering and pagination resolved in SQL, not after the fact.
- Deterministic `tools/list` ordering — the specification now says servers SHOULD do this because it
  "improves LLM prompt cache hit rates when tools are included in model context".

`_meta: { "anthropic/maxResultSizeChars": N }` is deliberately **not** set anywhere. It is a real
lever (overriding Claude Code's output cap up to 500,000 characters) but here it would prop up a
weak design: with `limit=20`, concise projection and a cursor, large responses do not arise, and
declaring a large ceiling invites filling it. Add it only if a measured response is actually being
truncated.

### `get_blast_radius` (stub)

Registered, so the surface is stable and documented; every call returns `isError: true` with the text
above. The description says "not implemented yet" and "do not call it" so tool search deprioritises
it and the model avoids selecting it. The token objection to an always-failing tool does not bite at
this scale (~300 tokens).

The backend already exists — this is unwired working code, not absent functionality:
`repoIntel.getBlastRadius(repoId, changedFiles)` at `server/src/modules/repo-intel/service.ts:224`,
with a persistent-index path at `:319` and a degraded ripgrep fallback at `:232-293`. The API-facing
contract exists and is unused: `BlastRadius` at
`server/src/vendor/shared/contracts/brief.ts:39`. Only a route, a module and this tool's body are
missing.

`BlastResult` (`server/src/modules/repo-intel/types.ts:74`) already carries `degraded` and `reason`,
following the degraded-mode contract that `modules/repo-intel/types.ts` declares explicitly. The
stub therefore specifies **both** shapes now — `isError` for "not implemented", the degraded shape
for "no index" — so phase two adds a route without changing the response shape.
`server/INSIGHTS.md` (2026-09-15) records the cost of leaving degraded mode implicit: repo-intel
context degrades silently with no error.

### Enforcement

A convention without a linter is a suggestion. `server/INSIGHTS.md` (2026-09-18) records an entire
unregistered module with hardcoded secrets and `sql.raw` concatenation passing typecheck, lint and
all 103 tests. `server/` holds its rings with `.dependency-cruiser.cjs` plus ESLint
`no-restricted-imports` zones, wired as `"lint": "eslint . && pnpm arch"`
(`server/package.json:15-16`).

`mcp/` gets the same, with rules for:

- `@modelcontextprotocol/*` importable only from `registry.ts` and `entry/*`;
- `fetch` / base URL only in `adapters/http/`;
- `zod` not importable from `core/**`, `ports.ts`, `tools/**`;
- no cycles.

Per the skill's own warning that a ruleset which never fails is the failure mode: after writing it,
remove one exclusion and confirm the rule actually fires.

### Package scaffolding

`scripts/check-agent-docs.sh` checks the README/AGENTS/CLAUDE pairing, so a new package without it
breaks the check: `mcp/README.md` (humans), `mcp/AGENTS.md` (agents), `mcp/CLAUDE.md` (three-line
shim importing `@AGENTS.md`), `mcp/INSIGHTS.md`. Plus a row in the package table and the Verify table
of the root `AGENTS.md`.

## Acceptance criteria

1. `tools/list` returns exactly five tools, in a deterministic order stable across calls.
2. All four annotation fields are set explicitly on all five tools.
3. Descriptions, parameter descriptions, `instructions` and the six error texts match this spec
   verbatim.
4. No tool declares `outputSchema`; every input schema is `.strict()`.
5. `get_findings` defaults to concise projection and `limit` 20, and paginates by opaque cursor.
6. Serialised tool definitions stay under a recorded token ceiling, asserted by a test.
7. `get_blast_radius` returns `isError: true` with the specified text.
8. `npm run arch` in `mcp/` passes, and fails when one exclusion is removed.
9. Every tool is exercisable through `MockDevDigestApi` with no network.
10. The MCP SDK is imported only from `registry.ts` and `entry/*`.
11. `GET /runs/:id/findings` filters and paginates in SQL and returns run status alongside findings.
12. `scripts/check-agent-docs.sh` passes.

## Test plan

| Layer | How |
|---|---|
| Rings | `npm run arch` in `mcp/`; a negative run with one exclusion removed |
| Protocol | `npx @modelcontextprotocol/inspector --cli <entry> --method tools/list` — exit code gates CI |
| Token budget | Serialise `tools`, count tokens, assert the ceiling |
| Determinism | Assert `tools/list` ordering is stable across calls |
| Ring 1 | Unit tests for projection: concise vs detailed, severity filter, truncation — no network, no SDK |
| Rings 3–4 | All tools through `MockDevDigestApi`; `get_blast_radius` asserts `isError: true` |
| Error texts | One test per situation above, asserting the message names the next action, not just the failure |
| New server route | `*.it.test.ts` (Docker-backed), because it is SQL |
| Tool selection | Realistic multi-step prompts; track accuracy, call count and **token consumption** |

Per-package verification: `mcp/` — its own typecheck, lint, test. `server/` — `pnpm typecheck`,
`pnpm lint` (includes `pnpm arch`), `pnpm exec vitest run --exclude '**/*.it.test.ts'`, and
`pnpm exec vitest run .it.test`. The `vendor/shared` change additionally requires `server/` typecheck
and tests.

## Phases

| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-27 | request read; `specs/` checked (no prior MCP spec), root + server + client INSIGHTS read; `README.md:90` L04 row and `repo-intel/README.md:41` found as the only prior art |
| Planning | 2026-09-27 | spec approved. Decisions: separate `mcp/` package (Zod 3 vs 4); rings with SDK confined to ring 4; HTTP adapter not a second Container; stdio primary; two renames; no `devdigest_` prefix; no `maxResultSizeChars`; stub registered returning `isError` |
| Implementation | 2026-09-27 | `server/` route and `mcp/` package built in parallel. Two corrections during integration: the "still executing" text split into two variants (sibling-run count not derivable from a run id), and `severity`/`category`/`status` widened to accept a scalar |
| Validation | 2026-09-27 | `mcp/`: typecheck ✓, `lint` (eslint + `arch`, 17 modules / 32 deps, 0 violations) ✓, **71 tests** ✓, negative arch run fires (exit 3) ✓, negative ESLint run fires ✓. `server/`: typecheck ✓, lint ✓, 368 unit ✓, 90 `.it.test` ✓ (the new route's 9 re-run independently). `check-agent-docs.sh` ✓ — but only after `git add -N mcp/`: it enumerates via `git ls-files`, so it had been passing without examining the new package at all. Inspector `tools/list` ✓ (5 tools, fixed order, no `outputSchema`, `additionalProperties: false`) and `--strict` ✓ (no schema-portability problems). **Live against the running API**: route verified for worst-first ordering, repeated-key filter, two-page cursor walk, 400 on bad cursor, 404 on unknown run; all four read-only tools end to end, both projections, and every error path. `review_pull_request` deliberately not exercised — it spends money on LLM calls. e2e n/a (no UI or seed change) |
| Follow-ups found in live testing | 2026-09-27 | Three, all fixed: array-only `severity`/`category`/`status` (stricter than the route it wraps; unit tests all passed arrays so none caught it); a bare `Run not found` with no recovery; a token ceiling derived from a pre-implementation estimate rather than a measurement. A fourth was a harness fault, not a product one — the Inspector CLI ignores a shell-prefixed env var, so `-e` is required and any earlier "verified with the mock" claim through a prefix was actually hitting the live API |
| Live review, end to end | 2026-09-27 | `review_pull_request` exercised for real. `acme/payments-api#482`: one agent, 4.1s, 3,185/231 tokens, $0.000489, 0 findings, `0/0 passed` — the empty-diff case that motivated `grounding`. `Pereplut/dev-digest#6` (4 files, 10,664 chars of patch): default fan-out to all four enabled agents; General Reviewer returned 11 findings at `11/11 passed` for $0.000976. Both `still executing` variants observed live. Three further defects found and fixed: `grounding` missing, the wave denominator counting history, and the wave shrinking as agents finished |
| Incident found while exercising the tool | 2026-09-27 | Three of four agents on `Pereplut/dev-digest#6` died as `failed` with `error`, `grounding` and `duration_ms` all null — the signature of `reapStaleRunningRuns`, whose only caller is `buildApp`'s boot. `buildApp` is what the test suite boots, and `loadConfig` takes `databaseUrl` from the ambient environment with no test override, so running `server/`'s unit suite reaped the dev database (`routes-smoke.test.ts` boots six times; `LOG_LEVEL` is forced silent under test, so nothing was logged). Fixed: the boot-reap block is skipped under `NODE_ENV=test`, with `test/boot-reap.it.test.ts` asserting both the skip and that a non-test boot still reaps. `test/jobs-reap.it.test.ts` moved to `NODE_ENV: 'development'` — it caught the first, over-broad version of the guard. Outside this spec's scope but recorded here because exercising the tool is what surfaced it |
| Completion | | status done, docs, insights wrap-up |
