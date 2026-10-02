import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { PrBriefEnvelope } from '@devdigest/shared';
import { AppError } from '../../../platform/errors.js';

/**
 * `pr_brief` data-access (spec 0018). The ONLY file in this module that
 * imports `drizzle-orm`.
 *
 * Reads parse the stored row through `PrBriefEnvelope`, never the bare
 * `PrBrief` — `PrBrief.parse()` strips `head_sha`, `generated_at`, `model`
 * and `missing_inputs`, which would silently destroy the staleness input a
 * `GET` needs.
 */
export class BriefRepository {
  constructor(private db: DbOrTx) {}

  async getBrief(prId: string): Promise<PrBriefEnvelope | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return undefined;
    const parsed = PrBriefEnvelope.safeParse(row.json);
    if (!parsed.success) {
      // Say so rather than hand the client a shape the parse just rejected —
      // the same convention `run.repo.ts getRunTrace` follows for `run_traces`.
      throw new AppError('brief_corrupt', 'Stored PR brief does not match the envelope schema', 500);
    }
    return parsed.data;
  }

  async upsertBrief(prId: string, envelope: PrBriefEnvelope): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: envelope })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: envelope } });
  }
}
