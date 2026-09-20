/**
 * Conventions application service (spec 0007).
 *
 * Orchestrates: pick samples (pure code, no model) → one structured model call
 * → code-side proof of every candidate → merge into the table. No SQL and no
 * vendor SDK live here; persistence goes through ConventionsRepository and
 * external systems through the container.
 */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type {
  ConventionCandidate,
  ConventionPatch,
  ConventionScan,
  ConventionSkillDefaults,
  ConventionSkillDraft,
  ConventionsPage,
  Skill,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { toSkillDto } from '../skills/helpers.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ConventionsRepository, type ConventionUpsert } from './repository/convention.repo.js';
import {
  CONFIG_CANDIDATES,
  EXTRACT_JOB_KIND,
  MAX_SAMPLE_FILE_BYTES,
  TOP_FILE_COUNT,
  WALK_EXCLUDED_DIRS,
  WALK_MAX_ENTRIES,
} from './constants.js';
import {
  conventionFingerprint,
  dedupeByFingerprint,
  isSafeRelativePath,
  toCandidateDto,
  toScanDto,
} from './helpers.js';
import { buildSampleBlock, pickSamplePaths, walkFallbackPaths, type SampleFile } from './sampling.js';
import { validateEvidence } from './proof.js';
import {
  CONVENTION_EXTRACTION_SCHEMA_NAME,
  ConventionExtraction,
  buildExtractionMessages,
} from './prompt.js';
import { buildConventionSkill } from './skill-body.js';

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  // ------------------------------------------------------------------- reads

  async page(workspaceId: string, repoId: string): Promise<ConventionsPage> {
    const [rows, scan] = await Promise.all([
      this.repo.listForRepo(workspaceId, repoId),
      this.repo.latestScan(workspaceId, repoId),
    ]);
    return {
      candidates: rows.map(toCandidateDto),
      scan: scan ? toScanDto(scan) : null,
    };
  }

  async patch(
    workspaceId: string,
    id: string,
    patch: ConventionPatch,
  ): Promise<ConventionCandidate> {
    const row = await this.repo.patch(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention not found');
    return toCandidateDto(row);
  }

  /** Server-computed defaults the create-skill modal opens with. */
  async skillDefaults(workspaceId: string, repoId: string): Promise<ConventionSkillDefaults> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const accepted = (await this.repo.listForRepo(workspaceId, repoId))
      .filter((r) => r.status === 'accepted')
      .map(toCandidateDto);
    const texts = buildConventionSkill(repo.fullName, accepted);
    return { ...texts, type: 'convention', accepted_count: accepted.length };
  }

  // ------------------------------------------------------------------ writes

  /**
   * Insert the scan row and enqueue the job. Returns immediately: the page
   * polls `GET /repos/:id/conventions` for the scan's status.
   */
  async startExtraction(
    workspaceId: string,
    repoId: string,
  ): Promise<{ scan: ConventionScan; jobId: string | null }> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      // Loud, not silently empty: repo-intel's silent degradation on an
      // un-cloned repo is recorded in server/INSIGHTS.md as a defect.
      throw new ConflictError(
        'This repository has no local checkout yet. Sync it before extracting conventions.',
        { field: 'clone_path' },
      );
    }

    const scan = await this.repo.startScan(workspaceId, repoId);
    let jobId: string | null = null;
    try {
      const job = await this.container.jobs.enqueue(workspaceId, EXTRACT_JOB_KIND, {
        workspaceId,
        repoId,
        scanId: scan.id,
      });
      jobId = job.id;
      // Nobody awaits `done`; without a sink an ultimately-failed job is an
      // unhandled rejection, which takes the process down under Node ≥ 15.
      void job.done.catch(() => undefined);
    } catch {
      await this.repo.failScan(scan.id, 'Could not enqueue the extraction job.');
    }
    return { scan: toScanDto((await this.repo.latestScan(workspaceId, repoId)) ?? scan), jobId };
  }

  /** The job handler. Throws on failure; the caller records it on the scan row. */
  async runExtraction(workspaceId: string, repoId: string, scanId: string): Promise<void> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const clonePath = repo.clonePath;
    if (!clonePath) throw new ValidationError('Repository has no local checkout');

    // --- 1. Pick the sample. Pure code — no model call in this step (crit. 39).
    const configPaths = await this.presentConfigs(clonePath);
    let sampler: 'repo-intel' | 'walk' = 'repo-intel';
    let ranked = await this.container.repoIntel.getConventionSamples(repoId, TOP_FILE_COUNT);
    if (ranked.length === 0) {
      // The repo was never indexed (or repo-intel is off). Fall back to a
      // deterministic walk rather than extracting from configs alone.
      sampler = 'walk';
      ranked = walkFallbackPaths(await listRepoFiles(clonePath));
    }
    const paths = pickSamplePaths(configPaths, ranked);
    const files = await this.readAll(clonePath, paths);
    if (files.length === 0) throw new ValidationError('No readable source files in the checkout');

    // --- 2. One structured model call.
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'conventions',
    );
    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: ConventionExtraction,
      schemaName: CONVENTION_EXTRACTION_SCHEMA_NAME,
      messages: buildExtractionMessages(repo.fullName, buildSampleBlock(files)),
      temperature: 0,
    });

    // --- 3. Prove every candidate against the real files.
    const byPath = new Map(files.map((f) => [f.path, f.content]));
    const upserts: ConventionUpsert[] = [];
    for (const c of result.data.candidates) {
      // SECURITY: only files WE sampled may be read here.
      //
      // `evidence_path` is model output, and the model is steered by untrusted
      // repository text, so treating it as a path to open makes it an arbitrary
      // read inside the clone. The clone contains `.git/config`, which holds the
      // credential the repo was cloned with (`withGitHubToken`) — and because a
      // successful proof re-reads the snippet from the real file, that token
      // would be persisted to `evidence_snippet`, served by the API, rendered in
      // the UI and embedded into skill bodies sent to the LLM provider.
      //
      // The model saw nothing but the sample, so a path outside it is either a
      // hallucination or an attempt to aim us elsewhere. Either way it is
      // unproven, not worth a filesystem read.
      const content = byPath.get(c.evidence_path) ?? null;

      const proof = validateEvidence(content, {
        evidencePath: c.evidence_path,
        evidenceStartLine: c.evidence_start_line,
        evidenceEndLine: c.evidence_end_line,
        evidenceSnippet: c.evidence_snippet,
      });
      upserts.push({
        workspaceId,
        repoId,
        scanId,
        category: c.category,
        rule: c.rule.trim(),
        evidencePath: c.evidence_path,
        evidenceStartLine: proof.ok ? proof.startLine : c.evidence_start_line,
        evidenceEndLine: proof.ok ? proof.endLine : c.evidence_end_line,
        // On success the snippet is re-read from the file, so the UI never
        // shows code the model wrote.
        evidenceSnippet: proof.ok ? proof.snippet : c.evidence_snippet,
        confidence: c.confidence,
        evidenceValid: proof.ok,
        rejectedReason: proof.ok ? null : proof.reason,
        fingerprint: conventionFingerprint(c.evidence_path, c.rule),
      });
    }

    // Collapse same-fingerprint duplicates BEFORE counting, so the scan row
    // describes what was actually stored (and so the batch upsert is legal —
    // see dedupeByFingerprint).
    const merged = dedupeByFingerprint(upserts);

    await this.repo.mergeCandidates(merged);
    await this.repo.finishScan(scanId, {
      sampler,
      sampleFileCount: files.length,
      candidateCount: merged.length,
      rejectedCount: merged.filter((u) => !u.evidenceValid).length,
      model: result.model,
      costUsd: result.costUsd,
    });
  }

  async failScan(scanId: string, message: string): Promise<void> {
    await this.repo.failScan(scanId, message);
  }

  /**
   * Create one skill from the user's edited draft.
   *
   * Goes through `container.skillsRepo` rather than the skills module's own
   * service: cross-module reuse travels through the container.
   */
  async createSkill(
    workspaceId: string,
    repoId: string,
    draft: ConventionSkillDraft,
  ): Promise<Skill> {
    await this.requireRepo(workspaceId, repoId);
    const rows = await this.repo.listByIds(workspaceId, draft.candidate_ids);
    if (rows.length === 0) throw new ValidationError('No matching conventions to merge');

    const evidenceFiles = [
      ...new Set(rows.map((r) => r.evidencePath).filter((p): p is string => !!p)),
    ];
    const row = await this.container.skillsRepo.insert({
      workspaceId,
      name: draft.name,
      description: draft.description,
      type: draft.type,
      body: draft.body,
      source: 'extracted',
      enabled: draft.enabled,
      evidenceFiles,
      message: 'Created from extracted conventions',
    });
    return toSkillDto(row, this.container.tokenizer.count(row.body));
  }

  // ----------------------------------------------------------------- private

  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.repo.getRepoBasics(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  /** Which of the well-known config files actually exist at the clone root. */
  private async presentConfigs(clonePath: string): Promise<string[]> {
    const found: string[] = [];
    for (const name of CONFIG_CANDIDATES) {
      if ((await readTextFile(clonePath, name)) !== null) found.push(name);
    }
    return found;
  }

  private async readAll(clonePath: string, paths: string[]): Promise<SampleFile[]> {
    const out: SampleFile[] = [];
    for (const path of paths) {
      if (!isSafeRelativePath(path)) continue;
      const content = await readTextFile(clonePath, path);
      if (content !== null) out.push({ path, content });
    }
    return out;
  }

}

