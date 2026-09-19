/**
 * Keyset pagination for GET /repos/:id/pulls (plan item D11).
 *
 * The endpoint used to return every PR in the repo and then build three `IN`
 * lists sized by that count. It now returns one page plus an opaque
 * `next_cursor`.
 *
 * The assertions that matter are about the BOUNDARY, not the happy path: a
 * keyset predicate that is subtly wrong still returns plausible-looking pages
 * while dropping or repeating rows across them. So these walk the whole set one
 * page at a time and check the union is exactly the input, with no duplicates —
 * which is what row-value comparison `(key, id) < (key, id)` buys, and what a
 * naive OFFSET or a `<` on a non-unique key would fail.
 *
 * `updated_at` is deliberately NULL on one row: it is nullable, so the sort key
 * coalesces, and a cursor built from a NULL must still round-trip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { PrPage } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('GET /repos/:id/pulls — keyset pagination (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** A repo with `count` PRs: descending updated_at, and one NULL. */
  async function setupRepoWithPrs(count: number) {
    const db = pg.handle.db;
    const name = `paged-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();

    for (let i = 0; i < count; i++) {
      await db.insert(t.pullRequests).values({
        workspaceId,
        repoId: repo!.id,
        number: i + 1,
        title: `PR ${i + 1}`,
        author: 'marisa.koch',
        branch: `feat/${i}`,
        base: 'main',
        headSha: `sha${i}`,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
        // The last one has no updated_at, exercising the coalesced sort key.
        updatedAt: i === count - 1 ? null : new Date(Date.UTC(2026, 0, i + 1)),
      });
    }
    return repo!;
  }

  // No GitHub override: container.github() throws without a token, the service
  // logs and serves persisted rows. That keeps these tests about pagination.
  const get = async (url: string) => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url });
    // `payload` is kept so a non-200 names itself. Casting an error envelope to
    // PrPage turns a real server error into `undefined.map(...)` three frames
    // later, which is exactly how the first run of these tests wasted a cycle.
    return { status: res.statusCode, body: res.json() as PrPage, payload: res.payload };
  };

  /** Fetch a page and fail loudly, with the server's own message, on non-200. */
  const getPage = async (url: string): Promise<PrPage> => {
    const res = await get(url);
    if (res.status !== 200) {
      throw new Error(`GET ${url} -> ${res.status}: ${res.payload}`);
    }
    return res.body;
  };

  it('returns one page plus a cursor, and null once exhausted', async () => {
    const repo = await setupRepoWithPrs(5);

    const first = await get(`/repos/${repo.id}/pulls?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.next_cursor).toBeTruthy();

    const last = await get(`/repos/${repo.id}/pulls?limit=50`);
    expect(last.body.items).toHaveLength(5);
    expect(last.body.next_cursor).toBeNull();
  });

  it('walks every PR exactly once across pages — no gaps, no repeats', async () => {
    const repo = await setupRepoWithPrs(7);

    const seen: number[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const qs = new URLSearchParams({ limit: '2' });
      if (cursor) qs.set('cursor', cursor);
      const page = await getPage(`/repos/${repo.id}/pulls?${qs.toString()}`);
      seen.push(...page.items.map((p) => p.number));
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7); // every PR exactly once
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('orders newest-updated first, and the order survives a page boundary', async () => {
    const repo = await setupRepoWithPrs(6);

    const whole = await getPage(`/repos/${repo.id}/pulls?limit=100`);
    const expected = whole.items.map((p) => p.number);

    const paged: number[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const qs = new URLSearchParams({ limit: '2' });
      if (cursor) qs.set('cursor', cursor);
      const page = await getPage(`/repos/${repo.id}/pulls?${qs.toString()}`);
      paged.push(...page.items.map((p) => p.number));
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    // Paging must not reshuffle: the concatenated pages equal one big read.
    expect(paged).toEqual(expected);
    // PR 6 has a NULL updated_at, so the coalesced key sorts it last.
    expect(expected[expected.length - 1]).toBe(6);
  });

  it('rejects a malformed cursor with 400 rather than silently serving page one', async () => {
    const repo = await setupRepoWithPrs(3);

    const res = await get(`/repos/${repo.id}/pulls?cursor=not-a-real-cursor`);

    expect(res.status).toBe(400);
  });

  it('rejects a well-formed cursor whose id is not a uuid with 400, not a Postgres 500', async () => {
    const repo = await setupRepoWithPrs(3);
    // Decodes cleanly, but the id half would reach `::uuid` in SQL.
    const crafted = Buffer.from('2020-01-01T00:00:00.000Z|x', 'utf8').toString('base64url');

    const res = await get(`/repos/${repo.id}/pulls?cursor=${crafted}`);

    expect(res.status).toBe(400);
  });

  it('bounds limit at the edge', async () => {
    const repo = await setupRepoWithPrs(3);

    // Over the cap, zero and non-numeric are all refused by the query schema —
    // an unbounded limit would defeat the point of paginating.
    expect((await get(`/repos/${repo.id}/pulls?limit=5000`)).status).toBe(422);
    expect((await get(`/repos/${repo.id}/pulls?limit=0`)).status).toBe(422);
    expect((await get(`/repos/${repo.id}/pulls?limit=abc`)).status).toBe(422);
  });
});
