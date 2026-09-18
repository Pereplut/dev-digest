# Skills

Reusable AI skills that provide specialized knowledge and workflows. They live in `.claude/skills/` and are shared with the team via version control.

> This file used to claim a `.cursor/skills/ → ../.claude/skills` symlink for Cursor compatibility. There is no `.cursor` directory in this repo and no file under it is tracked, so the claim was removed rather than the symlink created — nothing here references Cursor.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Where backend code goes: onion rings, the dependency rule, ports/adapters for external systems, what each layer may import |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-code-organization](react-code-organization/SKILL.md) | Frontend | Where code goes: folder structure, component splitting, logic layering, constants/utils/types placement, Next.js App Router architecture |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [engineering-insights](engineering-insights/SKILL.md) | Workflow | After each code task, record dependencies, fixes, measured facts, odd findings (dated, `file:line`) in the module's `INSIGHTS.md` |

### Lockfile drift (known, 2026-09-18)

`skills-lock.json` and the directories above have diverged in both directions:

- **Locked but absent** — `architecture-patterns` and `github-workflow-automation` have entries in
  `skills-lock.json` with no directory here. Nothing loads them.
- **Present but unlocked** — `engineering-insights`, `mermaid-diagram`, `onion-architecture`,
  `react-best-practices`, `react-code-organization`, `react-testing-library` and `security` exist
  here but are not tracked by the lockfile, so its hashes say nothing about them.

The catalog table above matches the directories exactly; the drift is lockfile ↔ directories only.
Resolving it means running the skills manager (install the two missing, or drop their entries) —
root `AGENTS.md` lists `skills-lock.json` among the lockfiles that are never hand-edited, so this is
recorded here rather than patched.

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
