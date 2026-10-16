**N+1 queries.** Flag a DB query (Drizzle `db.select`, `db.query.*`, a repository
method) executed once per item of a collection the PR iterates.

**Look for:** a query inside `for`/`for…of`, `.map(async …)`, `Promise.all(items.map(…))`,
or a helper called per item that queries internally (follow one level of calls
visible in the diff).

**Bad:**
```ts
for (const pr of prs) {
  pr.runs = await db.select().from(agentRuns).where(eq(agentRuns.prId, pr.id));
}
```
**Good:** one query with `inArray(agentRuns.prId, prs.map((p) => p.id))`, then
group in memory with a `Map`; or a join.

**Phrasing:** state the loop size driver ("one query per PR in the page, up to
100") and the fix. Cite the line with the query inside the loop.

**Severity:** CRITICAL when the loop runs on a request hot path over an
unbounded or user-sized collection; WARNING for a bounded or background loop;
SUGGESTION for a loop over a small fixed set (≤ 5).

**Do not flag:** loops over a constant tiny list, queries that must run
sequentially inside a transaction for correctness, or batch jobs already
throttled by a queue.