import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { AgentVersionConfig, type CiFailOn, type Provider, type ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow, SkillRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order and per-agent switch), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: SkillRow;
  order: number;
  enabled: boolean;
}

export type ReplaceSkillLinksResult =
  | { ok: true }
  | { ok: false; reason: 'agent_not_found' }
  | { ok: false; reason: 'unknown_skills'; skillIds: string[] };

/**
 * spec 0020 AC-9 — `skillsNotRestored` carries every snapshot skill id the
 * NEW snapshot does not carry, for any reason: deleted (AC-32) or globally
 * disabled (AC-87). `undefined` means no `agent_versions` row for that
 * `version` (route → 404, AC-35).
 */
export interface PromoteVersionResult {
  row: AgentRow;
  skillsNotRestored: string[];
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /**
   * Resolve several agents at once. Callers that need names for a set of rows
   * (the PR's reviews, say) would otherwise issue one `getById` per agent.
   * Returns only the agents that exist in this workspace, in no guaranteed
   * order — callers index by id.
   */
  async listByIds(workspaceId: string, ids: string[]): Promise<AgentRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, ids)));
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  /**
   * `dbOrTx` defaults to the repository's own pool so every pre-existing call
   * site (`insert`, `update`, both outside a transaction) is unchanged.
   * `promoteVersion` passes its own `tx` explicitly so this reads the skill
   * links it JUST rebuilt in the same transaction, not a stale snapshot from
   * the autocommit pool (spec 0020 — the AC-28 ordering trap).
   */
  private async snapshotVersion(row: AgentRow, version: number, dbOrTx: DbOrTx = this.db): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id, dbOrTx);
    await dbOrTx
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Every skill linked to an agent (enabled or not), in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    return this.db
      .select({ skill: t.skills, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
  }

  /**
   * Ordered ids of the skills a run of this agent would send (link enabled AND
   * skill enabled) — what an agent_versions snapshot records as `skills`.
   */
  async skillIdsForAgent(agentId: string, dbOrTx: DbOrTx = this.db): Promise<string[]> {
    const rows = await dbOrTx
      .select({ id: t.skills.id })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
        ),
      )
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => r.id);
  }

  /**
   * Effective skill count per agent (enabled link AND enabled skill) in ONE
   * grouped query, so the agent list is not N+1. Agents without skills are
   * absent from the map (callers default to 0).
   */
  async skillCounts(workspaceId: string, agentIds?: string[]): Promise<Map<string, number>> {
    if (agentIds && agentIds.length === 0) return new Map();
    const rows = await this.db
      .select({ agentId: t.agentSkills.agentId, n: sql<number>`count(*)::int` })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
          ...(agentIds ? [inArray(t.agentSkills.agentId, agentIds)] : []),
        ),
      )
      .groupBy(t.agentSkills.agentId);
    return new Map(rows.map((r) => [r.agentId, Number(r.n)]));
  }

  /**
   * Replace ALL of an agent's skill links with `links` (array order = prompt
   * order) in ONE transaction. Every skill must belong to the agent's
   * workspace; otherwise nothing changes.
   */
  async replaceSkillLinks(
    workspaceId: string,
    agentId: string,
    links: { skillId: string; enabled: boolean }[],
  ): Promise<ReplaceSkillLinksResult> {
    return this.db.transaction(async (tx) => {
      const [agent] = await tx
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .for('update');
      if (!agent) return { ok: false, reason: 'agent_not_found' };

      const ids = links.map((l) => l.skillId);
      if (ids.length > 0) {
        const found = await tx
          .select({ id: t.skills.id })
          .from(t.skills)
          .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, ids)));
        const known = new Set(found.map((r) => r.id));
        const unknown = ids.filter((id) => !known.has(id));
        if (unknown.length > 0) return { ok: false, reason: 'unknown_skills', skillIds: unknown };
      }

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (links.length > 0) {
        await tx.insert(t.agentSkills).values(
          links.map((l, i) => ({ agentId, skillId: l.skillId, order: i, enabled: l.enabled })),
        );
      }
      return { ok: true };
    });
  }

  /**
   * spec 0020 AC-28 – AC-32, AC-87, AC-88 — restore `version`'s snapshot onto
   * the agent as a NEW version, in one transaction: `name`, `description`
   * and `enabled` are untouched (AC-29, not in `config_json`); skill links
   * are reconciled BEFORE the new snapshot is inserted (the ordering trap —
   * `snapshotVersion` reads `skillIdsForAgent` at write time, so inserting it
   * first would record the PRE-promote skill set). `undefined` means either
   * the agent or the version snapshot was not found (both 404 at the
   * service/route); the caller (`AgentsService.promote`) has already
   * rejected `version === agent.version` (AC-33) and a live batch (AC-34)
   * before this runs, so a refused promote never opens this transaction.
   *
   * Deliberately NOT `update()` + `replaceSkillLinks()`: `update()` snapshots
   * BEFORE any link change (the ordering trap, inverted), and
   * `replaceSkillLinks` rejects the WHOLE call on an unknown skill id
   * (`:297` above) where AC-32 requires skipping just that one id and still
   * applying the rest.
   */
  async promoteVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<PromoteVersionResult | undefined> {
    return this.db.transaction(async (tx) => {
      const [agent] = await tx
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .for('update');
      if (!agent) return undefined;

      const [snapshot] = await tx
        .select()
        .from(t.agentVersions)
        .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
      if (!snapshot) return undefined;

      const config = AgentVersionConfig.parse(snapshot.configJson);
      const snapshotSkillIds = config.skills;

      // Which snapshot skill ids still have a `skills` row in this workspace
      // (AC-31/AC-32). A deleted skill's `agent_skills` link row is already
      // gone too — `skillId` cascades (`db/schema/agents.ts:57-59`) — so
      // "exists" here is exactly "can still be linked".
      const existingSkillRows =
        snapshotSkillIds.length > 0
          ? await tx
              .select({ id: t.skills.id })
              .from(t.skills)
              .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, snapshotSkillIds)))
          : [];
      const liveSkillIds = new Set(existingSkillRows.map((r) => r.id));

      // AC-30/AC-31: keep the agent's EXISTING links in their current order,
      // flipping only `enabled`; a snapshot skill with no link row but a live
      // skill row is appended AFTER them, enabled.
      const existingLinks = await tx
        .select({ skillId: t.agentSkills.skillId })
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agentId))
        .orderBy(asc(t.agentSkills.order));
      const existingLinkIds = new Set(existingLinks.map((l) => l.skillId));
      const snapshotSet = new Set(snapshotSkillIds);

      const rebuiltLinks: { skillId: string; enabled: boolean }[] = [
        ...existingLinks.map((l) => ({ skillId: l.skillId, enabled: snapshotSet.has(l.skillId) })),
        ...snapshotSkillIds
          .filter((id) => liveSkillIds.has(id) && !existingLinkIds.has(id))
          .map((id) => ({ skillId: id, enabled: true })),
      ];

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (rebuiltLinks.length > 0) {
        await tx
          .insert(t.agentSkills)
          .values(rebuiltLinks.map((l, i) => ({ agentId, skillId: l.skillId, order: i, enabled: l.enabled })));
      }

      const nextVersion = agent.version + 1;
      const [row] = await tx
        .update(t.agents)
        .set({
          provider: config.provider,
          model: config.model,
          systemPrompt: config.system_prompt,
          outputSchema: (config.output_schema as object | undefined) ?? null,
          strategy: config.strategy,
          ciFailOn: config.ci_fail_on,
          repoIntel: config.repo_intel,
          version: nextVersion,
        })
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .returning();

      // The ordering trap: snapshot LAST, inside the same `tx`, so it reads
      // the links this call just rebuilt (AC-28).
      await this.snapshotVersion(row!, nextVersion, tx);

      // AC-87/AC-88: `skillIdsForAgent` is the same filter (link enabled AND
      // skill enabled) `snapshotVersion` just used to build the new
      // snapshot — so whatever it drops (deleted OR globally disabled) is
      // exactly `skillsNotRestored`, making the union invariant hold by
      // construction rather than by two independently-written lists.
      const newSnapshotSkillIds = new Set(await this.skillIdsForAgent(agentId, tx));
      const skillsNotRestored = snapshotSkillIds.filter((id) => !newSnapshotSkillIds.has(id));

      return { row: row!, skillsNotRestored };
    });
  }
}