/**
 * Read a repo file, returning null instead of throwing when it is missing.
 * `GitClient.readFile` throws on ENOENT, and probing for optional config files
 * is the common case here.
 *
 * SECURITY — "inside the clone root" is not a safety boundary:
 *  - `isSafeRelativePath` only vets the STRING (absolute, `..`, NUL). `readFile`
 *    follows symlinks, so a repository that commits `tsconfig.json` as a link to
 *    `../../../.env` or to another clone's `.git/config` would have that file
 *    read, put in the prompt sample, and shipped to the model provider. We probe
 *    those config names by name, so the attacker only has to commit the link.
 *  - `.git/` is excluded outright: it holds the credential the clone URL carried
 *    (see platform/redact.ts) and is never repository source.
 * `lstat` (not `stat`) is what makes the first check work — it does not follow
 * the link, so `isFile()` is false for one. The realpath check then also covers
 * a link *inside* a directory component of the path.
 */
export async function readTextFile(clonePath: string, relPath: string): Promise<string | null> {
  if (!isSafeRelativePath(relPath)) return null;

  const root = resolve(clonePath);
  const full = resolve(root, relPath);
  if (full === root || !full.startsWith(root + sep)) return null;

  const stats = await lstat(full).catch(() => null);
  if (!stats?.isFile()) return null;
  // The sample caps (MAX_SAMPLE_LINES, SAMPLE_CHAR_BUDGET) are applied AFTER
  // the read, so without this the whole file is resident in the API process
  // first. `CONFIG_CANDIDATES` are probed by fixed name at the clone root, so a
  // repo need only commit a huge `package.json` to exhaust the heap of the
  // process serving every other request — well before the job's 120s timeout.
  if (stats.size > MAX_SAMPLE_FILE_BYTES) return null;
  // The sample caps (MAX_SAMPLE_LINES, SAMPLE_CHAR_BUDGET) are applied AFTER
  // the read, so without this the whole file is resident in the API process
  // first. `CONFIG_CANDIDATES` are probed by fixed name at the clone root, so a
  // repo need only commit a huge `package.json` to exhaust the heap of the
  // process serving every other request — well before the job's 120s timeout.

  const real = await realpath(full).catch(() => null);
  if (real === null || !real.startsWith(root + sep)) return null;
  if (relative(root, real).split(sep)[0] === '.git') return null;

  return readFile(full, 'utf8').catch(() => null);
}

/** Flat list of repo-relative file paths, bounded and excluding generated dirs. */
export async function listRepoFiles(clonePath: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [clonePath];
  while (stack.length > 0 && out.length < WALK_MAX_ENTRIES) {
    const dir = stack.pop() as string;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) {
        if ((WALK_EXCLUDED_DIRS as readonly string[]).includes(e.name)) continue;
        stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        out.push(relative(clonePath, join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  }
  return out;
}
