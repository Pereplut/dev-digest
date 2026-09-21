import type {
  Skill,
  SkillDraft,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillVersion,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { SkillRow } from '../../db/rows.js';
import { restoredMessage } from './constants.js';
import {
  renderSkillBlock,
  toCardStats,
  toSkillDto,
  toSkillVersionDto,
  rate,
} from './helpers.js';
import { buildImportDraft } from './import/preview.js';
import { SkillsRepository } from './repository/skill.repo.js';

export type CreateSkillInput = SkillDraft & { source?: SkillSource };
export type UpdateSkillInput = Partial<SkillDraft> & { enabled?: boolean };

/**
 * Skills service (spec 0006): CRUD with versioning, stats, and the import
 * preview. No HTTP and no SQL here — persistence goes through
 * SkillsRepository, pure transforms through helpers.ts / import/*.
 */
export class SkillsService {
  constructor(
    private container: Container,
    private repo: SkillsRepository = container.skillsRepo,
  ) {}

  private tokens(row: Pick<SkillRow, 'name' | 'body'>): number {
    return this.container.tokenizer.count(renderSkillBlock(row.name, row.body));
  }

  private async withStats(workspaceId: string, row: SkillRow): Promise<Skill> {
    const agg = await this.repo.aggregates(workspaceId, row.id);
    return toSkillDto(row, this.tokens(row), toCardStats(agg.get(row.id)));
  }

  async list(workspaceId: string, q?: string): Promise<Skill[]> {
    const [rows, agg] = await Promise.all([
      this.repo.list(workspaceId, q),
      this.repo.aggregates(workspaceId),
    ]);
    return rows.map((r) => toSkillDto(r, this.tokens(r), toCardStats(agg.get(r.id))));
  }

  async get(workspaceId: string, id: string): Promise<Skill> {
    const row = await this.repo.get(workspaceId, id);
    if (!row) throw new NotFoundError('Skill not found');
    return this.withStats(workspaceId, row);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      source: input.source ?? 'manual',
      message: input.message ?? null,
    });
    return this.withStats(workspaceId, row);
  }

  async update(workspaceId: string, id: string, patch: UpdateSkillInput): Promise<Skill> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      message: patch.message ?? null,
    });
    if (!row) throw new NotFoundError('Skill not found');
    return this.withStats(workspaceId, row);
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.delete(workspaceId, id);
    if (!ok) throw new NotFoundError('Skill not found');
  }

  async versions(workspaceId: string, id: string): Promise<SkillVersion[]> {
    const row = await this.repo.get(workspaceId, id);
    if (!row) throw new NotFoundError('Skill not found');
    return (await this.repo.versions(id)).map(toSkillVersionDto);
  }

  async restore(workspaceId: string, id: string, version: number): Promise<Skill> {
    const row = await this.repo.restore(workspaceId, id, version, restoredMessage(version));
    if (row === undefined) throw new NotFoundError('Skill not found');
    if (row === null) throw new NotFoundError(`Skill version ${version} not found`);
    return this.withStats(workspaceId, row);
  }

  async stats(workspaceId: string, id: string): Promise<SkillStats> {
    const row = await this.repo.get(workspaceId, id);
    if (!row) throw new NotFoundError('Skill not found');
    const { counts, agents, byCategory } = await this.repo.stats(workspaceId, id);
    return {
      agent_count: counts.agentCount,
      pull_rate: rate(counts.runsWithSkill, counts.runsTotal),
      accept_rate: rate(counts.accepted, counts.accepted + counts.dismissed),
      findings_30d: byCategory.reduce((sum, c) => sum + c.count, 0),
      agents,
      findings_by_category: byCategory,
    };
  }

  /** Parse an upload into a draft. Persists NOTHING. */
  async previewImport(
    workspaceId: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<SkillImportPreview> {
    const { draft, ignored_files } = buildImportDraft(this.container.archiveReader, filename, bytes);
    return {
      draft,
      source_filename: filename,
      ignored_files,
      name_conflict: await this.repo.existsByName(workspaceId, draft.name),
    };
  }
}
