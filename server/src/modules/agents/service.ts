import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkill,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import type { AgentRow } from '../../db/rows.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
// Pure skill helpers (ring 1) — the ONE prompt-block formatter and the Skill
// DTO mapping; never the skills module's service or repository.
import { renderSkillBlock, toSkillDto } from '../skills/helpers.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  /**
   * The repository is a constructor argument (B4) so a test can pass a stub
   * instead of reaching into a private field after construction. It defaults
   * to the real one over `container.db`, so every call site stays
   * `new AgentsService(container)`.
   */
  constructor(
    private container: Container,
    private repo: AgentsRepository = new AgentsRepository(container.db),
  ) {}

  async list(workspaceId: string): Promise<Agent[]> {
    const [rows, counts] = await Promise.all([
      this.repo.list(workspaceId),
      this.repo.skillCounts(workspaceId),
    ]);
    return rows.map((row) => toAgentDto(row, counts.get(row.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? this.withSkillCount(workspaceId, row) : undefined;
  }

  private async withSkillCount(workspaceId: string, row: AgentRow): Promise<Agent> {
    const counts = await this.repo.skillCounts(workspaceId, [row.id]);
    return toAgentDto(row, counts.get(row.id) ?? 0);
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row, 0);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? this.withSkillCount(workspaceId, row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /**
   * Every skill link of an agent (enabled or not), in prompt order, each with
   * its skill. Undefined when the agent is not in this workspace (route → 404).
   * Card stats are not computed here (`skill.stats` null); `token_count` is.
   */
  async skillLinks(workspaceId: string, agentId: string): Promise<AgentSkill[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({
      agent_id: agentId,
      skill_id: l.skill.id,
      order: l.order,
      enabled: l.enabled,
      skill: toSkillDto(
        l.skill,
        this.container.tokenizer.count(renderSkillBlock(l.skill.name, l.skill.body)),
      ),
    }));
  }

  /**
   * Replace the agent's skill links with `links` (array order = prompt order),
   * atomically. 404 for an unknown agent; 422 when a skill id is not in the
   * agent's workspace (nothing is changed then). Duplicates are rejected at
   * the route. Returns the new links.
   */
  async setSkillLinks(
    workspaceId: string,
    agentId: string,
    links: { skill_id: string; enabled: boolean }[],
  ): Promise<AgentSkill[]> {
    const result = await this.repo.replaceSkillLinks(
      workspaceId,
      agentId,
      links.map((l) => ({ skillId: l.skill_id, enabled: l.enabled })),
    );
    if (!result.ok) {
      if (result.reason === 'agent_not_found') throw new NotFoundError('Agent not found');
      throw new ValidationError('Unknown skill for this workspace', {
        skill_ids: result.skillIds,
      });
    }
    return (await this.skillLinks(workspaceId, agentId)) ?? [];
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
