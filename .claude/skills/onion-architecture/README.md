# onion-architecture — provenance

Research backing [SKILL.md](SKILL.md). Every rule there traces to a source here. Verified
2026-09-18.

## Focus

Onion / ports-and-adapters for `server/` (`@devdigest/api`): which ring a file belongs to and what
it may import. Deliberately **not** about whether the code inside a ring is correct — that is
`fastify-best-practices`, `drizzle-orm-patterns`, `zod` and `security`.

## Relation to other skills

| Skill | Answers | Overlap |
|---|---|---|
| `onion-architecture` (this) | Where does it go, what may it import | — |
| `fastify-best-practices` | How should the route itself be written | Both touch `routes.ts`; this skill only says what must *not* be in it |
| `drizzle-orm-patterns` | How should the query be written | Both touch `*.repo.ts`; this skill only says the query belongs there |
| `zod` | How should the contract be shaped | Both touch `vendor/shared`; this skill says ports import nothing outward |
| `react-code-organization` | Same question, frontend | Sibling in structure and voice; this is its backend counterpart |

## Sources

### Canonical

**[The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)** · Jeffrey Palermo · 2008-07 · the origin of the term
- "All coupling is toward the center." Directly the dependency rule in SKILL.md §1.
- "The Domain Model is only coupled to itself."
- The application core holds the domain model **and repository interfaces only**; implementations sit at the edges. "The object saving behavior is not in the application core… Only the interface is in the application core."
- "The database is not the center. It is external." Backs ring 4 placement of `db/**`.

