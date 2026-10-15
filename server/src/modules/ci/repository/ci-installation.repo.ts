import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { CiInstallationRow } from '../../../db/rows.js';

export type { CiInstallationRow };

/**
 * `ci_installations` data-access (spec 0022). The only file in this module
 * allowed to import drizzle-orm besides `ci-run.repo.ts`.
 */

/** A GHA installation joined to its agent — what refresh needs to ingest. */
export interface GhaInstallationForIngest {
  id: string;
  agentId: string;
  agentName: string;
  repo: string;
  repositoryId: number;
}

export interface UpsertOnExport {
  agentId: string;
  repo: string;
  repositoryId: number;
  triggers: string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
  prUrl: string | null;
}

export class CiInstallationRepository {
  constructor(private readonly db: DbOrTx) {}

  /** Installations of one agent, oldest first. */
  async listByAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(asc(t.ciInstallations.installedAt), asc(t.ciInstallations.id));
  }

  /** Every GHA installation of the workspace's agents, joined to the agent name. */
  async listGhaByWorkspace(workspaceId: string): Promise<GhaInstallationForIngest[]> {
    return this.db
      .select({
        id: t.ciInstallations.id,
        agentId: t.ciInstallations.agentId,
        agentName: t.agents.name,
        repo: t.ciInstallations.repo,
        repositoryId: t.ciInstallations.repositoryId,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.targetType, 'gha')))
      .orderBy(asc(t.ciInstallations.installedAt), asc(t.ciInstallations.id));
  }

  async getByAgentRepo(agentId: string, repo: string): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)));
    return row;
  }

  /**
   * One statement: insert at version 1, or — when the (agent, repo) row exists —
   * bump `workflow_version` by one and reset the stored settings.
   */
  async upsertOnExport(input: UpsertOnExport): Promise<CiInstallationRow> {
    const settings = {
      status: 'pr_open' as const,
      triggers: input.triggers,
      postAs: input.postAs,
      repositoryId: input.repositoryId,
      prUrl: input.prUrl,
    };
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: 'gha',
        workflowVersion: 1,
        ...settings,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: {
          ...settings,
          workflowVersion: sql`${t.ciInstallations.workflowVersion} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  }

  async setStatus(id: string, status: 'pr_open' | 'active' | 'error'): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({ status, updatedAt: new Date() })
      .where(eq(t.ciInstallations.id, id));
  }
}
