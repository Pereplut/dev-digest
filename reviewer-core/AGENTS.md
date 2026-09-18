# reviewer-core — `@devdigest/reviewer-core`

Pure review engine: diff → prompt → LLM → grounded findings.
Pipeline diagram and public API: [README.md](README.md)

## Commands (npm)
- `npm test` — hermetic vitest with a stubbed `LLMProvider`
- `npm run typecheck` (also the `build` — the package never emits JS)
- `npm run lint` — ESLint flat config (`eslint.config.mjs`)

## Boundaries
- **No DB, GitHub, or filesystem.** The *engine's* only side effect is the injected `LLMProvider`.
  The package does ship one first-party provider (`src/llm/openrouter.ts`) that makes real HTTP
  calls (OpenAI SDK client + a raw `fetch` to `/models`); it is injectable, so the pipeline never
  depends on it. Don't add a second one without a reason.
- Consumed as TypeScript source by the server via path alias (`../reviewer-core/src`);
  a change here can break `server` typecheck/tests — run them too.
- Public surface is `src/index.ts`; contracts (`Review`, `Finding`, …) come from `@devdigest/shared`
  (aliased to `../server/src/vendor/shared`).

## Conventions
- All untrusted content (diff, PR body, code, specs, skills) is wrapped with `wrapUntrusted()`;
  prompt-injection defense is the single `INJECTION_GUARD` rule — never keyword-scan untrusted text.
- Grounding is mandatory: findings not citing a real diff line are dropped by `groundFindings()`,
  and the score is recomputed from survivors — never trust the model's score.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) are omitted when absent, not rendered empty.

## Know before you edit
- Gotchas: [INSIGHTS.md](INSIGHTS.md) · Deep dives: [docs/](docs/README.md) · Planned work: [specs/](specs/README.md)
- Skills: `typescript-expert`, `zod`, `claude-api`, `security`
