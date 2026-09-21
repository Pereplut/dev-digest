import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'imported_file', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  /** Tokens this skill adds to a prompt (cl100k estimate of its rendered block). */
  token_count: z.number().int().nullish(),
  /** Card metrics; rates are 0..1 or null when there is nothing to divide by. */
  stats: z
    .object({
      agent_count: z.number().int(),
      pull_rate: z.number().nullable(),
      accept_rate: z.number().nullable(),
    })
    .nullish(),
  updated_at: z.string().nullish(),
});
export type Skill = z.infer<typeof Skill>;

/** Create/update body for a skill. `message` is the optional change note of the new version. */
export const SkillDraft = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  type: SkillType,
  body: z.string().trim().min(1).max(20_000),
  message: z.string().trim().max(200).optional(),
});
export type SkillDraft = z.infer<typeof SkillDraft>;

/** One immutable snapshot in a skill's history. */
export const SkillVersion = z.object({
  version: z.number().int(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  message: z.string().nullable(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/** Stats tab. Findings are attributed to the RUN that included the skill, not to the skill itself. */
export const SkillStats = z.object({
  agent_count: z.number().int(),
  pull_rate: z.number().nullable(),
  accept_rate: z.number().nullable(),
  findings_30d: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  findings_by_category: z.array(z.object({ category: z.string(), count: z.number().int() })),
});
export type SkillStats = z.infer<typeof SkillStats>;

/** Result of parsing an uploaded .md / .zip / .skill — nothing is saved until the user confirms. */
export const SkillImportPreview = z.object({
  draft: SkillDraft,
  source_filename: z.string(),
  ignored_files: z.array(z.object({ path: z.string(), reason: z.string() })),
  name_conflict: z.boolean(),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions (spec 0007) ----
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/** Closed set, so the model cannot invent a category. Mirrors CONVENTION_CATEGORIES. */
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error-handling',
  'async',
  'testing',
  'api',
  'data',
  'style',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/** Why code-side proof rejected a candidate. */
export const ConventionRejectReason = z.enum([
  'file_not_found',
  'line_out_of_range',
  'snippet_not_found',
]);
export type ConventionRejectReason = z.infer<typeof ConventionRejectReason>;

/**
 * One extracted house convention. `evidence_snippet` is always text re-read
 * from the repository, never the model's copy of it — see the proof step.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string(),
  evidence_start_line: z.number().int().nullable(),
  evidence_end_line: z.number().int().nullable(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  /** False when the evidence could not be found in the repo; see `rejected_reason`. */
  evidence_valid: z.boolean(),
  rejected_reason: z.string().nullable(),
  updated_at: z.string().nullish(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** One run of the extractor. The page polls this to know when a scan finished. */
export const ConventionScan = z.object({
  id: z.string(),
  status: z.enum(['running', 'done', 'failed']),
  /** `repo-intel` is the indexed path; `walk` the fallback for an unindexed repo. */
  sampler: z.enum(['repo-intel', 'walk']),
  sample_file_count: z.number().int(),
  candidate_count: z.number().int(),
  rejected_count: z.number().int(),
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** GET /repos/:id/conventions */
export const ConventionsPage = z.object({
  candidates: z.array(ConventionCandidate),
  scan: ConventionScan.nullable(),
});
export type ConventionsPage = z.infer<typeof ConventionsPage>;

/** PATCH /conventions/:id — accept, reject, or edit one candidate. */
export const ConventionPatch = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().trim().min(1).max(500).optional(),
    category: ConventionCategory.optional(),
  })
  .refine((v) => v.status !== undefined || v.rule !== undefined || v.category !== undefined, {
    message: 'patch must change at least one field',
  });
export type ConventionPatch = z.infer<typeof ConventionPatch>;

/**
 * One source of truth for the draft's bounds and for the defaults that prefill
 * it. The defaults ARE the body of the POST below, so a default the POST would
 * reject is a 400 the user can only escape by deleting text.
 */
export const CONVENTION_SKILL_LIMITS = {
  name: 80,
  description: 500,
  body: 20_000,
} as const;

/**
 * POST /repos/:id/conventions/skill — the fully edited draft from the modal.
 * Everything here is editable in the UI before saving (homework criterion 41);
 * the server only supplies the defaults.
 */
export const ConventionSkillDraft = z.object({
  name: z.string().trim().min(1).max(CONVENTION_SKILL_LIMITS.name),
  description: z.string().trim().min(1).max(CONVENTION_SKILL_LIMITS.description),
  type: SkillType,
  body: z.string().trim().min(1).max(CONVENTION_SKILL_LIMITS.body),
  enabled: z.boolean().default(true),
  candidate_ids: z.array(z.string()).min(1),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

/** The server-computed defaults the modal opens with. */
export const ConventionSkillDefaults = z.object({
  name: z.string().max(CONVENTION_SKILL_LIMITS.name),
  description: z.string().max(CONVENTION_SKILL_LIMITS.description),
  type: SkillType,
  body: z.string().max(CONVENTION_SKILL_LIMITS.body),
  accepted_count: z.number().int(),
});
export type ConventionSkillDefaults = z.infer<typeof ConventionSkillDefaults>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  /** Enabled skill links (list/detail DTO only). */
  skill_count: z.number().int().nullish(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  /** Per-agent switch; the skill reaches the prompt only if this AND skill.enabled. */
  enabled: z.boolean(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

export const AgentSkill = AgentSkillLink.extend({ skill: Skill });
export type AgentSkill = z.infer<typeof AgentSkill>;
