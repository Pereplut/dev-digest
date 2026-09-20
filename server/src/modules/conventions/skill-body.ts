/**
 * Aggregation: accepted convention candidates → one markdown skill body.
 *
 * The server produces this as the DEFAULT only. The modal hands the whole text
 * back to the user, who may rewrite any of it before saving (criterion 41), and
 * whatever they submit is what gets stored.
 *
 * Pure: takes candidates, returns a string.
 */
import type { ConventionCandidate } from '@devdigest/shared';

export interface ConventionSkillTexts {
  name: string;
  description: string;
  body: string;
}

/** `acme/payments-api` → `payments-api-conventions`. */
export function defaultSkillName(repoFullName: string): string {
  const short = repoFullName.split('/').pop() ?? repoFullName;
  return `${slugify(short)}-conventions`;
}

export function buildConventionSkill(
  repoFullName: string,
  candidates: ConventionCandidate[],
): ConventionSkillTexts {
  const short = repoFullName.split('/').pop() ?? repoFullName;
  return {
    name: defaultSkillName(repoFullName),
    description: `${candidates.length} house ${
      candidates.length === 1 ? 'convention' : 'conventions'
    } extracted from ${short}`,
    body: renderConventionsSkill(repoFullName, candidates),
  };
}

export function renderConventionsSkill(
  repoFullName: string,
  candidates: ConventionCandidate[],
): string {
  const short = repoFullName.split('/').pop() ?? repoFullName;
  const parts: string[] = [
    `# ${defaultSkillName(repoFullName)}`,
    '',
    `House conventions for \`${short}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
  ];

  const used = new Set<string>();
  for (const c of candidates) {
    const heading = uniqueSlug(c.rule, used);
    parts.push('', `## ${heading}`, ensureSentence(c.rule));
    if (c.evidence_path) {
      const fence = fenceFor(c.evidence_snippet);
      parts.push(
        '',
        `Detected in \`${formatLocation(c)}\`:`,
        '',
        `${fence}ts`,
        c.evidence_snippet,
        fence,
      );
    }
  }
  return parts.join('\n');
}

/**
 * A fence longer than the longest backtick run inside the snippet.
 *
 * The snippet is repository text. A fixed ``` fence lets a file that itself
 * contains ``` (any file documenting markdown will) close the block early, so
 * the rest of the snippet stops being code and becomes body markdown. That
 * matters more here than usual: this body is stored as a skill, and skill
 * bodies are placed in the SYSTEM message as agent CONFIGURATION — the trusted
 * region — by `assemblePrompt`, while every other repo-derived input is
 * delimiter-wrapped. Escaping out of the fence therefore promotes third-party
 * file content into instructions for every later review with this skill.
 */
function fenceFor(snippet: string): string {
  const longest = (snippet.match(/`+/g) ?? []).reduce((m, run) => Math.max(m, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * `src/api/users.ts:23-31`, or `…:23` when the range is one line.
 *
 * The path is sanitised for the same reason the rule is: it is model output
 * bounded only by `z.string().min(1)`, and for a candidate the machine rejected
 * but a user accepted it was never matched against a real file at all. It is
 * rendered inside backticks in the skill body, so a path carrying a newline and
 * a `##` would break out and forge a heading in the trusted SYSTEM region.
 */
export function formatLocation(c: ConventionCandidate): string {
  const path = sanitizePath(c.evidence_path);
  if (c.evidence_start_line === null) return path;
  if (c.evidence_end_line === null || c.evidence_end_line === c.evidence_start_line) {
    return `${path}:${c.evidence_start_line}`;
  }
  return `${path}:${c.evidence_start_line}-${c.evidence_end_line}`;
}

/** One line, no backticks — so it cannot close the span it is rendered in. */
function sanitizePath(path: string): string {
  return path
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[`\s]+/g, ' ')
    .trim();
}

function uniqueSlug(rule: string, used: Set<string>): string {
  const base = slugify(rule).split('-').slice(0, 5).join('-') || 'convention';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}-${n++}`;
  used.add(candidate);
  return candidate;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * One line, no control characters, no leading markdown structure.
 *
 * `rule` is free-form model output that no proof step validates (only its
 * length is bounded), and it lands in the trusted SYSTEM region via the skill
 * body. Collapsing it to a single line stops it forging a heading, a list or a
 * fence and thereby appearing to be part of the agent's own configuration.
 */
function ensureSentence(rule: string): string {
  const trimmed = rule
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[#>\-*`\s]+/, '')
    .trim();
  if (trimmed.length === 0) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
