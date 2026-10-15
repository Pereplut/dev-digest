import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { MAX_CI_RUNS_LISTED } from '../constants.js';
import type { CiRunInsert, CiRunRecord } from '../helpers.js';

/**
 * Ingested CI runs: `agent_runs` rows with `source = 'ci'` (spec 0022). Never
 * writes `ci_runs`.
 *
 * `cost_usd` crosses this boundary as a STRING on write and a NUMBER on read —
 * Drizzle 0.38 `numeric()` has no `mode: 'number'` (server/INSIGHTS.md:144-150)
 * — so the conversion lives here and nowhere else.
 */

const selection = {
  id: t.agentRuns.id,
  agentId: t.agentRuns.agentId,
  agentName: t.agents.name,
  ciInstallationId: t.agentRuns.ciInstallationId,
  repo: t.agentRuns.repo,
  externalPrNumber: t.agentRuns.externalPrNumber,
  commitSha: t.agentRuns.commitSha,
  actionsRunId: t.agentRuns.actionsRunId,
  jobUrl: t.agentRuns.jobUrl,
  ciGateTriggered: t.agentRuns.ciGateTriggered,
  status: t.agentRuns.status,
  error: t.agentRuns.error,
  findingsCount: t.agentRuns.findingsCount,
  costUsd: t.agentRuns.costUsd,
  durationMs: t.agentRuns.durationMs,
  ranAt: t.agentRuns.ranAt,
};

type SelectedRow = {
  [K in keyof typeof selection]: (typeof selection)[K]['_']['data'] | null;
};

function toRecord(r: SelectedRow): CiRunRecord {
  return {
    ...r,
    costUsd: r.costUsd == null ? null : Number(r.costUsd),
    // `ranAt` is NOT NULL on the table; the left join cannot null it.
    ranAt: r.ranAt as Date,
  } as CiRunRecord;
}

export class CiRunRepository {
  constructor(private readonly db: DbOrTx) {}

  /**
   * Insert one ingested run unless its (installation, Actions run id) pair is
   * already stored. Returns whether a row was inserted.
   */
  async insertIfAbsent(v: CiRunInsert): Promise<boolean> {
    const rows = await this.db
      .insert(t.agentRuns)
      .values({
        workspaceId: v.workspaceId,
        agentId: v.agentId,
        source: 'ci',
        ranAt: v.ranAt,
        status: v.status,
        error: v.error,
        durationMs: v.durationMs,
        costUsd: v.costUsd == null ? null : String(v.costUsd),
        findingsCount: v.findingsCount,
        blockers: v.blockers,
        ciInstallationId: v.ciInstallationId,
        repo: v.repo,
        externalPrNumber: v.externalPrNumber,
        commitSha: v.commitSha,
        actionsRunId: v.actionsRunId,
        jobUrl: v.jobUrl,
        ciGateTriggered: v.ciGateTriggered,
      })
      .onConflictDoNothing({
        target: [t.agentRuns.ciInstallationId, t.agentRuns.actionsRunId],
      })
      .returning({ id: t.agentRuns.id });
    return rows.length > 0;
  }

  /** The workspace's CI runs, newest first, capped at `MAX_CI_RUNS_LISTED`. */
  async listCiRuns(workspaceId: string, agentId?: string): Promise<CiRunRecord[]> {
    const rows = await this.db
      .select(selection)
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.source, 'ci'),
          agentId ? eq(t.agentRuns.agentId, agentId) : undefined,
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt), desc(t.agentRuns.id))
      .limit(MAX_CI_RUNS_LISTED);
    return rows.map(toRecord);
  }

  /** The newest CI run of each given installation. */
  async newestByInstallation(installationIds: string[]): Promise<Map<string, CiRunRecord>> {
    if (installationIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([t.agentRuns.ciInstallationId], selection)
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(
        and(eq(t.agentRuns.source, 'ci'), inArray(t.agentRuns.ciInstallationId, installationIds)),
      )
      .orderBy(t.agentRuns.ciInstallationId, desc(t.agentRuns.ranAt), desc(t.agentRuns.id));
    const out = new Map<string, CiRunRecord>();
    for (const r of rows) if (r.ciInstallationId) out.set(r.ciInstallationId, toRecord(r));
    return out;
  }
}
