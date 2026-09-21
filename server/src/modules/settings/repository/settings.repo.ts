import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { SettingsRow } from '../helpers.js';

/**
 * settings data-access layer — the ONLY place in this module that touches
 * Drizzle. Non-secret preferences only; secrets live behind SecretsProvider
 * and never reach this table.
 *
 * Only `key` and `value` are selected: `rowsToSettings` reads nothing else,
 * and a narrow projection keeps workspace/user ids out of the response path.
 */

export class SettingsRepository {
  constructor(private db: Db) {}

  async listForWorkspace(workspaceId: string): Promise<SettingsRow[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  /**
   * Upsert ONE preference. The caller loops; this is not atomic across keys,
   * which matches the pre-extraction behaviour (see the note in service.ts).
   */
  async upsert(
    workspaceId: string,
    userId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    await this.db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value },
      });
  }
}
