/**
 * `resolvePrecondition` — the onboarding reason ladder (AC-5 to AC-9, AC-86).
 * Pure function, no DB, no IO.
 */
import { describe, it, expect } from 'vitest';
import { resolvePrecondition } from '../src/modules/onboarding/helpers.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

function state(over: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 40,
    filesSkipped: 0,
    durationMs: 10,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date(),
    ...over,
  };
}

describe('resolvePrecondition', () => {
  it('flag_off wins even with an index row present (AC-6)', () => {
    expect(
      resolvePrecondition({
        flagEnabled: false,
        cloneReadable: true,
        indexState: state(),
        rankedCount: 10,
      }),
    ).toBe('flag_off');
  });

  it('no_clone when the clone root is not readable (AC-5)', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: false,
        indexState: state(),
        rankedCount: 10,
      }),
    ).toBe('no_clone');
  });

  it('no_clone covers "clone_path set but lstat failed" the same as a null path', () => {
    // The caller folds both cases into `cloneReadable: false` — covered above.
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: false,
        indexState: null,
        rankedCount: 0,
      }),
    ).toBe('no_clone');
  });

  it('not_indexed when there is no index row at all (AC-7)', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: null,
        rankedCount: 0,
      }),
    ).toBe('not_indexed');
  });

  it.each(['degraded', 'failed'] as const)('not_indexed when the index row status is %s (AC-7)', (status) => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state({ status }),
        rankedCount: 0,
      }),
    ).toBe('not_indexed');
  });

  it('no_source_files for zero indexed files with reason no_files, not not_indexed (AC-8)', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state({ status: 'partial', filesIndexed: 0, reason: 'no_files' }),
        rankedCount: 0,
      }),
    ).toBe('no_source_files');
  });

  it('index_incomplete on the behavioural last rung: a graph failure with zero ranked paths (AC-86)', () => {
    // runFullIndex persists `partial` (not degraded/failed) for a graph
    // failure, filesIndexed > 0, and stats.reason is neither set nor 'no_files'.
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state({ status: 'partial', filesIndexed: 42, reason: undefined }),
        rankedCount: 0,
      }),
    ).toBe('index_incomplete');
  });

  it('index_incomplete ignores status/stats.reason entirely — keys only on rankedCount', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state({ status: 'full', filesIndexed: 500, reason: undefined }),
        rankedCount: 0,
      }),
    ).toBe('index_incomplete');
  });

  it('no_source_files outranks index_incomplete when both hold (AC-9 precedence)', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state({ status: 'partial', filesIndexed: 0, reason: 'no_files' }),
        rankedCount: 0,
      }),
    ).toBe('no_source_files');
  });

  it('a healthy repo with ranked paths resolves to null (negative case)', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state(),
        rankedCount: 25,
      }),
    ).toBeNull();
  });

  it('the same graph-failure row WITH ranked paths resolves to null — the rung is behavioural, not status-keyed', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state({ status: 'partial', filesIndexed: 42, reason: undefined }),
        rankedCount: 3,
      }),
    ).toBeNull();
  });

  it('precedence table: flag_off beats every other reason', () => {
    expect(
      resolvePrecondition({
        flagEnabled: false,
        cloneReadable: false,
        indexState: state({ status: 'failed' }),
        rankedCount: 0,
      }),
    ).toBe('flag_off');
  });

  it('precedence table: no_clone beats not_indexed and index_incomplete', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: false,
        indexState: state({ status: 'failed' }),
        rankedCount: 0,
      }),
    ).toBe('no_clone');
  });

  it('precedence table: not_indexed beats no_source_files and index_incomplete', () => {
    expect(
      resolvePrecondition({
        flagEnabled: true,
        cloneReadable: true,
        indexState: state({ status: 'degraded' }),
        rankedCount: 0,
      }),
    ).toBe('not_indexed');
  });
});
