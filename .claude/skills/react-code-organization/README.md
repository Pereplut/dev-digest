# react-code-organization

**Version 1.1.0** · see [Version history](#version-history)

| File | What it is |
|---|---|
| [SKILL.md](SKILL.md) | The rules, tagged CRITICAL/HIGH/MEDIUM. What the agent loads |
| [examples.md](examples.md) | Before/after snippets and directory trees for each rule |
| README.md (this file) | Focus, scope, scenarios, version — and the 146 verified sources behind every rule |

## Focus

**Placement decisions, not correctness.** This skill answers one question — *"where does this code
belong?"* — for React and frontend codebases: which folder a component goes in, when to split it,
which layer owns business logic, and where constants, utils, types and hooks live.

It deliberately does **not** cover whether code is correct, performant or accessible.

## What it covers

| Area | Questions answered |
|---|---|
| **Project structure** | Feature vs type folders · colocation · when a component graduates to shared · route-private folders · nesting depth · barrel files |
| **Decomposition** | When to split a component · size and prop signals · container/presentational (retracted) · compound components, render props, headless · props vs `children` vs context vs slots · the server/client boundary |
| **Business logic** | Component vs hook vs plain TS module vs server · what must not be a hook · server state vs client state · state placement escalation · forms and validation · testability as the forcing function |
| **Constants, utils, types, naming** | Where constants go · `enum` vs union vs `as const` · the `utils/` dumping ground · when to extract a function · type placement · filename casing · test placement · duplication and dead code |

Each research section below ends with **Consensus** (what became a rule), **Contested** (where the
skill makes an explicit, reversible call), **Outdated advice to avoid**, and **Do not cite** (URLs
that failed verification — several widely shared ones).

## Relation to other skills

| Skill | Boundary |
|---|---|
| `react-best-practices` | **Closest sibling.** It answers *"is this code correct?"* — anti-patterns, hooks misuse, derive-don't-store, memoization, keys, a11y. This skill answers *"where does it go?"* Its brief "Code Organization" section is the summary; this skill is the detail |
| `next-best-practices` | App Router mechanics, RSC rules, metadata, route handlers. Overlaps only on the server/client boundary, which this skill treats purely as a *decomposition seam* |
| `react-testing-library` | How to write the test. This skill only decides **where the test file lives** and which layer is testable without a renderer |
| `typescript-expert` | Type-level programming and tooling. This skill covers only *placement* of types and the `enum`/`as const` decision |
| `zod` | Schema authoring. This skill covers only where a schema lives and that it is the single declaration types derive from |
| `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` | Server-side. This skill defers to them for anything past the server boundary |

## When to use it

Intended scenarios:

- Creating a new component, feature, hook or module and deciding **where the file goes**
- Naming a file or folder, or choosing between a flat file and a component folder
- Extracting logic out of a component — and deciding whether it becomes a hook or a plain function
- Deciding which layer owns a business rule, or where server vs client state lives
- Reviewing a PR for structure: cross-feature imports, dumping grounds, misplaced logic
- Refactoring an existing tree (type-first → feature-first, removing barrels)
- Settling a team debate on barrel files, `enum`, filename casing, or `utils/`
- Deciding where constants, types or tests belong

Not for: debugging a re-render, fixing a hooks bug, writing a test, or designing a DB schema.

## Sources

Research date: **2026-09-18**. Every URL below was fetched and confirmed to say what is claimed, or
is explicitly flagged. Sources are dated so stale advice stays visible — much of the popular
writing on this topic is 2019–2022 and predates React 18 / RSC.

## Which section answers which question

| Your question | Section |
|---|---|
| Where should all components be placed? | [1. Project structure](#1-project-structure--where-components-and-files-go) |
| How should they be divided? | [2. Decomposition](#2-decomposition--how-components-should-be-divided) |
| Where does business logic go? | [3. Business logic & layering](#3-business-logic--layering--where-logic-lives) |
| Where do constants go? What moves to utils/helpers? | [4. Constants, utils, types, naming](#4-constants-utils-types-naming) |
| Where does it go in a **Next.js App Router** app? | [5. Next.js App Router architecture](#5-nextjs-app-router-architecture) |

Each section ends with **Consensus** (what to encode as rules), **Contested** (where to make an
explicit choice rather than pretend there's one answer), **Outdated advice to avoid**, and
**Do not cite** (URLs that failed verification — several widely-shared ones).

---

## 1. Project structure — where components and files go

### Official framework & library docs

**[Project structure and organization — Next.js](https://nextjs.org/docs/app/getting-started/project-structure)** · Vercel · v16.3.5, updated 2026-07-21
The only first-party, current spec for App Router colocation.
- Colocate freely inside `app/`: a route is *not publicly accessible* until a `page.js` or `route.js` exists, so project files can be safely colocated inside route segments without becoming routable.
- `_folder` opts a folder and all subfolders out of routing. Documented benefits: separating UI from routing logic, consistency, editor grouping, avoiding conflicts with future Next.js conventions. **Not required** for colocation.
- `(group)` route groups organize "by site section, intent, or team" without changing URLs, and scope a `layout.tsx`/`loading.tsx` to a subset of routes.
- Pick one of three documented strategies (files outside `app/`, top-level folders inside `app/`, split by feature/route) and be consistent. Next.js is **unopinionated**; `components`/`lib` in its examples are "generalized placeholders, their naming has no special framework significance."

**[Style Guide — Redux](https://redux.js.org/style-guide/)** (Priority B: Strongly Recommended) · Mark Erikson · updated 2026-09-18
The canonical repudiation of type-based folders, from the library that popularized them.
- "structure files using a 'feature folder' approach (all files for a feature in the same folder)."
- One slice file per feature via `createSlice` — "also known as the 'ducks' pattern."
- Reject `actions/` + `reducers/` trees: "older Redux codebases often used a 'folder-by-type' approach… keeping related logic together makes it easier to find and update that code."
- Documented skeleton: `src/app` (app-wide setup), `src/common` (truly generic), `src/features/<feature>/`.

**[Importing and Exporting Components — react.dev](https://react.dev/learn/importing-and-exporting-components)** · Meta · undated (current)
Shows how little structural guidance official React docs give — worth stating plainly.
- Split a component into its own file as nesting grows.
- "People often use default exports if the file exports only one component, and use named exports if it exports multiple."
- Never `export default () => {}` — anonymous components make debugging harder.
- `react.dev/learn/thinking-in-react` covers the *logical* hierarchy only, not filesystem layout.

**[File Structure — React legacy FAQ](https://legacy.reactjs.org/docs/faq-structure.html)** · React team · **frozen; "This site is no longer updated"** (react.dev launch, March 2023) → pre-React-18/pre-RSC, yet still the only official React text on this topic
- Two legitimate groupings: "by feature or route" and "by file type."
- Nesting ceiling: "consider limiting yourself to a maximum of three or four nested folders."
- "If you're just starting a project, don't spend more than five minutes on choosing a file structure."
- "keep files that often change together close to each other. This principle is called 'colocation.'"

**[Style guide — Angular v22](https://angular.dev/style-guide)** · Angular team · current
A framework that *used* to prescribe type folders now forbids them — strong cross-ecosystem evidence.
- "Organize your project into subdirectories based on the features of your application."
- "Avoid creating subdirectories based on the type of code… avoid creating directories like `components`, `directives`, and `services`."
- Colocate `*.spec.ts` with source; keep files of one thing under the same base name.
- Gives **no** numeric file-count threshold (unlike v16 below).

**[Angular v16 style guide (LIFT)](https://raw.githubusercontent.com/angular/angular/16.2.x/aio/content/guide/styleguide.md)** · 2023 · legacy, but the only *documented* file-count rule found
- LIFT = Locate, Identify, Flat, T-DRY.
- "keep a flat folder structure as long as possible. Consider creating sub-folders when a folder reaches seven or more files."
- Rationale: "humans start to struggle when the number of adjacent interesting things exceeds nine."

**[Performance — Vite docs ("Avoid Barrel Files")](https://vite.dev/guide/performance)** · Vite team · current (v8.3.0)
First-party bundler documentation of the anti-barrel rule — not an opinion piece.
- "When you only import an individual API… all the files in that barrel file need to be fetched and transformed as they may contain the side-effects that run on initialization." Import the file directly.
- "The more implicit imports you have, the more time it adds up to resolve the paths."

**[optimizePackageImports — Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports)** · Vercel · updated 2025-12-19
- "Some packages can export hundreds or thousands of modules, which can cause performance issues"; the flag loads only what you use.
- ~30 libraries optimized by default (`lucide-react`, `@mui/material`, `recharts`, `date-fns`, `react-icons/*`) — third-party barrels are a known, tool-mitigated problem.
- Still experimental — not a licence to keep your own barrels.

**[File naming conventions — TanStack Router](https://tanstack.com/router/latest/docs/framework/react/routing/file-naming-conventions)** · current
- Files/folders prefixed `-` are excluded from the route tree "and can be used to colocate logic in route folders." Same idea as Next's `_folder`, different sigil.

**[Enforce Module Boundaries — Nx](https://nx.dev/features/enforce-module-boundaries)** · current
- Tag every project, constrain imports by tag (`scope:shared` may depend only on `scope:shared`).
- Untagged projects may depend on nothing unless `"*"` is allowed — **deny-by-default**.
- Enforced by ESLint/Oxlint rule or the Conformance plugin.

**[The virtuous cycle of workspace structure — Nx blog](https://nx.dev/blog/virtuous-cycle-of-workspace-structure)** · Philip Fulcher · 2025-02-03
Fetchable primary source for Nx's four library types.
- **feature** (containers bound to data sources), **ui** (presentational only), **data-access** (back-end interaction incl. state), **util** (low-level).
- Allowed directions: feature → any; ui → util (+ui); data-access → data-access/util; util → util only.
- Name projects `scope-type-identifier`: `products-feature-details`, `shared-ui-forms`; depend only on your own scope or `shared`.

### Reference architectures

**[Bulletproof React — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)** · [repo](https://github.com/alan2207/bulletproof-react) 35.9k★, pushed 2026-05-14
The de-facto community reference — and it **reversed its own barrel advice** in May 2024.
- Top level: `app/`, `assets`, `components`, `config`, `features`, `hooks`, `lib`, `stores`, `testing`, `types`, `utils`; each `features/<feature>/` may hold `api components hooks stores types utils` — "Include only necessary folders for each feature."
- **No barrels inside the app:** "In the past, it was recommended to use barrel files… However, it can cause issues for Vite to do tree shaking and can lead to performance issues. Therefore, it is recommended to import the files directly."
- Never import across features; compose at the app layer.
- Enforce one-way flow `shared → features → app` with ESLint `import/no-restricted-paths` zones (verbatim configs in the doc), including a zone forbidding feature→feature imports.

**Feature-Sliced Design v2.1** — [overview](https://feature-sliced.design/docs/get-started/overview) · [layers](https://feature-sliced.design/docs/reference/layers) · [slices & segments](https://feature-sliced.design/docs/reference/slices-segments) · [public API](https://feature-sliced.design/docs/reference/public-api) · [with Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs) · actively maintained
The most formally specified frontend architecture, and the main *pro-*barrel voice — with its own perf caveats.
- Layers: app, ~~processes (deprecated)~~, pages, widgets, features, entities, shared. Import rule, verbatim: "A module (file) in a slice can only import other slices when they are located on layers strictly below." Sibling slices may not import each other.
- Layers are opt-in: "most frontend projects will have at least the Shared, Pages, and App layers."
- Exactly three structural levels (layer → slice → segment); segments are `ui`, `api`, `model`, `lib`, `config` — "avoid essence-based names like components, hooks, types."
- Public API via index files, but never `export *` ("this is bad practice"); `@x` notation (`entities/A/@x/B.ts`) for unavoidable same-layer coupling, Entities only.
- Own barrel caveats: monolithic `shared/ui` indexes "risk pulling unnecessary code into bundles" → one index per component, skip indexes inside segments.
- With App Router: rename FSD's `app`/`pages` to `_app`/`_pages` under `src/`, keep Next's `app/` as routing only (`export { ExamplePage as default, metadata } from '@/_pages/example'`), use `index.server.ts` for server-only modules.

**[Folder Structure (App) — Create T3 App](https://create.t3.gg/en/folder-structure-app)** · T3 OSS · undated
- `src/app/_components/` holds app components — a mainstream starter puts shared-ish components in a private folder *inside* `app/`.
- `src/server/**` "used to clearly separate code that is only used on the server"; `src/trpc/**` is the client data layer.
- Note: `create.t3.gg/en/folder-structure` 404s; App and Pages pages are separate.

### Colocation & abstraction principles

**[Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation)** · 2019-06-17 · **pre-React-18/pre-RSC; principle holds, CSS-in-JS framing is dated**
- "Place code as close to where it's relevant as possible"; "Things that change together should be located as close as reasonable."
- Benefits: maintainability (no drift), applicability (you see what must change), ease of use (less context switching).
- Caveat: do **not** colocate integration/E2E tests — they span components and survive refactors, so they live at the project root.

**[AHA Programming — Kent C. Dodds](https://kentcdodds.com/blog/aha-programming)** · 2020-06-22
- "prefer duplication over the wrong abstraction" (Sandi Metz); "Optimize for change first."
- Let code repeat until commonalities "scream at you for abstraction" — the practical trigger for promoting code into `shared`.

**[Goodbye, Clean Code — Dan Abramov](https://overreacted.io/goodbye-clean-code/)** · 2020-01-11
- "My code traded the ability to change requirements for reduced duplication, and it was not a good trade."
- Applies directly to premature `shared/` extraction: the shared abstraction got "several times more convoluted" while the duplicated version "stayed easy as cake."

**[Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/)** · published 2022-03-15, **updated 2025-12-03** (current, and still pro-barrel)
- One directory per component: `Button/Button.tsx`, `Button/index.ts`, sub-components, `Button.helpers.ts`, `Button.types.ts`.
- `index.ts` re-exports so imports stay `import Button from '../Button'`, using `export * from './FileViewer'; export { default } from './FileViewer';`
- Component-specific hooks sit next to the component; reusable ones migrate to `src/hooks/`.
- A component-local helper moves to `src/helpers/` at second use; `helpers` = project-specific, `utils` = generic.

**[Screaming Architecture – Evolution of a React folder structure — Johannes Kettmann](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25)** · 2022-02-25 (edited 2022-03-13)
- Five stages: type folders → nested type folders → `pages/` split → colocate contexts/hooks near consumers → feature folders.
- Per Bob Martin: a type-based tree "screams: 'I'm a React app'"; a feature tree "screams 'Hey, I'm a project management tool'."
- Promotion rule: code moves to shared when a second page/feature needs it.
- "I definitely wouldn't recommend nesting too deeply."

**[React Folder Structure Best Practices — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/)** · updated 2026-05-05 · the most current systematic treatment found
- Staged path: one file → many files → component folders → technical folders → feature folders → domain folders → packages → monorepo.
- "whenever a React component becomes a reusable React component, I split it out as a standalone file"; "If exactly one feature uses a util, it lives inside that feature; once two or more features need it, it moves up."
- "My rule of thumb is to avoid nesting more than two levels."
- Barrels, nuanced: "getting out of fashion… they make tree shaking harder" — but "if you only export the public API, then it can be a good practice."

**[How to structure your React projects — Sandro Roth](https://sandroroth.com/blog/project-structure/)** · 2023-02-16 · useful mainly as a **snapshot of superseded advice**
- Type-based structure is "simple and easy to apply" but "doesn't scale."
- Describes Bulletproof React as giving each feature an `index.ts` public API — true in 2023, **no longer what Bulletproof React says**. A good illustration that mid-tier blog advice ages badly.

### Measured evidence on barrel files

**[How We Achieved 75% Faster Builds by Removing Barrel Files — Atlassian Engineering](https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files)** · Tim Sebastian, Principal SWE · 2025-06-26 · **the strongest real-world measurement available**
- 75% reduction in build minutes; TypeScript/IDE highlighting improved >30%; local unit testing ~50% faster, "up to 10x" in some packages.
- Smaller dependency graph improved affected-test selection: unit tests "88% fewer tests run… dropping from 1600 to 200", 73% lower average runtime; integration "85% fewer… 130 to 20"; visual regression 50% fewer.
- Codemod touched "over 90,000 files within a few days" in three waves.
- Names the cost honestly: removing barrels "sacrifices encapsulation and makes refactoring more fragile" — worth it at their scale.

**[How we optimized package imports in Next.js — Vercel](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)** · Shu Ding · 2023-10-13
- "If you want to use one single export from a barrel file that imports thousands of other things, you are still paying the price"; module init for major React packages costs 200–800ms, sometimes seconds.
- Module counts: `@material-ui/icons` 11,738; `@tabler/icons-react` 4,998; `@mui/material` 2,225; `lucide-react` 1,583; `recharts` 1,485; `react-use` 607.
- Dev 15–70% faster (`@material-ui/icons` 10.2s → 2.9s); production compile ~28% faster; cold starts up to 40% faster in serverless.

**[The barrel file debacle — Marvin Hagemeister](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/)** · 2023-10-08
- Measured module-graph load cost (M1 Air): 500 modules 0.15s · 1,000 0.31s · 10,000 3.12s · 25,000 16.81s · 50,000 48.44s — superlinear.
- With 100 test files, 4 in parallel: a 10,000-module graph adds ~1m18s of pure module loading; 25,000 ≈ 7 min; 50,000 ≈ 20 min (Jest-style runners don't tree-shake).
- Corrects the common mental model: barrel-referenced modules load **eagerly**, to preserve execution order and side effects — "It's a common misconception… that modules would only be loaded" on demand.

**[import/no-cycle — eslint-plugin-import](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md)** · maintained
- "Cyclic dependencies are **always** a dangerous anti-pattern." Barrels are the usual accidental source (feature → index → sibling → back to index).
- Knobs: `maxDepth`, `ignoreExternal`; expensive on large repos, so budget lint time.

**[The use of barrel files — Nx issue #3426](https://github.com/nrwl/nx/issues/3426)** · opened 2020-07-28 · closed as stale, no official resolution
- Historical record that Nx's library-`index.ts` convention drew "optimization bailout" and bundle-size complaints, plus concrete breakage. Use to show the tension is old and unresolved at framework level — **not** as a current Nx position.

### Consensus for this section

1. **Group by feature/domain at the top level; use type folders only *inside* a feature or inside `shared`.** Redux, Angular v22, Bulletproof React, FSD, Nx, Wieruch, Kettmann all agree. Type-first trees are endorsed today only for small/early projects.
2. **Colocate by default; distance is a cost you must justify.** Tests, styles, types, helpers and single-use hooks live next to their component.
3. **Promotion to `shared` is triggered by the second consumer, not by a guess.** Wieruch, Comeau, Kettmann all use this rule; Abramov and Dodds supply the reason.
4. **Dependencies flow one way, and the direction is machine-enforced.** `shared → features → app` (Bulletproof React), layers-strictly-below (FSD), deny-by-default tags (Nx). No feature imports another feature; compose at the app/page layer.
5. **Keep the tree shallow.** Published numbers: ≤2 levels (Wieruch), ≤3–4 (React FAQ), exactly 3 (FSD), split at 7–10 files (Angular LIFT).
6. **The routing directory is for routing.** Colocate route-private UI inside the route; keep genuinely shared code outside it.
7. **Inside your own app, import the file, not a barrel.** Never `export *`; a barrel is defensible only as a package's public entry point; never chain barrels.
8. **Don't spend your first day on this.** Start flat; refactor when navigation hurts.
9. **Enforcement beats documentation.** Every source operating at scale ships a lint rule. A structure convention with no linter is a suggestion.

### Contested for this section

1. **`index.ts` as a slice public API — encapsulation vs. performance.** *Pro:* FSD mandates it; Nx library entry points; Comeau (updated Dec 2025) still ships one per component. *Con:* Bulletproof React reversed to direct imports; Vite docs say avoid; Atlassian deleted 90k files' worth — while conceding it "sacrifices encapsulation." A defensible synthesis: barrels at *package* boundaries, direct imports within a package, boundaries enforced by lint rules rather than by files.
2. **Architecture up front vs. emergent.** FSD/Nx formality vs. React FAQ's "don't overthink it" and the anti-premature-abstraction camp. Team size and lifespan decide; FSD itself hedges.
3. **Where route-adjacent components live in Next.js.** Camp A: colocate in `app/**/_components` (Next permits; create-t3-app ships it). Camp B: `app/` is a thin routing shell, everything in `src/features/**` (Bulletproof React; FSD re-exports from `_pages`). Next.js deliberately refuses to arbitrate.
4. **Is there an `entities`/domain layer?** FSD yes; Bulletproof React and Redux have no equivalent; Nx splits differently (`data-access` vs `ui` vs `feature`).
5. **Component-per-folder vs. flat files.** Comeau always a folder with `index.ts`; Bulletproof/Redux keep files flat until they need friends. Collides with point 1.
6. **Exact nesting limit.** 2 (Wieruch) vs 3–4 (React FAQ) vs FSD's fixed 3 → treat as "2–3, hard cap 4".
7. **Numeric split threshold.** Angular v16 said 7/10 files; v22 deleted the number. Use 7–10 as an explicit heuristic.

### Outdated advice to avoid

| Avoid (why it's stale) | What replaced it |
|---|---|
| Top-level `actions/`, `reducers/`, `constants/`, `containers/` trees | Feature folders, one `createSlice` per feature — Redux names folder-by-type as the *older* pattern |
| Type-first top level as the target architecture | Feature/domain first; type folders only inside a feature or `shared` (Angular v22 forbids `components/`-style dirs) |
| "Add an `index.ts` barrel to every folder" (pre-2023 default, incl. Bulletproof React's own pre-May-2024 advice) | Direct file imports inside the app; barrels only as package entry points, explicit named exports, never `export *` |
| "Bundlers tree-shake barrels, so they're free" | Measurably false for dev servers, `tsc`/IDE and test runners: modules load eagerly, Jest-style runners don't tree-shake. `optimizePackageImports` mitigates *third-party* barrels only, and is experimental |
| FSD `processes` layer | Deprecated in v2.1; use pages/widgets/features |
| Pages-Router-shaped layout as the only option | App Router colocation: `_folder`, `(group)`, per-segment `loading`/`error`, optional `src/` |
| Dodds' 2019 colocation examples leaning on CSS-in-JS | The principle is untouched; re-check the styling mechanism against RSC constraints |
| "React has an official recommended folder structure" | It does not. react.dev has no file-structure page; the only official text is the frozen legacy FAQ. Cite Bulletproof React / FSD / framework docs as *community or framework* conventions, not React doctrine |

### Do not cite (failed verification)

- `profy.dev/article/react-folder-structure` — DNS failure; use the dev.to mirror above.
- `medium.com/capchase/…sped-up-builds-by-5x…` — HTTP 403; the "5x" claim is **unverified**.
- `nx.dev/docs/concepts/decisions/project-dependency-rules` and `nx.dev/concepts/more-concepts/library-types` — 404 on fetch; library types cited from the Nx blog instead.
- `v17.angular.io/guide/styleguide` — empty shell; LIFT quoted from the v16.2.x source markdown.
- The widely-repeated Lee Robinson quote on App Router colocation — no primary source found. **Do not use it.**

---

## 2. Decomposition — how components should be divided

### When to split (concrete heuristics)

**[Thinking in React — react.dev](https://react.dev/learn/thinking-in-react)** · Meta · current (React 19)
The only *authoritative* splitting criterion; everything else is commentary on it.
- Single responsibility: "a component should ideally only be concerned with one thing. If it ends up growing, it should be decomposed into smaller subcomponents."
- Derive the tree from the data shape: "Separate your UI into components, where each component matches one piece of your data model."
- Cross-check boundaries from three angles — programming (SoC), CSS (what you'd write a class for), design (layer structure).

**[When to Break Up a Component into Multiple Components — Kent C. Dodds](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components)** · 2019-07-19 · pre-RSC, logic still holds
- Split only on a felt problem: "When you experience one of the problems above, that's when you break your component into multiple smaller components. NOT BEFORE."
- His seven triggers as a checklist: whole-app re-render cost, a real reuse need, state/handler confusion, inability to unit-test in isolation, merge-conflict friction, a third-party lib needing a boundary, imperative-API encapsulation.
- Length alone is not a reason — "Duplication is far cheaper than the wrong abstraction" (Metz).

**[AHA Programming — Kent C. Dodds](https://kentcdodds.com/blog/aha-programming)** · 2020-06-22
- Don't abstract until the third occurrence; optimize for flexibility over DRY-ness.

**[Detecting code smells in React-based Web apps](https://homepages.dcc.ufmg.br/~mtov/pub/2023-ist-react.pdf)** — Fábio Ferreira & Marco Tulio Valente (UFMG), *Information and Software Technology* vol. 155 · **2023** · [smell catalog](https://github.com/fabiosferreira/React-Code-Smells)
**The only real empirical numbers in this space.** 12 React smells, validated with practitioners, thresholds from the 10 most-starred React repos (grafana, superset, metabase, Rocket.Chat, mastodon, joplin, redash, prometheus, ant-design-pro, carbon) — 3,657 files / 4,508 components.
- Table 7 thresholds (**90th percentile** of the benchmark, deliberately conservative): Too Many Props **> 13**; Large Component **> 116 LOC** *or* > 13 props *or* > 2 methods; Large File **> 225 LOC** *or* > 2 components *or* > 19 imports; JSX outside render **> 2 methods containing JSX**.
- Cite as *observed distribution tails, not targets*: "all projects in the study have large components," and removal rates ran 0.9%–50.5% — real teams tolerate large components.
- The paper's own caveat: size detection "relies on absolute thresholds… regardless of internal organization or cohesion." Prop Drilling, Low Cohesion and Duplicated Component were **not** automatable.

**ESLint thresholds** — [max-lines](https://eslint.org/docs/latest/rules/max-lines) · [max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function) · [complexity](https://eslint.org/docs/latest/rules/complexity) · [sonarjs/cognitive-complexity](https://github.com/SonarSource/eslint-plugin-sonarjs/blob/master/docs/rules/cognitive-complexity.md) · current
- Defaults: `max-lines` **300**/file (docs note recommendations span 100–500), `max-lines-per-function` **50**, `complexity` **20**, cognitive complexity **15**.
- Prefer cognitive complexity over raw lines for components: ESLint's own docs admit `complexity`/`max-statements` miss long JSX chains, and JSX inflates lines without adding branching.

### Container/Presentational: origin and retraction

**[Presentational and Container Components — Dan Abramov](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0)** · 2015, **updated 2019 with a retraction**
The most consequential retraction in React architecture advice — still cargo-culted.
- Verbatim 2019 note: "Update from 2019: I wrote this article a long time ago and my views have since evolved. In particular, I don't suggest splitting your components like this anymore."
- His replacement: "The main reason I found it useful was because it let me separate complex stateful logic from other aspects of the component. Hooks let me do the same thing without an arbitrary division."
- He objects to the dogma too — enforced "without any necessity and with almost dogmatic fervor far too many times."
- **Provenance:** Medium returns HTTP 403 to automated fetches; the text was verified via a mirror plus two independent corroborations. Cite the Medium URL, quote only these sentences.

**[Goodbye presentational and container components? — Sam Dawson](https://www.samdawson.dev/article/container-components/)** · 2020-04-22
- Independent corroboration of the retraction; design the component's *interface*, not its innards. Treat "we do it because it's a best practice" as a warning sign.

**[Not All Components Are Created Equal — Emily Bartman & Phil Plückthun (NearForm)](https://nearform.com/digital-community/react-components/)** · 2021-06-22
The strongest steelman for a *descriptive* revival.
- Let categories emerge: "we're not saying we need to write components to fit these categories, but that components organically show characteristics of them."
- Taxonomy presentational / structural / stateful on an "axis of reusability" — not in folders.

**[RSC and the Echo of 'Presentational and Container Components' — Lorenzo Rivosecchi](https://dev.to/fibonacid/rsc-and-the-echo-of-presentational-and-container-components-33i)** · 2023-06-29 · community-level, cite for framing only
- Names the comeback vector (server = container, client = presentational) **and** its failure mode: letting "client components render all the markup" "defeats one of the most important benefits of RSC: Shipping less JavaScript to the browser."

### Atomic Design

**[Atomic Web Design — Brad Frost](https://bradfrost.com/blog/post/atomic-web-design/)** · 2013-06-10 · [book ch. 2](https://atomicdesign.bradfrost.com/chapter-2/) (2016, free)
Primary source — and it contains the caveats critics are usually credited with.
- Frost's own guardrails: "atomic design is not a linear process", it is "a mental model", "atomic design is not rigid dogma."
- Explicitly **not** a code architecture: "atomic design has nothing to do with web-specific subjects like CSS or JavaScript architecture." Do not map atoms/molecules/organisms onto folders and call it done.
- Rename tiers freely (he cites GE Design's Principles/Basics/Components/Templates/Features/Applications).

**[Extending Atomic Design — Brad Frost](https://bradfrost.com/blog/post/extending-atomic-design/)** · 2019-07-10
- Restates flexibility six years on; adapt the taxonomy to your team's vocabulary.

**Critiques** — [Perils of Atomic Design (Jay Freestone)](https://www.jayfreestone.com/writing/perils-of-atomic-design/) · 2015-09-28 · [Against atomic design (Donnie D'Amato)](https://blog.damato.design/posts/against-atomic-design/) · undated · [Where Atomic Design Fell Short (Frost's own link-post)](https://bradfrost.com/blog/link/where-atomic-design-fell-short/) · 2015-03-05
**Flag the dates: 2015, pre-hooks and pre-RSC, and they critique the design methodology, not React code.**
- Freestone: it "promotes designing in isolation"; the manufacturing analogy misleads because "the car is not designed in isolation, it is manufactured in isolation."
- D'Amato: the metaphor is the defect — a dropdown is defensibly a molecule *or* an organism, so "the naming is what hurts the approach."
- Frost concedes the vocabulary problem but defends hierarchy: "my issue with terms like 'modules' and 'components' is that they don't carry any sense of hierarchy."

**[Atomic Design and its relevance in frontend in 2025 — Yan Levin](https://dev.to/m_midas/atomic-design-and-its-relevance-in-frontend-in-2025-32e9)** · 2025-01-03 · community-level, a dated data point not an authority
- Verdict: "For modern frontend projects in 2025, where business logic and domain entities are more prevalent, Atomic Design is rarely used."
- Failure mode: it organizes *UI* and is silent on business logic and domain entities. Still fine for "UI-heavy projects with little business complexity" — i.e. design-system packages.

### Compound components, render props, headless

**[Compound Components with React Hooks — Kent C. Dodds](https://kentcdodds.com/blog/compound-components-with-react-hooks)** · 2019-02-18
- Reach for compound components when children share implicit parent state; the model is `<select>`/`<option>`, which "implicitly stores state about the selected option and shares that with its children."
- Share state via context so consumers can wrap and nest the parts freely.

**[Inversion of Control — Kent C. Dodds](https://kentcdodds.com/blog/inversion-of-control)** · 2019-11-18
The decision rule for *when* to move from props to compound/render-prop APIs.
- Invert once you're repeatedly bolting on conditional options: "Each new argument/option/prop you add to your reusable code makes it harder for end users to use."
- Don't invert for one caller — IoC "for a single use case would just make the code more complicated."

**[patterns.dev — Compound Pattern](https://www.patterns.dev/react/compound-pattern)** · [Render Props Pattern](https://www.patterns.dev/react/render-props-pattern) · maintained/current
- Implement compound components with **context, not `React.cloneElement`**: with cloning "only direct children of the parent component will have access" to shared props, and shallow merges risk collisions.
- Default to hooks over render props: "in a 2025 codebase, render props are no longer the default tool for sharing logic — custom hooks are."
- Keep render props for headless libraries (Downshift, React Aria) and animation primitives "where the wrapper must structurally own the JSX tree"; watch callback pyramids.

**[Radix Primitives — Introduction](https://www.radix-ui.com/primitives/docs/overview/introduction)** · [Composition (`asChild`)](https://www.radix-ui.com/primitives/docs/guides/composition) · current
The reference implementation of "decompose into parts, let the consumer own the element."
- Expose **granular parts** so consumers can "wrap them and add your own event listeners, props, or refs" instead of a monolith with 30 props.
- Use `asChild` over an `as`/`component` prop: "Radix will not render a default DOM element, instead cloning the part's child and passing it the props and behavior required to make it functional." Anything under `asChild` must spread props and forward its ref.

**[Headless UI](https://headlessui.com/)** · [TanStack Table](https://tanstack.com/table/latest) · [React Aria](https://react-aria.adobe.com/) · current
- Headless = behavior/state/a11y without markup: "completely unstyled, fully accessible UI components"; TanStack gives "state and typed APIs without prescribing a single element or style" for "100% control of your code" — at the cost of building the UI yourself.
- React Aria's three tiers are a decomposition ladder worth copying: high-level components → compositional patterns via exported contexts → low-level hooks for "complete control" to "intercept events, override behavior, customize DOM elements." Start high, drop down only where needed.

**[shadcn/ui docs](https://ui.shadcn.com/docs)** · current
- "This is not a component library. It is how you build your component library." You own the source, so "split it" is a local edit, not an override fight.
- "Every component uses a common, composable interface, making them predictable."

### Props design

**[Passing Data Deeply with Context — react.dev](https://react.dev/learn/passing-data-deeply-with-context)** · current
The authoritative ordering, and it names *missing decomposition* as the real cause of drilling.
- "Just because you need to pass some props several levels deep doesn't mean you should put that information into context."
- Props first, even many: "it's not unusual to pass a dozen props down through a dozen components… it makes it very clear which components use which data!"
- The key rule: "Extract components and pass JSX as `children` to them… this often means that you forgot to extract some components along the way" — `<Layout posts={posts} />` becomes `<Layout><Posts posts={posts} /></Layout>`.
- Reserve context for theming, current user, routing, genuinely distant consumers.

**[Passing Props to a Component — react.dev](https://react.dev/learn/passing-props-to-a-component)** · current
- `children` as *the* default extension point: "a component with a `children` prop [has] a 'hole' that can be 'filled in' by its parent components with arbitrary JSX."

**[Prop Drilling — Kent C. Dodds](https://kentcdodds.com/blog/prop-drilling)** · 2018-05-21 · **class/HOC-era; the advice survived into react.dev**
- Keep state in "the least common parent" of the components that need it, not at the root.
- Don't extract render methods into components merely to tidy; extract for real reuse.

**[Multiple Boolean Props are a Code Smell — Kyle Shevlin](https://kyleshevlin.com/multiple-boolean-props-are-a-code-smell/)** · 2020-08-28
- Replace mutually-exclusive booleans with one enum: `<CommonButton primary warning danger>` → `<BetterButton variant="primary">`. n booleans encode 2ⁿ combinations, most meaningless.

**[Material UI — API design approach](https://mui.com/material-ui/guides/api/)** · [Overriding component structure (slots)](https://mui.com/material-ui/customization/overriding-component-structure/)** · current
A large design system's codified rules — the most citable version of the boolean/enum line.
- Verbatim: "A boolean is used when **2** possible values are required. An enum is used when **> 2** possible values are required."
- Boolean props default to `false` and are named as adjectives (`disabled`, not `disable`) "because props describe states and not actions."
- Composition default: "Using the `children` prop is the idiomatic way to do composition with React" — but where composition is limited, "providing explicit props makes the implementation simpler and more performant" (Tab's `icon`/`label`).
- **Slots** when consumers must replace *internal structure*: `component` for the root, `slots` to replace interior elements, `slotProps` to configure them.

**[class-variance-authority](https://cva.style/docs)** · current
- Names the problem: "manually matching classes to props, and manually adding types." Declare variants once, get a typed `variant`/`size` API.

### Server vs Client Components (RSC)

**[`'use client'` — react.dev](https://react.dev/reference/rsc/use-client)** · [Server Components — react.dev](https://react.dev/reference/rsc/server-components)** · current
- The directive marks a module *and all its transitive imports* as client code; "only Client modules are bundled and evaluated by the client." Boundary placement **is** a bundle-size decision.
- The official shape is container-splits-at-the-boundary: a Server Component reads data (`await db…`) and renders `<Counter initialValue={…} />`, a `'use client'` leaf.
- Server Components can't use state/effects/browser APIs and **cannot create context** (they can render a provider imported from a client module). Promises may cross, read with `use`.
- One documented reason to force a component client-side: "components that return a long SVG path string."

**[Server and Client Components — Next.js](https://nextjs.org/docs/app/getting-started/server-and-client-components)** · [The Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary)** · v16.3.5, updated 2026-08-25
The most detailed current decomposition guidance anywhere, including two gotchas nobody else documents.
- Push the boundary to the leaves: "add `'use client'` to specific interactive components instead of marking large parts of your UI as Client Components."
- Two rules: "Code crosses through imports… Data crosses through props, and it must be serializable" — function props can't cross; Server Functions cross as references.
- Slot pattern to keep server content under client state: `<Modal title={…}><Cart /></Modal>` — "Here, `Cart` runs on the server, and `Modal` only ever sees its output, never its code." Docs distinguish **owner** (whose JSX contains it → decides environment) from **parent**.
- **Compound components break at the boundary:** a Server Component importing a client compound gets a client reference, so `Menu.Item` is `undefined`. "To use its pieces from a Server Component, expose them as named exports instead of static properties."
- Render providers as deep as possible; wrap third-party client-only components in your own `'use client'` file.

**[Making Sense of React Server Components — Josh W. Comeau](https://www.joshwcomeau.com/react/server-components/)** · published 2023-09-06, updated 2025-05-09
- Rule of thumb: "if a component can be a Server Component, it should be a Server Component."
- Extract the state, don't promote the page — pluck state management into a client wrapper so siblings stay server.
- The insight that fixes most mistakes: "the parent/child relationship doesn't matter" — the **importer** determines component type.

**[The Two Reacts — Dan Abramov](https://overreacted.io/the-two-reacts/)** · 2024-01-04 · [Impossible Components](https://overreacted.io/impossible-components/) · 2025-04-22
- The frame: client is `UI = f(state)`, server is `UI = f(data)`, and we want `UI = f(data, state)` — so one feature legitimately becomes two components in two environments.
- Technique: a client component leaves **holes** a server component fills — "You can always take a tag like `<section>...</section>` and replace it with a frontend component that enriches a plain section with stateful logic" — plus extra element props alongside `children`.

### Splitting for performance (what changed)

**[`memo` — react.dev](https://react.dev/reference/react/memo)** · current
Official list of **structural** fixes that make memoization unnecessary.
- Accept JSX as `children` in visual wrappers — "when the wrapper updates its own state, React knows children don't need to re-render."
- Keep state local; pass primitives instead of freshly-built objects; project values (`hasGroups={person.groups !== null}`) rather than whole records.

**[State Colocation will make your React app faster — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)** · 2019-09-23
- Moving state down means React "doesn't even execute" reconciliation for unaffected branches — the cheapest perf fix is a boundary, not a `memo`.

**[Why React Re-Renders — Josh W. Comeau](https://www.joshwcomeau.com/react/why-react-re-renders/)** · published 2022-08-16, updated 2025-12-03
- Position state-independent subtrees so cascades can't reach them. "Don't over-optimize!… honestly, React is already very optimized."

**[React Compiler — react.dev](https://react.dev/learn/react-compiler/introduction)** · documented as **stable**, optional install
- It "automatically optimizes your React application by handling memoization for you, eliminating the need for manual `useMemo`, `useCallback`, and `React.memo`."
- Requires **no architectural change** — so split for responsibility/reuse, not to enable memoization.

### Consensus for this section

1. **Responsibility, not length, is the criterion** (react.dev). Every serious source refuses a line-count rule; the only numbers are lint defaults and one paper's 90th-percentile tails.
2. **Split reactively, on a named problem** — Dodds' seven triggers plus rule-of-three. No source endorses preemptive atomization.
3. **Prop drilling is not the enemy; missing composition is.** Official escalation: props → extract components and pass `children` → context.
4. **`children` is the default extension point**; slots are the escalation when consumers must replace internal structure.
5. **Booleans for 2 states, `variant` enums beyond that** — unanimous (MUI codified, Shevlin, CVA tooling).
6. **Container/Presentational is retracted by its author**, replaced by custom hooks. The surviving version is descriptive only.
7. **Atomic Design is a shared-vocabulary mental model, not a code architecture** — Frost says so himself.
8. **Invert control when options multiply** — compound (context-based) → render props → headless hooks, but never for a single caller.
9. **Headless/hooks-first is the accepted way to split behavior from presentation**: parts + `asChild`/slots for markup ownership.
10. **RSC makes the boundary a first-class seam.** Server by default, `'use client'` as deep as possible, pass server output through `children`.
11. **Structure beats memoization**; the React Compiler removes most remaining reasons to restructure for memo.

### Contested for this section

1. **Is container/presentational dead or reborn?** Retraction camp (Abramov, Dawson) vs descriptive camp (NearForm: categories *emerge*) vs the RSC echo. Recommended stance: the *file-level* mandate is dead; the *environment* split is real but is not a licence to make client components the only renderers.
2. **Atomic Design's usefulness.** Frost's flexible model vs irreducible taxonomy ambiguity and silence on domain logic. Note the asymmetry: the named-author critiques are **2015** and target design methodology; the React-specific 2025 critiques are community-level.
3. **Is prop drilling a smell at all?** react.dev and Dodds defend a dozen props as explicit; the smells paper catalogues it as a smell — though it could not automate detection. Both agree the fix is composition, not context.
4. **How many props is too many?** Empirical tail is **13**; MUI/Shevlin argue the problem is the *kind* of prop long before the count. No agreed number — use "can you describe it in one sentence?"
5. **Explicit props vs unrestricted `children`.** MUI breaks with "always compose" where composition is over-general; Radix/shadcn push the other way. Roughly *product component* (props) vs *design-system primitive* (parts/slots).
6. **Compound components vs the RSC boundary.** Dot-notation compounds break when a Server Component imports them; Next's docs say switch to named exports. **Unsettled** — nobody has reconciled dot-notation APIs with server/client interleaving.
7. **How much does re-render cost justify splitting?** Weakened by the React Compiler. Splitting for responsibility still stands.

### Outdated advice to avoid

| Avoid | What replaced it |
|---|---|
| "Every feature = container + presentational component"; `containers/` vs `components/` folders as a mandate | **Retracted by the author (2019).** Extract stateful logic into a custom hook; keep one component. Organize by feature with a shared `components/`, lint-ban cross-feature imports |
| Render props / HOCs as the default logic-sharing mechanism | Custom hooks — "in a 2025 codebase, render props are no longer the default tool for sharing logic." Keep render props for headless libs and animation primitives |
| `React.cloneElement` + `React.Children.map` for compound components | Context-based compounds, or Radix-style parts + `asChild`. `cloneElement` is discouraged in current react.dev API docs |
| Mapping atomic tiers onto source folders (`atoms/`, `molecules/`, `organisms/`) as app architecture | Never what Frost proposed. Keep atomic vocabulary for *design conversation*; structure code by feature/domain. Tiers are fine inside a design-system package |
| "Put shared data in context to avoid prop drilling" | Props first, then extract a component and pass JSX as `children`. Context for theming/user/routing/distant consumers |
| Boolean flags per visual state (`<Button primary warning danger>`) | A single typed `variant`/`size` enum (CVA if Tailwind-based); slots when structure must be replaceable |
| Splitting components to sprinkle `React.memo`/`useMemo`/`useCallback` | React Compiler is stable and eliminates manual memoization with no architectural change. Colocate state, accept `children`, pass primitives |
| `'use client'` at the page/layout root; "convert the tree so hooks work" | Server by default; `'use client'` at interactive leaves; pass server output as `children`; providers as deep as possible; wrap third-party client-only libs in your own client file |
| Dot-notation compounds used from a Server Component (`<Menu.Item>`) | Expose the parts as **named exports**, or keep the compound inside one graph |
| `getInitialState`/constructor seeding from props, `forceUpdate`, `renderX()` methods returning JSX | Function components + hooks; extract each `renderX()` into a real component (study threshold: > 2 methods containing JSX) |

**Date hygiene:** the 2018 prop-drilling and 2015 atomic-design critiques are pre-hooks; the 2019 Dodds posts are hooks-era but pre-RSC (splitting logic survives, performance framing is dated by the compiler). The Abramov article's *body* is 2015 class-era and must never be cited without the 2019 retraction note.

**Do not cite:** `medium.com/@dan_abramov/...` returns HTTP 403 to automated fetches (quote verified via mirror + corroboration); `web.archive.org` was blocked. `react-spectrum.adobe.com/react-aria/index.html` now 301s — use `react-aria.adobe.com`.

## 3. Business logic & layering — where logic lives

### React's own rules (the layering question)

**[Reusing Logic with Custom Hooks — react.dev](https://react.dev/learn/reusing-logic-with-custom-hooks)** · current
The most authoritative statement of what a hook is **for** and what must **not** be one.
- Extract into a hook only when the logic actually calls hooks (state, effects, context, external-store subscriptions).
- If it calls no hooks, drop the `use` prefix: docs show `// 🔴 Avoid: A Hook that doesn't use Hooks / function useSorted(items) { return items.slice().sort() }` vs `// ✅ Good: A regular function … function getSorted(items)`. A plain function can also be called conditionally.
- "Custom Hooks let you share *stateful logic* but not *state itself*."
- Never `useMount` / `useEffectOnce` / `useUpdateEffect`: "Avoid creating and using custom 'lifecycle' Hooks that act as alternatives and convenience wrappers for the `useEffect` API itself." Keep hooks at "concrete high-level use cases" (`useChatRoom`, `useOnlineStatus`).
- Push imperative external-system logic into a plain class or module and let the hook only wire it up.

**[Rules of React — react.dev](https://react.dev/reference/rules)** · current
- Components are idempotent; "Side effects must run outside of render." Props, state, hook arguments and return values are immutable.
- "Only call Hooks from React functions" — so any logic you want callable from a script, test, worker, or server **cannot** live in a hook.

**[Keeping Components Pure — react.dev](https://react.dev/learn/keeping-components-pure)** · current
- Render is a pure function of props/state/context: "same inputs, same output"; "minds its own business."
- Mutations and I/O go in event handlers ("event handlers don't need to be pure"); `useEffect` is "your last resort."

**[You Might Not Need an Effect — react.dev](https://react.dev/learn/you-might-not-need-an-effect)** · current
The canonical anti-pattern catalogue — the essential citation for "useEffect is not a logic pipeline."
- Derive, don't sync: "You don't need Effects to transform data for rendering."
- Event-driven business logic goes in the handler: "You don't need Effects to handle user events… By the time an Effect runs, you don't know *what* the user did."
- Reset state with `key`, not an Effect; collapse Effect chains into one handler. Subscribe to external stores with `useSyncExternalStore`.
- The rule: "Code that runs because a component was *displayed* should be in Effects, the rest should be in events."

**[Extracting State Logic into a Reducer — react.dev](https://react.dev/learn/extracting-state-logic-into-a-reducer)** · current
react.dev's own testability-as-placement argument.
- "consolidate all the state update logic outside your component in a single function, called a *reducer*." Dispatch *events*, not setters.
- "A reducer is a pure function that doesn't depend on your component. This means that you can export and test it separately in isolation."

**[Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)** · [Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) · [Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) · [Scaling Up with Reducer and Context](https://react.dev/learn/scaling-up-with-reducer-and-context) · all current
- Never store what you can compute; don't mirror props in state; store IDs not duplicated objects; model one `status` union instead of contradictory booleans.
- One owner per piece of state ("single source of truth"), which "doesn't mean that all state lives in one place."
- The gate before context: "Just because you need to pass some props several levels deep doesn't mean you should put that information into context."
- The sanctioned "poor man's store": separate state and dispatch contexts, export `useTasks()` / `useTasksDispatch()` so components stay "focused on what they display rather than where they get the data."

### Data fetching as a layer — server state vs client state

**[React Query as a State Manager — TkDodo](https://tkdodo.eu/blog/react-query-as-a-state-manager)** · Dominik Dorfmeister (TanStack Query maintainer) · **2021-08-20 (pre-v4; concepts current, API dated)**
The origin of the mainstream "server state ≠ app state" framing.
- "React Query is in fact *NOT* a data fetching library." Treat fetched data as a snapshot you don't own; tune `staleTime` instead of disabling refetching.
- Don't copy server data into another store or `useState`.

**[Why You Want React Query — TkDodo](https://tkdodo.eu/blog/why-you-want-react-query)** · 2023-11-07
- What hand-rolled Effect fetching gets wrong: race conditions, missing loading state, "not yet loaded vs empty" ambiguity, stale error/data mixing, StrictMode double-invocation.
- "Data Fetching is simple. Async State Management is not."

**[Practical React Query — TkDodo](https://tkdodo.eu/blog/practical-react-query)** · published 2020-11-16, **updated 2023-10-21**
- Wrap `useQuery` in a custom hook per resource so query keys/options live in one place and UI components don't own fetching.
- Putting query data in local state "implicitly opt[s] out of all background updates." Don't use `setQueryData` as a general store.

**[Deriving Client State from Server State — TkDodo](https://tkdodo.eu/blog/deriving-client-state-from-server-state)** · **2025-09-01** · the most current statement of derive-don't-sync at the seam
- Never write an Effect that resets client selections when server data changes; compute the effective value from (server data + stored client value) in a hook.
- Keep the raw stored value so the UI can show an invalid selection; validity restores itself if the item returns. Library-agnostic.

**[React Query and Forms — TkDodo](https://tkdodo.eu/blog/react-query-and-forms)** · 2022-04-10
The one sanctioned exception to "don't copy server state," with the price stated.
- Default: server state in the query, only edits in form state — "If the user has changed a field, we show the Client State. If not, we fall back to the Server State."
- If you do seed a form: "As soon as we copy that state somewhere else, React Query cannot do its job anymore" — consider `staleTime: Infinity` and reset after a successful mutation.

**[You Might Not Need React Query — TkDodo](https://tkdodo.eu/blog/you-might-not-need-react-query)** · 2023-05-20
The maintainer drawing the RSC boundary himself.
- If fetching happens exclusively on the server, skip the client query layer: "React Query is, first and foremost, a library to manage asynchronous state on the client." Keep it for infinite/paginated lists, offline, background refresh.

**[TanStack Query Overview](https://tanstack.com/query/latest/docs/framework/react/overview)** · [Does this replace client state management?](https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state) · official, v5
- Server state is state that "is persisted remotely in a location you may not control or own," needs async APIs, "implies shared ownership," and can go stale → manage it with a cache, not a store.
- "TanStack Query is not a replacement for local/client state management." Move entity data out of stores; what's left is typically `themeMode`, `sidebarStatus` — then ask whether a store is still warranted.

**[RTK Query Overview — Redux Toolkit](https://redux-toolkit.js.org/rtk-query/overview)** · official, current
- The Redux team conceding the split: RTK Query exists because "'data fetching and caching' is really a different set of concerns than 'state management'."

**[React Query: It's Time to Break up with your "Global State"! — Tanner Linsley](https://gitnation.com/contents/react-query-its-time-to-break-up-with-your-global-state)** · React Summit Remote **2020** · dated framing, foundational
- Cite for the thesis only (verified via the abstract page): "When server state and client state are stored in the same system, tradeoffs are made"; "Server state has unique challenges that require dedicated tools."

### State-management boundaries

**[Redux Style Guide](https://redux.js.org/style-guide/)** · official, current
The most explicit "what belongs in the store" rulebook in the ecosystem.
- Priority A: "Reducers Must Not Have Side Effects" — no async, no `Date.now()`/`Math.random()`.
- "Put as Much Logic as Possible in Reducers" — not in click handlers — because it "helps ensure that more of the actual app logic is easily testable."
- "Keep State Minimal and Derive Additional Values" via selectors; "Model Actions as Events, Not Setters."
- "Evaluate Where Each Piece of State Should Live": the single-tree principle "has been over-interpreted… Values that are 'local' should generally be kept in the nearest UI component instead."
- Priority C: "Avoid Putting Form State In Redux" — keep edits local, dispatch once on completion.

**[Redux FAQ: General](https://redux.js.org/faq/general)** · official, current
- Reach for a store only on the documented signals (lots of state needed in many places, frequent updates, complex update logic, large team, update history).
- Quotable for skeptics: Dan Abramov — "don't use Redux until you have problems with vanilla React."
- A Redux store is UI-agnostic ("can be used as a data store for any UI layer") — which is why domain logic can live in reducers/selectors.

**[Why React Context is Not a "State Management" Tool — Mark Erikson](https://blog.isquaredsoftware.com/2021/01/context-redux-differences/)** · 2021-01-18 · pre-RSC, argument still standard
- "Context is how state (that exists somewhere already) is shared with other components. Context has little to do with state management." Context is dependency injection; the state lives in `useState`/`useReducer`/a store.

**[Working with Zustand — TkDodo](https://tkdodo.eu/blog/working-with-zustand)** · 2022-11-20
- Export custom hooks, not the raw store; prefer atomic selectors; separate actions from state; keep store scope small — many small stores composed by hooks.

**[Zustand — Flux-inspired practice](https://zustand.docs.pmnd.rs/learn/guides/flux-inspired-practice)** · official, current · **partly contradicts the above**
- "Your applications global state should be located in a single Zustand store" (sliced when large). Keep side effects in functions wrapping the state functions.

**[Application State Management with React — Kent C. Dodds](https://kentcdodds.com/blog/application-state-management-with-react)** · 2020-07-21 · pre-RSC, principles intact
- "Keep state as local as possible and use context only when prop drilling really becomes a problem."
- Two buckets: server cache vs UI state — "Server cache has inherently different problems from UI state and therefore needs to be managed differently."

**[Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation)** · 2019-06-17
- The default that "extract to a layer" must beat: place code close to where it's relevant; move it up when a second consumer appears.

### Framework-agnostic domain logic — advocates and critics

**[Clean Architecture on Frontend — Alex Bespoyasov](https://bespoyasov.me/blog/clean-architecture-on-frontend/)** · ~2021–2022 · evergreen, no RSC content
The most serious example-driven treatment — and it contains its own limits.
- "All the main application functionality is isolated and collected in one place—in the domain." Define ports from your needs: "we adapt the outside world to our needs, not the other way around."
- React is a driving adapter. Honour only two non-negotiables — extract the domain, never let dependencies point outward — and "if it's more pragmatic… to break a rule, I'll break it."
- Costs he names: "If the project is small, a full implementation will be an overkill"; harder onboarding; more bundle; more up-front design.

**[Comment thread — practitioner pushback](https://dev.to/bespoyasov/clean-architecture-on-frontend-4311/comments)** · 2021–2022
- The core objection (Alex Grad, Oct 2021): "Hooks are part of React. React is about the UI layer. So why are hooks part of the application layer?… How can you reuse them across different UI libraries?"
- Author's answer: hooks are DI glue; the injected functions stay framework-agnostic. His own scoping: the payoff is for apps with rich domain logic; thin clients whose rules live on the server don't need it.

**[Clean Architecture in React — Alex Kondov](https://alexkondov.com/full-stack-tao-clean-architecture-react/)** · 2024-02-09
The middle camp: separate domain from view, refuse speculative layering.
- "A component should just receive data and return markup—it should act as a pure function."
- "When, how, and what data we need is part of our domain logic. They have no place being together [with visualization code]."
- "I never rush to extract reusable components"; prefer few deep modules over many shallow ones.

**[Clean Architecture on the Frontend: Beyond Smart and Dumb Components — djblackett](https://dev.to/djblackett/clean-architecture-on-the-frontend-beyond-smart-and-dumb-components-1abj)** · indexed 2025
Gives two operational, agent-friendly placement tests.
- **Framework Test:** "Would this rule still matter if I rebuilt the UI in another framework, or shipped a mobile app?" → if yes, it isn't a component's job.
- **Import Smell Test:** "If a function imports `toast`, `useMutation`, or `styled-components`, it's presentation or orchestration." Domain logic must run in plain TS unit tests.
- Worked split: `createPendingInvoice()` (domain) vs `useSubmitNewInvoice()` (presentation: form + mutation + cache + toast) vs component (render).
- Caveats: frontend rules are UX, not security — the backend must re-enforce; not every feature earns domain/application/infrastructure folders.

**[Clean Architecture in Frontend: A How-To Guide — Evan Carter (FSD blog)](https://feature-sliced.design/blog/frontend-clean-architecture)** · **2025-12-30**
- Inward-only dependencies across Domain → Application → Interface Adapters → Frameworks & Drivers.
- "Clean Architecture doesn't remove constraints. It **pushes them to the edges**."
- Apply when "the product is long-lived… team size is growing"; "may be overkill when the app is small and short-lived." "Prefer simple factories over global containers."

**[The 5 Frontend Architectures You Must Know in 2025 — Evan Carter](https://feature-sliced.design/blog/frontend-architecture-guide)** · 2025-11-27
- Size-to-architecture mapping: layered MVC/MVVM for "Simple–medium apps, small teams" (beware "controllers or view-models [becoming] God objects"); atomic design covers UI composition, "not domain complexity"; micro-frontends only at multi-team scale; FSD for "Medium–large SPAs, multi-team long-lived products."

**[Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview)** · v2.1 · and **[Bulletproof React — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)**
- FSD: business entities in `entities`, product behaviour in `features`, `shared` project-agnostic; imports only from strictly lower layers; `processes` deprecated.
- Bulletproof React: the pragmatic alternative — feature folders, one-way `shared → features → app`, enforced in CI with `import/no-restricted-paths` rather than by convention.

### Forms, validation, and the client/server contract

**[How to think about data security in Next.js](https://nextjs.org/docs/app/guides/data-security)** · v16.3.5, updated **2026-08-25**
The current authority on what must live in server code.
- All data access in a server-only Data Access Layer that "Only run[s] on the server," performs authorization checks, and returns "safe, minimal **Data Transfer Objects (DTOs)**." Mark them `import 'server-only'`; only the DAL reads `process.env`.
- Re-verify auth **inside** every Server Action — "A page-level authentication check does not extend to the Server Actions defined within it" — and check resource ownership (IDOR).
- Keep `"use server"` actions thin: "Only return what the UI needs, not raw database records." Treat `searchParams`/params/headers as untrusted.

**[How to Think About Security in Next.js — Sebastian Markbåge](https://nextjs.org/blog/security-nextjs-server-components-actions)** · 2023-10-23 · React core author
- Choose exactly one data-handling model (HTTP APIs / DAL / component-level queries) and don't mix: "Exceptions pop out as suspicious."
- "a Server Component function body should only see data that the current user issuing the request is authorized to have access to."
- "the argument list to Server Actions (`"use server"`) must always be treated as hostile and the input has to be verified" — "manually or with a tool like `zod`."
- `import 'server-only'` so "internal business logic doesn't accidentally leak to the client."

**[How to create forms with Server Actions — Next.js](https://nextjs.org/docs/app/guides/forms)** · v16.3.5, updated 2026-08-25
- HTML attributes for cheap checks; a schema library ("Zod or Valibot") for real validation **in the action** via `safeParse`, returning field errors instead of throwing.
- Surface with `useActionState` (also yields `pending`); `useFormStatus` in a child for submit state; `useOptimistic` for optimistic UI.
- **Caveat for skill authors:** its samples still use Zod-3 APIs (`invalid_type_error`, `error.flatten()`) — re-check against current zod.dev before copying.

**[Zod — Basics](https://zod.dev/basics)** · **v4.6 (current)**
- One schema in a shared module; derive types with `z.infer` (and `z.input`/`z.output` with transforms) so validation and types can't drift.
- Prefer `.safeParse()` at boundaries — returns `{ success: true; data } | { success: false; error }`.

**React Hook Form — Get Started** (https://react-hook-form.com/get-started) · **fetch returned HTTP 403**, so the `@hookform/resolvers` + `zodResolver` pattern is **unverified here**. Re-verify before citing; the verified version of "same schema both sides" is the Next.js forms guide + Zod docs above.

### Testability as the forcing function

**[React Testing Library API (`renderHook`)](https://testing-library.com/docs/react-testing-library/api)** · official, current
- `renderHook` is "a convenience wrapper around `render` with a custom test component… mostly interesting for libraries publishing hooks."
- "You should prefer `render` since a custom test component results in more readable and robust tests."

**[How to test custom React hooks — Kent C. Dodds](https://kentcdodds.com/blog/how-to-test-custom-react-hooks)** · 2020-03-22 · pre-RSC, still mainstream
- Default to testing a component that uses the hook; escalate to `renderHook` only for rerender-with-new-props, cleanup-on-unmount, or async hooks.

**[How to use a custom React hook to increase application testability — Arnaud Langlade](https://www.arnaudlanglade.com/software-testing-react-hook/)** · 2023-04-04
- When a component can't be rendered in tests, "refactor this component to extract the business logic into a hook… the component will only be responsible for rendering things." Inject services through a provider so tests supply fakes.

**[React has changed, your Hooks should too — Matt Smith](https://allthingssmitty.com/2025/12/01/react-has-changed-your-hooks-should-too/)** · 2025-12-01
- "useEffect is still the most commonly misused hook. It often becomes a dumping ground for logic that doesn't belong there, e.g., data fetching, derived values, even simple state transformations."
- "Only use effects for actual side effects, things that touch the outside world. Everything else should be derived during render." Prefer Server Components, server actions, `use()`, `useActionState`.

### Consensus for this section

**Components (incl. JSX):** rendering and event wiring only. Pure and idempotent; derive display values during render. Business *rules* may be *called* from JSX but never *defined* there.

**Custom hooks:** the React-coupled glue layer — state, subscriptions, context, queries, mutations, form wiring, orchestration of "when." Extract to a hook only if it calls hooks; otherwise it's a plain function. Hooks are adapters/DI seams, not a place to hide domain rules, and never lifecycle wrappers.

**Plain TS modules:** pure domain rules, calculations, mappers, reducer/state-machine logic, validation schemas. Three convergent tests: would this survive a UI-framework swap or a mobile app? does it import UI libs (`toast`, `useMutation`, styled-components)? can it be tested without a renderer?

**Server code:** the only place with authority. Secrets, DB access, authorization and canonical validation live in a server-only DAL returning DTOs; `"use server"` entry points are public endpoints whose arguments are hostile and whose callers must be re-authorized per action. **Frontend rules are UX, never a security boundary.**

**Server state is a cache, not app state** — remote, shared-ownership, staleable. It belongs in a query cache keyed by resource and wrapped in a custom hook, not in a store or `useState`. Copying it out forfeits background updates; Redux's own team concedes caching is "a different set of concerns."

**Never sync; derive.** Effects are for external side effects only. Transformations, adjusted selections and client-state-that-depends-on-server-state are computed, not stored-and-synced.

**State placement escalates, it doesn't start global:** local → lifted to nearest common owner → context (only after props and `children` extraction fail) → store, and a store only on Redux's documented signals. Context transports; it does not manage.

**Forms:** edits are local/form-library state, not store state; server state stays in the query, and display resolves edits over server values.

**Validation:** one Zod schema in a shared module, `z.infer` for types, `safeParse` at boundaries, *always* re-validated on the server.

**Abstraction is earned, not pre-paid.** Even the clean-architecture advocates set project-size gates and warn about onboarding cost, bundle size and design time.

### Contested for this section

1. **Does frontend domain logic deserve its own layered architecture?** Advocates (Bespoyasov, FSD blog, djblackett) vs pragmatists (Kondov, Dodds/AHA, the comment thread). The advocates largely concede the scoping, so the real disagreement is narrow: *default-on layering* vs *earn-it layering*.
2. **Are hooks a legitimate application layer, or a framework leak?** Critics: hooks can't be reused outside React or called from plain code. Bespoyasov: they're DI glue. djblackett's Import Smell Test resolves it most cleanly for an agent.
3. **Should fetching live in a client hook at all?** react.dev still says "consider extracting your fetching logic into a custom Hook"; TkDodo says query hooks per resource — but also "you probably don't need React Query" with RSC; Smith calls bespoke fetching hooks outdated. Client-interactive lists, offline and background refresh still argue for the query layer.
4. **One store or many?** Redux and Zustand's own docs say a single sliced store; TkDodo says many small stores for Zustand. Both agree actions are events and side effects wrap the setters.
5. **How much logic belongs in the store vs a neutral module?** Redux: "Put as Much Logic as Possible in Reducers" (justified by testability, defensible since the store is UI-agnostic). Clean-architecture camps put those rules in a framework-free module. Both end up testable without rendering; the difference is whether the store counts as "framework."
6. **Is context a state-management tool?** Erikson: no. react.dev lists "Managing state" as a context use case and documents reducer+context as a scaling path. Reconciliation: context is transport, the reducer is management.
7. **Copying server state into form state.** "Never duplicate" vs the pragmatic forms exception with named trade-offs vs the newer derive-both approach.
8. **Where do you test extracted logic?** Pure-function camp (no renderer) vs Testing Library's own "prefer `render`; `renderHook` is mostly for libraries publishing hooks." Synthesis: pure logic → plain unit tests; hook tests for lifecycle behaviour; integration-test the component.

### Outdated advice to avoid

| Avoid | What replaced it |
|---|---|
| `useEffect` + `fetch` as the standard data-loading pattern | Framework/server-side loading (RSC, route loaders) or a query cache; hand-rolled versions leak race conditions, loading/empty ambiguity, stale errors, StrictMode double-fetch. If you must, add an `ignore` cleanup flag |
| "Server data goes in Redux/Zustand slices" | TanStack Query / RTK Query; even Redux says caching is a different concern, and duplicating cache data opts you out of background updates |
| A store as the default state container for a new app | Local-first escalation; Redux's own FAQ quotes Abramov: "don't use Redux until you have problems with vanilla React" |
| Form state in the global store | Local/form-library state, dispatching once on completion, with server values staying in the query |
| Effect-based state synchronisation ("when props change, `setState`") | Derive in render / `useMemo`, `key`-based resets, compute next state in the handler, derive client state from server state on read |
| Custom lifecycle hooks (`useMount`, `useEffectOnce`, `useUpdateEffect`) and hook-ifying pure helpers (`useSorted`) | Plain functions, or a class for imperative external systems |
| Manual store subscriptions inside effects | `useSyncExternalStore` |
| Container/presentational as *the* logic boundary | Hooks plus a domain/use-case split |
| Component-level DB queries in Server Components as a normal pattern | Prototypes only; new projects use a server-only DAL returning DTOs with auth checks inside |
| Trusting a page-level auth check, or client-side validation, to protect mutations | Per-action re-authorization + ownership checks + server-side schema validation; Server Actions are reachable by direct POST |
| Pre-v4 React Query material (callback options, `refetchOnWindowFocus`-disabling advice) | Verify against TanStack v5; prefer `staleTime` tuning. Note *Practical React Query* is kept updated (2023-10-21) while *React Query as a State Manager* (2021) is not |
| Zod 3 idioms in copied snippets (`invalid_type_error`, `error.flatten()`) — **including inside the current Next.js forms guide** | Check zod.dev (now v4.6) for v4 equivalents |
| Pre-RSC "all state is client state" framing | Linsley's 2020 talk and Dodds' 2020 post are foundational but predate RSC, Server Actions, `useActionState` and `use()` — pair them with the 2023–2025 sources above |

**Do not cite:** `profy.dev/article/react-architecture-business-logic-and-dependency-injection` (DNS failure); the Medium "Clean Architecture for Frontend" post (HTTP 403); `web.archive.org` (blocked). `tkdodo.eu/blog/thinking-in-react-query` loads but is a slide deck with no quotable prose — use the other TkDodo posts.

## 4. Constants, utils, types, naming

### Constants, and `enum` vs union vs `as const`

**[TypeScript 5.8 release notes — `--erasableSyntaxOnly`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)** · Microsoft · **2025-02-28** · [announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/)
The primary source for the strongest current argument against `enum` — it is literally the syntax a type-stripping runtime cannot execute.
- Under `erasableSyntaxOnly`, these error: **`enum` declarations**, `namespace`/`module` with runtime code, class parameter properties, `import =`/`export =`.
- "it must be possible to easily erase or 'strip out' any TypeScript-specific syntax from a file, leaving behind a valid JavaScript file."
- Pair with `verbatimModuleSyntax`. Cite TS 5.8 / Feb 2025 as when anti-`enum` guidance got official tooling.

**[Node.js — Modules: TypeScript (type stripping)](https://nodejs.org/api/typescript.html)** · current (v24/v25 docs)
**The decisive fact: type stripping is no longer experimental or opt-in.**
- On by default since **v23.6.0 and v22.18.0**, stable since **v25.2.0 / v24.12.0**: "By default Node.js will execute TypeScript files that contains only erasable TypeScript syntax."
- "any TypeScript features that involve replacing TypeScript syntax with new JavaScript syntax will error. The most prominent features that require transformation are: `Enum` declarations, `namespace` with runtime code, parameter properties, import aliases."
- Node's **own recommended tsconfig** sets `"erasableSyntaxOnly": true, "verbatimModuleSyntax": true` — that decision settles the enum question mechanically.

**[TypeScript Handbook — Enums](https://www.typescriptlang.org/docs/handbook/enums.html)** · living doc
The official handbook now nudges away from `enum` itself.
- "In modern TypeScript, you may not need an enum when an object with `as const` could suffice."
- "The biggest argument in favour of this format over TypeScript's `enum` is that it keeps your codebase aligned with the state of JavaScript."
- The idiom: `type Direction = typeof ODirection[keyof typeof ODirection]` — one extra line is the whole cost.
- Ambient `const enum` is "fundamentally incompatible" with `isolatedModules`.

**[Why I Don't Like TypeScript Enums — Matt Pocock](https://www.totaltypescript.com/why-i-dont-like-typescript-enums)** · undated · and **[TypeScript 5.8 Ships `--erasableSyntaxOnly`](https://www.totaltypescript.com/erasable-syntax-only)** · ~Jan/Feb 2025
- Numeric enums accept raw numbers where the enum is expected. String enums are **nominally** typed — you can't pass a structurally identical enum or a matching string literal, at odds with TS's structural system.
- "if you're desperate to use enums, I'd strongly recommend using string enums only." Never expose an `enum` on an API/serialization boundary.
- On the flag: it "disables a bunch of features that I don't think should ever have been part of TypeScript."

**[typescript-eslint — `no-unsafe-enum-comparison`](https://typescript-eslint.io/rules/no-unsafe-enum-comparison/)** · current
- Tool-backed admission that holes remain: "While overt safety problems with enums were resolved in TypeScript 5.0, some logical pitfalls remain permitted. For example, it is allowed to compare enum values against non-enum values."
- It's in `recommended-type-checked`. If you keep enums, enable it and compare `x === Vegetable.Asparagus`, never `x === 'asparagus'`.

**[The Difference Between TypeScript Unions, Enums, and Objects — Cam McHenry](https://camchenry.com/blog/typescript-union-vs-enum-vs-object)** · 2022-04-30
The clearest **decision table**, and the fairest statement of where each form wins.
- Runtime availability: enums and const objects yes, unions no. Reverse mapping: **enums only**. Computed keys/values: **const objects only**. Mixed/non-primitive members and automatic dedup: **unions only**.
- "Use union types as a default"; "Avoid using `enum` if possible."

**[Why I do not use enums in TypeScript — Christian Rackerseder](https://www.echooff.dev/blog/why-i-do-not-use-enums-in-typescript)** · **2026-03-22** · most current source on this question
- "I do not want a special TypeScript runtime feature when plain JavaScript values plus a type can model the same domain more directly."
- The canonical replacement idiom, worth copying verbatim: `export const Status = { Pending: "pending", … } as const; export type Status = (typeof Status)[keyof typeof Status];` — same name for value and type.

**[ESLint — `no-magic-numbers`](https://eslint.org/docs/latest/rules/no-magic-numbers)** · current
The only widely-deployed *operational* definition of "this value deserves a name."
- "'Magic numbers' are numbers that occur multiple times in code without an explicit meaning. They should preferably be replaced by named constants."
- Escape hatches are first-class: `ignore`, `ignoreArrayIndexes`, `ignoreDefaultValues`, `enforceConst`, `detectObjects`, plus TS-specific `ignoreEnums`, `ignoreNumericLiteralTypes`, `ignoreTypeIndexes`.
- So: name a literal when it **repeats** or its meaning isn't obvious at the call site. Array indexes, `0`/`1` and default values don't need names.

**[Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html)** · living doc
The strictest still-maintained definition of `CONSTANT_CASE` — most codebases get this wrong.
- "Every constant is a `@const` static property or a module-local `const` declaration, but not all `@const` static properties and module-local `const`s are constants." The test is **deep immutability**: "Merely intending to never mutate the object is generally not enough."
- "File names must be all lowercase and may include underscores (`_`) or dashes (`-`), but no additional punctuation."

**[Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)** · living doc · **the notable dissenter on enums**
- "Code must not use `const enum`; use plain `enum` instead." (Plain enums are permitted.)
- "Do not use default exports. This ensures that all imports follow a uniform pattern."
- `CONSTANT_CASE` restricted to "symbols declared on the module level, static fields of module level classes, and values of module level enums."
- Interfaces (not type aliases) for object types; `UpperCamelCase` for types/enums/component functions.

### utils / helpers / lib

**[Bulletproof React — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)** · [Project Standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) · maintained
The de-facto reference — and it **does** keep a `utils/`, a useful counterweight to the anti-pattern camp.
- A real lib-vs-utils distinction: **`lib` = "preconfigured reusable libraries"**, `utils` = "shared utility functions", `config` = global config/env.
- `utils` and `types` exist at *both* the shared and feature scope, promoted only when shared.
- Naming is machine-enforced: `check-file/filename-naming-convention` → **kebab-case** for all `*.{ts,tsx}`; folders kebab-case except `__tests__`. Absolute imports via `@/*`.
- Encode file-naming in ESLint rather than prose, or it drifts.

**[Angular Style Guide v22](https://angular.dev/style-guide)** · current
The only *official framework* guide that names the dumping ground outright.
- "Avoid overly generic file names like `helpers.ts`, `utils.ts`, or `common.ts`."
- "Avoid creating subdirectories based on the type of code… avoid creating directories like `components`, `directives`, and `services`."
- Hyphen-separated files; siblings share the basename; unit tests colocated as `user-profile.spec.ts`. "Prefer focusing source files on a single concept."

**[Feature-Sliced Design — Slices and segments](https://feature-sliced.design/docs/reference/slices-segments)** · current
- Standard segments **`ui`, `api`, `model`, `lib`, `config`**; `lib` is "library code for other modules in the slice."
- The generalizable rule: "Make sure that the name of these segments describes the purpose of the content, not its essence. For example, `components`, `hooks`, and `types` are bad segment names because they aren't that helpful when you're looking for code."

**[The utility module antipattern — Yang Lin Zhao](https://www.yanglinzhao.com/posts/utils-antipattern/)** · 2020-05-19
The clearest statement of the root cause: the name carries no boundary.
- "util is just too loose of a name; it gives no guidance about what should or should not belong in it."
- "Names should be narrow. It needs to give us programmers a sense of its domain."
- Proposals: domain-named modules (`utils/array.ts`, `utils/validation.ts`); optionally a deliberately ugly `unstable_temporary_utils` quarantine with a lint-enforced size cap.

**[Dunghill Anti-Pattern: Why Utility Classes Are Bad Practice — Matti Lehtinen](https://mattilehtinen.com/articles/dunghill-anti-pattern-why-utility-classes-and-modules-smell/)** · 2023-09-05
- "I call directories or files that contain a large mix of random functions 'dunghills'."
- Alternatives in order: (a) move it to the feature it serves; (b) split into cohesive domain files; (c) a service/class when there is state, business logic or I/O. "You should put the code 'to where it really belongs'."

**[React Folder Structure Best Practices — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/)** · updated **2026-05-05**
- Stage-3 component folder: `index.js`, `component.js`, `test.js`, `style.css`, plus optional `hooks.ts`, `types.ts`, `utils.ts`, `constants.ts` — i.e. **colocated per-component `constants.ts`/`types.ts`** as the default.
- "If exactly one feature uses a utility, it lives inside that feature; once two or more features need it, it moves up to the shared layer."
- `lib/` = pre-configured third-party wrappers, distinct from `utils/` = your own helpers.

**[My React file/folder structure — 2025 changes — Codemzy](https://www.codemzy.com/blog/react-file-structure)** · 2025-10-02
A dated data point on the kebab-case migration actually happening.
- "Filenames are kebab-case (from PascalCase)" — explicitly a change from an earlier convention.
- Utils as **domain-named files** (`utils/auth.js`, `utils/teams.js`) rather than one `utils.js`. "Named exports > default exports."

**[Please Stop Using Barrel Files — TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files)** · **2024-07-26**
Measured numbers on what `index.ts` re-exports cost.
- A Next.js project went from "pages that were loading over 11k modules" taking 5–10s to start, down to "about 3.5k modules - a reduction of 68%" after removing internal barrels.
- Importing from your own directory's barrel creates a cycle: `tab-panel.ts → index.ts → tab-panel.ts`.
- Conclusion: barrels are for **published libraries** with a single entry point; skip them inside app code.

### Extraction heuristics and intra-file placement

**[Reusing Logic with Custom Hooks — react.dev](https://react.dev/learn/reusing-logic-with-custom-hooks)** · current
- Names start with `use` + capital letter; this "guarantees that you can always look at a component and know where its state, Effects, and other React features might 'hide'."
- The under-applied inverse: `useSorted(items)` that calls no hooks is 🔴 wrong — make it `getSorted(items)`, which can then be called conditionally.
- Extract for a **concrete high-level use case**; 🔴 never generic lifecycle wrappers. If you can't name it clearly, it isn't ready to extract.

**[Keeping Components Pure](https://react.dev/learn/keeping-components-pure)** · [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) · react.dev, current
- A computation that is pure and closes over nothing can be hoisted to module scope or a sibling module for free, with no behaviour risk.
- "When something can be calculated from the existing props or state, don't put it in state. Instead, calculate it during rendering." Expensive cases: `useMemo(() => getFilteredTodos(todos, filter), …)` — note the extracted callee is a **plain, testable, non-hook function**.

**[The anatomy of React component files — Andrei Pfeiffer](https://andreipfeiffer.dev/blog/2021/react-components-anatomy)** · 2021-09-21
The most concrete *intra-file* placement rules found — answers "where in the file," not just "which folder."
- "Any magic value, like a `string` or a `number`, is placed at the top of the file, below the import statements" — outside the component so it isn't recreated per render; complex structures move to their own file.
- Pure functions live **outside** the component function: it signals purity, allows direct import in tests, and makes later extraction trivial. Impure closures (event handlers) stay inside.
- Suggested order: imports → constants & types → component → variables → effects → return → render helpers → local functions → pure functions.

**[Tao of React — Alex Kondov](https://alexkondov.com/tao-of-react/)** · 2021-01-18 · pre-RSC, treat framework specifics with care
- "Group by route/module from the start. This is a structure that supports change and growth."
- "Helper functions that don't need to hold a closure over the components should be moved outside" — pass what they need as arguments.
- Repetitive markup → a configuration object + loop, with the config extracted as a constant outside the component.

### Types, and sharing them with the server

**[Where To Put Your Types in Application Code — Matt Pocock](https://www.totaltypescript.com/where-to-put-your-types-in-application-code)** · undated
The cleanest three-rule answer, mapping straight onto a skill rule.
- "When a type is used in only one place, put it in the same file where it's used."
- "Types that are used in more than one place should be moved to a shared location" — a `*.types.ts` at the narrowest enclosing scope.
- "Types that are used in more than one package in a monorepo should be moved to a shared package."
- Promote one level at a time; a global `types/` is the last resort, not the default.

**[Zod](https://zod.dev/)** · [Basics](https://zod.dev/basics) · Zod 4, current
- "TypeScript-first schema validation with static type inference"; `z.infer<typeof Schema>` replaces a hand-written duplicate type.
- **Honest caveat:** the Basics page demonstrates the mechanics but does **not** itself make a "single source of truth" doctrinal claim — that framing is community practice, not a Zod docs quote.

**[React + TypeScript Style Guide — mlane](https://github.com/mlane/react-typescript-style-guide)** · undated · lower authority (one practitioner), useful for its explicit promotion rule and its dissent
- "If a constant or utility is used in more than one feature, move it" to shared; otherwise keep it as `pages/profile/profileConstants.ts`.
- Dissent on tests: "Tests should remain close to the code they validate, typically in a `__tests__/` folder."

### Naming, test placement, and what real codebases do

**Airbnb React/JSX Style Guide** (https://javascript.airbnb.tech/react/ — `airbnb.io/javascript/react/` now 301s here) · ⚠️ **STALE**
Still the most-cited source for PascalCase component filenames, and effectively frozen — you need this to tell agents to stop citing it.
- Its rules: `.jsx` extension; "Use PascalCase for filenames. E.g., `ReservationCard.jsx`"; directory root components as `index.jsx`.
- **Staleness, verified via GitHub API:** the last commit touching `react/README.md` is **2021-02-17**; prior touches 2023-05-15 (URL updates) and 2020-09-23. The repo is *not* archived and got a 2026-02-21 commit — but to the JS readme, not the React guide.
- **npm, verified:** `eslint-config-airbnb@19.0.4` carries no deprecation flag; `eslint-config-airbnb-typescript@18.0.0`, registry-modified 2024-03-02. Not formally deprecated, but ~5 years without substantive update, and it predates hooks-era idioms, RSC and flat config.

**[Vue.js Style Guide — Strongly Recommended](https://vuejs.org/style-guide/rules-strongly-recommended.html)** · current
The most honest official statement that the casing war has no winner.
- "Filenames of Single-File Components should either be always PascalCase or always kebab-case."
- "PascalCase works best with autocompletion in code editors… However, mixed case filenames can sometimes create issues on case-insensitive file systems, which is why kebab-case is also perfectly acceptable."

**[Jest — Configuration (`testMatch`)](https://jestjs.io/docs/configuration)** · current · and **[Vitest — `include`](https://vitest.dev/config/include)** · current
- Jest's default blesses **both** placements: `["**/__tests__/**/*.?([mc])[jt]s?(x)", "**/?(*.)+(spec|test).?([mc])[jt]s?(x)"]`.
- Vitest dropped `__tests__` from its default entirely: `['**/*.{test,spec}.?(c|m)[jt]s?(x)']` — evidence the ecosystem is converging on suffix-based colocation, and colocated tests are the zero-config path.

**Popular-codebase file naming — verified via GitHub API** (evidence, not a doc)
- `shadcn-ui/ui` → `accordion.tsx`, `alert-dialog.tsx`, `button.tsx`, `button-group.tsx` — **all kebab-case**.
- `mui/material-ui` → `Accordion/`, `Alert/`, `Box/` — **PascalCase folders**, with `Button/Button.js`, `Button/Button.test.js`, `Button/buttonClasses.ts`, `Button/index.js` — PascalCase component files, camelCase non-component files, colocated tests, per-directory barrel.
- `reactjs/react.dev` → `Breadcrumbs.tsx`, `Button.tsx`, `DocsFooter.tsx` — **PascalCase**. React's own site does not use kebab-case.
- The defensible statement: kebab-case files + PascalCase exports is the newer trend (shadcn, Bulletproof React, Angular); PascalCase files remain standard in component libraries (MUI) and on react.dev.

### Duplication, abstraction, dead code

**[AHA Programming — Kent C. Dodds](https://kentcdodds.com/blog/aha-programming)** · 2020-06-22
- **A**void **H**asty **A**bstractions. Quotes Metz: "prefer duplication over the wrong abstraction"; and Conlin Durbin's rule of three: "You can ask yourself 'Haven't I written this before?' two times, but never three."

**[The Wrong Abstraction — Sandi Metz](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)** · 2016-01-20 · foundational, universally cited
Explains the *mechanism* of decay, which is what makes the rule actionable.
- The decay loop: abstraction → new requirement doesn't fit → add a parameter/conditional → repeat → incomprehensible code, sustained by sunk-cost reasoning.
- The fix: **inline the abstraction back into every caller**, delete what's unused, re-abstract from the real requirements.
- So: when a util has grown boolean/mode parameters selecting per-caller behaviour, inline and re-derive — don't add another flag.

**[Rule of three — Wikipedia](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming))** · current
Verifies provenance (Fowler's *Refactoring*, attributed to Don Roberts) and states the caveats.
- "two instances of similar code do not require refactoring, but when similar code is used three times, it should be extracted into a new procedure."
- Caveat: early refactoring "risks selecting a wrong abstraction"; the rule assumes maintenance cost exceeds refactoring cost at three copies.

**[AHA Testing — Kent C. Dodds](https://kentcdodds.com/blog/aha-testing)** · 2019-04-07
- Both extremes named: copy-paste tests, and over-DRY tests where someone "adds another `if` statement to the testing utility for their case."
- The litmus test: "How easy is it to determine the difference between assertions of two similar tests."
- Threshold: "I would consider this pre-mature abstraction if you've only got two or three tests in the file."

**[Knip](https://knip.dev/)** · current
The enforcement arm of the delete-dead-code rule; successor to `ts-prune`.
- Finds unused **files, exports, dependencies and types**. One testimonial notes AI-assisted coding "started to produce left-overs in our codes faster than we ever could."
- Barrel files hide unused exports from tooling — removing barrels makes Knip's output trustworthy.

### Consensus for this section

**Constants.** Colocation is the default: a magic value at the top of the file that uses it, below the imports; a per-component/per-feature `constants.ts` once several files in that feature share it; a global `config/` only for genuinely app-wide values, chiefly env. Promotion is one level at a time and demand-driven. A literal earns a name when it **repeats** or isn't legible at the call site. `CONSTANT_CASE` means **deeply immutable module-level** — a `const` holding a mutable object stays camelCase. A single top-level `constants.ts` is the same anti-pattern as `utils.ts`.

**enum vs union vs `as const`.** Default to a string-literal union; use an `as const` object when you need the values at runtime; avoid `enum` in new code (Google dissents). The 2025–26 argument is mechanical, not aesthetic: Node strips types by default since 22.18/23.6 and **errors on enums**, and Node's own recommended tsconfig sets `erasableSyntaxOnly: true`. Standard idiom: `const X = {…} as const` + `type X = (typeof X)[keyof typeof X]`, value and type sharing one name. `const enum` is out everywhere. If enums stay: string enums only, plus `no-unsafe-enum-comparison`.

**utils / helpers / lib.** `utils/` as an undifferentiated bucket is condemned because the *name carries no boundary*; Angular bans the filenames outright. Replacements in priority order: (1) push the function into the feature that owns it; (2) split into **domain-named modules**; (3) promote to shared only on the second consumer. One distinction recurs in real codebases: **`lib` = configured third-party integrations**, **`utils` = your own small pure functions**. **`helpers` has no stable meaning anywhere — drop the word.** Cross-feature imports should be a build error, not a convention.

**Extracting a function out of a component** — the signals that justify it:
1. It's **pure** — same inputs, same output, no mutation. Pure means free to hoist.
2. It needs **no closure** over props/state; pass arguments explicitly.
3. It's **derived data, not state** — calculate during render; the `useMemo` callee is naturally a plain function.
4. You want to **unit-test it** without rendering.
5. A **second real consumer** exists.
6. It **calls no hooks → it is not a hook**: name it `getSorted`, not `useSorted`.

Placement ladder: module scope in the same file → sibling domain-named module in the feature → shared layer. Never straight to a global `utils.ts`.

**Types.** Colocate by default, promote on demand: one consumer → same file; several → `*.types.ts` at the narrowest enclosing scope; several packages → shared package. A global `types/` holds only framework plumbing. Props types live in the component file. Client/server sharing is **schema-first**: one Zod schema, type via `z.infer`, so validation and type can't drift.

**Naming and files.** Consistency enforced by lint matters more than which convention. Newer trend: **kebab-case filenames + PascalCase exports**; PascalCase files remain standard in component libraries and on react.dev. Non-component files are camelCase or kebab-case, never PascalCase. Named exports over default. **Barrels are out for app code**, in only for published library entry points — the honest rule is at most one barrel at a feature's public edge, never inside it, never imported from siblings in the same directory. Tests: colocated `Component.test.tsx` is the mainstream default and Vitest's zero-config path. One concept per file.

**Hooks.** `useXxx`, capital after `use`, and only if it calls at least one hook. One hook per file. Feature hooks in the feature, shared hooks promoted on second consumer. Never `useMount`-style wrappers.

**Duplication and dead code.** Rule of three is a *floor*, not a trigger — two copies are fine, consider extracting at the third, and even then only when the shape is clear. The decay signal is an abstraction accumulating per-caller flags; the fix is to inline and re-derive. Tests get less DRY than source. Colocation makes dead code obvious; run Knip in CI, with barrels removed so it can see unused exports.

### Contested for this section

1. **Should `enum` be avoided?** Avoid: TS handbook, Pocock, McHenry, Rackerseder, and decisively the Node/`erasableSyntaxOnly` reality. Allowed: **Google's TS guide** permits plain enums and bans only `const enum`. Enums genuinely win on numeric reverse mapping. Resolution: the trade-off used to be taste; since Node 22.18/23.6 it's compatibility. With `erasableSyntaxOnly` on (or possible), enums are simply unavailable.
2. **kebab-case vs PascalCase filenames** — genuinely unresolved. kebab: Bulletproof React (lint-enforced), Angular, Wieruch, Codemzy, shadcn. Pascal: Airbnb (stale), MUI, react.dev's own site. Vue's official guide calls both "perfectly acceptable" given consistency. Pick one, enforce with `eslint-plugin-check-file`.
3. **Is `utils/` an anti-pattern?** Yes: Angular, the dunghill/utility-module critiques, FSD. No, if scoped: Bulletproof React keeps `utils/` at both levels, as do Wieruch and Codemzy. **Resolution: the fight is about granularity, not the word.** A single catch-all is indefensible; a directory of small domain-named modules with a promotion rule is what practical guides ship.
4. **Barrels — never, or at boundaries?** Never in app code: TkDodo's measured 68% reduction, Bulletproof React, Vercel's workaround. Yes as a public API: Wieruch, MUI, mlane. Rules satisfying both: never import from your own directory's barrel; at most one at a feature's outer edge; never a `src/components/index.ts` re-exporting everything.
5. **Colocated `*.test.tsx` vs `__tests__/`.** Colocated: Angular, Wieruch, Kondov, MUI, Vitest's default. `__tests__/`: mlane explicitly; Jest's default supports it and Bulletproof React exempts `__tests__` from its kebab-case rule, implying it uses them.
6. **`type` vs `interface`** — Google mandates `interface` for object types; mlane uses `interface` for props and `type` elsewhere. Treat as a per-project lint choice, not a correctness issue.
7. **Rule of three: threshold or floor?** Present AHA as the refinement — three copies *permit* extraction, they don't require it.

### Outdated advice to avoid

| Avoid | What replaced it |
|---|---|
| "Use `enum` for a fixed set of values" | String-literal union by default; `as const` object + `(typeof X)[keyof typeof X]` when runtime values are needed. Node **errors** on enums under default type stripping |
| "`const enum` is the fast/zero-cost enum" | `as const` object. Banned by Google; ambient `const enum` is "fundamentally incompatible" with `isolatedModules`; forbidden under `erasableSyntaxOnly` |
| "Follow the Airbnb React/JSX style guide" | ⚠️ Last substantive commit to its React guide: **2021-02-17**. Use react.dev for React rules, Bulletproof React for structure, Google TS or Angular for naming, typescript-eslint for lint |
| "Use the `.jsx` extension"; "name a directory's root component `index.jsx`" | `.tsx`; explicit filenames (`footer.tsx`) and direct imports — `index.jsx` per directory is at odds with anti-barrel guidance and fills editor tabs with `index` |
| "Re-export everything through `index.ts` barrels for clean imports" | Direct file imports; at most one barrel at a feature's public edge; `@/*` path alias for ergonomics. Measured harm: 11k → 3.5k modules, 5–10s dev startup; cycles; hides unused exports from dead-code tools |
| "Put all shared code in `utils/`" | Feature-local placement first; then domain-named modules; then a shared layer on second consumer |
| "Group folders by file type — `components/`, `hooks/`, `types/`, `utils/`" | Feature/domain folders with purpose-named segments; type-named folders only in the small shared layer |
| "Types belong in a global `types/` folder (or a big `.d.ts`)" | Same file → feature `*.types.ts` → shared package; global `types/` for framework plumbing only |
| "Maintain a TS interface alongside your validation schema" | One Zod schema; derive with `z.infer`; export value and type under one name |
| "Write a `useMount`/`useEffectOnce`/`useUpdateEffect` helper hook" | Purpose-named hooks for concrete use cases — react.dev marks these 🔴 explicitly |
| "Prefix any shared helper with `use` because it lives in `hooks/`" | `getSorted`, `formatCost` — plain functions in a domain module. A function calling no hooks must not be `useXxx` |
| "Sync derived values into state with an Effect" | Calculate during render; `useMemo` + an extracted pure function when expensive |
| "DRY: extract on the second occurrence" | Rule of three as a floor + AHA: abstract when the duplication is the obstacle and the shape is clear |
| "Keep adding a parameter/flag so the existing util covers the new case" | Inline the abstraction back into callers, delete the unused, re-abstract |
| "Tests should be as DRY as source code" | AHA testing: minimal nesting, test object factories, local `renderFoo`; don't abstract with only 2–3 tests in a file |
| "`const` means the name gets `CONSTANT_CASE`" | `CONSTANT_CASE` for deeply immutable module-level values only; camelCase otherwise |
| "Next.js prescribes a project structure" | It is "unopinionated"; `components`/`lib` in its examples are "generalized placeholders." Pick a strategy, use `_folder` to opt out of routing, be consistent |
| "`ts-prune` for dead code" | Knip in CI, with barrels removed so it can see unused exports |

**Date hygiene:** the Pfeiffer (2021), Kondov (2021), McHenry (2022), Zhao (2020) and Metz (2016) sources predate current React/TS releases. Their *principles* are corroborated by the official docs cited above, but don't quote their framework-specific details as current.

**Do not cite:** `mykeels.medium.com/utils-are-a-blackhole` (HTTP 403); `airbnb.io/javascript/react/` (301 → `javascript.airbnb.tech`).

---

## 5. Next.js App Router architecture

> **Version warning, read first.** The official docs fetched for this section are **16.3.5**.
> This repo runs **Next 15.5.19** (`client/package.json`: `next: ^15.1.3`). Several rules below
> are v16-only — `proxy.ts`, mandatory `default.js`, `retry()`, generated `PageProps<'/route'>`
> types, `cacheComponents` — and must **not** be applied to a 15.x codebase. Each is tagged
> **[v16]**. Async `params`/`searchParams`/`cookies()` already apply in 15.
>
> Because this repo is on 15.x, the section ends with a table of **what applies here and what
> does not** — several canonical Next rules are inapplicable by design, not by neglect.

### 5.1 File and folder architecture

**[Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure)** · Vercel · v16.3.5, updated **2026-07-21**
The canonical page — and it refuses to mandate a layout.
- "Next.js is **unopinionated** about how you organize and colocate your project files."
- A route is not public until `page` or `route` exists, so "project files can be **safely colocated** inside route segments." Colocation needs no opt-in; `_folder` is a convenience.
- Render hierarchy, outermost → innermost: `layout` → `template` → `error` → `loading` → `not-found` → `page`.
- Three sanctioned strategies: files outside `app`, top-level folders inside `app`, or split by feature/route. Pick one, stay consistent.

**[Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)** · v16.3.5, updated 2025-06-16
- Three architectural jobs only: organize by team/concern/feature, define multiple root layouts, opt a subset of siblings into a shared layout. **Never for URLs.**
- Two groups resolving to one path is an **error**: "`(marketing)/about/page.js` and `(shop)/about/page.js` would both resolve to `/about` and cause an error."
- Navigating between *different root layouts* forces a full page reload — this "**only** applies to multiple root layouts." Distinguish "route group" from "route group with its own root layout" before quoting the cost.

**[`layout.js`](https://nextjs.org/docs/app/api-reference/file-conventions/layout)** · v16.3.5, updated 2026-05-27
The constraint list is what pushes code out of layouts.
- Never read `searchParams` or `pathname` in a layout — layouts "do not rerender," so the values go stale. Push to a page prop or a Client Component.
- "Layouts cannot pass data to their `children`." Refetch in both and rely on `fetch` dedup or React `cache`.
- Any layout with no layout above it is a root layout and must render `<html>`/`<body>`.

**[`template.js`](https://nextjs.org/docs/app/api-reference/file-conventions/template)** · v16.3.5, updated 2026-03-05
- Use it *only* to force a remount per navigation (resync `useEffect`, reset child client state, re-show a Suspense fallback). It renders between layout and children and "does **not** wrap the `layout.js` in the same segment."

**[Error Handling](https://nextjs.org/docs/app/getting-started/error-handling)** · updated 2026-06-10 · **[`error.js`](https://nextjs.org/docs/app/api-reference/file-conventions/error)** · updated 2026-07-10
- Put `error.tsx` at the level that can still render something useful; "Errors will bubble up to the nearest parent error boundary."
- The documented gap that dictates placement: `error.js` "does **not** wrap the `layout.js` or `template.js` above it in the same segment. To handle errors in the root layout, use `global-error.js`."
- `global-error.tsx` replaces the root layout, so it needs its own `<html>`/`<body>`, styles and fonts, and cannot use `metadata`.
- **[v16]** Prefer `retry()` over `reset()` (stable 16.3.0). On 15.x it is `reset()`.

**[`loading.js`](https://nextjs.org/docs/app/api-reference/file-conventions/loading)** · v16.3.5, updated 2026-06-08
The one caching/streaming rule that genuinely forces code placement.
- `loading.js` "does **not** wrap the `layout.js`, `template.js`, or `error.js` in the same segment."
- Therefore: uncached runtime data access in a layout (`cookies()`, `headers()`, uncached `fetch`) must move into `page.js` or get its own `<Suspense>` — otherwise navigation blocks.
- Scope a spinner to one page by wrapping that page in a route group with its own `loading.tsx`.

**[`not-found.js`](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)** · updated 2026-07-10
- Segment-level `not-found.js` catches `notFound()`; root `app/not-found.js` additionally catches all unmatched URLs.
- Experimental `global-not-found.js` (15.4.0, `experimental.globalNotFound`) exists for exactly two cases: multiple root layouts, or a root layout under a top-level dynamic segment.

**[Parallel Routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes)** · updated 2026-08-25 · **[Intercepting Routes](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes)** · updated 2025-06-16 · **[`default.js`](https://nextjs.org/docs/app/api-reference/file-conventions/default)** · updated 2025-10-09
- Two named architectures only: slot-based dashboards/feeds, and modals with shareable URLs surviving refresh and back/forward.
- **Never use a conditional slot as authorization:** "Both slots render on the server, regardless of which one the layout returns… `@admin/page.js` executes its data fetches for every user."
- Prerender coupling: "if one slot is dynamic, all slots at that level must be dynamic."
- `(..)` counts **route segments, not filesystem folders**, and ignores `@slot` folders — the top source of wrong nesting.
- A modal costs ~4 files: `@slot/default.tsx`, the intercepted `(.)route/page.tsx`, the real `/route/page.tsx`, usually `@slot/[...catchAll]/page.tsx`.
- **[v16]** `default.js` is now required for **every** slot including implicit `children`; builds fail without it. Optional on 15.x.

**[`page.js`](https://nextjs.org/docs/app/api-reference/file-conventions/page)** · updated 2026-06-09 · **[Dynamic Segments](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes)** · **[`generateStaticParams`](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)** · updated 2026-08-25
- "A `page` is always the **leaf** of the route subtree" and is what makes a segment publicly accessible. `searchParams` exists on pages only.
- `generateStaticParams` can only look **upward**: "You can generate params for dynamic segments above the current layout or page, but **not below**."
- Use `[[...slug]]` when the parameterless path must match too.
- **[v16]** Generated global helpers `PageProps<'/route'>`, `LayoutProps<'/route'>`, `RouteContext<'/route'>` (via typegen). Not available on 15.x — type params by hand.

**[Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)** · updated 2026-06-25 · **[`route.js`](https://nextjs.org/docs/app/api-reference/file-conventions/route)** · updated 2026-04-30
The clearest official statement on whether you need `route.ts` at all.
- **Don't build an internal API tier for your own Server Components:** "Fetch data in Server Components directly from its source, not via Route Handlers." Prerendering fails at build (no server listening) and costs a round trip at runtime.
- Add Route Handlers for genuinely public HTTP surface: webhooks, OAuth callbacks, non-HTML content types, CORS, proxying, mobile/3rd-party clients.
- "Server Actions are queued. Using them for data fetching introduces sequential execution."
- Folder names are the URL, literal filenames included: `app/rss.xml/route.ts` → `/rss.xml`.

**[`src` folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder)** · updated 2025-10-17 · **[Instrumentation](https://nextjs.org/docs/app/guides/instrumentation)** · **[Multi-Zones](https://nextjs.org/docs/app/guides/multi-zones)** · updated 2026-06-01
- Stay at the true root regardless of `src`: `public/`, `package.json`, `next.config.js`, `tsconfig.json`, `.env.*`.
- Silent footgun: "`src/app` or `src/pages` will be ignored if `app` or `pages` are present in the root directory."
- `instrumentation.ts` goes at the root or in `src` beside `app` — "not inside the `app` or `pages` directory."
- Multi-zones only for "collections of pages unrelated to the other pages"; cross-zone navigation is a hard navigation, linked with a plain `<a>`, not `<Link>`. Every non-default zone needs `assetPrefix`.

**[`proxy.js`](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)** · updated 2026-09-07 · **[v16 blog](https://nextjs.org/blog/next-16)** (Lai, Story, Markbåge, Neutkens, 2025-10-21) · **[Upgrade to v16](https://nextjs.org/docs/app/guides/upgrading/version-16)**
- **[v16]** `proxy.ts` replaces `middleware.ts`, Node runtime only, one per project, at the root or in `src`. Codemod: `npx @next/codemod@canary middleware-to-proxy .`
- **Keep `middleware.ts` if you need the Edge runtime** — "The `edge` runtime is **NOT** supported in `proxy`." On 15.x, `middleware.ts` *is* the current convention.
- Always set a `matcher`, or it runs on `_next/static`, `_next/image` and `public/`.

**Reference architectures** — [Bulletproof React docs](https://raw.githubusercontent.com/alan2207/bulletproof-react/master/docs/project-structure.md) and its [actual Next app](https://github.com/alan2207/bulletproof-react/tree/master/apps/nextjs-app/src) · [FSD Next.js guide](https://feature-sliced.design/docs/guides/tech/with-nextjs) · "The Ultimate Next.js App Router Architecture" at `feature-sliced.design/blog/nextjs-app-router-guide` (⚠️ **provenance unverifiable — not official FSD guidance**; see [Do not cite (section 5)](#do-not-cite-section-5)) · [create-t3-app](https://create.t3.gg/en/folder-structure-app) · [next-colocation-template](https://github.com/arhamkhnz/next-colocation-template) (74★ — an illustration of a camp, not an authority; its tree still shows pre-v16 `middleware.ts`)
- The routing-shell position, as that unverified post puts it: "Use Next.js `app/` for routing only. Use `src/` for the product architecture (FSD layers)." Attribute it to an anonymous post, not to FSD.
- FSD renames its colliding layers to `_app`/`_pages` and re-exports from `app/`.
- **Complicating evidence:** Bulletproof React's *actual* Next app is a hybrid, not a pure shell — `src/app/` holds `provider.tsx` alongside route files, and `app/` sits **inside** `src` as a sibling of `features/`.
- ⚠️ The FSD guide claims middleware/instrumentation "must remain in the project root, not within the `src` folder" — this **contradicts** the official docs, which require them inside `src` when `src` is used. **The official docs win.**
- [Turborepo — Structuring a repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository): `apps/` + `packages/`, no nested packages, namespaced internal packages, and "If you ever find yourself writing `../` to get from one package to another, you likely have an opportunity to re-think your approach."

### 5.2 The server/client boundary, and server-side layering

**[The Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary)** · v16.3.5, updated **2026-08-25**
The best official statement of the boundary *as an architectural seam*.
- The two-rule model, verbatim: "**Code** crosses through imports. Whatever a Client Component imports is pulled into the client bundle." / "**Data** crosses through props, and it must be serializable, so functions like event handlers cannot cross."
- Owner vs parent: "Because `Cart`'s owner is a Server Component, `Cart` renders on the server. `Modal` is only the parent, so `Modal` receives `Cart`'s output to place but not its code to run."
- Compound components break across the seam: "`Menu.Item` is `undefined`, and React throws 'Element type is invalid.'… expose them as named exports instead of static properties."
- Name function props `action` or `*Action` — the TypeScript plugin flags other function props.
- Wrap, don't convert: "create a Client Component wrapper that imports it and place the directive on the wrapper."

**[Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)** · updated 2026-08-25 · **[`'use client'`](https://react.dev/reference/rsc/use-client)** · **[`'use server'`](https://react.dev/reference/rsc/use-server)** · **[Server Components](https://react.dev/reference/rsc/server-components)** · react.dev, current
- "`'use client'` defines the boundary between server and client code on the *module dependency tree*, not the render tree."
- Identity is by **usage**, not definition: a component imported and called in a Client Component *is* a Client Component.
- Serializable across the seam: primitives, Date, plain objects, Map/Set/TypedArray, **JSX elements**, **Promises**, **Server Functions**. Not: non-`'use server'` functions, classes, class instances, null-prototype objects, ungrouped symbols.
- "Server Components cannot create context, but they can render a context provider imported from a Client Component module."
- Render providers as deep as possible — "`ThemeProvider` only wraps `{children}` instead of the entire `<html>` document."
- `import 'server-only'` turns accidental client imports into build errors; installing the npm package is optional, Next handles it internally.

**[Data security in Next.js](https://nextjs.org/docs/app/guides/data-security)** · v16.3.5, updated **2026-08-25**
The current canonical home of the three-models taxonomy — it supersedes the 2023 blog post.
- "We recommend choosing one data fetching approach and avoiding mixing them." HTTP APIs → existing large orgs; **DAL → new projects**; component-level queries → prototypes only.
- The DAL's three rules: "Only run on the server. Perform authorization checks. Return safe, minimal Data Transfer Objects (DTOs)."
- "only the Data Access Layer should access `process.env`."
- Actions stay thin: "This keeps authentication, authorization, and database logic in a dedicated `server-only` module, while `"use server"` actions stay thin."

**[Authentication](https://nextjs.org/docs/app/guides/authentication)** · v16.3.5, updated 2026-08-25
The authoritative ranking of where auth checks belong.
- Proxy/middleware is optimistic only: "it should not be your only line of defense… The majority of security checks should be performed as close as possible to your data source."
- **Never gate a route in a layout**, for two documented reasons: layouts "don't re-render on navigation," and "A layout also does not control whether the rest of the route renders… a layout that hides or swaps them does not stop them from running or from appearing in the RSC Payload." The `return null` habit is called "**not recommended**."
- Put the check inside the data function: "This guarantees that wherever `getUser()` is called within your application, the auth check is performed, and prevents developers from forgetting."
- Memoize the session with React `cache()`; `import 'server-only'` at the top of the DAL. Client Components "can't import the DAL."

**[Server Actions and Mutations](https://nextjs.org/docs/app/guides/server-actions)** · updated 2026-06-17 · **[Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data)** · **[Forms](https://nextjs.org/docs/app/guides/forms)** · updated 2026-08-25
- **Every action is a public POST endpoint:** "A Server Action runs as a POST request against the page that invokes it… the route is reachable to anyone who can send the same POST. Treat every action as an untrusted entry point."
- "Render-time gating (only rendering a form on an authenticated page) is not a security boundary."
- **Schema validation is not authorization:** "Send a reference (typically an ID) plus the user's change, and re-read the rest from a trusted source using the session. Schema validation (zod or similar) only checks the *shape* of the input. A well-formed `Item` object can still refer to a row the caller does not own."
- Actions are serialized per client — "do not rely on `Promise.all` to parallelize Server Actions from the client."
- Official file placement examples: `app/lib/actions.ts` / `app/actions.ts`. Server Functions cannot be defined in Client Components; import them from a file with the directive.
- Flow: mutate → `revalidatePath`/`updateTag`/`refresh` → optional `redirect` (which throws, so revalidate first).

**[Building interactive apps](https://nextjs.org/docs/app/guides/interactive-apps)** · updated 2026-08-25
The only official page that ships a **feature-folder** layout for actions and queries.
- "The app is organized by feature. Everything for the task domain (queries, Server Functions, and components) lives under `features/task/`. Shared UI primitives live in `components/ui/`, and pages in `app/` compose feature components." Files: `features/task/task-queries.ts`, `task-actions.ts`.
- Ownership split: `<Suspense>` streaming · `useOptimistic` for a value during async work · `useTransition` for pending/error · `useActionState` for pending/reset/result.
- Actions return a discriminated result for *expected* failures; unexpected throws go to the nearest error boundary.

**Request-scoped APIs push reads downward** — [`cookies`](https://nextjs.org/docs/app/api-reference/functions/cookies) · [`page.js`](https://nextjs.org/docs/app/api-reference/file-conventions/page) · [Streaming](https://nextjs.org/docs/app/guides/streaming) · [Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data) · [`cache`](https://react.dev/reference/react/cache)
- The placement rule: "If you `await` any of these at the top of a layout or page, everything below that point becomes dynamic and cannot be prerendered… Instead, pass the promise down and let the consuming component resolve it inside a `<Suspense>` boundary."
- Cookie **reads** work anywhere on the server; **writes** don't: "HTTP does not allow setting cookies after streaming starts, so you must use `.set` in a Server Function or Route Handler." That's the architectural reason mutations can't live in render.
- Wrap non-`fetch` data functions in `React.cache` so components share one result per request. The trap: "Calling a memoized function outside of a component will not use the cache."

**Core-author essays** — [How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) (**Sebastian Markbåge, 2023-10-23** — architecture unchanged, *syntax* stale: sync `cookies()`, "Next.js 14") · [What Does `'use client'` Do?](https://overreacted.io/what-does-use-client-do/) (Dan Abramov, 2025-04-25) · [Impossible Components](https://overreacted.io/impossible-components/) · [The Two Reacts](https://overreacted.io/the-two-reacts/)
- Markbåge: "a Server Component function body should only see data that the current user issuing the request is authorized to have access to"; DTOs create "a layering where security audits can focus primarily on the Data Access Layer while the UI can rapidly iterate"; "always re-read access control and `cookies()` whenever reading data. Don't pass it as props or params."
- ⚠️ `.bind()` args are **not** encrypted, unlike closure variables — don't rely on encryption to hide secrets.
- Abramov: the directives "let you *open the door* from one environment to the other"; the architecture is "a *single program spanning two environments*."
- The inversion that justifies the client-shell pattern: "The backend is the source of truth for the data—so it must be the frontend's parent."

**[Postmortem on Next.js Middleware bypass](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass)** · Vercel, 2025-03-25 · CVE-2025-29927, patched 12.3.5 / 13.5.9 / 14.2.25 / **15.2.3**
- Empirical backing for "middleware is not authoritative": "We do not recommend Middleware to be the sole method of protecting routes in your application."

**[Authentication with Cache Components](https://nextjs.org/docs/app/guides/authentication-with-cache-components)** · **[v16]** · updated 2026-08-25
The clearest case where caching *forces* a layering decision.
- A plain `use cache` function can't read `cookies()`, so the DAL splits: an exported getter that resolves the user, plus an **unexported** cached function keyed by id. "Keep `getNotesByUserId` unexported so a caller can't request another user's notes by passing a different id."
- Cache keys and tags are plaintext — key on a stable id, keep secrets out of arguments and tags.

**Practitioner & alternative layers** — [Component Composition Patterns](https://vercel.com/academy/nextjs-foundations/component-composition-patterns) (Vercel Academy, updated 2026-08-21: "Keep state in a tiny client wrapper"; names the "prop soup" anti-pattern) · [community discussion #184740](https://github.com/orgs/community/discussions/184740) (2026-01-20 — colocation consensus: "a global `/actions` folder is unnecessary and usually harms separation of concerns") · [vercel/next.js#74585](https://github.com/vercel/next.js/issues/74585) (verified compound-component breakage) · [nextjs-clean-architecture](https://github.com/nikolovlazar/nextjs-clean-architecture/blob/main/README.md) (Lazar Nikolov — five layers, actions and route handlers as interchangeable *drivers*; asked whether you should do this, the README answers "**No**. Not if you don't expect the project to grow") · [Centralizing Authorization with a Service Layer](https://sph.sh/en/posts/scalable-permission-systems-102-service-layer-centralization/) (2026-03-15, **no stated author** — "there is no chokepoint through which all data access must pass") · [next-safe-action](https://next-safe-action.dev/docs/getting-started) · [tRPC Server Actions](https://trpc.io/docs/client/nextjs/server-actions) (still `experimental_`) and [tRPC + RSC](https://trpc.io/docs/client/react/server-components) (conceding "RSC on its own solves a lot of the same problems tRPC was designed to solve, so you may not need tRPC at all")

**Naming history worth knowing** — [React v19](https://react.dev/blog/2024/12/05/react-19) (2024-12-05) and [Server Functions](https://react.dev/reference/rsc/server-functions)
- "There is no directive for Server Components. A common misunderstanding is that Server Components are denoted by `"use server"`" — that directive marks Server *Functions*.
- "Until September 2024, we referred to all Server Functions as 'Server Actions'." A Server Action is a Server Function used in an action context.
- `useFormState` → `useActionState` (from `react`), returning `[state, action, pending]`.

### 5.3 Applied architectures, enforcement, failure modes

**Reference repos — verified paths, versions and push dates** (no reference architecture found is on Next 16)

| Repo | State | What it actually does |
|---|---|---|
| [bulletproof-react](https://github.com/alan2207/bulletproof-react) | 35.9k★, pushed 2026-05-14, **`next: ^14.2.5`, React 18, ESLint 8** | `apps/nextjs-app/src/` = `app components config features hooks lib styles testing types utils`. `features/discussions/` has `api/` + `components/` and **no `index.ts`**. Route shell: `src/app/app/discussions/{page.tsx,_components/,__tests__/}` |
| [create-t3-app](https://github.com/t3-oss/create-t3-app) | 29.1k★, pushed 2025-12-13, template on `next: ^15.5.9` | Axis is **environment**, not feature: `src/app` (routes + `_components`) · `src/server/{api,auth,db}` · `src/trpc/{react.tsx,server.ts}` — two callers for one typed procedure layer |
| [vercel/commerce](https://github.com/vercel/commerce) | pushed 2026-08-13, `next: 15.6.0-canary.60` | `app/` routes only; `components/` domain-grouped but globally shared; `lib/shopify` is the data layer. **No `features/`, no barrels, no import firewall at all** |
| [next-learn dashboard](https://github.com/vercel/next-learn/tree/main/dashboard/final-example) | Vercel's own tutorial, pushed 2026-07-29 | Everything inside `app/`: `app/lib/{data,actions,definitions}.ts`, `app/ui/`. `data.ts` opens a Postgres client at module scope and **has no `import 'server-only'`** |
| [vercel/platforms](https://github.com/vercel/platforms) | pushed 2026-07-08 | `app/actions.ts` and `subdomain-form.tsx` sit in the route root — the honest floor for a small app |

**[FSD "Usage with Next.js"](https://feature-sliced.design/docs/guides/tech/with-nextjs)** · verified against repo source `src/content/docs/docs/guides/tech/with-nextjs.mdx` (repo pushed 2026-09-14)
- The core instruction, verbatim: "To avoid conflicts, rename **both** `app` and `pages` FSD layers to `_app` and `_pages`, regardless of which router you use."
- Route files become one-line re-exports: `export { ExamplePage as default, metadata } from '@/_pages/example';` Route handlers likewise: `export { getExampleData as GET } from '@/_app/api-routes';`
- The RSC-specific fix worth knowing: "If a server-only module is exported from `index.ts`, server-only side effects can propagate into the client module graph when a Client Component imports that slice" → add **`index.server.ts`** as a second public API.
- ⚠️ The widely-seen `views/` rename is a **community variant, not** what the official guide says.

**[FSD Public API reference](https://feature-sliced.design/docs/reference/public-api)** — the re-export pattern's costs, from its own proponents
- Wildcard re-exports "hurt the discoverability of a slice"; index files are "a clear opportunity to accidentally create a circular import"; bundlers "might have a hard time tree-shaking"; "Having a large amount of index files in a project can slow down the development server."
- "No real protection against side-stepping the public API" → pair it with a linter.

**Enforcement tooling**

| Tool | State | Use it when |
|---|---|---|
| [`import/no-restricted-paths`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md) | The most-copied. [bulletproof-react's real config](https://github.com/alan2207/bulletproof-react/blob/master/apps/nextjs-app/.eslintrc.cjs) ships `zones` with **one entry per feature** plus `import/no-cycle` | Default choice. Allow-by-default; `except` must match `from`'s type; put a `message` on every zone |
| [`eslint-plugin-boundaries`](https://github.com/javierbrea/eslint-plugin-boundaries) | v**7.2.0** (2026-08-09); docs site still 7.1.0. v7 consolidates into one `boundaries/dependencies` rule with `default: "disallow"` | You want **deny-by-default**, entry-point enforcement, and per-layer bans on external packages (e.g. no `next/*` inside domain code). Write new configs against `boundaries/dependencies` — `element-types`/`entry-point` are v6-era deprecated aliases |
| [`no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports) | ESLint core | Ban `next/*`, `react` or a DB client inside domain modules via `patterns`. **Static imports only** — not a security control |
| [Steiger](https://github.com/feature-sliced/steiger) | `0.6.0` (2026-07-14), **beta** | FSD structure checks (`fsd/forbidden-imports`, `no-public-api-sidestep`, `excessive-slicing`). Pin the version if CI gates on it |
| [TS project references](https://www.typescriptlang.org/docs/handbook/project-references.html) | Stable | Layers are separate packages. The `.d.ts` boundary is **unforgeable**, unlike a lint rule — at the cost of `tsc -b` orchestration and committed build outputs. Usually too heavy inside one app |
| `import 'server-only'` | Built into Next | **Every DAL module.** The only option enforced by the compiler at the boundary that matters. Installing the npm package is optional — Next handles the import internally |

**[ESLint config reference](https://nextjs.org/docs/app/api-reference/config/eslint)** · v16.3.5, updated 2026-08-25
- **[v16]** "`next lint` and the `eslint` next.config.js option were removed in favor of the ESLint CLI." Run `eslint .`
- `eslint-config-next` bundles `@next/eslint-plugin-next`, `eslint-plugin-react`, `eslint-plugin-react-hooks` — **not** `eslint-plugin-import`. Install it yourself for boundary zones.

**Testing seams** — [Testing overview](https://nextjs.org/docs/app/guides/testing) (updated 2026-02-03) · [Vitest guide](https://nextjs.org/docs/app/guides/testing/vitest) (updated 2026-08-25)
- "Since `async` Server Components are new to the React ecosystem, some tools do not fully support them. In the meantime, we recommend using **End-to-End Testing** over **Unit Testing** for `async` components."
- "Vitest currently does not support them. While you can still run **unit tests** for synchronous Server and Client Components, we recommend using **E2E tests** for `async` components."
- [Vitest issue #8526](https://github.com/vitest-dev/vitest/issues/8526) (created 2025-09-04, **closed** without resolution, no minimal repro) — so cite the **Next.js docs** for this limitation, not the Vitest side. Don't expect async-RSC unit testing to land; architect so logic sits outside components.

**[Pages → App migration](https://nextjs.org/docs/app/guides/migrating/app-router-migration)** · updated 2026-08-25
- "The `app` directory is intentionally designed to work simultaneously with the `pages` directory to allow for incremental page-by-page migration."
- Per-page recipe: move the existing default export into a `'use client'` component, then add a thin `app/**/page.tsx` Server Component that fetches and passes props — "the easiest migration path because it has the most comparable behavior to the `pages` directory." That seam is also where you later lift logic into a feature module.
- Accepted cost: "there will be a hard navigation" across routers, and `next/link` won't prefetch across them. Group migrated routes so that's rare. `next/compat/router` for dual-router components.

### Consensus for this section

1. **`app/` is a routing adapter, not the application.** Every serious reference keeps composition out of route files — bulletproof-react's pages render a `_components` shell, FSD's route files are one-line re-exports, Commerce's pages compose `components/*` + `lib/shopify`.
2. **Colocation inside `app/` is safe and needs no opt-in.** A route isn't public until `page`/`route` exists; `_folder` is convenience (editor sorting, separating UI from routing, future-proofing against new file conventions).
3. **Route groups are for layout topology and ownership, never URLs.** Two groups resolving to one path is an error. The full-page-reload cost applies **only** to multiple root layouts.
4. **Failure ownership is per-segment and nests upward, with documented gaps.** `error.js` does not cover its own segment's `layout`/`template`; `loading.js` covers neither. Hence `global-error.tsx` for root-layout failures, and uncached layout data must move to `page.js` or get its own `<Suspense>`.
5. **Layouts are shells — enforced by the framework, not taste.** No re-render, no `searchParams`/`pathname`, and "Layouts cannot pass data to their `children`."
6. **The boundary is a module-graph seam with two crossing rules.** Code crosses by import and gets bundled; data crosses by serializable props. `'use client'` goes on leaf entry points; server output enters client shells as `children`; providers as deep as possible; wrap third-party client-only libs rather than converting your tree.
7. **A DAL is the official default for new projects:** server-only, authorizes, returns DTOs, monopolizes `process.env`. Actions stay thin wrappers over it.
8. **Auth authority ranking is unanimous:** DAL/data-source > page/leaf > layout > proxy/middleware. Layout checks neither re-run on navigation nor stop nested segments, parallel slots, the RSC payload, or actions.
9. **Every Server Action is a public POST endpoint.** Authenticate, authorize *the specific resource*, validate, constrain the return. Schema validation is not authorization — accept an ID plus the change and re-read the rest from the session.
10. **Re-read request state; don't pass it.** `cookies()`/`headers()` inside cached DAL helpers, not threaded as props.
11. **Request-scoped APIs push reads downward.** Awaiting them at the top of a layout makes the whole subtree dynamic — pass the promise down and resolve inside `<Suspense>`.
12. **Don't call your own Route Handlers from Server Components** — prerender fails at build, round trip at runtime. Route Handlers are for real public HTTP surface; Server Actions mutate and are queued.
13. **Dependencies flow one way and cross-feature imports are banned** — identical in bulletproof-react and FSD.
14. **A convention that isn't linted decays.** Every camp says so out loud; that's why this tooling exists at all.
15. **Barrels are out**, including around `app/`: bulletproof-react reversed itself, FSD documents the costs, TkDodo measured 11k → 3.5k modules (−68%).
16. **RSC skews the test pyramid.** Pure logic and sync components unit-test; async Server Components don't → e2e. The DAL/domain split is what keeps most logic unit-testable.
17. **Migration is incremental by design**, route by route.

### Contested for this section

1. **Should application code live inside `app/`?** Next.js lists both as valid and ranks neither. **Vercel's own published apps put everything inside `app/`** (next-learn: `app/lib`, `app/ui`; platforms: `actions.ts` at the route root), while bulletproof-react and FSD keep `app/` a thin shell over `src/features` / `src/_pages`. Complicating the shell camp: bulletproof-react's *actual* Next app is a hybrid — `src/app/provider.tsx` sits beside route files. No winner; the choice predicts how much `app/` grows.
2. **The re-export pattern** (`export { Page as default } from '@/_pages/…'`). FSD prescribes it; FSD's own docs and TkDodo document the costs. Worth preserving the nuance: a **route-level re-export of 1–2 named bindings is not the same thing as a feature-wide barrel** — the measured harm is about large index files. A real constraint either way: route segment config is *file-level exported variables*, so anything a route must expose has to be re-exported binding by binding.
3. **How many layers?** FSD's six vs bulletproof-react's three tiers vs T3's environment split vs Commerce's flat `app`+`components`+`lib`.
4. **DAL vs component-level access.** The guide recommends a DAL; **Vercel's own teaching app queries Postgres from `app/lib/data.ts` with no `server-only` guard** — the docs' own audit checklist would flag it. Follow the guide, not the tutorial.
5. **Which enforcement tool?** `no-restricted-paths` (most-copied, allow-by-default, one zone per feature, plugin not bundled) vs `boundaries` v7 (deny-by-default, can ban external packages, needs a classification model) vs Steiger (structure, beta) vs project references (unforgeable, heavy). Reasonable teams differ.
6. **Where mutations live.** Colocated `actions.ts` has community consensus; centralization is argued specifically for the auth chokepoint. The official reconciliation: colocate thin `'use server'` wrappers, centralize auth/authz/DB in the DAL. The "actions own business logic" style is common and conflicts with that.
7. **Colocated `actions.ts` vs a central folder.** Official examples are themselves inconsistent — `app/lib/actions.ts` and `app/actions.ts` vs feature-scoped `features/task/task-actions.ts` in the interactive-apps guide.
8. **`server-only` — required or optional?** The *import* is load-bearing; the *npm dependency* is optional, since Next handles it internally and "The contents of these packages from NPM are not used."

### Outdated advice to avoid (Next-specific)

| Avoid | Replacement |
|---|---|
| Sync `cookies()` / `params.slug` / `searchParams.q` | `await` them (Promises since 15.0.0-RC, sync **removed** in 16); `use()` in Client Components; codemod `next-async-request-api` |
| **[v16]** `middleware.ts` + `export function middleware()` | `proxy.ts` + `export function proxy()`, Node runtime, root or `src`. **Keep `middleware.ts` for the Edge runtime** — it is unsupported in `proxy`. On 15.x, `middleware.ts` is current |
| Protecting routes in middleware/proxy alone | CVE-2025-29927 plus matcher blind spots (actions POST to the page's own route). Optimistic cookie check at most; authoritative checks in the DAL and in every action |
| Auth check in `layout.tsx`, or `return null` there | Layouts don't re-render and don't gate siblings, parallel slots, the RSC payload or actions. Check in the DAL/page/leaf, re-check per action |
| `useFormState` from `react-dom` | `useActionState` from `react` → `[state, action, pending]`; codemod `replace-use-form-state` |
| "`'use server'` marks a Server Component" | There is **no** Server Component directive. `'use server'` marks Server Functions |
| Calling everything "Server Actions" | Server Function is the superset; a Server Action is one used in an action context (renamed Sept 2024) |
| Dot-notation compounds across the boundary | Named exports, or keep the compound on one side |
| Fetching your own `/api/*` from a Server Component | Call the DAL/ORM directly |
| **[v16]** `revalidateTag('tag')` single-arg | `updateTag(tag)` in actions for read-your-writes; `revalidateTag(tag, 'max')` for SWR |
| **[v16]** `experimental.ppr` / `experimental_ppr` / `dynamicIO` | `cacheComponents: true` |
| **[v16]** `export const dynamic`/`revalidate`/`fetchCache` as architectural dials | Removed when Cache Components is enabled |
| Relying on closure encryption or `.bind()` to hide secrets | `.bind()` args are **not** encrypted. Pass IDs, re-read server-side |
| Reading `cookies()` inside a plain `use cache` function | Read outside and pass in, or use `'use cache: private'` |
| `getServerSideProps`/`getStaticProps`/`getStaticPaths`, `_app`/`_document`, `next/head`, `useRouter` from `next/router` | Server Component fetching, `generateStaticParams`, root `layout.tsx` + Metadata API, `next/navigation` (`next/compat/router` while dual-router) |
| **[v16]** `next lint`; assuming `eslint-config-next` gives you `eslint-plugin-import` | `eslint .` with flat config; install `eslint-plugin-import` yourself |
| Treating bulletproof-react's Next app as current | It's Next 14 / React 18 / ESLint 8. Steal the *rules* (unidirectional, no cross-feature, no barrels); modernize the mechanics |
| Pre-RSC "hexagonal React = domain + hooks as ports" | Hooks are client-only and say nothing about the server graph. Use a server-only DAL + thin drivers |

### Do not cite (section 5)

- **`feature-sliced.design/blog/*` — provenance unverifiable. This retroactively affects sections 3 and 4 of this README.** The pages load and are bylined "Evan Carter", but the official FSD docs repo (`feature-sliced/documentation`, pushed 2026-09-14) is Astro/Starlight and contains **no blog content**; the `fsd.how` mirror returns **404**; no `/blog/` links appear on the FSD homepage. The three posts cited earlier here — *The Ultimate Next.js App Router Architecture*, *Clean Architecture in Frontend: A How-To Guide* (§3), *The 5 Frontend Architectures You Must Know in 2025* (§4) — are **plausible but not official FSD guidance**. Treat them as anonymous blog posts; prefer the verified `feature-sliced.design/docs/*` pages, which were checked against repo source.
- `nextjs.org/docs/13/...` — 404; the versioned `/docs/13/` tree is gone. Never cite that URL shape.
- `create.t3.gg/en/folder-structure` — 404. Real pages: `/en/folder-structure-app` and `-pages`.
- `turborepo.com/...` — 301 to `turborepo.dev`. Cite `.dev` only.
- `npmjs.com/package/eslint-plugin-boundaries` — HTTP 403 to automated fetches; use the GitHub README and `jsboundaries.dev`.
- `robinwieruch.de/next-folder-structure/` and `/next-js-folder-structure/` — both 404.
- `nextjs.org/docs/app/getting-started/updating-data` — 404; the path is `/mutating-data`.
- `nextjs.org/blog/cve-2025-29927` — 308; cite `vercel.com/blog/postmortem-on-next-js-middleware-bypass`.
- `matias-suez.com/blog/hexagonal-architecture-nextjs` — body unreadable across two attempts. **No credible long-form treatment of hexagonal architecture specifically with RSC was found** — treat that combination as thin ground.
- `sph.sh/...service-layer-centralization/` — well argued but **no stated author**; attribute to the site.
- `makerkit.dev/blog/tutorials/server-only-code-nextjs` — internally inconsistent metadata (dated 2024-12-10 while claiming Next 16). Cite at most for the `lib/server` convention.
- `react.dev/blog/2024/04/25/react-19-upgrade-guide` — loads but does **not** contain the `useFormState` deprecation; cite the 2024-12-05 React 19 post.
- **Claim that route segment config must be "statically analyzable"** — not found in the docs. Don't assert it.
- **Claim that Next.js docs warn about barrel files in `app/`** — not found. Cite TkDodo / FSD / bulletproof-react instead.
- `vercel/next.js` discussion #55908 — cite only as historical evidence of disagreement (Sept 2023, Next 13, unanswered, no Vercel reply).
- `vercel/commerce` — a template pinned to a **canary**; an example, not guidance.
- Assorted Medium/DEV/dev.to/SEO-farm "how I structure Next.js in 2026" posts, and the "FSD spreads one feature across layers" critique — unverified folklore.

### In this repo (DevDigest) — what applies and what doesn't

Measured facts about `client/` (2026-09-18): Next **15.5.19**, React 19 · 8 `page.tsx`, one `layout.tsx` · **no** `error.tsx` / `loading.tsx` / `not-found.tsx` / `template.tsx` · **no** route groups · **no** `src/features/` · **0** Server Actions · **0** route handlers · **no** `middleware.ts` · **no** `import 'server-only'` · **62** files with `'use client'`, including the root `src/app/page.tsx`.

**The architectural fact that governs everything below:** this is an App Router app used as a **client SPA**. Authority over data lives in the Fastify API on :3001; all HTTP goes through `src/lib/api.ts` and state through TanStack Query, with `NEXT_PUBLIC_API_BASE` compiled into the bundle by `next.config.mjs`. That is a deliberate boundary set by `client/AGENTS.md` and the repo's package split.

| Rule from this section | Applies here? |
|---|---|
| Data Access Layer, DTOs, `process.env` only in the DAL | **No — by design.** The DAL equivalent is the Fastify server, a separate package. Do not introduce DB access or secrets into `client/` |
| Server Actions: auth per action, IDs not objects, thin wrappers | **No — none exist.** If one is ever added, every rule applies at once: it is a public POST endpoint |
| Auth authority ranking (DAL > page > layout > proxy) | **Not applicable in `client/`.** Authorization belongs to the server package |
| `'use client'` at the leaves; providers as deep as possible | **Partially violated.** The root `page.tsx` is a Client Component and there are 62 client modules. Defensible for an SPA, but new UI should not widen the client graph reflexively |
| Failure ownership per segment (`error.tsx`, `not-found.tsx`) | **Applies, and is absent.** No segment owns its own failure today; `src/components/repo-not-found/` does this in userland instead. The cheapest real improvement available |
| Layouts are shells; no `searchParams`/data-to-children | **Applies and is satisfied** — one thin root layout |
| Don't call your own Route Handlers from Server Components | **Applies trivially** — neither exists. Note the repo already follows the spirit: the client calls the Fastify API, not a Next API tier |
| `app/` as routing shell vs the whole app | **Currently "whole app"**: features live in `app/**/_components/` with no `src/features/`. Consistent with Vercel's own published apps; fine while route-private, but a component needed by two routes belongs in `src/components/` |
| One-way dependencies, no cross-feature imports, lint-enforced | **Applies and is unenforced.** `client/eslint.config.mjs` has no `import/no-restricted-paths` zones. Nothing stops one route's `_components` importing another's |
| Barrels | `src/components/<kebab-case>/index.ts` barrels exist — feature-edge form, the defensible one. Don't add a top-level re-export |
| RSC testing seam | **Applies fully.** No async Server Components exist, so unit tests work today — a property to preserve, not to assume |
| **[v16]** `proxy.ts`, mandatory `default.js`, `retry()`, `PageProps<>`, `cacheComponents` | **None apply on 15.5.19.** They are an upgrade checklist, not current advice |

## Version history

The version lives in two places, kept in step: the `version` field in
[SKILL.md](SKILL.md) frontmatter, and this table.

| Version | Date | Change |
|---|---|---|
| 1.1.0 | 2026-09-18 | Added section 5, **Next.js App Router architecture** (structure · server/client boundary and server layering · applied architectures, enforcement, failure modes), version-tagged for 15.x vs **[v16]**, with an applies/doesn't-apply table for this repo. Also downgraded three `feature-sliced.design/blog/*` citations in §3–§5 to unverifiable provenance |
| 1.0.0 | 2026-09-18 | First release. Four rule sections, 146 verified sources, four contested calls made explicit, enforcement table, DevDigest mapping with three flagged deviations |

Versioning policy — semver on the *rules*, not the prose:
- **Major** — a rule reverses, or a contested call flips (e.g. barrels become recommended)
- **Minor** — a new rule or area is added, or new sources change a recommendation's strength
- **Patch** — wording, examples, dead links, added evidence for an existing rule

When bumping: update the SKILL.md `version` field, add a row here, and re-check the **Do not cite**
lists — link rot is the most common reason a source claim stops being verifiable.

## Maintenance notes

- This repo's skill convention ([`.claude/skills/README.md`](../README.md)) names `references.md`
  for "Sources and rationale". The sources live in this README instead, as requested; mirror or
  rename if the house layout should win.
- `react-code-organization` is a **local** skill — it is not in `skills-lock.json`, so edits here
  are safe and will not be overwritten by a skill sync.
- The DevDigest mapping in SKILL.md tracks `client/AGENTS.md`. If that file's conventions change
  (`_components/<PascalCase>/`, `src/lib/hooks/<domain>.ts`, `src/components/<kebab-case>/`), update
  the mapping and the three flagged deviations with it.