**[part 2](http://jeffreypalermo.com/blog/the-onion-architecture-part-2/)** · 2008 · worked example (CodeCampServer).
**[part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/)** · 2008 · contrast with traditional layered architecture — the source of "unnecessary coupling" between UI, logic and data access.

**[Onion Architecture part 4 — after four years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/)** · 2013-08 · the retrospective
- Reaffirms the four tenets unchanged; addresses misconceptions rather than revising.
- "Onion architecture works just fine without the likes of StructureMap or Castle Windsor." → SKILL.md §9, "DI container required? No."
- Works with and without DDD, and composes with CQRS. It is "merely an architectural pattern."

**[Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)** · Alistair Cockburn · 2005 · ports and adapters
- A port is "the purpose of the conversation between the two devices"; an adapter converts that API to a specific technology.
- Primary (driving) vs secondary (driven) adapters. Our `routes.ts` are primary; `adapters/**` are secondary.
- Intent: "Create your application to work without either a UI or a database so you can run automated regression-tests against the application." → cited in SKILL.md §7; `routes-smoke.test.ts` already achieves it.
- The hexagon has six sides only to leave room for ports, not because six matters.

**[The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)** · Robert C. Martin · 2012-08
- The Dependency Rule verbatim: "Source code dependencies can only point inwards. Nothing in an inner circle can know anything at all about something in an outer circle."
- Circles: Entities → Use Cases → Interface Adapters → Frameworks & Drivers.
- **The rule this skill knowingly relaxes:** "Isolated, simple, data structures are passed across the boundaries. We don't want to cheat and pass Entities or Database rows." SKILL.md §9 permits Drizzle rows out of repositories and says so explicitly.

**[Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/)** · Herberto Graça · 2017-09 · The Software Architecture Chronicles
- Onion "builds on the Ports & Adapters Architecture… by adding internal layers to it" from DDD.
- Outer layers may call any inner layer directly, "avoiding unnecessary proxy classes" → the relaxed-layers call in §9.
- Graça disagrees with Palermo on repository placement: repositories belong to the application layer since "the domain knows nothing about persistence." **We follow Graça**, which is why the port sits in ring 2 and the implementation in ring 4.

### Comparison and selection

**[Clean vs Onion vs Hexagonal Architecture](https://milanjovanovic.tech/blog/clean-architecture-vs-onion-vs-hexagonal)** · Milan Jovanović
- The three name the same four rings differently: Hexagonal (core/ports/adapters), Onion (domain model / domain services / application services / infrastructure), Clean (entities / use cases / interface adapters / frameworks). "The naming differs. The structure is nearly identical."
- Hexagonal is symmetric — UI and DB adapters sit outside at the same level — whereas layered implies top-to-bottom. Our ring 4 mixes `routes.ts` and `adapters/**` for exactly this reason.

**[Where vertical slices fit inside the modular monolith](https://milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture)** · Milan Jovanović
- "The module boundary already enforces separation from the rest of the system. You don't need layers to protect you."
- Add layers when multiple use cases share complex domain logic; keep slices flat otherwise. → §9 "layers are earned."

### The pragmatic counterweight

**[Overengineering in Onion/Hexagonal Architectures](https://victorrentea.ro/blog/overengineering-in-onion-hexagonal-architectures/)** · Victor Rentea · the authority for half of §9
- "An interface deserves to exist if and only if: it has more than one implementation in the project, or it is used to implement Dependency Inversion to protect an Inner Ring, or it is packaged in a client library." → verbatim basis for the interface rule in §3.
- Strict layers produce a **Middle Man** smell; prefer "Relaxed Layers" where calls may skip layers moving in the same direction. → §1, §9.
- Separate persistence entities alongside domain models can multiply CRUD code ~4×, and teams that do it "regret it 1-2 years later." → the decision to bless `$inferSelect` rows.
- "When testing is hard, the production design can be improved, or you're testing too fine-grained." → §7's treatment of the monkey-patched service test.

**[Domain services vs Application services](https://enterprisecraftsmanship.com/posts/domain-vs-application-services/)** · Vladimir Khorikov
- Domain services hold business decisions; application services orchestrate repositories, transactions, gateways and events. → why `service.ts` is ring 3 and owns the transaction boundary (§8).

**[Functional Core, Imperative Shell](https://functional-architecture.org/functional_core_imperative_shell/)**
- Pure functions hold domain logic; the shell performs side effects and orchestrates. "Dependencies go inward."
- The framing that fits this TypeScript codebase better than DI-heavy OOP onion, and an accurate description of what `reviewer-core` already is. → §2.

### Stack-specific

**[Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)** · Sentry
- The `const invoker = tx ?? db` pattern: repositories take an optional transaction and fall back to the driver. → §8.
- Transactions are started in an outer layer and passed down; nested transactions become savepoints.
- Trade-off acknowledged: extracting the ORM's transaction type couples the infrastructure layer to that ORM.

**[Drizzle — Transactions](https://orm.drizzle.team/docs/transactions)** · official
- `await db.transaction(async (tx) => { … })`; `tx` mirrors the db instance; `tx.rollback()`; nested transactions create savepoints; `PgTransactionConfig` for isolation level. → §8.

**[dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)** · [options](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md) · [CLI](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md)
- `forbidden` rules are `{ name, severity, from: { path, pathNot }, to: { path, pathNot } }`; patterns are **regex, not globs**.
- `tsConfig: { fileName: 'tsconfig.json' }` is required for TypeScript path aliases to resolve.
- `tsPreCompilationDeps: true` includes type-only imports, "dependencies on types only exist before, but not after compile time."
- Exit code equals the number of `error`-severity violations; `--output-type err-long` includes the rule comment.
- Already a dependency here (`server/package.json`), previously used only at runtime to index other repos.

**[ESLint `no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports)** · core rule, no plugin, works without type information — which matters because `server/eslint.config.mjs` is deliberately not type-aware.

**[eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)** · the richer alternative: classify files via `settings['boundaries/elements']`, then allow/disallow between types. Worth adopting if the zone list outgrows the core rule.

**[ast-grep lint rules](https://ast-grep.github.io/guide/project/lint-rule.html)** · YAML rules (`id`, `language`, `rule`, `message`, `severity`) run via `ast-grep scan`. The fallback for constraints an import graph cannot express. `@ast-grep/napi` is already a dependency.

**[Fakes at the port, not mocks everywhere](https://dev.to/gabrielanhaia/testing-hexagonal-go-fakes-at-the-port-not-mocks-everywhere-54kb)** and **[Avoid mocking repositories](https://danielrotter.at/2023/09/22/avoid-mocking-repositories-by-using-in-memory-implementations.html)** · Daniel Rotter
- A fake implements the port coherently; a mock asserts call order and couples tests to implementation. → §7, and the justification for `adapters/mocks.ts` over `vi.mock`.

**[Claude Code skills](https://code.claude.com/docs/en/skills)** · official · frontmatter fields, the 1,536-character description cap that drives auto-invocation, and the 500-line SKILL.md guideline.

### Consensus

- Dependencies point inward, always. Unanimous across Palermo, Cockburn, Martin, Graça, Jovanović.
- External systems sit behind interfaces owned by the inside. Unanimous.
- The database is a detail, not the centre. Unanimous.
- Prefer fakes at ports over mock frameworks for domain tests. Strong agreement.

### Contested

- **Rows vs entities across the repository boundary.** Martin forbids it; Rentea calls the separate persistence model a 4× cost for CRUD. We side with Rentea and say so in §9.
- **Where repositories belong.** Palermo (core, as interfaces) vs Graça (application). We follow Graça.
- **Strict vs relaxed layers.** Classic layering says call only the next layer; Rentea and Graça both call that a Middle Man. We use relaxed.
- **Whether a DI container is needed.** Palermo says no; the InversifyJS-style Node/TS writeups assume yes. We have a hand-rolled `Container` and need nothing more.

### Outdated / not cited

- InversifyJS-centric Node onion tutorials (2016-era `dev.to`/Wolk Software): decorator-and-container-heavy, written pre-ESM and pre-`node:test`. The structural advice survives; the tooling does not. Not cited.
- Generic "Onion Architecture in Node.js" Medium reposts: no dates, no versions, largely restating Palermo. Not cited.
- `skills-lock.json` lists an `architecture-patterns` skill (`sickn33/antigravity-awesome-skills`) that is **not installed**. Reviewed: language-agnostic, principles-level Clean/Hexagonal/DDD, no TypeScript and no repo specifics. Superseded here; the dead lockfile entry should be installed or removed separately.

## Version history

The version lives in two places, kept in step: the `version` field in [SKILL.md](SKILL.md)
frontmatter, and this table. Semver on the **rules**, not the prose — major when a rule reverses or
a contested call flips, minor when a rule or area is added, patch for wording and evidence.

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-09-18 | Initial: four rings mapped onto `server/`, five-step external-system checklist, six documented deviations, dependency-cruiser + ESLint enforcement |

## Maintenance notes

- The **Known deviations** list in SKILL.md §11 is paired with the exclusions in
  `server/.dependency-cruiser.cjs`. Fix a deviation → remove both the list entry and the exclusion.
- This skill is **local**, not in `skills-lock.json`. Do not add it: locked skills are overwritten
  on sync.
