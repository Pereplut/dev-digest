/**
 * Prompt assembly for the one onboarding `completeStructured` call (AC-41,
 * AC-42). Pure — builds messages, calls nothing.
 *
 * Every repository-derived string is wrapped individually with
 * `wrapUntrusted()`, including values a casual reading might call "just a
 * path" — a repo-relative path, a script name, an env key name, the repo's
 * own full name — all come from the repository or from whoever added it, not
 * from us (server/INSIGHTS.md, 2026-09-20: "the task line stays outside
 * `<untrusted>` is only half an injection defence" — the rule is about
 * ownership, not position).
 */
import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import type { Facts } from './facts.js';

const SYSTEM_PROMPT_NAME = 'onboarding.system.md';

/** Wrap each item of a list individually, so one tainted entry cannot smuggle the rest out. */
function wrapEach(idPrefix: string, items: readonly string[]): string[] {
  return items.map((item, i) => wrapUntrusted(`${idPrefix}-${i}`, item));
}

function formatChain(chain: readonly string[], index: number): string {
  return `${index + 1}. ${wrapEach('critical-path', chain).join(' -> ')}`;
}

function formatFactsBlock(facts: Facts): string {
  const lines: string[] = [];

  lines.push(`Repository: ${wrapUntrusted('repo-name', facts.repoFullName)}`);
  lines.push('');
  lines.push(`Package manager: ${facts.packageManager ?? 'none detected'}`);
  lines.push(`docker-compose.yml present: ${facts.dockerComposePresent ? 'yes' : 'no'}`);
  lines.push('');

  lines.push('## Scripts (package.json)');
  if (facts.scripts.length === 0) {
    lines.push('(none)');
  } else {
    for (const [i, s] of facts.scripts.entries()) {
      lines.push(`- ${wrapUntrusted(`script-name-${i}`, s.name)}: ${wrapUntrusted(`script-cmd-${i}`, s.command)}`);
    }
  }
  lines.push('');

  lines.push('## run_locally commands (use ONLY these, verbatim, in the run_locally section)');
  if (facts.runLocallyCommands.length === 0) {
    lines.push('(none)');
  } else {
    for (const cmd of wrapEach('run-command', facts.runLocallyCommands)) lines.push(`- ${cmd}`);
  }
  lines.push('');

  lines.push('## Environment variable keys (.env.example)');
  if (facts.envKeys.length === 0) {
    lines.push('(none)');
  } else {
    lines.push(wrapEach('env-key', facts.envKeys).join(', '));
  }
  lines.push('');

  lines.push('## Reading path (ranked, most central first)');
  if (facts.readingPath.length === 0) {
    lines.push('(none — no ranked files available)');
  } else {
    for (const [i, path] of wrapEach('reading-path', facts.readingPath).entries()) {
      lines.push(`${i + 1}. ${path}`);
    }
  }
  lines.push('');

  lines.push('## Critical path chains');
  if (facts.criticalPaths.length === 0) {
    lines.push('(none available)');
  } else {
    facts.criticalPaths.forEach((chain, i) => lines.push(formatChain(chain, i)));
  }
  lines.push('');

  lines.push('## First-tasks signals (code them into first_tasks prose; never invent others)');
  const { findings, candidates } = facts.firstTasksContext;
  if (findings.length === 0 && candidates.length === 0) {
    lines.push('(none)');
  } else {
    findings.forEach((f, i) => {
      lines.push(
        `- Open finding: ${wrapUntrusted(`finding-title-${i}`, f.title)} (${wrapUntrusted(`finding-path-${i}`, f.file)}:${f.startLine})`,
      );
    });
    candidates.forEach((c, i) => {
      lines.push(
        `- Convention candidate: ${wrapUntrusted(`candidate-rule-${i}`, c.rule)} (${wrapUntrusted(`candidate-path-${i}`, c.evidencePath)})`,
      );
    });
  }
  lines.push('');

  if (facts.readme !== null) {
    lines.push('## README excerpt');
    lines.push(wrapUntrusted('readme-excerpt', facts.readme));
  }

  return lines.join('\n');
}

export async function buildOnboardingMessages(facts: Facts): Promise<ChatMessage[]> {
  // The ONLY placeholder the template declares (decision 17); every other
  // `{{var}}` would otherwise ship to the model literally.
  const system = await renderPrompt(SYSTEM_PROMPT_NAME, { language: 'English' });

  const task =
    'Write the five-section onboarding tour described above, grounded strictly in the facts below.';

  return [
    { role: 'system', content: system },
    { role: 'user', content: `${task}\n\n${formatFactsBlock(facts)}` },
  ];
}
