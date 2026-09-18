/**
 * Canonical Drizzle schema — EVERY table in the schema.
 *
 * Tenancy rule: every domain table carries `workspace_id` (FK→workspaces)
 * and, where relevant, `created_by` (FK→users). All queries scope by
 * workspace_id via the base-repository guard.
 *
 * This is the COMPLETE schema. Feature agents A1–A6 do NOT run parallel
 * migrations against these tables — they only extend with their own new
 * columns/tables via their own migrations.
 *
 * The tables are organized into domain files under `./schema/`; this barrel
 * re-exports them so every consumer keeps importing from `db/schema` unchanged.
 *
 * ---------------------------------------------------------------------------
 * ROADMAP SCAFFOLDING — 16 of these 40 tables have no read or write anywhere in
 * `src/` outside this schema and `db/seed.ts` (measured 2026-09-18). They are
 * kept DELIBERATELY: they cost nothing at runtime and are expensive to re-add,
 * but nothing is wired to them yet, so do not assume a feature exists because
 * its table does — and do not spend effort indexing or constraining them until
 * something reads them.
 *
 *   ci.ts        ciInstallations, ciRuns          (entire file unused)
 *   eval.ts      evalCases, evalRuns,
 *                conformanceChecks, composedReviews (entire file unused)
 *   knowledge.ts memory, conventions              ← `memory` is a pgvector table
 *   context.ts   codeChunks, onboarding           ← `codeChunks` is pgvector
 *   ops.ts       installedPlugins, digests
 *   runs.ts      multiAgentRuns
 *   reviews.ts   prBrief
 *   skills.ts    skillVersions
 *   core.ts      workspaceMembers
 *
 * Both pgvector tables are in that list, which is why the missing ANN
 * (ivfflat/hnsw) index does not bite yet — add one when they are first queried.
 *
 * Re-derive this list with:
 *   grep -rhoE "export const [a-zA-Z0-9_]+ = pgTable" src/db/schema/*.ts
 *   # then, per name: grep -rn "t\.<name>\b" src --include=*.ts \
 *   #   | grep -v "^src/db/schema/" | grep -v "^src/db/seed"
 * ---------------------------------------------------------------------------
 */
export * from './schema/core';
export * from './schema/repos';
export * from './schema/pulls';
export * from './schema/reviews';
export * from './schema/skills';
export * from './schema/agents';
export * from './schema/knowledge';
export * from './schema/context';
export * from './schema/eval';
export * from './schema/ci';
export * from './schema/runs';
export * from './schema/ops';
export * from './schema/repo-intel';

import { users, workspaces, workspaceMembers, settings } from './schema/core';
import { repos } from './schema/repos';
import { pullRequests, prFiles, prCommits } from './schema/pulls';
import { reviews, findings, prIntent, prBrief } from './schema/reviews';
import { skills, skillVersions } from './schema/skills';
import { agents, agentVersions, agentSkills } from './schema/agents';
import { memory, conventions } from './schema/knowledge';
import { codeChunks, symbols, references, onboarding } from './schema/context';
import { evalCases, evalRuns, conformanceChecks, composedReviews } from './schema/eval';
import { ciInstallations, ciRuns } from './schema/ci';
import { agentRuns, runTraces, multiAgentRuns } from './schema/runs';
import { jobs, installedPlugins, digests } from './schema/ops';
import {
  repoIndexState,
  fileEdges,
  fileFacts,
  fileRank,
  repoMapCache,
} from './schema/repo-intel';

/** Convenience: the full schema object for drizzle() client typing. */
export const schema = {
  users,
  workspaces,
  workspaceMembers,
  settings,
  repos,
  pullRequests,
  prFiles,
  prCommits,
  reviews,
  findings,
  prIntent,
  prBrief,
  skills,
  skillVersions,
  agents,
  agentVersions,
  agentSkills,
  conventions,
  memory,
  codeChunks,
  symbols,
  references,
  onboarding,
  evalCases,
  evalRuns,
  conformanceChecks,
  composedReviews,
  ciInstallations,
  ciRuns,
  agentRuns,
  runTraces,
  multiAgentRuns,
  jobs,
  installedPlugins,
  digests,
  // repo-intel: T2 = index state + graph + facts; T3 = rank + map.
  repoIndexState,
  fileEdges,
  fileFacts,
  fileRank,
  repoMapCache,
};
