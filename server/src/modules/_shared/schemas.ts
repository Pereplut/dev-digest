import { z } from 'zod';

/**
 * Shared route param schemas. Most `/:id` routes address a DB row whose primary
 * key is a uuid (see db/schema/*), so validate that shape at the edge — an
 * invalid id becomes a clean 422 instead of a downstream DB/500.
 *
 * NOTE: not every `:id` is a uuid (e.g. `/providers/:id` where id is a provider
 * name like "openai"); those routes use their own schema.
 */
export const IdParams = z.object({ id: z.string().uuid() });
export type IdParams = z.infer<typeof IdParams>;

/**
 * A repo uuid plus a PR NUMBER (GitHub's per-repo counter, not a row id).
 * Path segments arrive as strings, so `number` is coerced — and bounded, so a
 * junk segment is a 422 at the edge rather than a miss deeper in.
 */
export const RepoPullNumberParams = z.object({
  id: z.string().uuid(),
  number: z.coerce.number().int().positive(),
});
export type RepoPullNumberParams = z.infer<typeof RepoPullNumberParams>;

/**
 * Keyset pagination query. Query values arrive as strings, so `limit` coerces —
 * and is BOUNDED, because the point of paginating is that one request cannot
 * ask the database for an unbounded amount of work. `cursor` is opaque to the
 * caller: it comes back as `next_cursor` and is passed through unchanged.
 */
export const PageQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
  cursor: z.string().min(1).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;
