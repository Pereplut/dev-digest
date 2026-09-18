import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * The transaction handle Drizzle passes to `db.transaction(cb)`. Derived from
 * `Db` rather than imported from drizzle's internals so it cannot drift from
 * the actual driver/schema generics.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Either the pool or an open transaction. Repository functions take this so a
 * service can compose several of them into ONE atomic unit without every query
 * being duplicated in a tx-flavoured variant:
 *
 *   await db.transaction(async (tx) => { await insertReview(tx, …); … });
 *
 * Passing `db` keeps the existing auto-commit behaviour.
 */
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client over postgres-js. Used by the app (one shared handle)
 * and by the Testcontainers harness (per-test handle).
 */
export function createDb(databaseUrl: string, opts?: { max?: number }): DbHandle {
  const sql = postgres(databaseUrl, { max: opts?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
