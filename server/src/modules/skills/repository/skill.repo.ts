import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { SkillSource, SkillType } from '@devdigest/shared';
import type { Db, DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { SkillRow, SkillVersionRow } from '../../../db/rows.js';
import { ConflictError } from '../../../platform/errors.js';
import { INITIAL_SKILL_VERSION } from '../constants.js';
import { isSkillContentChange, type SkillAggregateCounts, type SkillContent } from '../helpers.js';

export type { SkillRow, SkillVersionRow };

/**
 * Skills data-access (spec 0006). Owns `skills`, `skill_versions` and the
 * skill-side reads of `agent_skills` / `run_skills`. Workspace-scoped.
 * The agent side of `agent_skills` (link/replace/count) is AgentsRepository's.
 */

export interface InsertSkill extends SkillContent {
  workspaceId: string;
  source: SkillSource;
  message?: string | null;
}

export interface UpdateSkill extends Partial<SkillContent> {
  enabled?: boolean;
  message?: string | null;
}

/** A skill that will be sent in a run, in link order. */
export interface EnabledSkillRow {
  id: string;
  name: string;
  version: number;
  body: string;
}

export interface SkillStatsRows {
  counts: SkillAggregateCounts;
  agents: { id: string; name: string }[];
  byCategory: { category: string; count: number }[];
}

/** Postgres unique_violation, possibly wrapped by the driver/ORM. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function nameTaken(name: string): ConflictError {
  return new ConflictError(`A skill named "${name}" already exists`, { field: 'name' });
}

type AggregateRow = {
  skill_id: string;
  agent_count: number;
  runs_total: number;
  runs_with_skill: number;
  accepted: number;
  dismissed: number;
};

export class SkillsRepository {
  constructor(private db: DbOrTx) {}

  private tx<T>(cb: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return (this.db as Db).transaction((tx) => cb(tx));
  }

  async list(workspaceId: string, q?: string): Promise<SkillRow[]> {
    const conds: SQL[] = [eq(t.skills.workspaceId, workspaceId)];
    const term = q?.trim();
    if (term) {
      // Escape LIKE wildcards so a search for "100%" matches literally.
      const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(or(ilike(t.skills.name, pattern), ilike(t.skills.description, pattern))!);
    }
    return this.db
      .select()
      .from(t.skills)
      .where(and(...conds))
      .orderBy(asc(t.skills.name));
  }

  async get(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async existsByName(workspaceId: string, name: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return row !== undefined;
  }

  /** Insert a skill AND its v1 snapshot, atomically. Throws ConflictError on a taken name. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    try {
      return await this.tx(async (tx) => {
        const [row] = await tx
          .insert(t.skills)
          .values({
            workspaceId: values.workspaceId,
            name: values.name,
            description: values.description,
            type: values.type,
            source: values.source,
            body: values.body,
            version: INITIAL_SKILL_VERSION,
          })
          .returning();
        await snapshot(tx, row!, values.message ?? null);
        return row!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken(values.name);
      throw err;
    }
  }

  /**
   * Update a skill. A change to name/description/type/body bumps the version
   * and writes a snapshot (with the change note); toggling only `enabled`
   * does not. Returns undefined when the skill is not in this workspace.
   */
  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    try {
      return await this.tx(async (tx) => {
        const [existing] = await tx
          .select()
          .from(t.skills)
          .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
          .for('update');
        if (!existing) return undefined;

        const content = isSkillContentChange(
          { ...existing, type: existing.type as SkillType },
          patch,
        );
        const enabledChange = patch.enabled !== undefined && patch.enabled !== existing.enabled;
        if (!content && !enabledChange) return existing;

        const [row] = await tx
          .update(t.skills)
          .set({
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(content
              ? {
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  ...(patch.description !== undefined ? { description: patch.description } : {}),
                  ...(patch.type !== undefined ? { type: patch.type } : {}),
                  ...(patch.body !== undefined ? { body: patch.body } : {}),
                  version: existing.version + 1,
                  updatedAt: new Date(),
                }
              : {}),
          })
          .where(eq(t.skills.id, id))
          .returning();
        if (content) await snapshot(tx, row!, patch.message ?? null);
        return row!;
      });
    } catch (err) {
      if (isUniqueViolation(err) && patch.name !== undefined) throw nameTaken(patch.name);
      throw err;
    }
  }

  /**
   * Restore an old snapshot as a NEW version (history is never rewritten).
   * `undefined` = skill not in the workspace; `null` = no such version.
   */
  async restore(
    workspaceId: string,
    id: string,
    version: number,
    message: string,
  ): Promise<SkillRow | undefined | null> {
    let restoredName = '';
    try {
      return await this.tx(async (tx) => {
        const [existing] = await tx
          .select()
          .from(t.skills)
          .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
          .for('update');
        if (!existing) return undefined;
        const [snap] = await tx
          .select()
          .from(t.skillVersions)
          .where(and(eq(t.skillVersions.skillId, id), eq(t.skillVersions.version, version)));
        if (!snap) return null;
        restoredName = snap.name;
        const [row] = await tx
          .update(t.skills)
          .set({
            name: snap.name,
            description: snap.description,
            type: snap.type,
            body: snap.body,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(t.skills.id, id))
          .returning();
        await snapshot(tx, row!, message);
        return row!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken(restoredName);
      throw err;
    }
  }

  /** Delete (links and versions cascade; run_skills keep history with skill_id null). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** All snapshots of a skill, newest first. */
  async versions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /**
   * The skills a run of `agentId` sends, in link order: the link is enabled
   * AND the skill is globally enabled. Workspace-scoped through the skill.
   */
  async enabledForAgent(workspaceId: string, agentId: string): Promise<EnabledSkillRow[]> {
    return this.db
      .select({
        id: t.skills.id,
        name: t.skills.name,
        version: t.skills.version,
        body: t.skills.body,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
          eq(t.skills.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(t.agentSkills.order));
  }

  /**
   * Card-metric counts for every skill in the workspace (or just `skillId`)
   * in ONE round trip — the list endpoint must not issue a query per skill.
   *
   * - agent_count: agents with an ENABLED link;
   * - runs_total: done runs of the agents currently linked (enabled or not);
   * - runs_with_skill: of those runs, the ones whose prompt included the skill
   *   (restricted to the same agents so the ratio stays within 0..1);
   * - accepted / dismissed: decided findings of reviews produced by ANY run
   *   that included the skill (findings are attributed to the run).
   */
  async aggregates(
    workspaceId: string,
    skillId?: string,
  ): Promise<Map<string, SkillAggregateCounts>> {
    const skillFilter = skillId ? sql`and s.id = ${skillId}::uuid` : sql``;
    const rows = await this.db.execute<AggregateRow>(sql`
      with ws_skills as (
        select s.id from skills s where s.workspace_id = ${workspaceId}::uuid ${skillFilter}
      ),
      skill_runs as (
        select distinct rs.skill_id, rs.run_id, r.agent_id
        from run_skills rs
        join agent_runs r on r.id = rs.run_id and r.status = 'done'
        where rs.skill_id in (select id from ws_skills)
      )
      select
        s.id as skill_id,
        (select count(*) from agent_skills l
          where l.skill_id = s.id and l.enabled)::int as agent_count,
        (select count(*) from agent_runs r
          where r.status = 'done'
            and r.agent_id in (select l.agent_id from agent_skills l where l.skill_id = s.id))::int
          as runs_total,
        (select count(*) from skill_runs sr
          where sr.skill_id = s.id
            and sr.agent_id in (select l.agent_id from agent_skills l where l.skill_id = s.id))::int
          as runs_with_skill,
        (select count(*) from findings f
          join reviews rv on rv.id = f.review_id
          where rv.run_id in (select sr.run_id from skill_runs sr where sr.skill_id = s.id)
            and f.accepted_at is not null)::int as accepted,
        (select count(*) from findings f
          join reviews rv on rv.id = f.review_id
          where rv.run_id in (select sr.run_id from skill_runs sr where sr.skill_id = s.id)
            and f.accepted_at is null and f.dismissed_at is not null)::int as dismissed
      from ws_skills s
    `);
    const out = new Map<string, SkillAggregateCounts>();
    for (const r of rows) {
      out.set(r.skill_id, {
        agentCount: Number(r.agent_count),
        runsTotal: Number(r.runs_total),
        runsWithSkill: Number(r.runs_with_skill),
        accepted: Number(r.accepted),
        dismissed: Number(r.dismissed),
      });
    }
    return out;
  }

  /** Stats-tab data: the counts, the agents with an enabled link, and 30-day findings by category. */
  async stats(workspaceId: string, skillId: string): Promise<SkillStatsRows> {
    const counts = (await this.aggregates(workspaceId, skillId)).get(skillId) ?? {
      agentCount: 0,
      runsTotal: 0,
      runsWithSkill: 0,
      accepted: 0,
      dismissed: 0,
    };
    const agents = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.agentSkills.skillId, skillId),
          eq(t.agentSkills.enabled, true),
          eq(t.agents.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(t.agents.name));

    const n = sql<number>`count(*)::int`;
    const byCategory = await this.db
      .select({ category: t.findings.category, count: n })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, 'done'),
          sql`${t.agentRuns.ranAt} >= now() - interval '30 days'`,
          sql`exists (select 1 from run_skills rs where rs.run_id = ${t.agentRuns.id} and rs.skill_id = ${skillId}::uuid)`,
        ),
      )
      .groupBy(t.findings.category)
      .orderBy(desc(n), asc(t.findings.category));

    return {
      counts,
      agents,
      byCategory: byCategory.map((r) => ({ category: r.category, count: Number(r.count) })),
    };
  }
}

/** Write the immutable snapshot of `row`'s current version. */
async function snapshot(db: DbOrTx, row: SkillRow, message: string | null): Promise<void> {
  await db.insert(t.skillVersions).values({
    skillId: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    type: row.type,
    body: row.body,
    message,
  });
}
