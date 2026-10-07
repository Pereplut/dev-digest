import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AC-37, AC-47 — a static import-graph assertion, hermetic (no Postgres, no
 * real dependency-cruiser run): `run-executor.ts` must resolve to neither
 * `reviews/run-executor.ts` nor `reviews/diff-loader.ts`, and nothing under
 * `modules/evals/` assembles a prompt of its own. The positive control proves
 * the assertion isn't vacuous — an evals module that reaches no diff at all
 * would pass the negative check trivially.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVALS_DIR = path.join(__dirname, '../src/modules/evals');

function importSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, 'utf8');
  const specifiers: string[] = [];
  const re = /(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) specifiers.push(m[1]!);
  return specifiers;
}

function normalize(p: string): string {
  return path.normalize(p).replace(/\.(js|ts)$/, '');
}

function resolvesTo(specifier: string, fromDir: string, target: string): boolean {
  if (!specifier.startsWith('.')) return false;
  return normalize(path.join(fromDir, specifier)) === normalize(target);
}

function allTsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allTsFilesUnder(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FORBIDDEN_TARGETS = [
  path.join(EVALS_DIR, '../reviews/run-executor'),
  path.join(EVALS_DIR, '../reviews/diff-loader'),
];

describe('evals import graph (AC-37, AC-47)', () => {
  it('run-executor.ts resolves to neither reviews/run-executor nor reviews/diff-loader', () => {
    const file = path.join(EVALS_DIR, 'run-executor.ts');
    const specifiers = importSpecifiers(file);
    for (const spec of specifiers) {
      for (const bad of FORBIDDEN_TARGETS) {
        expect(resolvesTo(spec, EVALS_DIR, bad)).toBe(false);
      }
    }
  });

  it('positive control: service.ts DOES import loadDiff from reviews/diff-loader — for case creation only', () => {
    const file = path.join(EVALS_DIR, 'service.ts');
    const specifiers = importSpecifiers(file);
    const target = path.join(EVALS_DIR, '../reviews/diff-loader');
    expect(specifiers.some((s) => resolvesTo(s, EVALS_DIR, target))).toBe(true);
    // service.ts must NOT reach reviews/run-executor.ts.
    const runExecutorTarget = path.join(EVALS_DIR, '../reviews/run-executor');
    expect(specifiers.some((s) => resolvesTo(s, EVALS_DIR, runExecutorTarget))).toBe(false);
  });

  it('no file under modules/evals/ assembles its own prompt (assemblePrompt / wrapUntrusted)', () => {
    for (const file of allTsFilesUnder(EVALS_DIR)) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not call assemblePrompt`).not.toMatch(/\bassemblePrompt\s*\(/);
      expect(text, `${file} must not call wrapUntrusted`).not.toMatch(/\bwrapUntrusted\s*\(/);
    }
  });
});
