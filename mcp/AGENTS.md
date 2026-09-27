# mcp — `@devdigest/mcp`

MCP server exposing five tools over the DevDigest API (stdio primary,
Streamable HTTP optional). Architecture and how to run: [README.md](README.md)

## Started on demand — never by the dev scripts
`./scripts/dev.sh`, `./scripts/e2e.sh` and every CI workflow deliberately make no
reference to this package, and `dev.sh`'s install step names its packages
explicitly (`dev.sh:76-80`), so `mcp/` is never picked up implicitly. **Do not
add it to any of them.** It is a client-facing adapter started when an agent
needs it, and it requires the API to be up already — folding it into the stack
launcher would only add a startup ordering problem. `.mcp.json` at the repo root
is the supported entry point: Claude Code spawns one short-lived stdio
subprocess per session, on demand. Runbook: [README.md](README.md) § Run it from scratch.

## Commands (npm)
- `npm run dev` — stdio entry (`tsx src/entry/stdio.ts`), talks to the running API on `:3001`
- `npm run dev:http` — Streamable HTTP entry, `:3100/mcp`
- `npm run typecheck` (also the `build` — the package never emits JS)
- `npm run lint` — ESLint zones **and** `npm run arch` (`"lint": "eslint . && npm run arch"`)
- `npm run arch` — `.dependency-cruiser.cjs` ring enforcement alone
- `npm test` — vitest, hermetic (no network, `MockDevDigestApi`)

## Boundaries — the ring table

| Ring | Files under `src/` | Contents | Must not import |
|---|---|---|---|
| 1 — core | `core/project.ts`, `core/errors.ts` | Pure free functions: concise/detailed projection, severity/category filtering, truncation, pagination, agent rollup, conventions rendering, repo-slug resolution, the six error texts | MCP SDK, `zod`, `fetch` |
| 2 — port | `ports.ts` | `interface DevDigestApi`, plain TS types only | any implementation |
| 3 — application | `tools/run-review.ts`, `tools/findings.ts` | Only genuine orchestration: slug → repo id → pull id → start; run → findings + status | MCP SDK, `fetch` |
| 4 — transport/infra | `registry.ts`, `adapters/http/`, `adapters/mocks.ts`, `container.ts`, `entry/stdio.ts`, `entry/http.ts` | Tool registration (names, descriptions, annotations, Zod-4 input schemas), HTTP adapter, mock, composition roots | inner rings outward |

Consequences, enforced by `.dependency-cruiser.cjs` + ESLint zones (`npm run
arch` fails when a rule fires; `no-restricted-imports`/`no-restricted-globals`
catch the rest in-editor):
- The MCP SDK is imported **only** in `registry.ts` and `entry/*`.
- `zod` is not imported from `core/**`, `ports.ts`, or `tools/**` — Zod 4 and
  the MCP SDK live only in ring 4, which is the whole reason this is a
  separate package (`server/` and `reviewer-core/` are Zod 3.25).
- `fetch` (a global, not an import — ESLint `no-restricted-globals`, not
  dependency-cruiser) is called only from `adapters/http/`.
- `list_review_agents`, `get_repo_conventions` and `get_blast_radius` get **no**
  ring-3 module: a service that only forwards to the port is a Middle Man.
  Their handlers in `registry.ts` call the port directly and pipe the result
  through a ring-1 projection (ring 4 → ring 1 is allowed).
- `get_blast_radius` never calls the port at all — it is a stub returning
  `isError: true` with a fixed text, registered so the surface stays stable.

## Conventions
- **Tool descriptions, parameter `.describe()` texts, server `instructions`,
  and the six tool-error texts are verbatim from
  [`../specs/0011-mcp-server.md`](../specs/0011-mcp-server.md).** Never
  paraphrase them when editing `registry.ts` or `core/errors.ts` — diff
  against the spec, don't retype from memory.
- Five tool names, no `devdigest_` prefix: `list_review_agents`,
  `review_pull_request`, `get_findings`, `get_repo_conventions`,
  `get_blast_radius`.
- Every input schema is `.strict()`; no tool declares `outputSchema`; all four
  annotation fields (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`) are set explicitly on every tool — the protocol defaults
  are the pessimistic ones.
- Never set `_meta: { "anthropic/maxResultSizeChars": … }` — see the spec's
  "Token budget" section for why (it would prop up a design that shouldn't
  need it).
- Tool registration order in `registry.ts` is fixed, never conditional —
  `tools/list` ordering must be deterministic across calls.
- stdio hazard: stdout is the JSON-RPC channel. All diagnostics go to
  `process.stderr`, never `console.log`.
- HTTP mounting hazards (all fail silently — see `entry/http.ts`'s docstring):
  pass the parsed body as the third argument to `toNodeHandler`; attach auth
  via `Object.assign(req.raw, { auth })`; compose `hostHeaderValidation`
  yourself even though `createMcpFastifyApp()` already arms it for a
  localhost bind.
- This process never builds a `Container` or calls the API's `buildApp()` —
  see README's "What it is". It only ever talks to the API over `fetch`.

## Know before you edit
- Gotchas: [INSIGHTS.md](INSIGHTS.md)
- Spec: [`../specs/0011-mcp-server.md`](../specs/0011-mcp-server.md)
- Skills: `onion-architecture`, `zod`, `typescript-expert`, `security`
