# onion-architecture — examples

Before/after pairs taken from this codebase. `❌` marks real code that violates a rule (all of it
grandfathered — see SKILL.md §11); `✅` marks real code that is the reference shape.

---

## 1. `routes.ts` is transport only

❌ `modules/pulls/routes.ts` — a handler that owns the query, the sync and the business logic:

```ts
import { and, count, desc, eq, inArray, isNull, sum } from 'drizzle-orm';
import * as t from '../../db/schema.js';

app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
  const { workspaceId } = await getContext(container, req);
  const [repo] = await container.db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
  if (!repo) throw new NotFoundError('Repo not found');

  const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
  for (const pr of pulls) {
    await container.db.insert(t.pullRequests).values({ … }).onConflictDoUpdate({ … });
  }
  // …~20 queries total, plus diff-stat backfill, cost rollup and severity rollup
});
```

✅ `modules/repos/routes.ts` — the whole file is parse → context → service → status:

```ts
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);
    return repo;
  });

  app.get('/repos', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });
}
```

**Rule:** a route parses, resolves context, calls one service method, and maps the status code.

---

## 2. Services reach external systems through the container

✅ `modules/repos/service.ts` — git and secrets both arrive as ports; no SDK import anywhere:

```ts
async runCloneJob(payload: CloneJobPayload): Promise<void> {
  const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
  const cloneUrl = token ? withGitHubToken(url, token) : url;
  const { path } = await this.container.git.clone({ owner, name }, cloneUrl, { depth: CLONE_DEPTH });
  await this.repo.updateClonePath(repoId, path);
}
```

❌ The shape to avoid — importing the library directly, which removes the test seam:

```ts
import simpleGit from 'simple-git';                 // ring 3 importing a vendor SDK
const git = simpleGit(cloneDir);
await git.clone(url, dest);
```

This is what happened with ast-grep: `repo-intel/service.ts` and `pipeline/full.ts` import
`parseSymbols` / `parseImports` from `adapters/astgrep` directly, so no test can substitute it.

**Rule:** if there is no port, add one (SKILL.md §6) rather than importing the library.

---

## 3. Only the data layer imports `drizzle-orm`

✅ `modules/reviews/repository/review.repo.ts` — free functions taking `db` first:

```ts
export async function insertFindings(db: Db, reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
  const rows = await db.insert(t.findings).values(findings.map((f) => ({
    reviewId, file: f.file, startLine: f.start_line, … }))).returning();
  return rows;
}
```

✅ `modules/reviews/repository.ts` composes them behind one facade, so services see a single object:

```ts
import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';

export class ReviewRepository {
  constructor(private db: Db) {}
  getPull(workspaceId: string, prId: string) { return pullRepo.getPull(this.db, workspaceId, prId); }
}
```

**Rule:** `drizzle-orm` appears in `repository.ts` and `repository/*.repo.ts`. Nowhere else in a module.

---

## 4. Mapping happens once, in `helpers.ts`

✅ `modules/repos/service.ts` — repository returns rows, the service maps them:

```ts
async list(workspaceId: string): Promise<Repo[]> {
  const rows = await this.repo.list(workspaceId);
  return rows.map(toRepoDto);
}
```

❌ `modules/reviews/repository/run.repo.ts` — mapping inside the repository, so the same module now
has two answers to "where does row → DTO happen":

```ts
export async function listRunsForPull(db, workspaceId, prId): Promise<RunSummary[]> {
  return rows.map(({ run, agentName }) => ({
    run_id: run.id, agent_id: run.agentId, agent_name: agentName ?? null,
    duration_ms: run.durationMs, cost_usd: run.costUsd, … }));
}
```

**Rule:** repositories return `$inferSelect` rows; `helpers.ts` converts to the snake_case contract.

---

## 5. Pure logic is a free function

✅ `modules/pulls/status.ts` — the file header states the reason:

```ts
/** PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly). */
export function rollupSeverities(rows: { severity: string; n?: number }[]): FindingsCounts {
  const c: FindingsCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL' || r.severity === 'WARNING' || r.severity === 'SUGGESTION') {
      c[r.severity] += r.n ?? 1;
    }
  }
  return c;
}
```

❌ The consequence of not doing this — `test/repo-intel-facade-degraded.test.ts` has to fake a
container and then reach through the class to replace a private field, because the service
constructs its own repository:

```ts
const container = { config: { … }, db: {} as never, … } as never;
const svc = new RepoIntelService(container);
(svc as unknown as { repo: Record<string, unknown> }).repo = { getRepoBasics: async () => null };
```

**Rule:** logic that needs a unit test goes in ring 1 as a free function — not behind a constructor.

---

## 6. Inner rings never import outward

❌ `adapters/astgrep/index.ts:25` — ring 4 infrastructure importing a feature module:

```ts
import { MAX_SIGNATURE_CHARS, SUPPORTED_EXT } from '../../modules/repo-intel/constants.js';
```

✅ The fix: the constants move into the adapter (it owns the parsing limits), or into the port file
if both sides need them. `db/rows.ts` already exists for the analogous problem — it holds shared row
shapes "so cross-cutting consumers can reference a row shape WITHOUT importing another module's
data layer."

**Rule:** `adapters/**` and `platform/**` must not import `modules/**`.

---

## 7. Adding an external system — all five steps

✅ How `DepGraph` was done (the compact, correct version):

```ts
// 1. Port — declared beside the adapter for a narrow internal dependency
export interface DepGraph { … }

// 2. Adapter — the only file importing dependency-cruiser
export class DepCruiseGraph implements DepGraph { … }

// 3. Mock — deterministic, no network (adapters/mocks.ts)

// 4. Container — lazy getter + an overrides key
get depgraph(): DepGraph {
  if (this.overrides.depgraph) return this.overrides.depgraph;
  this._depgraph ??= new DepCruiseGraph();
  return this._depgraph;
}

// 5. Consume — services use container.depgraph; tests inject via overrides
```

Use `async` for the getter only when the client needs a secret first — compare `github()`, which
resolves a token and throws `ConfigError` when it is missing.

**Rule:** skip a step and the system becomes untestable. ast-grep skipped all five.

---

## 8. Transactions stay in the application ring

❌ Current state — `run.repo.deleteAgentRun` deletes from two tables with no transaction, so a
failure between them leaves orphaned rows:

```ts
await db.delete(t.reviews).where(eq(t.reviews.runId, runId));
await db.delete(t.agentRuns).where(eq(t.agentRuns.id, runId));
```

✅ The shape to use — the service owns the boundary, repositories accept an invoker:

```ts
// service.ts
await this.db.transaction(async (tx) => {
  await deleteReviews(tx, runId);
  await deleteAgentRun(tx, runId);
});

// repository/run.repo.ts
export async function deleteAgentRun(db: Db | Tx, runId: string) {
  await db.delete(t.agentRuns).where(eq(t.agentRuns.id, runId));
}
```

**Rule:** the transaction boundary is a use-case concern. It never appears in `routes.ts`.
